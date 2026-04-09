// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 重算全局状态。参见 PRD §4.3。
 * 手动触发全量重建 characters_last_seen / last_scene_ending / last_confirmed_chapter_focus。
 */

import { scan_characters_in_chapter } from "../domain/character_scanner.js";
import { createState } from "../domain/state.js";
import { extract_last_scene_ending } from "../domain/text_utils.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { FactRepository } from "../repositories/interfaces/fact.js";
import type { ProjectRepository } from "../repositories/interfaces/project.js";
import type { StateRepository } from "../repositories/interfaces/state.js";

export interface RecalcResult {
  characters_last_seen: Record<string, number>;
  last_scene_ending: string;
  last_confirmed_chapter_focus: string[];
  chapters_scanned: number;
  cleaned_dirty_count: number;
  cleaned_focus_count: number;
}

export async function recalc_state(
  au_id: string,
  state_repo: StateRepository,
  chapter_repo: ChapterRepository,
  project_repo: ProjectRepository,
  fact_repo?: FactRepository | null,
): Promise<RecalcResult> {
  // 读取 state
  let state;
  try {
    state = await state_repo.get(au_id);
  } catch {
    state = createState({ au_id });
  }

  // 读取 cast_registry
  let castRegistry: { characters?: string[] } = { characters: [] };
  try {
    const project = await project_repo.get(au_id);
    castRegistry = project.cast_registry ?? { characters: [] };
  } catch {
    // ignore
  }

  // 获取所有已确认章节
  let chapters: Awaited<ReturnType<ChapterRepository["list_main"]>>;
  try {
    chapters = await chapter_repo.list_main(au_id);
  } catch {
    chapters = [];
  }

  if (chapters.length === 0) {
    state.characters_last_seen = {};
    state.last_scene_ending = "";
    state.last_confirmed_chapter_focus = [];
    state.chapters_dirty = [];
    state.chapter_focus = [];
    await state_repo.save(state);
    return {
      characters_last_seen: {},
      last_scene_ending: "",
      last_confirmed_chapter_focus: [],
      chapters_scanned: 0,
      cleaned_dirty_count: 0,
      cleaned_focus_count: 0,
    };
  }

  // 按章节号排序
  const sortedChapters = [...chapters].sort((a, b) => a.chapter_num - b.chapter_num);

  let chaptersScanned = 0;
  const newCharactersLastSeen: Record<string, number> = {};

  for (const ch of sortedChapters) {
    if (!ch.content) continue;
    chaptersScanned++;

    const scanned = scan_characters_in_chapter(ch.content, castRegistry, null, ch.chapter_num);
    for (const [charName, chNum] of Object.entries(scanned)) {
      if (chNum > (newCharactersLastSeen[charName] ?? 0)) {
        newCharactersLastSeen[charName] = chNum;
      }
    }
  }

  // 最后一章的信息
  const lastChapter = sortedChapters[sortedChapters.length - 1];
  const newLastSceneEnding = lastChapter.content
    ? extract_last_scene_ending(lastChapter.content)
    : "";
  const newLastConfirmedFocus = [...(lastChapter.confirmed_focus ?? [])];

  // 清理 chapters_dirty
  const existingNums = new Set(sortedChapters.map((ch) => ch.chapter_num));
  const oldDirty = [...(state.chapters_dirty ?? [])];
  const newDirty = oldDirty.filter((n) => existingNums.has(n));
  const cleanedDirtyCount = oldDirty.length - newDirty.length;

  // 清理 chapter_focus
  const oldFocus = [...(state.chapter_focus ?? [])];
  let cleanedFocusCount = 0;
  let newFocus = oldFocus;

  if (oldFocus.length > 0 && fact_repo) {
    try {
      const facts = await fact_repo.list_all(au_id);
      const validFocusIds = new Set(facts.filter((f) => f.status === "unresolved").map((f) => f.id));
      newFocus = oldFocus.filter((fid) => validFocusIds.has(fid));
      cleanedFocusCount = oldFocus.length - newFocus.length;
    } catch {
      newFocus = oldFocus;
    }
  }

  // 写回 state
  state.characters_last_seen = newCharactersLastSeen;
  state.last_scene_ending = newLastSceneEnding;
  state.last_confirmed_chapter_focus = newLastConfirmedFocus;
  state.chapters_dirty = newDirty;
  state.chapter_focus = newFocus;
  await state_repo.save(state);

  return {
    characters_last_seen: newCharactersLastSeen,
    last_scene_ending: newLastSceneEnding,
    last_confirmed_chapter_focus: newLastConfirmedFocus,
    chapters_scanned: chaptersScanned,
    cleaned_dirty_count: cleanedDirtyCount,
    cleaned_focus_count: cleanedFocusCount,
  };
}
