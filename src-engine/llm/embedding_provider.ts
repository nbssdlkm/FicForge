// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** Embedding Provider 接口 + OpenAI 兼容实现。 */

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  get_dimension(): number;
  get_model_name(): string;
}

/**
 * 远程 Embedding Provider（调用 OpenAI 兼容 /v1/embeddings 端点）。
 */
export class RemoteEmbeddingProvider implements EmbeddingProvider {
  private dimension = 0;

  constructor(
    private apiBase: string,
    private apiKey: string,
    private model: string,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const url = `${this.apiBase.replace(/\/+$/, "")}/v1/embeddings`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!resp.ok) {
      throw new Error(`Embedding API error: HTTP ${resp.status}`);
    }

    const data = (await resp.json()) as {
      data: { index: number; embedding: number[] }[];
    };

    // 按 index 排序
    const sorted = data.data.sort((a, b) => a.index - b.index);
    const embeddings = sorted.map((d) => d.embedding);

    if (embeddings.length > 0 && this.dimension === 0) {
      this.dimension = embeddings[0].length;
    }

    return embeddings;
  }

  get_dimension(): number {
    return this.dimension;
  }

  get_model_name(): string {
    return this.model;
  }
}
