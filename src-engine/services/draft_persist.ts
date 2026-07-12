// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 「生成 → 草稿持久化」共享原语（盲审 2026-07-11 重复维：generation 与
 * simple_chat_dispatch 此前各写一份 createGeneratedWith + createDraft + 锁内 save，
 * GeneratedWith 增字段 / 加锁策略变更时两处需手工同步）。
 */

import { createDraft, type Draft } from "../domain/draft.js";
import { createGeneratedWith, type GeneratedWith } from "../domain/generated_with.js";
import type { DraftRepository } from "../repositories/interfaces/draft.js";
import { nowUtc } from "../utils/file_utils.js";
import { withAuLock } from "./au_lock.js";

export interface PersistGeneratedDraftParams {
  au_id: string;
  chapter_num: number;
  variant: string;
  content: string;
  mode: string;
  model: string;
  temperature: number;
  top_p: number;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  draft_repo: DraftRepository;
}

export async function persistGeneratedDraft(
  p: PersistGeneratedDraftParams,
): Promise<{ draft: Draft; generated_with: GeneratedWith }> {
  const generated_with = createGeneratedWith({
    mode: p.mode,
    model: p.model,
    temperature: p.temperature,
    top_p: p.top_p,
    input_tokens: p.input_tokens,
    output_tokens: p.output_tokens,
    char_count: p.content.length,
    duration_ms: p.duration_ms,
    generated_at: nowUtc(),
  });
  const draft = createDraft({
    au_id: p.au_id,
    chapter_num: p.chapter_num,
    variant: p.variant,
    content: p.content,
    generated_with,
  });
  // 只对「写 draft」这一小段持 AU 锁，不锁整个生成流程 —— 否则 30 秒的流式生成
  // 会阻塞 UI 对同 AU 的所有其它写操作（confirm / undo / editFact 等）。
  await withAuLock(p.au_id, async () => {
    await p.draft_repo.save(draft);
  });
  return { draft, generated_with };
}
