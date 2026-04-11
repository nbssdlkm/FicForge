// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 确认章节流程。参见 PRD §4.3、§2.6.5 多文件写入顺序契约。
 * 严格遵循 5 步写入顺序：备份 → 章节 → state → ops → 清理草稿。
 */

import { createChapter } from "../domain/chapter.js";
import { scan_characters_in_chapter } from "../domain/character_scanner.js";
import { IndexStatus } from "../domain/enums.js";
import type { GeneratedWith } from "../domain/generated_with.js";
import { createOpsEntry } from "../domain/ops_entry.js";
import { extract_last_scene_ending } from "../domain/text_utils.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { DraftRepository } from "../repositories/interfaces/draft.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";
import { compute_content_hash, generate_op_id, now_utc } from "../repositories/implementations/file_utils.js";

export class ConfirmChapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfirmChapterError";
  }
}

// ---------------------------------------------------------------------------
// AU 互斥锁（Promise queue 串行化）
// ---------------------------------------------------------------------------

const _locks = new Map<string, Promise<void>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = _locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  _locks.set(key, next.then(() => {}, () => {}));
  return next;
}

// ---------------------------------------------------------------------------
// 草稿 ID 解析
// ---------------------------------------------------------------------------

function parseDraftId(draftId: string): [number, string] | null {
  const m = draftId.match(/^ch(\d{4,})_draft_(\w+)\.md$/);
  return m ? [Number(m[1]), m[2]] : null;
}

export interface ConfirmChapterParams {
  au_id: string;
  chapter_num: number;
  draft_id: string;
  generated_with?: GeneratedWith | null;
  cast_registry?: { characters?: string[] };
  character_aliases?: Record<string, string[]> | null;
  content_override?: string | null;
  chapter_repo: ChapterRepository;
  draft_repo: DraftRepository;
  state_repo: StateRepository;
  ops_repo: OpsRepository;
}

export interface ConfirmChapterResult {
  chapter_id: string;
  chapter_num: number;
  revision: number;
  content_hash: string;
  current_chapter: number;
}

export async function confirm_chapter(params: ConfirmChapterParams): Promise<ConfirmChapterResult> {
  return withLock(params.au_id, () => doConfirm(params));
}

async function doConfirm(params: ConfirmChapterParams): Promise<ConfirmChapterResult> {
  const {
    au_id, chapter_num, draft_id,
    generated_with = null,
    cast_registry = { characters: [] },
    character_aliases = null,
    content_override = null,
    chapter_repo, draft_repo, state_repo, ops_repo,
  } = params;

  // === 步骤 0：前置校验 ===
  if (chapter_num <= 0) {
    throw new ConfirmChapterError(`chapter_num 必须为正整数，收到 ${chapter_num}`);
  }

  const parsed = parseDraftId(draft_id);
  if (!parsed) {
    throw new ConfirmChapterError(`无效的 draft_id: ${draft_id}`);
  }

  const [draftChapterNum, draftVariant] = parsed;
  if (draftChapterNum !== chapter_num) {
    throw new ConfirmChapterError(`draft_id 章节号 ${draftChapterNum} 与请求章节号 ${chapter_num} 不匹配`);
  }

  let draft;
  try {
    draft = await draft_repo.get(au_id, chapter_num, draftVariant);
  } catch {
    throw new ConfirmChapterError(`草稿文件不存在: ${draft_id}`);
  }

  const draftContent = content_override ?? draft.content;
  const provenance = content_override !== null ? "mixed" : "ai";

  // === 步骤 1：备份（如果覆盖已有章节）===
  let oldChapterId = "";
  let oldRevision = 0;
  const chapterExists = await chapter_repo.exists(au_id, chapter_num);
  if (chapterExists) {
    const oldChapter = await chapter_repo.get(au_id, chapter_num);
    oldChapterId = oldChapter.chapter_id;
    oldRevision = oldChapter.revision;
    await chapter_repo.backup_chapter(au_id, chapter_num);
  }

  // === 步骤 2：写入正文章节 ===
  const contentHash = await compute_content_hash(draftContent);
  const timestamp = now_utc();
  const chapterId = oldChapterId || crypto.randomUUID();
  const revision = oldRevision ? oldRevision + 1 : 1;

  // 读取 state 获取 confirmed_focus
  const state = await state_repo.get(au_id);
  const confirmedFocus = [...state.chapter_focus];

  const chapter = createChapter({
    au_id,
    chapter_num,
    content: draftContent,
    chapter_id: chapterId,
    revision,
    confirmed_focus: confirmedFocus,
    confirmed_at: timestamp,
    content_hash: contentHash,
    provenance,
    generated_with: generated_with ?? null,
  });
  await chapter_repo.save(chapter);

  // === 步骤 3：更新 state.yaml ===
  const isAdvancing = chapter_num === state.current_chapter;

  if (isAdvancing) {
    state.current_chapter = chapter_num + 1;
  }

  if (isAdvancing) {
    state.last_scene_ending = extract_last_scene_ending(draftContent);
  }

  state.last_confirmed_chapter_focus = confirmedFocus;

  // characters_last_seen 合并更新
  const scanned = scan_characters_in_chapter(
    draftContent, cast_registry ?? { characters: [] }, character_aliases, chapter_num,
  );
  for (const [charName, chNum] of Object.entries(scanned)) {
    const existing = state.characters_last_seen[charName] ?? 0;
    if (chNum > existing) {
      state.characters_last_seen[charName] = chNum;
    }
  }

  state.chapter_focus = [];
  state.index_status = IndexStatus.STALE;

  // === 步骤 4：append ops.jsonl（先于 state 落盘，D-0036） ===
  const gwPayload: Record<string, unknown> = {};
  if (generated_with) {
    gwPayload.mode = generated_with.mode;
    gwPayload.model = generated_with.model;
    gwPayload.temperature = generated_with.temperature;
    gwPayload.top_p = generated_with.top_p;
    gwPayload.input_tokens = generated_with.input_tokens;
    gwPayload.output_tokens = generated_with.output_tokens;
    gwPayload.char_count = generated_with.char_count;
    gwPayload.duration_ms = generated_with.duration_ms;
  }

  await ops_repo.append(au_id, createOpsEntry({
    op_id: generate_op_id(),
    op_type: "confirm_chapter",
    target_id: chapterId,
    chapter_num,
    timestamp,
    payload: {
      focus: confirmedFocus,
      characters_last_seen_snapshot: { ...state.characters_last_seen },
      last_scene_ending_snapshot: state.last_scene_ending,
      generated_with: gwPayload,
    },
  }));

  // === 步骤 4b：state 落盘（ops 之后，可从 ops 重建） ===
  await state_repo.save(state);

  // === 步骤 5：清理草稿 ===
  await draft_repo.delete_by_chapter(au_id, chapter_num);

  return {
    chapter_id: chapterId,
    chapter_num,
    revision,
    content_hash: contentHash,
    current_chapter: state.current_chapter,
  };
}
