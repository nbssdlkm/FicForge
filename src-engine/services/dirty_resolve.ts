// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Dirty 章节解除流程。参见 PRD §4.3。
 * 最新章 vs 历史章分流：两者的 state 更新范围完全不同。
 */

import { mergeCharactersLastSeen, scanCharactersInChapter } from "../domain/character_scanner.js";
import { IndexStatus } from "../domain/enums.js";
import type { FactChange } from "../domain/fact_change.js";
import { createOpsEntry } from "../domain/ops_entry.js";
import { extractLastSceneEnding } from "../domain/text_utils.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { FactRepository } from "../repositories/interfaces/fact.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";
import { logCatch } from "../logger/index.js";
import { computeContentHash, generateOpId, nowUtc } from "../utils/file_utils.js";
import { withAuLock } from "./au_lock.js";
import { editFact, updateFactStatus } from "./facts_lifecycle.js";
import { WriteTransaction } from "./write_transaction.js";

export class DirtyResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirtyResolveError";
  }
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
  /**
   * 步骤 6 中应用失败的 fact 变更（章节本身已成功解除脏）。
   * 旧行为是整体抛错 —— 但此时 chapter/state 已提交、该章已不在 chapters_dirty，
   * 同路径重试必然被前置校验拒绝，用户勾选的变更静默丢失（盲审 2026-07-11 正确性维）。
   * 现在改为逐条尽力应用 + 如实带回失败清单，由 UI 明示「章节已解除，N 条笔记变更
   * 未应用」引导去 Facts 面板手工处理，不再把半成功伪装成整体失败。
   */
  failed_fact_changes: FailedFactChange[];
}

export interface FailedFactChange {
  fact_id: string;
  action: "update" | "deprecate";
  error: string;
}

/**
 * Dirty 章节解除入口。持 AU 锁覆盖整个 doResolve —— 内部会调用底层
 * facts_lifecycle.editFact / updateFactStatus，那两个底层函数不加锁
 * 正是为了避免在这里发生重入死锁。见 services/au_lock.ts。
 */
export async function resolveDirtyChapter(params: ResolveDirtyParams): Promise<ResolveDirtyResult> {
  return withAuLock(params.au_id, () => doResolve(params));
}

async function doResolve(params: ResolveDirtyParams): Promise<ResolveDirtyResult> {
  const {
    au_id,
    chapter_num,
    confirmed_fact_changes,
    cast_registry = { characters: [] },
    character_aliases = null,
    chapter_repo,
    state_repo,
    ops_repo,
    fact_repo,
  } = params;

  // === 步骤 1：前置校验 ===
  const state = await state_repo.get(au_id);

  if (!state.chapters_dirty.includes(chapter_num)) {
    throw new DirtyResolveError(`章节 ${chapter_num} 不在 chapters_dirty 列表中`);
  }

  const chapterExists = await chapter_repo.exists(au_id, chapter_num);
  if (!chapterExists) {
    throw new DirtyResolveError(`章节 ${chapter_num} 文件不存在`);
  }

  // === 步骤 2：最新章 / 历史章分流 ===
  const isLatest = chapter_num === state.current_chapter - 1;
  let content: string;

  if (isLatest) {
    state.characters_last_seen = await recalcCharactersLatest(
      au_id,
      chapter_num,
      chapter_repo,
      ops_repo,
      cast_registry,
      character_aliases,
    );
    content = await chapter_repo.getContentOnly(au_id, chapter_num);
    state.last_scene_ending = extractLastSceneEnding(content);
  } else {
    content = await chapter_repo.getContentOnly(au_id, chapter_num);
  }

  // === 步骤 3：重算 content_hash ===
  const newHash = await computeContentHash(content);
  const chapter = await chapter_repo.get(au_id, chapter_num);
  // 逃逸域错误统一走 DirtyResolveError（与 :89/:94 同拼；exists 已过但 get 为 null=竞态/仓储不一致）。
  if (!chapter) throw new DirtyResolveError(`Chapter not found: ${au_id} ch${chapter_num}`);
  chapter.content_hash = newHash;
  chapter.revision += 1;
  chapter.confirmed_at = nowUtc();

  // === 步骤 4：更新 state（内存） ===
  const dirtyIdx = state.chapters_dirty.indexOf(chapter_num);
  if (dirtyIdx >= 0) state.chapters_dirty.splice(dirtyIdx, 1);
  state.index_status = IndexStatus.STALE;

  // === 步骤 5：事务提交（D-0036：ops → chapter → state） ===
  // 先提交 chapter + state，再应用 fact 变更。fact 变更失败不再整体抛错 ——
  // 逐条尽力应用并把失败清单随结果带回（见 ResolveDirtyResult.failed_fact_changes）。
  // 旧顺序（fact 先 → chapter/state 后）的问题：fact 各自独立 commit，
  // chapter/state commit 失败时无法回滚已提交的 fact，留下不一致的中间状态。
  const timestamp = nowUtc();
  const tx = new WriteTransaction();
  tx.appendOp(
    au_id,
    createOpsEntry({
      op_id: generateOpId(),
      op_type: "resolve_dirty_chapter",
      target_id: chapter.chapter_id,
      chapter_num,
      timestamp,
      payload: {},
    }),
  );
  tx.saveChapter(au_id, chapter);
  tx.setState(state);
  await tx.commit(ops_repo, null, state_repo, chapter_repo, null);

  // === 步骤 6：执行 facts 变更（在 chapter/state 成功提交之后） ===
  const failedFactChanges = await applyFactChanges(
    au_id,
    chapter_num,
    confirmed_fact_changes,
    fact_repo,
    ops_repo,
    state_repo,
  );

  return {
    chapter_num,
    is_latest: isLatest,
    content_hash: newHash,
    failed_fact_changes: failedFactChanges,
  };
}

// -----------------------------------------------------------------
// 步骤 2：facts 变更
// -----------------------------------------------------------------

/**
 * 逐条尽力应用 fact 变更，失败不中断后续条目（单条 IO 失败不该连坐拖垮其余变更），
 * 失败清单返回给调用方透出。每条失败都落日志（可随「导出日志」带走诊断）。
 */
async function applyFactChanges(
  au_id: string,
  chapter_num: number,
  changes: FactChange[],
  fact_repo: FactRepository,
  ops_repo: OpsRepository,
  state_repo: StateRepository,
): Promise<FailedFactChange[]> {
  const failed: FailedFactChange[] = [];
  for (const change of changes) {
    if (change.action === "keep") continue;

    try {
      if (change.action === "update" && change.updated_fields) {
        await editFact(au_id, change.fact_id, change.updated_fields, fact_repo, ops_repo, state_repo);
      } else if (change.action === "deprecate") {
        await updateFactStatus(au_id, change.fact_id, "deprecated", chapter_num, fact_repo, ops_repo, state_repo);
      }
    } catch (e) {
      logCatch("dirty_resolve", `apply fact change failed: ${change.action} ${change.fact_id}`, e);
      failed.push({
        fact_id: change.fact_id,
        action: change.action as "update" | "deprecate",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return failed;
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
  const content = await chapter_repo.getContentOnly(au_id, chapter_num);
  const scanned = scanCharactersInChapter(content, cast_registry, character_aliases, chapter_num);

  // 合并（取 max，proto 安全见 mergeCharactersLastSeen）
  mergeCharactersLastSeen(baseline, scanned);

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
  const confirmOp = await ops_repo.getConfirmForChapter(au_id, n - 1);
  if (confirmOp) {
    const snapshot = confirmOp.payload.characters_last_seen_snapshot;
    if (snapshot && typeof snapshot === "object") {
      try {
        const result: Record<string, number> = {};
        for (const [k, v] of Object.entries(snapshot as Record<string, unknown>)) {
          const num = Number(v);
          // 裸 Error 有意：这是「快照损坏→降级扫描」的局部控制流信号，下方 catch 立即接住，
          // 从不逃逸 doResolve，故不用 DirtyResolveError（逃逸域错误才用自定义类）。
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
  const allChapters = await chapter_repo.listMain(au_id);
  const start = Math.max(1, n - 3);
  let targetChapters = allChapters.filter((ch) => ch.chapter_num >= start && ch.chapter_num <= n - 1);

  if (targetChapters.length < 3) {
    targetChapters = allChapters.filter((ch) => ch.chapter_num < n);
  }

  const result: Record<string, number> = {};
  for (const ch of targetChapters) {
    const scanned = scanCharactersInChapter(ch.content, cast_registry, character_aliases, ch.chapter_num);
    mergeCharactersLastSeen(result, scanned);
  }
  return result;
}
