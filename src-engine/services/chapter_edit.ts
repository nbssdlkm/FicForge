// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 章节编辑服务。
 *
 * 封装章节内容更新的完整流程：
 * 读章节 → 更新 content/hash/provenance/revision → 保存 → 标记 dirty → 写 op → 标记索引 STALE。
 * 解决 F4：漏写 op 导致跨设备同步丢失 dirty 状态。
 */

import { IndexStatus } from "../domain/enums.js";
import { createOpsEntry } from "../domain/ops_entry.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";
import { compute_content_hash, generate_op_id, now_utc } from "../repositories/implementations/file_utils.js";
import { WriteTransaction } from "./write_transaction.js";

export interface EditChapterContentResult {
  chapter_num: number;
  content_hash: string;
  provenance: string;
  revision: number;
}

/**
 * 更新章节正文内容。
 *
 * 完成以下步骤：
 * 1. 读取章节 → 更新 content、content_hash、provenance、revision
 * 2. 保存章节
 * 3. 在 state.chapters_dirty 中标记该章节号
 * 4. 在 state 中标记 index_status 为 STALE
 * 5. 写入 mark_chapters_dirty op 到 ops.jsonl
 */
export async function edit_chapter_content(
  au_id: string,
  chapter_num: number,
  new_content: string,
  chapter_repo: ChapterRepository,
  state_repo: StateRepository,
  ops_repo: OpsRepository,
): Promise<EditChapterContentResult> {
  // 1. 读取并更新章节（内存）
  const ch = await chapter_repo.get(au_id, chapter_num);
  ch.content = new_content;
  ch.content_hash = await compute_content_hash(new_content);
  ch.provenance = "mixed";
  ch.revision += 1;

  // 2. 计算新 state（内存）
  const st = await state_repo.get(au_id);
  if (!st.chapters_dirty.includes(chapter_num)) {
    st.chapters_dirty.push(chapter_num);
  }
  st.index_status = IndexStatus.STALE;

  // 3. 事务提交（D-0036：ops → chapter → state）
  const tx = new WriteTransaction();
  tx.appendOp(au_id, createOpsEntry({
    op_id: generate_op_id(),
    op_type: "mark_chapters_dirty",
    target_id: au_id,
    timestamp: now_utc(),
    payload: { added_dirty: [chapter_num] },
  }));
  tx.saveChapter(au_id, ch);
  tx.setState(st);
  await tx.commit(ops_repo, null, state_repo, chapter_repo, null);

  return {
    chapter_num,
    content_hash: ch.content_hash,
    provenance: ch.provenance,
    revision: ch.revision,
  };
}
