// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 向量检索结果片段。参见 PRD §2.6.2。 */

export interface Chunk {
  content: string;
  chapter_num: number;
  score: number;
  metadata: Record<string, unknown>;
}

export function createChunk(partial: Pick<Chunk, "content" | "chapter_num" | "score"> & Partial<Chunk>): Chunk {
  return {
    metadata: {},
    ...partial,
  };
}
