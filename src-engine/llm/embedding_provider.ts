// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** Embedding Provider 接口 + OpenAI 兼容实现。 */

export interface EmbeddingProvider {
  /**
   * 向量化一批文本。`opts.signal` 用于外部取消（如 backfill / 重建索引点停）——
   * 取消时在飞的 HTTP 请求立即中止（不空跑到 30s 超时、不白扣费），抛出 name="AbortError"
   * 的错误，供上层按「干净取消」处理（对齐 backfill 的 isAbortError 语义）。
   */
  embed(texts: string[], opts?: { signal?: AbortSignal }): Promise<number[][]>;
  get_dimension(): number;
  get_model_name(): string;
}

/** 构造 name="AbortError" 的取消错误，让上层（backfill.isAbortError）识别为干净取消。 */
function makeAbortError(): Error {
  const e = new Error("Embedding request aborted");
  e.name = "AbortError";
  return e;
}

/**
 * 远程 Embedding Provider（调用 OpenAI 兼容 /embeddings 端点；apiBase 需包含 /v1）。
 */
export class RemoteEmbeddingProvider implements EmbeddingProvider {
  private dimension = 0;

  constructor(
    private apiBase: string,
    private apiKey: string,
    private model: string,
  ) {}

  async embed(texts: string[], opts?: { signal?: AbortSignal }): Promise<number[][]> {
    if (texts.length === 0) return [];

    const external = opts?.signal;
    // 外部已取消 → 不发起请求，立即以 AbortError 收尾。
    if (external?.aborted) throw makeAbortError();

    const url = `${this.apiBase.replace(/\/+$/, "")}/embeddings`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    // 外部取消（backfill/重建点停）联动内部 controller，立即中止在飞请求。
    const onExternalAbort = () => controller.abort();
    external?.addEventListener("abort", onExternalAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timeoutId);
      external?.removeEventListener("abort", onExternalAbort);
    };

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: controller.signal,
      });
    } catch (e) {
      cleanup();
      // 外部取消优先于超时判定：用户点停时不误报为网络/超时错误。
      if (external?.aborted) throw makeAbortError();
      if (controller.signal.aborted) {
        throw new Error("Embedding API timeout (30s)");
      }
      throw new Error(`Embedding API network error: ${e instanceof Error ? e.message : String(e)}`);
    }
    cleanup();

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
