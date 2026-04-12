// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 写入事务抽象。
 *
 * 保证 D-0036 写入顺序：ops → chapters → facts → drafts → state。
 * Service 方法向 tx 注册写入意图，由 commit() 统一按固定顺序落盘，
 * 消除手工编排遗漏风险。
 *
 * ops-first 策略：只要 ops 写成功，其他数据都可以通过 rebuildFromOps 重建。
 */

import type { Chapter } from "../domain/chapter.js";
import type { Fact } from "../domain/fact.js";
import type { OpsEntry } from "../domain/ops_entry.js";
import type { State } from "../domain/state.js";
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
   * 按 D-0036 固定顺序落盘：ops → chapters → facts → drafts → state。
   *
   * ops 是 sync truth，其他数据可从 ops 重建，故 ops 最先、state 最后。
   * 只要 ops 写入成功，即使后续步骤失败，重启后 rebuildFromOps 可自愈。
   */
  async commit(
    ops_repo: OpsRepository,
    fact_repo: FactRepository | null,
    state_repo: StateRepository | null,
    chapter_repo?: ChapterRepository | null,
    draft_repo?: DraftRepository | null,
  ): Promise<void> {
    // 1. ops 先落盘（sync truth）
    for (const { au_id, entry } of this.pendingOps) {
      await ops_repo.append(au_id, entry);
    }

    // 2. chapters 落盘（confirm 的核心产物）
    if (chapter_repo) {
      for (const { chapter } of this.pendingChapters) {
        await chapter_repo.save(chapter);
      }
      for (const { au_id, chapter_num } of this.pendingChapterDeletes) {
        await chapter_repo.delete(au_id, chapter_num);
      }
    }

    // 3. facts 落盘
    if (fact_repo) {
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
    }

    // 4. drafts 清理（非关键，丢了可重新生成）
    if (draft_repo) {
      for (const { au_id, chapter_num, mode } of this.pendingDraftDeletes) {
        if (mode === "by_chapter") {
          await draft_repo.delete_by_chapter(au_id, chapter_num);
        } else {
          await draft_repo.delete_from_chapter(au_id, chapter_num);
        }
      }
    }

    // 5. state 最后落盘（可从 ops 重建）
    if (this.pendingState && state_repo) {
      await state_repo.save(this.pendingState);
    }
  }
}
