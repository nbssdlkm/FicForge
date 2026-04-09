// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Dirty 章节解除流程。参见 PRD §4.3。
 * 最新章 vs 历史章分流：两者的 state 更新范围完全不同。
 */

import { scan_characters_in_chapter } from "../domain/character_scanner.js";
import { IndexStatus } from "../domain/enums.js";
import type { FactChange } from "../domain/fact_change.js";
import { createOpsEntry } from "../domain/ops_entry.js";
import { extract_last_scene_ending } from "../domain/text_utils.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { FactRepository } from "../repositories/interfaces/fact.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";
import { compute_content_hash, generate_op_id, now_utc } from "../repositories/implementations/file_utils.js";
import { edit_fact, update_fact_status } from "./facts_lifecycle.js";

export class DirtyResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirtyResolveError";
  }
}

// ---------------------------------------------------------------------------
// AU 互斥锁
// ---------------------------------------------------------------------------

const _locks = new Map<string, Promise<void>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = _locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  _locks.set(key, next.then(() => {}, () => {}));
  return next;
}

export interface ResolveDirtyParams {
  au_id: string;
  chapter_num: number;
  confirmed_fact_changes: FactChange[];
  cast_registry?: { characters?: string[] };
  character_aliases?: Record<string, string[]> | null;
  chapter_repo: ChapterRepository;
  state_repo: StateRepository;
  ops_repo: OpsRepository;
  fact_repo: FactRepository;
}

export interface ResolveDirtyResult {
  chapter_num: number;
  is_latest: boolean;
  content_hash: string;
}

export async function resolve_dirty_chapter(params: ResolveDirtyParams): Promise<ResolveDirtyResult> {
  return withLock(params.au_id, () => doResolve(params));
}

async function doResolve(params: ResolveDirtyParams): Promise<ResolveDirtyResult> {
  const {
    au_id, chapter_num, confirmed_fact_changes,
    cast_registry = { characters: [] },
    character_aliases = null,
    chapter_repo, state_repo, ops_repo, fact_repo,
  } = params;

  // === 步骤 1：前置校验 ===
  let state = await state_repo.get(au_id);

  if (!state.chapters_dirty.includes(chapter_num)) {
    throw new DirtyResolveError(`章节 ${chapter_num} 不在 chapters_dirty 列表中`);
  }

  const chapterExists = await chapter_repo.exists(au_id, chapter_num);
  if (!chapterExists) {
    throw new DirtyResolveError(`章节 ${chapter_num} 文件不存在`);
  }

  // === 步骤 2：执行 facts 变更 ===
  const timestamp = now_utc();
  await applyFactChanges(au_id, chapter_num, confirmed_fact_changes, fact_repo, ops_repo, state_repo);

  // 重新读取 state（fact 级联可能已修改并保存）
  state = await state_repo.get(au_id);

  // === 步骤 3：最新章 / 历史章分流 ===
  const isLatest = chapter_num === state.current_chapter - 1;
  let content: string;

  if (isLatest) {
    state.characters_last_seen = await recalcCharactersLatest(
      au_id, chapter_num, chapter_repo, ops_repo, cast_registry, character_aliases,
    );
    content = await chapter_repo.get_content_only(au_id, chapter_num);
    state.last_scene_ending = extract_last_scene_ending(content);
  } else {
    content = await chapter_repo.get_content_only(au_id, chapter_num);
  }

  // === 步骤 4：重算 content_hash ===
  const newHash = await compute_content_hash(content);
  const chapter = await chapter_repo.get(au_id, chapter_num);
  chapter.content_hash = newHash;
  chapter.revision += 1;
  chapter.confirmed_at = now_utc();
  await chapter_repo.save(chapter);

  // === 步骤 5：更新 state.yaml ===
  const dirtyIdx = state.chapters_dirty.indexOf(chapter_num);
  if (dirtyIdx >= 0) state.chapters_dirty.splice(dirtyIdx, 1);
  state.index_status = IndexStatus.STALE;
  await state_repo.save(state);

  // === 步骤 6：append ops.jsonl ===
  await ops_repo.append(au_id, createOpsEntry({
    op_id: generate_op_id(),
    op_type: "resolve_dirty_chapter",
    target_id: chapter.chapter_id,
    chapter_num,
    timestamp,
    payload: {},
  }));

  return {
    chapter_num,
    is_latest: isLatest,
    content_hash: newHash,
  };
}

// -----------------------------------------------------------------
// 步骤 2：facts 变更
// -----------------------------------------------------------------

async function applyFactChanges(
  au_id: string,
  chapter_num: number,
  changes: FactChange[],
  fact_repo: FactRepository,
  ops_repo: OpsRepository,
  state_repo: StateRepository,
): Promise<void> {
  for (const change of changes) {
    if (change.action === "keep") continue;

    if (change.action === "update" && change.updated_fields) {
      await edit_fact(au_id, change.fact_id, change.updated_fields, fact_repo, ops_repo, state_repo);
    } else if (change.action === "deprecate") {
      await update_fact_status(au_id, change.fact_id, "deprecated", chapter_num, fact_repo, ops_repo, state_repo);
    }
  }
}

// -----------------------------------------------------------------
// 步骤 3：最新章 characters_last_seen 重算
// -----------------------------------------------------------------

async function recalcCharactersLatest(
  au_id: string,
  chapter_num: number,
  chapter_repo: ChapterRepository,
  ops_repo: OpsRepository,
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null,
): Promise<Record<string, number>> {
  // 获取基线
  const baseline = await getBaseline(au_id, chapter_num, chapter_repo, ops_repo, cast_registry, character_aliases);

  // 扫描第 N 章
  const content = await chapter_repo.get_content_only(au_id, chapter_num);
  const scanned = scan_characters_in_chapter(content, cast_registry, character_aliases, chapter_num);

  // 合并（取 max）
  for (const [name, chNum] of Object.entries(scanned)) {
    if (chNum > (baseline[name] ?? 0)) {
      baseline[name] = chNum;
    }
  }

  return baseline;
}

async function getBaseline(
  au_id: string,
  n: number,
  chapter_repo: ChapterRepository,
  ops_repo: OpsRepository,
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null,
): Promise<Record<string, number>> {
  if (n <= 1) return {};

  // 优先：ops 快照
  const confirmOp = await ops_repo.get_confirm_for_chapter(au_id, n - 1);
  if (confirmOp) {
    const snapshot = confirmOp.payload.characters_last_seen_snapshot;
    if (snapshot && typeof snapshot === "object") {
      try {
        const result: Record<string, number> = {};
        for (const [k, v] of Object.entries(snapshot as Record<string, unknown>)) {
          const num = Number(v);
          if (Number.isNaN(num)) throw new Error("invalid snapshot value");
          result[String(k)] = num;
        }
        return result;
      } catch {
        // 快照数据损坏，降级到扫描
      }
    }
  }

  // 降级：扫描 N-3 到 N-1 章
  return scanRecentChapters(au_id, n, chapter_repo, cast_registry, character_aliases);
}

async function scanRecentChapters(
  au_id: string,
  n: number,
  chapter_repo: ChapterRepository,
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null,
): Promise<Record<string, number>> {
  const allChapters = await chapter_repo.list_main(au_id);
  const start = Math.max(1, n - 3);
  let targetChapters = allChapters.filter((ch) => ch.chapter_num >= start && ch.chapter_num <= n - 1);

  if (targetChapters.length < 3) {
    targetChapters = allChapters.filter((ch) => ch.chapter_num < n);
  }

  const result: Record<string, number> = {};
  for (const ch of targetChapters) {
    const scanned = scan_characters_in_chapter(ch.content, cast_registry, character_aliases, ch.chapter_num);
    for (const [name, chNum] of Object.entries(scanned)) {
      if (chNum > (result[name] ?? 0)) {
        result[name] = chNum;
      }
    }
  }
  return result;
}
