// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Facts 生命周期管理。参见 PRD §3.6、§6.7、§4.3。
 * 四个 Service 方法：add_fact / edit_fact / update_fact_status / set_chapter_focus。
 */

import { FactSource, FactStatus, FactType, NarrativeWeight } from "../domain/enums.js";
import type { Fact } from "../domain/fact.js";
import { createFact } from "../domain/fact.js";
import { createOpsEntry } from "../domain/ops_entry.js";
import type { FactRepository } from "../repositories/interfaces/fact.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";
import { generate_fact_id, generate_op_id, now_utc } from "../repositories/implementations/file_utils.js";

export class FactsLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactsLifecycleError";
  }
}

// ---------------------------------------------------------------------------
// 别名归一化
// ---------------------------------------------------------------------------

function normalizeCharacters(
  characters: string[],
  character_aliases: Record<string, string[]>,
): string[] {
  if (!character_aliases || Object.keys(character_aliases).length === 0) {
    return characters;
  }

  const aliasMap = new Map<string, string>();
  for (const [mainName, aliases] of Object.entries(character_aliases)) {
    for (const alias of aliases) {
      aliasMap.set(alias, mainName);
    }
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const name of characters) {
    const main = aliasMap.get(name) ?? name;
    if (!seen.has(main)) {
      result.push(main);
      seen.add(main);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 悬空 ID 级联清理
// ---------------------------------------------------------------------------

async function cleanDanglingFocus(
  au_id: string,
  fact_id: string,
  state_repo: StateRepository,
): Promise<boolean> {
  const state = await state_repo.get(au_id);
  let changed = false;
  let wasInFocus = false;

  const focusIdx = state.chapter_focus.indexOf(fact_id);
  if (focusIdx >= 0) {
    state.chapter_focus.splice(focusIdx, 1);
    wasInFocus = true;
    changed = true;
  }

  const lastIdx = state.last_confirmed_chapter_focus.indexOf(fact_id);
  if (lastIdx >= 0) {
    state.last_confirmed_chapter_focus.splice(lastIdx, 1);
    changed = true;
  }

  if (changed) {
    await state_repo.save(state);
  }

  return wasInFocus;
}

// ---------------------------------------------------------------------------
// resolves 联动
// ---------------------------------------------------------------------------

async function applyResolvesForward(
  au_id: string,
  resolves_target_id: string,
  fact_repo: FactRepository,
): Promise<void> {
  const target = await fact_repo.get(au_id, resolves_target_id);
  if (target !== null && target.status !== FactStatus.RESOLVED) {
    target.status = FactStatus.RESOLVED;
    await fact_repo.update(au_id, target);
  }
}

async function applyResolvesReverse(
  au_id: string,
  old_resolves_target_id: string,
  fact_repo: FactRepository,
): Promise<void> {
  const allFacts = await fact_repo.list_all(au_id);
  const stillResolved = allFacts.some((f) => f.resolves === old_resolves_target_id);
  if (!stillResolved) {
    const target = await fact_repo.get(au_id, old_resolves_target_id);
    if (target !== null && target.status === FactStatus.RESOLVED) {
      target.status = FactStatus.UNRESOLVED;
      await fact_repo.update(au_id, target);
    }
  }
}

// ===========================================================================
// Service 方法
// ===========================================================================

export async function add_fact(
  au_id: string,
  chapter_num: number,
  fact_data: Record<string, unknown>,
  fact_repo: FactRepository,
  ops_repo: OpsRepository,
  source = "manual",
  character_aliases: Record<string, string[]> | null = null,
): Promise<Fact> {
  const ts = now_utc();

  let characters = (fact_data.characters as string[]) ?? [];
  if (character_aliases) {
    characters = normalizeCharacters(characters, character_aliases);
  }

  const fact = createFact({
    id: generate_fact_id(),
    content_raw: (fact_data.content_raw as string) ?? "",
    content_clean: (fact_data.content_clean as string) ?? "",
    characters,
    timeline: (fact_data.timeline as string) ?? "",
    story_time: (fact_data.story_time as string) ?? "",
    chapter: (fact_data.chapter as number) ?? chapter_num,
    status: (fact_data.status as FactStatus) ?? FactStatus.ACTIVE,
    type: (fact_data.type as FactType) ?? FactType.PLOT_EVENT,
    resolves: (fact_data.resolves as string) ?? null,
    narrative_weight: (fact_data.narrative_weight as NarrativeWeight) ?? NarrativeWeight.MEDIUM,
    source: source as FactSource,
    revision: 1,
    created_at: ts,
    updated_at: ts,
  });

  await fact_repo.append(au_id, fact);

  // resolves 正向联动
  if (fact.resolves) {
    await applyResolvesForward(au_id, fact.resolves, fact_repo);
  }

  // ops
  await ops_repo.append(
    au_id,
    createOpsEntry({
      op_id: generate_op_id(),
      op_type: "add_fact",
      target_id: fact.id,
      chapter_num,
      timestamp: ts,
      payload: {
        content_clean: fact.content_clean,
        status: fact.status,
      },
    }),
  );

  return fact;
}

export async function edit_fact(
  au_id: string,
  fact_id: string,
  updated_fields: Record<string, unknown>,
  fact_repo: FactRepository,
  ops_repo: OpsRepository,
  state_repo: StateRepository,
  character_aliases: Record<string, string[]> | null = null,
): Promise<Fact> {
  const fact = await fact_repo.get(au_id, fact_id);
  if (fact === null) {
    throw new FactsLifecycleError(`Fact 不存在: ${fact_id}`);
  }

  const oldResolves = fact.resolves;
  const oldStatus = fact.status;

  // 别名归一化
  if ("characters" in updated_fields && character_aliases) {
    updated_fields.characters = normalizeCharacters(
      updated_fields.characters as string[],
      character_aliases,
    );
  }

  // 应用字段更新
  const enumFields: Record<string, (v: string) => string> = {
    status: (v) => v as FactStatus,
    type: (v) => v as FactType,
    narrative_weight: (v) => v as NarrativeWeight,
    source: (v) => v as FactSource,
  };
  for (const [key, value] of Object.entries(updated_fields)) {
    if (key in fact) {
      (fact as unknown as Record<string, unknown>)[key] =
        key in enumFields && typeof value === "string" ? enumFields[key](value) : value;
    }
  }

  await fact_repo.update(au_id, fact);

  // resolves 级联
  const newResolves = fact.resolves;
  if (oldResolves !== newResolves) {
    if (newResolves) {
      await applyResolvesForward(au_id, newResolves, fact_repo);
    }
    if (oldResolves) {
      await applyResolvesReverse(au_id, oldResolves, fact_repo);
    }
  }

  // 悬空 ID 级联清理
  const newStatus = fact.status;
  if (
    (newStatus === FactStatus.DEPRECATED || newStatus === FactStatus.RESOLVED) &&
    oldStatus !== newStatus
  ) {
    await cleanDanglingFocus(au_id, fact_id, state_repo);
  }

  // ops
  await ops_repo.append(
    au_id,
    createOpsEntry({
      op_id: generate_op_id(),
      op_type: "edit_fact",
      target_id: fact_id,
      timestamp: now_utc(),
      payload: { updated_fields },
    }),
  );

  return fact;
}

export async function update_fact_status(
  au_id: string,
  fact_id: string,
  new_status: string,
  chapter_num: number,
  fact_repo: FactRepository,
  ops_repo: OpsRepository,
  state_repo: StateRepository,
): Promise<{ fact_id: string; new_status: string; focus_warning: boolean }> {
  const fact = await fact_repo.get(au_id, fact_id);
  if (fact === null) {
    throw new FactsLifecycleError(`Fact 不存在: ${fact_id}`);
  }

  const oldStatus = fact.status;
  fact.status = new_status as FactStatus;

  await fact_repo.update(au_id, fact);

  // 悬空 ID 级联清理
  let focusWarning = false;
  if (new_status === "deprecated" || new_status === "resolved") {
    focusWarning = await cleanDanglingFocus(au_id, fact_id, state_repo);
  }

  // ops
  await ops_repo.append(
    au_id,
    createOpsEntry({
      op_id: generate_op_id(),
      op_type: "update_fact_status",
      target_id: fact_id,
      chapter_num,
      timestamp: now_utc(),
      payload: { old_status: oldStatus, new_status },
    }),
  );

  return { fact_id, new_status, focus_warning: focusWarning };
}

export async function set_chapter_focus(
  au_id: string,
  focus_ids: string[],
  fact_repo: FactRepository,
  ops_repo: OpsRepository,
  state_repo: StateRepository,
): Promise<{ focus_ids: string[] }> {
  // 校验长度
  if (focus_ids.length > 2) {
    throw new FactsLifecycleError(`chapter_focus 最多 2 个，收到 ${focus_ids.length} 个`);
  }

  // 校验每个 ID
  for (const fid of focus_ids) {
    const fact = await fact_repo.get(au_id, fid);
    if (fact === null) {
      throw new FactsLifecycleError(`Fact 不存在: ${fid}`);
    }
    if (fact.status !== FactStatus.UNRESOLVED) {
      throw new FactsLifecycleError(`Fact ${fid} 的 status 为 ${fact.status}，只能选 unresolved`);
    }
  }

  // 更新 state
  const state = await state_repo.get(au_id);
  state.chapter_focus = [...focus_ids];
  await state_repo.save(state);

  // ops
  await ops_repo.append(
    au_id,
    createOpsEntry({
      op_id: generate_op_id(),
      op_type: "set_chapter_focus",
      target_id: au_id,
      chapter_num: state.current_chapter,
      timestamp: now_utc(),
      payload: { focus: [...focus_ids] },
    }),
  );

  return { focus_ids: [...focus_ids] };
}
