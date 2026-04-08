// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 运行时状态领域对象。参见 PRD §3.5 state.yaml。 */

import { IndexStatus } from "./enums.js";

export interface EmbeddingFingerprint {
  mode: string;       // api / local / ollama
  model: string;
  api_base: string;
}

export function createEmbeddingFingerprint(partial?: Partial<EmbeddingFingerprint>): EmbeddingFingerprint {
  return {
    mode: "",
    model: "",
    api_base: "",
    ...partial,
  };
}

/** AU 运行时状态。字段名与 PRD §3.5 state.yaml 一致。 */
export interface State {
  au_id: string;
  revision: number;
  updated_at: string;                           // ISO 8601
  current_chapter: number;                       // 当前待写章节号（D-0001）
  last_scene_ending: string;
  last_confirmed_chapter_focus: string[];
  characters_last_seen: Record<string, number>;
  chapter_focus: string[];                       // fact id 数组，最多 2 个
  chapter_titles: Record<number, string>;        // {1: "黄昏的告别", 2: "..."}
  chapters_dirty: number[];
  index_status: IndexStatus;
  index_built_with: EmbeddingFingerprint | null;
  sync_unsafe: boolean;
}

export function createState(partial: Pick<State, "au_id"> & Partial<State>): State {
  return {
    revision: 0,
    updated_at: "",
    current_chapter: 1,
    last_scene_ending: "",
    last_confirmed_chapter_focus: [],
    characters_last_seen: {},
    chapter_focus: [],
    chapter_titles: {},
    chapters_dirty: [],
    index_status: IndexStatus.STALE,
    index_built_with: null,
    sync_unsafe: false,
    ...partial,
  };
}
