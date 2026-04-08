// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** Fandom 领域对象。参见 PRD §3.2 fandom.yaml。 */

export interface Fandom {
  name: string;
  created_at: string;                        // ISO 8601
  core_characters: string[];
  wiki_source: string;                       // 可选
}

export function createFandom(partial?: Partial<Fandom>): Fandom {
  return {
    name: "",
    created_at: "",
    core_characters: [],
    wiki_source: "",
    ...partial,
  };
}
