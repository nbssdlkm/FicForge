// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Facts 生命周期管理。参见 PRD §3.6、§6.7、§4.3。
 * 四个 Service 方法：addFact / editFact / updateFactStatus / setChapterFocus。
 *
 * ⚠️ 本层不持 AU 锁 —— 是"底层 service"。
 * 原因：dirty_resolve 等已持锁的 orchestrator 会内部调用这些函数，
 * 如果本层加同一把 AU 锁会重入死锁。
 * 调用者必须已持锁，保证机制：
 *   - UI 直接调用：engine-facts.ts 的入口包 withAuLock
 *   - service 内部调用：由 orchestrator 入口的 withAuLock 覆盖
 * 分层策略详见 services/au_lock.ts。
 */

import { FactSource, FactStatus, FactType, NarrativeWeight, TimeKind, SuspenseType } from "../domain/enums.js";
import type { Fact } from "../domain/fact.js";
import { createFact } from "../domain/fact.js";
import { createOpsEntry } from "../domain/ops_entry.js";
import type { FactRepository } from "../repositories/interfaces/fact.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";
import { generateFactId, generateOpId, nowUtc } from "../utils/file_utils.js";
import { WriteTransaction } from "./write_transaction.js";
import { hasLogger, getLogger } from "../logger/index.js";
import {
  normalizeCharacters,
  sanitizeKnownTo,
  sanitizeHiddenFrom,
  sanitizeConfidence,
  reconcileKnowledge,
  CONFIDENCE_FIELD_KEYS,
} from "../domain/fact_sanitize.js";

// 归一化函数已下沉 domain/fact_sanitize（M3 批一：写路径与 ops 回放共用消毒判据）。
// 这里保留 re-export，既有导入点（facts_extraction 等）零改动。
export { normalizeCharacters };

export class FactsLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactsLifecycleError";
  }
}

// ---------------------------------------------------------------------------
// M8-A 枚举校验集合（addFact 路径与 rawToExtracted 对齐）
// ---------------------------------------------------------------------------

const TIME_KIND_SET = new Set(Object.values(TimeKind) as string[]);
const SUSPENSE_SET = new Set(Object.values(SuspenseType) as string[]);

// ---------------------------------------------------------------------------
// 悬空 ID 级联清理
// ---------------------------------------------------------------------------

/** 纯内存操作：从 state 的 focus 列表中移除指定 fact_id。不落盘。 */
function applyDanglingFocusCleanup(
  state: { chapter_focus: string[]; last_confirmed_chapter_focus: string[] },
  fact_id: string,
): { wasInFocus: boolean; changed: boolean } {
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

  return { wasInFocus, changed };
}

// ---------------------------------------------------------------------------
// resolves 联动（返回待写入的 op + fact，由调用方塞进 tx 提交）
// ---------------------------------------------------------------------------

interface ResolvesEffect {
  op: ReturnType<typeof createOpsEntry>;
  fact: Fact;
}

async function collectResolvesForward(
  au_id: string,
  resolves_target_id: string,
  chapter_num: number,
  fact_repo: FactRepository,
): Promise<ResolvesEffect | null> {
  const target = await fact_repo.get(au_id, resolves_target_id);
  if (target !== null && target.status !== FactStatus.RESOLVED) {
    const oldStatus = target.status;
    target.status = FactStatus.RESOLVED;
    return {
      op: createOpsEntry({
        op_id: generateOpId(),
        op_type: "update_fact_status",
        target_id: resolves_target_id,
        chapter_num,
        timestamp: nowUtc(),
        payload: {
          old_status: oldStatus,
          new_status: FactStatus.RESOLVED,
          reason: "resolves_cascade",
        },
      }),
      fact: target,
    };
  }
  return null;
}

async function collectResolvesReverse(
  au_id: string,
  old_resolves_target_id: string,
  chapter_num: number,
  fact_repo: FactRepository,
  exclude_fact_id?: string,
): Promise<ResolvesEffect | null> {
  const allFacts = await fact_repo.listAll(au_id);
  // exclude_fact_id: 正在编辑的 fact，其 resolves 字段即将被移除，
  // 但磁盘上尚未更新，需要从 "仍然 resolves" 检查中排除
  const stillResolved = allFacts.some((f) => f.resolves === old_resolves_target_id && f.id !== exclude_fact_id);
  if (!stillResolved) {
    const target = await fact_repo.get(au_id, old_resolves_target_id);
    if (target !== null && target.status === FactStatus.RESOLVED) {
      const oldStatus = target.status;
      target.status = FactStatus.UNRESOLVED;
      return {
        op: createOpsEntry({
          op_id: generateOpId(),
          op_type: "update_fact_status",
          target_id: old_resolves_target_id,
          chapter_num,
          timestamp: nowUtc(),
          payload: {
            old_status: oldStatus,
            new_status: FactStatus.UNRESOLVED,
            reason: "resolves_cascade_reverse",
          },
        }),
        fact: target,
      };
    }
  }
  return null;
}

// ===========================================================================
// Service 方法
// ===========================================================================

export async function addFact(
  au_id: string,
  chapter_num: number,
  fact_data: Record<string, unknown>,
  fact_repo: FactRepository,
  ops_repo: OpsRepository,
  source = "manual",
  character_aliases: Record<string, string[]> | null = null,
): Promise<Fact> {
  const ts = nowUtc();

  let characters = (fact_data.characters as string[]) ?? [];
  if (character_aliases) {
    characters = normalizeCharacters(characters, character_aliases);
  }

  // M8-A: time_kind / suspense_type — validate enum, illegal → null (与 rawToExtracted 对齐)
  const rawTimeKind = fact_data.time_kind as string | undefined;
  const rawSuspense = fact_data.suspense_type as string | undefined;

  // M8-A: known_to / hidden_from — 单一真相源消毒（domain/fact_sanitize，M3 批一）。
  // add 语境形状非法（数字/对象等）无旧值可保 → 按 null / [] 落库（与旧行为一致：42 → null）。
  const knownToRes = sanitizeKnownTo(fact_data.known_to, character_aliases);
  const hiddenFromRes = sanitizeHiddenFrom(fact_data.hidden_from, character_aliases);
  // 跨字段矛盾在写入口化解（对抗审 MED-3：同名同现两名单 / all+hidden 并存）
  const { known_to: knownTo, hidden_from: hiddenFrom } = reconcileKnowledge(
    knownToRes.ok ? knownToRes.value : null,
    hiddenFromRes.ok ? hiddenFromRes.value : [],
  );
  const confidenceRes = sanitizeConfidence(fact_data._confidence);

  const fact = createFact({
    id: generateFactId(),
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
    // Layer 2 (M8-A) — forwarded from fact_data, not silently dropped
    location: (fact_data.location as string | undefined) ?? null,
    story_time_tag: (fact_data.story_time_tag as string | undefined) ?? null,
    story_time_order: typeof fact_data.story_time_order === "number" ? fact_data.story_time_order : null,
    time_kind: rawTimeKind && TIME_KIND_SET.has(rawTimeKind) ? (rawTimeKind as TimeKind) : null,
    action_verb: (fact_data.action_verb as string | undefined) ?? null,
    caused_by: Array.isArray(fact_data.caused_by) ? (fact_data.caused_by as string[]) : [],
    // Layer 3 (M8-A)
    known_to: knownTo,
    hidden_from: hiddenFrom,
    suspense_type: rawSuspense && SUSPENSE_SET.has(rawSuspense) ? (rawSuspense as SuspenseType) : null,
    // Thread 关联（M8-B）—— 必须从 fact_data 转发进 fact，否则下面的快照 / 持久化拿不到（M8-A 教训）
    thread_ids: Array.isArray(fact_data.thread_ids) ? (fact_data.thread_ids as string[]) : [],
    thread_roles:
      typeof fact_data.thread_roles === "object" && fact_data.thread_roles !== null
        ? (fact_data.thread_roles as Record<string, string>)
        : undefined,
    // _confidence（形状消毒：仅保留已知键 + 合法档位；非法形状 → undefined，M3 批一）
    _confidence: confidenceRes.ok ? confidenceRes.value : undefined,
  });

  // WriteTransaction 保证 D-0036 写入顺序：ops → facts
  const tx = new WriteTransaction();
  tx.appendOp(
    au_id,
    createOpsEntry({
      op_id: generateOpId(),
      op_type: "add_fact",
      target_id: fact.id,
      chapter_num,
      timestamp: ts,
      payload: {
        content_clean: fact.content_clean,
        status: fact.status,
        fact: {
          id: fact.id,
          content_raw: fact.content_raw,
          content_clean: fact.content_clean,
          characters: fact.characters,
          chapter: fact.chapter,
          status: fact.status,
          type: fact.type,
          narrative_weight: fact.narrative_weight,
          source: fact.source,
          timeline: fact.timeline,
          story_time: fact.story_time,
          resolves: fact.resolves,
          revision: fact.revision,
          created_at: fact.created_at,
          updated_at: fact.updated_at,
          // Layer 2 (M8-A) — only include if present, keeps op payload lean
          ...(fact.location != null ? { location: fact.location } : {}),
          ...(fact.story_time_tag != null ? { story_time_tag: fact.story_time_tag } : {}),
          ...(fact.story_time_order != null ? { story_time_order: fact.story_time_order } : {}),
          ...(fact.time_kind != null ? { time_kind: fact.time_kind } : {}),
          ...(fact.action_verb != null ? { action_verb: fact.action_verb } : {}),
          ...(fact.caused_by?.length ? { caused_by: fact.caused_by } : {}),
          // Layer 3 (M8-A)
          ...(fact.known_to != null ? { known_to: fact.known_to } : {}),
          ...(fact.hidden_from?.length ? { hidden_from: fact.hidden_from } : {}),
          ...(fact.suspense_type != null ? { suspense_type: fact.suspense_type } : {}),
          // Thread 关联（M8-B）—— 不进快照则 hop 3 无从恢复（M8-A 同款 BLOCKER 教训）
          ...(fact.thread_ids?.length ? { thread_ids: fact.thread_ids } : {}),
          ...(fact.thread_roles && Object.keys(fact.thread_roles).length ? { thread_roles: fact.thread_roles } : {}),
          // _confidence
          ...(fact._confidence ? { _confidence: fact._confidence } : {}),
        },
      },
    }),
  );
  tx.appendFact(au_id, fact);

  // resolves 联动：读取 target fact，构造 op + fact 更新，塞进同一个 tx
  if (fact.resolves) {
    const effect = await collectResolvesForward(au_id, fact.resolves, chapter_num, fact_repo);
    if (effect) {
      tx.appendOp(au_id, effect.op);
      tx.updateFact(au_id, effect.fact);
    }
  }

  await tx.commit(ops_repo, fact_repo, null);

  return fact;
}

export async function editFact(
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
    updated_fields.characters = normalizeCharacters(updated_fields.characters as string[], character_aliases);
  }

  // 应用字段更新。H-fix：枚举字段必须运行时校验 —— 旧代码 `(v)=>v as FactStatus` 是纯类型 cast，
  // 非法枚举（如 status:"resloved"）会静默写进 facts.jsonl，让 fact 从所有按 status 筛选的视图 +
  // 上下文组装里消失（dictToFact 读回时也不校验这 4 个字段）。非法值一律拒绝（保留 fact 现有合法
  // 值）+ 记警告；op 只记实际生效的字段，avoid 把垃圾写进 ops.jsonl。
  const enumValueSets: Record<string, ReadonlySet<string>> = {
    status: new Set<string>(Object.values(FactStatus)),
    type: new Set<string>(Object.values(FactType)),
    narrative_weight: new Set<string>(Object.values(NarrativeWeight)),
    source: new Set<string>(Object.values(FactSource)),
  };
  const appliedFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updated_fields)) {
    if (!(key in fact)) continue;
    // M3 批一：_confidence 为引擎自管字段（人改富化字段时由下方统一升 high）——不接受外部
    // 直写，防调用方手拼判据形成第二真相源，也防无形状校验的垃圾落盘（第三路调查 1a）。
    if (key === "_confidence") {
      if (hasLogger()) getLogger().warn("facts", "edit_fact 拒绝外部直写 _confidence（引擎自管）", { fact_id });
      continue;
    }
    // M3 批一：知情边界字段走单一真相源消毒（与 ops 回放对称，见 domain/fact_sanitize）。
    // 形状非法 → 拒绝 + warn + 保留现值（与枚举校验同语义）。
    if (key === "known_to" || key === "hidden_from") {
      const res =
        key === "known_to" ? sanitizeKnownTo(value, character_aliases) : sanitizeHiddenFrom(value, character_aliases);
      if (!res.ok) {
        if (hasLogger()) getLogger().warn("facts", `edit_fact 拒绝非法形状 ${key}`, { fact_id, value: String(value) });
        continue;
      }
      // 同值编辑不算变更（对抗审 MED-2）：否则「原样保存」也会落 op、涨 revision，
      // 还会把未经人工纠正的 LLM 低置信标注误升 high。
      if (JSON.stringify(res.value) === JSON.stringify((fact as unknown as Record<string, unknown>)[key])) {
        continue;
      }
      (fact as unknown as Record<string, unknown>)[key] = res.value;
      appliedFields[key] = res.value;
      continue;
    }
    const enumSet = enumValueSets[key];
    if (enumSet && !(typeof value === "string" && enumSet.has(value))) {
      if (hasLogger()) getLogger().warn("facts", `edit_fact 拒绝非法枚举 ${key}`, { fact_id, value: String(value) });
      continue; // 保留现值，不落库垃圾
    }
    // 同值编辑跳过（对抗审 MED-2）：UI 的非受控表单每次保存都会带上全部字段，
    // 结构化等值的不再进 applied —— 配合下方空 applied 早退，根治 revision 空转。
    if (JSON.stringify(value) === JSON.stringify((fact as unknown as Record<string, unknown>)[key])) {
      continue;
    }
    (fact as unknown as Record<string, unknown>)[key] = value;
    appliedFields[key] = value;
  }

  // 知情字段被实际编辑时，跨字段矛盾在写侧化解（对抗审 MED-3；未触碰知情字段的编辑
  // 不顺手改动存量数据 —— 化解只在用户动了这两个字段之一时发生）。
  if ("known_to" in appliedFields || "hidden_from" in appliedFields) {
    const rec = reconcileKnowledge(fact.known_to ?? null, fact.hidden_from ?? []);
    if (JSON.stringify(rec.known_to) !== JSON.stringify(fact.known_to ?? null)) {
      fact.known_to = rec.known_to;
      appliedFields.known_to = rec.known_to;
    }
    if (JSON.stringify(rec.hidden_from) !== JSON.stringify(fact.hidden_from ?? [])) {
      fact.hidden_from = rec.hidden_from;
      appliedFields.hidden_from = rec.hidden_from;
    }
  }

  // 空编辑早退（第三路调查发现④）：全部键被拒/无有效变更时不落 op、不 bump revision——
  // 否则无脏检查的保存会造成 revision 空转 + 空审计记录。此时 status/resolves 均未动，
  // 下方级联分支本就不会触发，返回现有 fact 安全。
  if (Object.keys(appliedFields).length === 0) {
    return fact;
  }

  // 人改必然注入（第三路调查发现②）：人工编辑过的富化字段 per-field 置信度升 high。
  // 仅在 fact 已有 _confidence（ReAct/LLM 产物）时需要——无 _confidence 本就无门控必注入，
  // 不凭空造对象（与 react_extraction_dispatch H10 约定一致）。删键/删对象方案均不可行：
  // 删单键仍走「_confidence 存在但缺条目 → 抑制」路径；删整对象会放行其它字段的 low 置信猜测。
  if (fact._confidence) {
    let upgraded = false;
    for (const key of CONFIDENCE_FIELD_KEYS) {
      if (key in appliedFields) {
        fact._confidence[key] = "high";
        upgraded = true;
      }
    }
    // _confidence 变更并入同一条 edit_fact op：ops 回放（白名单含 _confidence）与磁盘天然一致
    if (upgraded) appliedFields._confidence = { ...fact._confidence };
  }

  // 悬空 ID 级联清理（内存操作，不落盘）
  const newStatus = fact.status;
  let needStateSave = false;
  let state: Awaited<ReturnType<StateRepository["get"]>> | null = null;
  if ((newStatus === FactStatus.DEPRECATED || newStatus === FactStatus.RESOLVED) && oldStatus !== newStatus) {
    state = await state_repo.get(au_id);
    const { changed } = applyDanglingFocusCleanup(state, fact_id);
    needStateSave = changed;
  }

  // WriteTransaction 保证 D-0036 写入顺序：ops → facts → state
  const tx = new WriteTransaction();
  tx.appendOp(
    au_id,
    createOpsEntry({
      op_id: generateOpId(),
      op_type: "edit_fact",
      target_id: fact_id,
      timestamp: nowUtc(),
      payload: { updated_fields: appliedFields },
    }),
  );
  tx.updateFact(au_id, fact);
  if (needStateSave && state) {
    tx.appendOp(
      au_id,
      createOpsEntry({
        op_id: generateOpId(),
        op_type: "set_chapter_focus",
        target_id: au_id,
        timestamp: nowUtc(),
        payload: { focus: [...state.chapter_focus] },
      }),
    );
    tx.setState(state);
  }
  // resolves 联动：读取 target fact(s)，构造 op + fact 更新，塞进同一个 tx
  const newResolves = fact.resolves;
  if (oldResolves !== newResolves) {
    if (newResolves) {
      const effect = await collectResolvesForward(au_id, newResolves, fact.chapter, fact_repo);
      if (effect) {
        tx.appendOp(au_id, effect.op);
        tx.updateFact(au_id, effect.fact);
      }
    }
    if (oldResolves) {
      const effect = await collectResolvesReverse(au_id, oldResolves, fact.chapter, fact_repo, fact_id);
      if (effect) {
        tx.appendOp(au_id, effect.op);
        tx.updateFact(au_id, effect.fact);
      }
    }
  }

  await tx.commit(ops_repo, fact_repo, state_repo);

  return fact;
}

export async function updateFactStatus(
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

  // 悬空 ID 级联清理（内存操作，不落盘）
  let focusWarning = false;
  let needStateSave = false;
  let state: Awaited<ReturnType<StateRepository["get"]>> | null = null;
  if (new_status === "deprecated" || new_status === "resolved") {
    state = await state_repo.get(au_id);
    const { wasInFocus, changed } = applyDanglingFocusCleanup(state, fact_id);
    focusWarning = wasInFocus;
    needStateSave = changed;
  }

  // WriteTransaction 保证 D-0036 写入顺序：ops → facts → state
  const tx = new WriteTransaction();
  tx.appendOp(
    au_id,
    createOpsEntry({
      op_id: generateOpId(),
      op_type: "update_fact_status",
      target_id: fact_id,
      chapter_num,
      timestamp: nowUtc(),
      payload: { old_status: oldStatus, new_status },
    }),
  );
  tx.updateFact(au_id, fact);
  if (needStateSave && state) {
    tx.appendOp(
      au_id,
      createOpsEntry({
        op_id: generateOpId(),
        op_type: "set_chapter_focus",
        target_id: au_id,
        timestamp: nowUtc(),
        payload: { focus: [...state.chapter_focus] },
      }),
    );
    tx.setState(state);
  }
  // TD-014: 作废一个 resolver → 反向级联。若没有别的 fact 仍 resolve 其目标，把目标退回 UNRESOLVED
  // （揭示者作废后伏笔不该还挂 RESOLVED）。exclude=fact_id：被作废的 fact 其 resolves 字段还在盘上，
  // 但已不该算作有效 resolver，从「仍 resolves」检查中排除。
  // 仅 deprecate 触发：其它状态（resolved/active）不影响 fact 作为 resolver 的有效性。
  // undo 路径的同款反向级联已由 undo_chapter.ts 的 collectResolvesRollback 覆盖，不在此处理。
  if (fact.status === FactStatus.DEPRECATED && fact.resolves) {
    const effect = await collectResolvesReverse(au_id, fact.resolves, chapter_num, fact_repo, fact_id);
    if (effect) {
      tx.appendOp(au_id, effect.op);
      tx.updateFact(au_id, effect.fact);
    }
  }
  await tx.commit(ops_repo, fact_repo, state_repo);

  return { fact_id, new_status, focus_warning: focusWarning };
}

export async function setChapterFocus(
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

  // WriteTransaction 保证 D-0036 写入顺序：ops → state
  const state = await state_repo.get(au_id);
  state.chapter_focus = [...focus_ids];

  const tx = new WriteTransaction();
  tx.appendOp(
    au_id,
    createOpsEntry({
      op_id: generateOpId(),
      op_type: "set_chapter_focus",
      target_id: au_id,
      chapter_num: state.current_chapter,
      timestamp: nowUtc(),
      payload: { focus: [...focus_ids] },
    }),
  );
  tx.setState(state);
  await tx.commit(ops_repo, null, state_repo);

  return { focus_ids: [...focus_ids] };
}

// ===========================================================================
// M10-B: 冷热分层 — archiveFact / unarchiveFact / runArchivalSweep
// ===========================================================================

/** 距当前章节 ≥ ARCHIVE_DISTANCE 的 low-weight active/unresolved fact 进入冷区。抽为常量便于调参。 */
export const ARCHIVE_DISTANCE = 10;

/**
 * 冷区固化判据（单一真相源）。spec §七.2 / CC 拍板 Q2：
 *   active/unresolved + narrative_weight=low + 距当前章 ≥ threshold + 未归档。
 * findArchivalCandidates（预览）与 runArchivalSweep（实归档）共用，避免两处对「冷」漂移。
 */
export function isArchivalCandidate(
  fact: Fact,
  current_chapter: number,
  cold_threshold_chapters: number = ARCHIVE_DISTANCE,
): boolean {
  return (
    (fact.status === FactStatus.ACTIVE || fact.status === FactStatus.UNRESOLVED) &&
    fact.narrative_weight === NarrativeWeight.LOW &&
    fact.chapter <= current_chapter - cold_threshold_chapters &&
    fact.archived !== true
  );
}

/**
 * 只读：列出满足冷区判据的 fact（不写任何东西）。
 * Q4 用户确认流的预览步——UI 先拿这个给用户看「打算归档哪些」，确认后才调 archiveFacts。
 */
export async function findArchivalCandidates(
  au_id: string,
  current_chapter: number,
  fact_repo: FactRepository,
  cold_threshold_chapters: number = ARCHIVE_DISTANCE,
): Promise<Fact[]> {
  const all = await fact_repo.listAll(au_id);
  return all.filter((f) => isArchivalCandidate(f, current_chapter, cold_threshold_chapters));
}

/**
 * 批量归档「用户确认过的」指定 fact_id。逐条 archiveFact；不存在/已归档幂等跳过。
 * 调用者须已持 AU 锁。Q4：UI 传进来的是用户在预览里勾选确认的子集，不重新扫（防 TOCTOU 把
 * 预览后新变冷的 fact 也一起归了——只动用户实际看过、确认过的那些）。
 * @returns 实际归档掉的 fact_id 列表
 */
export async function archiveFacts(
  au_id: string,
  fact_ids: string[],
  fact_repo: FactRepository,
  ops_repo: OpsRepository,
): Promise<string[]> {
  // ponytail: 逐条 archiveFact = 每条重写整个 facts.jsonl（O(n²)，与 batchUpdateFactStatus 同款既存特性）。
  // 单次锁内、正确性无碍；只有「一次性归档上百条冷 fact」才会有秒级卡顿。真撞上再给 repo 加 bulk 写一次过。
  const archived: string[] = [];
  for (const id of fact_ids) {
    const fact = await fact_repo.get(au_id, id);
    if (fact === null || fact.archived === true) continue;
    await archiveFact(au_id, id, fact_repo, ops_repo);
    archived.push(id);
  }
  return archived;
}

/**
 * 将指定 fact 标记为 archived（写 ops + 更新 fact）。
 * 调用者必须已持 AU 锁（同 facts_lifecycle 其他函数约定）。
 */
export async function archiveFact(
  au_id: string,
  fact_id: string,
  fact_repo: FactRepository,
  ops_repo: OpsRepository,
): Promise<void> {
  const fact = await fact_repo.get(au_id, fact_id);
  if (fact === null) {
    throw new FactsLifecycleError(`archive_fact: Fact 不存在: ${fact_id}`);
  }

  const ts = nowUtc();
  fact.archived = true;
  fact.archived_at = ts;

  // WriteTransaction 保证顺序：ops → fact
  const tx = new WriteTransaction();
  tx.appendOp(
    au_id,
    createOpsEntry({
      op_id: generateOpId(),
      op_type: "archive_fact",
      target_id: fact_id,
      timestamp: ts,
      payload: { archived_at: ts },
    }),
  );
  tx.updateFact(au_id, fact);
  await tx.commit(ops_repo, fact_repo, null);
}

/**
 * 解除指定 fact 的归档状态（写 ops + 更新 fact）。
 * 调用者必须已持 AU 锁。
 */
export async function unarchiveFact(
  au_id: string,
  fact_id: string,
  fact_repo: FactRepository,
  ops_repo: OpsRepository,
): Promise<void> {
  const fact = await fact_repo.get(au_id, fact_id);
  if (fact === null) {
    throw new FactsLifecycleError(`unarchive_fact: Fact 不存在: ${fact_id}`);
  }

  const ts = nowUtc();
  fact.archived = false;
  fact.archived_at = undefined;

  // WriteTransaction 保证顺序：ops → fact
  const tx = new WriteTransaction();
  tx.appendOp(
    au_id,
    createOpsEntry({
      op_id: generateOpId(),
      op_type: "unarchive_fact",
      target_id: fact_id,
      timestamp: ts,
      payload: {},
    }),
  );
  tx.updateFact(au_id, fact);
  await tx.commit(ops_repo, fact_repo, null);
}

/**
 * 扫描所有 active/unresolved facts，对满足冷区条件的 fact 批量归档。
 * 固化条件（spec §七.2，CC 拍板 Q2）：
 *   fact.chapter <= currentChapter - cold_threshold_chapters
 *   && fact.narrative_weight === NarrativeWeight.LOW
 *   && status ∈ {active, unresolved}（不扫 deprecated/resolved，避免无意义写操作）
 *   && !fact.archived
 *
 * 调用者必须已持 AU 锁。
 *
 * ⚠️ 引擎半成品——等待 UI 确认流程消费（M10-B 待接线）。
 * 本函数已实现并有测试，但**未接入** confirmChapter 等自动触发路径。
 * 原因：CC 拍板 Q4「固化必须用户确认、非静默自动触发」——自动 = 违反 Q4。
 * 后续 UI 确认流程（用户看到归档提示后点「确认」）消费此函数时，
 * 须在 withAuLock 内调用，并展示将被归档的 fact 列表供用户审核。
 * 非死代码；请勿将此函数自动接入 confirm 或任何隐式触发路径。
 *
 * @returns 被归档的 fact_id 列表
 */
export async function runArchivalSweep(
  au_id: string,
  current_chapter: number,
  fact_repo: FactRepository,
  ops_repo: OpsRepository,
  cold_threshold_chapters: number = ARCHIVE_DISTANCE,
): Promise<string[]> {
  // 判据走 findArchivalCandidates、归档走 archiveFacts —— 与 Q4 预览/确认流同源，无重复判据。
  const candidates = await findArchivalCandidates(au_id, current_chapter, fact_repo, cold_threshold_chapters);
  return archiveFacts(
    au_id,
    candidates.map((f) => f.id),
    fact_repo,
    ops_repo,
  );
}
