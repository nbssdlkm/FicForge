// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 撤销最新章流程。参见 PRD §6.3 步骤 0-10。
 *
 * ⚠️ 全代码库最危险的 Service：10 步级联回滚，涉及 5 类文件。
 * 严格遵循多文件写入顺序：数据变更 → state → ops（事务提交标记）。
 */

import { scan_characters_in_chapter } from "../domain/character_scanner.js";
import { FactStatus, IndexStatus } from "../domain/enums.js";
import type { OpsEntry } from "../domain/ops_entry.js";
import { createOpsEntry } from "../domain/ops_entry.js";
import type { Fact } from "../domain/fact.js";
import { extract_last_scene_ending } from "../domain/text_utils.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { DraftRepository } from "../repositories/interfaces/draft.js";
import type { FactRepository } from "../repositories/interfaces/fact.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";
import { generate_op_id, now_utc } from "../repositories/implementations/file_utils.js";
import { WriteTransaction } from "./write_transaction.js";

export class UndoChapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndoChapterError";
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

export interface UndoChapterParams {
  au_id: string;
  cast_registry?: { characters?: string[] };
  character_aliases?: Record<string, string[]> | null;
  chapter_repo: ChapterRepository;
  draft_repo: DraftRepository;
  state_repo: StateRepository;
  ops_repo: OpsRepository;
  fact_repo: FactRepository;
}

export interface UndoChapterResult {
  chapter_num: number;
  new_current_chapter: number;
}

export async function undo_latest_chapter(params: UndoChapterParams): Promise<UndoChapterResult> {
  return withLock(params.au_id, () => doUndo(params));
}

async function doUndo(params: UndoChapterParams): Promise<UndoChapterResult> {
  const {
    au_id,
    cast_registry = { characters: [] },
    character_aliases = null,
    chapter_repo, draft_repo, state_repo, ops_repo, fact_repo,
  } = params;

  // =================================================================
  // 步骤 0：前置校验
  // =================================================================
  const state = await state_repo.get(au_id);
  const n = state.current_chapter - 1;

  if (n < 1) {
    throw new UndoChapterError("没有已确认章节可撤销（current_chapter == 1）");
  }

  // =================================================================
  // 步骤 1：确定被撤销的章节号 N
  // =================================================================
  let chapterId = "";
  try {
    const oldChapter = await chapter_repo.get(au_id, n);
    chapterId = oldChapter.chapter_id;
  } catch {
    // 章节文件已不存在（异常状态），继续回滚
  }

  // =================================================================
  // 读取阶段：收集所有待写入操作（不实际写入）
  // =================================================================
  const tx = new WriteTransaction();

  // 步骤 3a：facts resolves 关系回滚
  const resolvesOps = await collectResolvesRollback(au_id, n, ops_repo, fact_repo);
  for (const { op, fact } of resolvesOps) {
    tx.appendOp(au_id, op);
    tx.updateFact(au_id, fact);
  }

  // 步骤 3b：回放 update_fact_status（收集待更新 facts）
  const manualRollbacks = await collectManualStatusRollback(au_id, n, ops_repo, fact_repo);
  for (const fact of manualRollbacks) {
    tx.updateFact(au_id, fact);
  }

  // 步骤 2：删除章节文件 + 清理 ≥N 的所有草稿（D-0016）
  tx.deleteChapter(au_id, n);
  tx.deleteDraftFromChapter(au_id, n);

  // 步骤 4：facts 物理删除（D-0003，通过 ops target_id 精准删除）
  const { deleteOps, factIdsToDelete } = await collectChapterFactDeletes(au_id, n, ops_repo);
  for (const op of deleteOps) {
    tx.appendOp(au_id, op);
  }
  tx.deleteFactsByIds(au_id, factIdsToDelete);

  // =================================================================
  // 步骤 5-10：state 更新（内存计算）
  // =================================================================
  state.index_status = IndexStatus.STALE;
  state.last_scene_ending = await rollbackLastSceneEnding(au_id, n, ops_repo, chapter_repo);
  state.characters_last_seen = await rollbackCharactersLastSeen(
    au_id, n, ops_repo, chapter_repo, cast_registry, character_aliases,
  );
  state.chapter_focus = [];
  state.last_confirmed_chapter_focus = await rollbackConfirmedFocus(au_id, n, chapter_repo);

  const dirtyIdx = state.chapters_dirty.indexOf(n);
  if (dirtyIdx >= 0) {
    state.chapters_dirty.splice(dirtyIdx, 1);
  }
  delete state.chapter_titles[n];
  state.current_chapter = n;

  // undo_chapter op（主 op，包含 state snapshot 供跨设备重建）
  tx.appendOp(au_id, createOpsEntry({
    op_id: generate_op_id(),
    op_type: "undo_chapter",
    target_id: chapterId,
    chapter_num: n,
    timestamp: now_utc(),
    payload: {
      state_snapshot: {
        current_chapter: state.current_chapter,
        last_scene_ending: state.last_scene_ending,
        characters_last_seen: { ...state.characters_last_seen },
        last_confirmed_chapter_focus: [...state.last_confirmed_chapter_focus],
        chapter_titles: { ...state.chapter_titles },
        chapters_dirty: [...state.chapters_dirty],
      },
    },
  }));
  tx.setState(state);

  // =================================================================
  // 事务提交：ops → chapters → facts → drafts → state
  // =================================================================
  await tx.commit(ops_repo, fact_repo, state_repo, chapter_repo, draft_repo);

  return {
    chapter_num: n,
    new_current_chapter: state.current_chapter,
  };
}

// -----------------------------------------------------------------
// 步骤 3a：facts resolves 状态回滚（收集模式，不直接写入）
// -----------------------------------------------------------------

interface ResolvesRollbackItem {
  op: OpsEntry;
  fact: Fact;
}

async function collectResolvesRollback(
  au_id: string,
  n: number,
  ops_repo: OpsRepository,
  fact_repo: FactRepository,
): Promise<ResolvesRollbackItem[]> {
  const result: ResolvesRollbackItem[] = [];

  const addFactOps = await ops_repo.get_add_facts_for_chapter(au_id, n);
  const idsToDelete = new Set(addFactOps.map((op) => op.target_id));

  if (idsToDelete.size === 0) return result;

  const allFacts = await fact_repo.list_all(au_id);

  // 找有 resolves 关系的即将被删除的 facts
  const targetsToCheck = new Set<string>();
  for (const fact of allFacts) {
    if (idsToDelete.has(fact.id) && fact.resolves) {
      targetsToCheck.add(fact.resolves);
    }
  }

  if (targetsToCheck.size === 0) return result;

  for (const targetId of targetsToCheck) {
    const target = await fact_repo.get(au_id, targetId);
    if (target === null || target.status !== FactStatus.RESOLVED) continue;

    // 检查是否有其他 fact（排除即将删除的）仍然 resolves 该目标
    const stillResolved = allFacts.some(
      (f) => f.resolves === targetId && !idsToDelete.has(f.id) && f.id !== targetId,
    );
    if (!stillResolved) {
      const oldStatus = target.status;
      target.status = FactStatus.UNRESOLVED;
      result.push({
        op: createOpsEntry({
          op_id: generate_op_id(),
          op_type: "update_fact_status",
          target_id: targetId,
          chapter_num: n,
          timestamp: now_utc(),
          payload: {
            old_status: oldStatus,
            new_status: FactStatus.UNRESOLVED,
            reason: "undo_resolves_cascade",
          },
        }),
        fact: target,
      });
    }
  }

  return result;
}

// -----------------------------------------------------------------
// 步骤 3b：回放 update_fact_status（收集模式，不直接写入）
// -----------------------------------------------------------------

async function collectManualStatusRollback(
  au_id: string,
  n: number,
  ops_repo: OpsRepository,
  fact_repo: FactRepository,
): Promise<Fact[]> {
  const result: Fact[] = [];

  const allOps = await ops_repo.list_all(au_id);
  const statusOps = allOps.filter(
    (op) => op.op_type === "update_fact_status" && op.chapter_num === n,
  );

  if (statusOps.length === 0) return result;

  // 按时间戳逆序回放
  statusOps.sort((a, b) => (a.timestamp > b.timestamp ? -1 : a.timestamp < b.timestamp ? 1 : 0));

  for (const op of statusOps) {
    const oldStatus = op.payload.old_status as string | undefined;
    if (!oldStatus) continue;

    const fact = await fact_repo.get(au_id, op.target_id);
    if (fact === null) continue;

    fact.status = oldStatus as FactStatus;
    result.push(fact);
  }

  return result;
}

// -----------------------------------------------------------------
// 步骤 4：facts 物理删除（收集模式，不直接写入）
// -----------------------------------------------------------------

interface ChapterFactDeletes {
  deleteOps: OpsEntry[];
  factIdsToDelete: string[];
}

async function collectChapterFactDeletes(
  au_id: string,
  n: number,
  ops_repo: OpsRepository,
): Promise<ChapterFactDeletes> {
  const addFactOps = await ops_repo.get_add_facts_for_chapter(au_id, n);
  if (addFactOps.length === 0) return { deleteOps: [], factIdsToDelete: [] };

  const factIdsToDelete = addFactOps.map((op) => op.target_id);
  const deleteOps: OpsEntry[] = [];

  for (const factId of factIdsToDelete) {
    deleteOps.push(createOpsEntry({
      op_id: generate_op_id(),
      op_type: "delete_fact",
      target_id: factId,
      chapter_num: n,
      timestamp: now_utc(),
      payload: { reason: "undo_chapter" },
    }));
  }

  return { deleteOps, factIdsToDelete };
}

// -----------------------------------------------------------------
// 步骤 6：last_scene_ending 回滚
// -----------------------------------------------------------------

async function rollbackLastSceneEnding(
  au_id: string,
  n: number,
  ops_repo: OpsRepository,
  chapter_repo: ChapterRepository,
): Promise<string> {
  if (n === 1) return "";

  // 优先：ops 快照
  const confirmOp = await ops_repo.get_confirm_for_chapter(au_id, n - 1);
  if (confirmOp) {
    const snapshot = confirmOp.payload.last_scene_ending_snapshot;
    if (typeof snapshot === "string") return snapshot;
  }

  // 降级：读取 ch{N-1} 末尾
  try {
    const content = await chapter_repo.get_content_only(au_id, n - 1);
    return extract_last_scene_ending(content);
  } catch {
    return "";
  }
}

// -----------------------------------------------------------------
// 步骤 7：characters_last_seen 回滚
// -----------------------------------------------------------------

async function rollbackCharactersLastSeen(
  au_id: string,
  n: number,
  ops_repo: OpsRepository,
  chapter_repo: ChapterRepository,
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null,
): Promise<Record<string, number>> {
  if (n === 1) return {};

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
        // 快照数据损坏，降级到全量扫描
      }
    }
  }

  // 降级：全量扫描重建
  return rebuildCharactersLastSeen(au_id, chapter_repo, cast_registry, character_aliases);
}

async function rebuildCharactersLastSeen(
  au_id: string,
  chapter_repo: ChapterRepository,
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null,
): Promise<Record<string, number>> {
  const chapters = await chapter_repo.list_main(au_id);
  const result: Record<string, number> = {};
  for (const ch of chapters) {
    const scanned = scan_characters_in_chapter(ch.content, cast_registry, character_aliases, ch.chapter_num);
    for (const [name, num] of Object.entries(scanned)) {
      if (num > (result[name] ?? 0)) {
        result[name] = num;
      }
    }
  }
  return result;
}

// -----------------------------------------------------------------
// 步骤 9：last_confirmed_chapter_focus 回退
// -----------------------------------------------------------------

async function rollbackConfirmedFocus(
  au_id: string,
  n: number,
  chapter_repo: ChapterRepository,
): Promise<string[]> {
  if (n <= 1) return [];
  try {
    const prevCh = await chapter_repo.get(au_id, n - 1);
    return [...prevCh.confirmed_focus];
  } catch {
    return [];
  }
}
