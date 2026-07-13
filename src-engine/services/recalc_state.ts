// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 重算全局状态。参见 PRD §4.3。
 * 手动触发全量重建 characters_last_seen / last_scene_ending / last_confirmed_chapter_focus。
 */

import { mergeCharactersLastSeen, scanCharactersInChapter } from "../domain/character_scanner.js";
import { createState } from "../domain/state.js";
import { extractLastSceneEnding } from "../domain/text_utils.js";
import { logCatch } from "../logger/index.js";
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
  /** 计算后的 state 对象（调用方负责 save，以便 ops-first 写入）。 */
  state: Awaited<ReturnType<StateRepository["get"]>>;
}

export async function recalcState(
  au_id: string,
  state_repo: StateRepository,
  chapter_repo: ChapterRepository,
  project_repo: ProjectRepository,
  fact_repo?: FactRepository | null,
  // 别名归一化表（E8）：全量重扫必须与 confirm/undo 同表，否则「重算状态」会把
  // confirm 已按主名记录的 characters_last_seen 冲回别名盲状态（真回归）。null = 无表回退现状。
  character_aliases: Record<string, string[]> | null = null,
): Promise<RecalcResult> {
  // 读取 state
  let state: Awaited<ReturnType<StateRepository["get"]>>;
  try {
    state = await state_repo.get(au_id);
  } catch {
    state = createState({ au_id });
  }

  // 读取 cast_registry：project.yaml 缺失（null）或读失败都回退空名册（recalc 为
  // best-effort 修复工具，不因 project 读不出而中止），读失败落日志可诊断。
  let castRegistry: { characters?: string[] } = { characters: [] };
  try {
    const project = await project_repo.get(au_id);
    castRegistry = project?.cast_registry ?? { characters: [] };
  } catch (err) {
    logCatch("recalc", "project read failed; using empty cast_registry", err);
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
    return {
      characters_last_seen: {},
      last_scene_ending: "",
      last_confirmed_chapter_focus: [],
      chapters_scanned: 0,
      cleaned_dirty_count: 0,
      cleaned_focus_count: 0,
      state,
    };
  }

  // 按章节号排序
  const sortedChapters = [...chapters].sort((a, b) => a.chapter_num - b.chapter_num);

  let chaptersScanned = 0;
  const newCharactersLastSeen: Record<string, number> = {};

  for (const ch of sortedChapters) {
    if (!ch.content) continue;
    chaptersScanned++;

    const scanned = scanCharactersInChapter(ch.content, castRegistry, character_aliases, ch.chapter_num);
    mergeCharactersLastSeen(newCharactersLastSeen, scanned);
  }

  // 最后一章的信息
  const lastChapter = sortedChapters[sortedChapters.length - 1];
  const newLastSceneEnding = lastChapter.content ? extractLastSceneEnding(lastChapter.content) : "";
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

  // 计算完毕，更新 state 对象（不落盘，由调用方在 ops 之后 save）
  state.characters_last_seen = newCharactersLastSeen;
  state.last_scene_ending = newLastSceneEnding;
  state.last_confirmed_chapter_focus = newLastConfirmedFocus;
  state.chapters_dirty = newDirty;
  state.chapter_focus = newFocus;

  return {
    characters_last_seen: newCharactersLastSeen,
    last_scene_ending: newLastSceneEnding,
    last_confirmed_chapter_focus: newLastConfirmedFocus,
    chapters_scanned: chaptersScanned,
    cleaned_dirty_count: cleanedDirtyCount,
    cleaned_focus_count: cleanedFocusCount,
    state,
  };
}
