// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LocalFileStateRepository — state.yaml 读写实现。参见 PRD §3.5。 */

import * as yaml from "js-yaml";
import type { PlatformAdapter } from "../../platform/adapter.js";
import { IndexStatus } from "../../domain/enums.js";
import type { EmbeddingFingerprint, State } from "../../domain/state.js";
import { createEmbeddingFingerprint, createState } from "../../domain/state.js";
import { STATE_YAML } from "../../domain/paths.js";
import { ON_DISK_DEFAULT_REVISION } from "../../domain/project.js";
import type { StateRepository } from "../interfaces/state.js";
import {
  atomicWrite,
  dumpYaml,
  joinPath,
  nowUtc,
  objToPlain,
  validateBasePath,
  withWriteLock,
} from "../../utils/file_utils.js";

export class FileStateRepository implements StateRepository {
  constructor(private adapter: PlatformAdapter) {}

  private statePath(au_id: string): string {
    validateBasePath(au_id, "au_id");
    return joinPath(au_id, STATE_YAML);
  }

  async get(au_id: string): Promise<State> {
    const path = this.statePath(au_id);
    const exists = await this.adapter.exists(path);
    if (!exists) {
      return createState({ au_id });
    }

    const text = await this.adapter.readFile(path);
    const raw = yaml.load(text) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") {
      return createState({ au_id });
    }

    return dictToState(raw, au_id);
  }

  async save(state: State): Promise<void> {
    const path = this.statePath(state.au_id);
    await withWriteLock(path, async () => {
      state.updated_at = nowUtc();
      state.revision += 1;
      const raw = objToPlain(state);
      const content = dumpYaml(raw);
      const dir = path.substring(0, path.lastIndexOf("/"));
      await this.adapter.mkdir(dir);
      // state.yaml 截断会丢 index_status / dirty 标记等推进状态 —— 原子写（审计 H5）
      await atomicWrite(this.adapter, path, content);
    });
  }

  async update(au_id: string, mutator: (state: State) => void): Promise<State> {
    const path = this.statePath(au_id);
    return withWriteLock(path, async () => {
      const state = await this.get(au_id);
      mutator(state);
      state.updated_at = nowUtc();
      state.revision += 1;
      const raw = objToPlain(state);
      const content = dumpYaml(raw);
      const dir = path.substring(0, path.lastIndexOf("/"));
      await this.adapter.mkdir(dir);
      await atomicWrite(this.adapter, path, content);
      return state;
    });
  }
}

function dictToEmbeddingFingerprint(d: Record<string, unknown> | null): EmbeddingFingerprint | null {
  if (!d) return null;
  return createEmbeddingFingerprint({
    mode: (d.mode as string) ?? "",
    model: (d.model as string) ?? "",
    api_base: (d.api_base as string) ?? "",
  });
}

function dictToState(d: Record<string, unknown>, au_id: string): State {
  const chapterTitles: Record<number, string> = {};
  const rawTitles = (d.chapter_titles ?? {}) as Record<string, string>;
  for (const [k, v] of Object.entries(rawTitles)) {
    chapterTitles[Number(k)] = v;
  }

  return createState({
    au_id,
    revision: (d.revision as number) ?? ON_DISK_DEFAULT_REVISION,
    updated_at: (d.updated_at as string) ?? "",
    current_chapter: (d.current_chapter as number) ?? 1,
    last_scene_ending: (d.last_scene_ending as string) ?? "",
    last_confirmed_chapter_focus: (d.last_confirmed_chapter_focus as string[]) ?? [],
    characters_last_seen: (d.characters_last_seen as Record<string, number>) ?? {},
    chapter_focus: (d.chapter_focus as string[]) ?? [],
    chapter_titles: chapterTitles,
    chapters_dirty: (d.chapters_dirty as number[]) ?? [],
    index_status:
      IndexStatus[(d.index_status as string)?.toUpperCase() as keyof typeof IndexStatus] ?? IndexStatus.STALE,
    index_built_with: dictToEmbeddingFingerprint(d.index_built_with as Record<string, unknown> | null),
    sync_unsafe: (d.sync_unsafe as boolean) ?? false,
  });
}
