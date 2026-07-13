// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 撤销最新章流程。参见 PRD §6.3 步骤 0-10。
 *
 * ⚠️ 全代码库最危险的 Service：10 步级联回滚，涉及 5 类文件。
 * 使用 WriteTransaction 保证 D-0036 写入顺序：读取+计算 → tx(ops → chapters → facts → drafts → state)。
 */

import { mergeCharactersLastSeen, scanCharactersInChapter } from "../domain/character_scanner.js";
import { FactStatus, IndexStatus } from "../domain/enums.js";
import { logCatch } from "../logger/index.js";
import type { OpsEntry } from "../domain/ops_entry.js";
import { createOpsEntry } from "../domain/ops_entry.js";
import type { Fact } from "../domain/fact.js";
import { extractLastSceneEnding } from "../domain/text_utils.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { DraftRepository } from "../repositories/interfaces/draft.js";
import type { FactRepository } from "../repositories/interfaces/fact.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";
import { generateOpId, nowUtc } from "../utils/file_utils.js";
import { withAuLock } from "./au_lock.js";
import { WriteTransaction } from "./write_transaction.js";

export class UndoChapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndoChapterError";
  }
}

/**
 * undo 流程自身记账产生的 `update_fact_status` op 的 reason —— 生产端与过滤端共用，
 * 避免「字面量散落 + 前缀约定」两处独立维护漂移（单一真相源）。
 * 这些 op 不代表本章「真实发生过」的状态变更，故被 isUndoGeneratedStatusOp 排除回放。
 */
const UNDO_REASON_PREFIX = "undo_";
const UNDO_RESOLVES_CASCADE_REASON = `${UNDO_REASON_PREFIX}resolves_cascade`;
const UNDO_MANUAL_ROLLBACK_REASON = `${UNDO_REASON_PREFIX}manual_rollback`;

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

/**
 * 撤销最新章入口。持 AU 锁覆盖 10 步级联回滚的整个事务 ——
 * 这是全代码库最危险的 Service，任何并发插入都会破坏级联一致性。
 * 锁分层策略见 services/au_lock.ts。
 */
export async function undoLatestChapter(params: UndoChapterParams): Promise<UndoChapterResult> {
  return withAuLock(params.au_id, () => doUndo(params));
}

async function doUndo(params: UndoChapterParams): Promise<UndoChapterResult> {
  const {
    au_id,
    cast_registry = { characters: [] },
    character_aliases = null,
    chapter_repo,
    draft_repo,
    state_repo,
    ops_repo,
    fact_repo,
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
  // 章节文件已不存在（get 返回 null，异常状态）时继续回滚；fs 读错误照抛中止 undo
  // —— 旧的裸 catch 会把真实读错误也吞成"不存在"，读失败时不该带病级联。
  const oldChapter = await chapter_repo.get(au_id, n);
  if (oldChapter) chapterId = oldChapter.chapter_id;

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

  // 步骤 3b：回放 update_fact_status（收集待更新 facts + 反向 op，TD-003）
  const manualRollbacks = await collectManualStatusRollback(au_id, n, ops_repo, fact_repo);
  for (const { op, fact } of manualRollbacks) {
    tx.appendOp(au_id, op);
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
    au_id,
    n,
    ops_repo,
    chapter_repo,
    cast_registry,
    character_aliases,
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
  tx.appendOp(
    au_id,
    createOpsEntry({
      op_id: generateOpId(),
      op_type: "undo_chapter",
      target_id: chapterId,
      chapter_num: n,
      timestamp: nowUtc(),
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
    }),
  );
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
    const stillResolved = allFacts.some((f) => f.resolves === targetId && !idsToDelete.has(f.id) && f.id !== targetId);
    if (!stillResolved) {
      const oldStatus = target.status;
      target.status = FactStatus.UNRESOLVED;
      result.push({
        op: createOpsEntry({
          op_id: generateOpId(),
          op_type: "update_fact_status",
          target_id: targetId,
          chapter_num: n,
          timestamp: nowUtc(),
          payload: {
            old_status: oldStatus,
            new_status: FactStatus.UNRESOLVED,
            reason: UNDO_RESOLVES_CASCADE_REASON,
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
): Promise<ResolvesRollbackItem[]> {
  const result: ResolvesRollbackItem[] = [];

  const allOps = await ops_repo.list_all(au_id);
  const statusOps = allOps.filter(
    (op) =>
      op.op_type === "update_fact_status" &&
      op.chapter_num === n &&
      // 排除 undo 自身记账产生的 update_fact_status op（undo_resolves_cascade /
      // undo_manual_rollback）。它们不是本章「真实发生过」的状态变更，回放会把上一次
      // undo 的反向操作再反一次 → 二次 undo 歧义（TD-003 修复要求）。单次 undo 中这些 op
      // 还在事务里未落盘，本过滤为空操作；只在「章节 confirm→undo→reconfirm→undo」时生效。
      !isUndoGeneratedStatusOp(op),
  );

  if (statusOps.length === 0) return result;

  // 逆序回放：按 lamport_clock 降序（与 ops_projection.deterministicSort 的升序镜像，
  // timestamp / op_id 作 tiebreaker）。**不能只按 timestamp** —— nowUtc() 截到整秒
  // （file_utils.ts），同一秒内对同一 fact 的多次状态变更 timestamp 相同、比较器返回 0、
  // 排序退化为升序（正放），导致只回滚到「最后一次变更的 old_status」而非本章真正的章前态。
  // lamport_clock 在 append 时单调分配，对同秒 op 也严格有序。回放的最早一条 op（携带章前
  // old_status）最后被 push、其 tx.updateFact 最后生效（last-write-win），故须降序。
  // 前提：所有 status op 都经 file_ops.append 拿到真实 lamport_clock。导入路径（如 bundle）
  // 直接搬运 ops.jsonl 也保留原 lamport，故成立；唯有「lamport 缺失记 0」的远古遗留 op 同秒
  // 同 fact 并存时才会退到 op_id tiebreak（确定但非因果序）—— 当前数据形态不存在，见 TECH-DEBT。
  statusOps.sort((a, b) => {
    const clockA = a.lamport_clock ?? 0;
    const clockB = b.lamport_clock ?? 0;
    if (clockA !== clockB) return clockB - clockA; // lamport 降序
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? 1 : -1;
    return a.op_id < b.op_id ? 1 : a.op_id > b.op_id ? -1 : 0;
  });

  for (const op of statusOps) {
    const oldStatus = op.payload.old_status as string | undefined;
    if (!oldStatus) continue;

    const fact = await fact_repo.get(au_id, op.target_id);
    if (fact === null) continue;

    // 反向 op：把 fact 从当前状态退回 oldStatus，并落一条审计 op，使
    // rebuildFactsFromOps 重建结果与 repo 一致（TD-003 —— 此前只改 repo 不落 op，重建发散）。
    const currentStatus = fact.status;
    fact.status = oldStatus as FactStatus;
    result.push({
      op: createOpsEntry({
        op_id: generateOpId(),
        op_type: "update_fact_status",
        target_id: op.target_id,
        chapter_num: n,
        timestamp: nowUtc(),
        payload: {
          old_status: currentStatus,
          new_status: oldStatus,
          reason: UNDO_MANUAL_ROLLBACK_REASON,
        },
      }),
      fact,
    });
  }

  return result;
}

/** 该 update_fact_status op 是否为 undo 流程自身记账产生（不应被后续 undo 再反向）。 */
function isUndoGeneratedStatusOp(op: OpsEntry): boolean {
  const reason = op.payload.reason;
  return typeof reason === "string" && reason.startsWith(UNDO_REASON_PREFIX);
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
    deleteOps.push(
      createOpsEntry({
        op_id: generateOpId(),
        op_type: "delete_fact",
        target_id: factId,
        chapter_num: n,
        timestamp: nowUtc(),
        payload: { reason: "undo_chapter" },
      }),
    );
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
    return extractLastSceneEnding(content);
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
          // 裸 Error 有意：「快照损坏→降级扫描」的局部控制流信号，下方 catch 立即接住，
          // 从不逃逸 doUndo，故不用 UndoChapterError（逃逸域错误才用自定义类）。
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
  return rebuildCharactersLastSeen(au_id, n, chapter_repo, cast_registry, character_aliases);
}

async function rebuildCharactersLastSeen(
  au_id: string,
  n: number,
  chapter_repo: ChapterRepository,
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null,
): Promise<Record<string, number>> {
  // 只扫 < n 的章：第 n 章正在被撤销、此刻仍在盘上（tx 尚未 commit），若计入会把角色
  // 持久记为「最后见于已被删除的第 n 章」。姊妹路径 dirty_resolve.scanRecentChapters 同样
  // 限定 <= n-1，此处对齐（盲审 R5 正确性 M1；触发面=前一章无 confirm 快照的导入作品）。
  const chapters = await chapter_repo.list_main(au_id);
  const result: Record<string, number> = {};
  for (const ch of chapters) {
    if (ch.chapter_num >= n) continue;
    const scanned = scanCharactersInChapter(ch.content, cast_registry, character_aliases, ch.chapter_num);
    mergeCharactersLastSeen(result, scanned);
  }
  return result;
}

// -----------------------------------------------------------------
// 步骤 9：last_confirmed_chapter_focus 回退
// -----------------------------------------------------------------

async function rollbackConfirmedFocus(au_id: string, n: number, chapter_repo: ChapterRepository): Promise<string[]> {
  if (n <= 1) return [];
  try {
    const prevCh = await chapter_repo.get(au_id, n - 1);
    return prevCh ? [...prevCh.confirmed_focus] : [];
  } catch (err) {
    // best-effort：focus 回滚不值得让 undo 级联失败，但读错误落日志可诊断
    logCatch("undo", `rollbackConfirmedFocus read failed for ch${n - 1}`, err);
    return [];
  }
}
