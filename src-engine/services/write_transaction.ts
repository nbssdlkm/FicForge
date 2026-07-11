// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Write transaction abstraction.
 *
 * Guarantees D-0036 persistence order:
 * ops -> chapters -> facts -> drafts -> state.
 *
 * Important constraint: only ops-backed projections such as state/facts can be
 * rebuilt from ops. Chapter bodies are not stored in ops, so a chapter write
 * failure after ops commit requires explicit escalation instead of claiming the
 * system can self-heal.
 */

import type { Chapter } from "../domain/chapter.js";
import type { Fact } from "../domain/fact.js";
import type { OpsEntry } from "../domain/ops_entry.js";
import type { State } from "../domain/state.js";
import { logCatch } from "../logger/index.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { DraftRepository } from "../repositories/interfaces/draft.js";
import type { FactRepository } from "../repositories/interfaces/fact.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";

interface PendingOp {
  au_id: string;
  entry: OpsEntry;
}

interface PendingFact {
  au_id: string;
  fact: Fact;
  mode: "append" | "update";
}

interface PendingFactDelete {
  au_id: string;
  fact_ids: string[];
}

interface PendingChapter {
  au_id: string;
  chapter: Chapter;
}

interface PendingChapterDelete {
  au_id: string;
  chapter_num: number;
}

interface PendingDraftDelete {
  au_id: string;
  chapter_num: number;
  mode: "by_chapter" | "from_chapter";
}

export const PARTIAL_COMMIT_CHAPTER_MISSING = "PARTIAL_COMMIT_CHAPTER_MISSING" as const;
export const PARTIAL_COMMIT_OPS_ONLY = "PARTIAL_COMMIT_OPS_ONLY" as const;

export type PartialCommitErrorCode =
  | typeof PARTIAL_COMMIT_CHAPTER_MISSING
  | typeof PARTIAL_COMMIT_OPS_ONLY;

function detectPartialCommitErrorCode(failed: readonly string[]): PartialCommitErrorCode {
  return failed.includes("chapters")
    ? PARTIAL_COMMIT_CHAPTER_MISSING
    : PARTIAL_COMMIT_OPS_ONLY;
}

function buildPartialCommitMessage(
  errorCode: PartialCommitErrorCode,
  completed: readonly string[],
  failed: readonly string[],
  skipped: readonly string[],
): string {
  const prefix =
    `WriteTransaction partial commit: completed=[${completed.join(",")}] failed=[${failed.join(",")}] skipped=[${skipped.join(",")}]. `;

  if (errorCode === PARTIAL_COMMIT_CHAPTER_MISSING) {
    // 只描述本次事务实际跳过的块 —— 多数调用方不带 draft_repo，无条件提
    // drafts 会误导排障（对抗审 LOW）。
    const skippedClause = skipped.length > 0
      ? `Blocks [${skipped.join(",")}] were skipped and still hold the pre-transaction snapshot. `
      : "";
    const retryHint = skipped.includes("drafts")
      ? " (re-confirm from the surviving draft)."
      : ".";
    return (
      prefix +
      "Ops were committed, but chapter content may be missing on disk. " +
      skippedClause +
      "rebuildFromOps cannot restore chapter bodies; resolve the disk issue and re-run the operation" +
      retryHint
    );
  }

  return (
    prefix +
    "Ops were committed and still describe the canonical state/facts projection. " +
    "rebuildFromOps can repair ops-backed data, but non-op artifacts may still require cleanup."
  );
}

function buildPartialCommitActions(
  errorCode: PartialCommitErrorCode,
  skipped: readonly string[],
): string[] {
  if (errorCode === PARTIAL_COMMIT_CHAPTER_MISSING) {
    const actions: string[] = [];
    if (skipped.length > 0) {
      actions.push(
        `Skipped blocks [${skipped.join(",")}] were intentionally left untouched; re-run the failed operation (e.g. re-confirm the draft) after resolving the disk issue.`,
      );
    }
    actions.push(
      "Check whether the expected chapters/main/chXXXX.md file exists before trusting current_chapter.",
      "Do not rely on rebuildFromOps alone to restore missing chapter content.",
    );
    return actions;
  }

  return [
    "Run rebuildFromOps if state.yaml or facts need to be reconstructed from committed ops.",
    "Inspect non-op artifacts separately if the failed step wrote files outside ops-backed projections.",
  ];
}

export class PartialCommitError extends Error {
  readonly errorCode: PartialCommitErrorCode;
  readonly completed: string[];
  readonly failed: string[];
  /** 因前置块失败被有意跳过（而非尝试后失败）的块 —— 它们的磁盘内容仍是事务前快照。 */
  readonly skipped: string[];
  readonly actions: string[];

  constructor(completed: readonly string[], failed: readonly string[], skipped: readonly string[] = []) {
    const errorCode = detectPartialCommitErrorCode(failed);
    super(buildPartialCommitMessage(errorCode, completed, failed, skipped));
    this.name = "PartialCommitError";
    this.errorCode = errorCode;
    this.completed = [...completed];
    this.failed = [...failed];
    this.skipped = [...skipped];
    this.actions = buildPartialCommitActions(errorCode, skipped);
  }
}

export class WriteTransaction {
  private pendingOps: PendingOp[] = [];
  private pendingChapters: PendingChapter[] = [];
  private pendingChapterDeletes: PendingChapterDelete[] = [];
  private pendingFacts: PendingFact[] = [];
  private pendingFactDeletes: PendingFactDelete[] = [];
  private pendingDraftDeletes: PendingDraftDelete[] = [];
  private pendingState: State | null = null;

  appendOp(au_id: string, entry: OpsEntry): void {
    this.pendingOps.push({ au_id, entry });
  }

  saveChapter(au_id: string, chapter: Chapter): void {
    this.pendingChapters.push({ au_id, chapter });
  }

  deleteChapter(au_id: string, chapter_num: number): void {
    this.pendingChapterDeletes.push({ au_id, chapter_num });
  }

  appendFact(au_id: string, fact: Fact): void {
    this.pendingFacts.push({ au_id, fact, mode: "append" });
  }

  updateFact(au_id: string, fact: Fact): void {
    this.pendingFacts.push({ au_id, fact, mode: "update" });
  }

  deleteFactsByIds(au_id: string, fact_ids: string[]): void {
    if (fact_ids.length > 0) {
      this.pendingFactDeletes.push({ au_id, fact_ids });
    }
  }

  deleteDraftByChapter(au_id: string, chapter_num: number): void {
    this.pendingDraftDeletes.push({ au_id, chapter_num, mode: "by_chapter" });
  }

  deleteDraftFromChapter(au_id: string, chapter_num: number): void {
    this.pendingDraftDeletes.push({ au_id, chapter_num, mode: "from_chapter" });
  }

  setState(state: State): void {
    this.pendingState = state;
  }

  /**
   * Persist in D-0036 order.
   *
   * Ops must land first because they are the sync truth. State is last because
   * it is an ops-backed projection. Chapter bodies are intentionally treated as
   * a separate artifact that cannot be reconstructed from ops.
   *
   * Gating invariant: if the chapters block fails, drafts cleanup and state
   * save are skipped (reported via PartialCommitError.skipped) — drafts are the
   * only recoverable source of chapter bodies and current_chapter must not
   * advance past a chapter that never landed on disk.
   */
  async commit(
    ops_repo: OpsRepository,
    fact_repo: FactRepository | null,
    state_repo: StateRepository | null,
    chapter_repo?: ChapterRepository | null,
    draft_repo?: DraftRepository | null,
  ): Promise<void> {
    for (const { au_id, entry } of this.pendingOps) {
      await ops_repo.append(au_id, entry);
    }

    const completed: string[] = ["ops"];
    const failed: string[] = [];
    const skipped: string[] = [];
    // chapters 块失败时置位：drafts / state 块被门控跳过（见下），防止「章未落盘、
    // 唯一内容源草稿被删、current_chapter 越过缺失章」的不可恢复丢章。
    // 有意分叉：此时 ops 已先行落盘、领先于被跳过的 state。ops 仅是 audit log
    //（D-0040），失败窗口内不得把 ops 回放进 state —— 否则指针会再次越过缺失章。
    let chaptersFailed = false;

    if (chapter_repo) {
      try {
        for (const { chapter } of this.pendingChapters) {
          await chapter_repo.save(chapter);
        }
        for (const { au_id, chapter_num } of this.pendingChapterDeletes) {
          await chapter_repo.delete(au_id, chapter_num);
        }
        completed.push("chapters");
      } catch (err) {
        failed.push("chapters");
        chaptersFailed = true;
        logCatch("write_tx", "chapters write failed after ops committed", err);
      }
    }

    if (fact_repo) {
      try {
        for (const { au_id, fact, mode } of this.pendingFacts) {
          if (mode === "append") {
            await fact_repo.append(au_id, fact);
          } else {
            await fact_repo.update(au_id, fact);
          }
        }
        for (const { au_id, fact_ids } of this.pendingFactDeletes) {
          await fact_repo.delete_by_ids(au_id, fact_ids);
        }
        completed.push("facts");
      } catch (err) {
        failed.push("facts");
        logCatch("write_tx", "facts write failed after ops committed", err);
      }
    }

    if (draft_repo && this.pendingDraftDeletes.length > 0) {
      // 草稿是章节正文唯一的非 ops 可恢复源（D-0036）：章节块失败时绝不删草稿，
      // 留给用户「修复磁盘问题后重新 confirm」的退路。
      if (chaptersFailed) {
        skipped.push("drafts");
      } else {
        try {
          for (const { au_id, chapter_num, mode } of this.pendingDraftDeletes) {
            if (mode === "by_chapter") {
              await draft_repo.delete_by_chapter(au_id, chapter_num);
            } else {
              await draft_repo.delete_from_chapter(au_id, chapter_num);
            }
          }
          completed.push("drafts");
        } catch (err) {
          failed.push("drafts");
          logCatch("write_tx", "drafts cleanup failed after ops committed", err);
        }
      }
    }

    if (this.pendingState && state_repo) {
      // 同理：章节块失败时不推进 state，current_chapter 不得越过未落盘的章。
      if (chaptersFailed) {
        skipped.push("state");
      } else {
        try {
          await state_repo.save(this.pendingState);
          completed.push("state");
        } catch (err) {
          failed.push("state");
          logCatch("write_tx", "state write failed after ops committed", err);
        }
      }
    }

    if (failed.length > 0) {
      throw new PartialCommitError(completed, failed, skipped);
    }
  }
}
