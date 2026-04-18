// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FontDownloader — 字体文件下载引擎。
 *
 * 核心职责：
 * 1. 按 source priority 升序 failover —— 主源失败自动尝试备源，直到成功或全部失败；
 * 2. 通过 ReadableStream 分块读取，触发 onProgress 回调；
 * 3. 完成后执行 SHA-256 校验（sha256 非空时）；
 * 4. 支持 AbortSignal 取消，取消抛出结构化 FontError("aborted", ...)；
 * 5. 所有网络错误 / 校验错误归一化为 FontError。
 *
 * 不负责：存储（storage.ts）、注册（registry.ts）、重试策略（未来 Phase 6）。
 */

import {
  FontError,
  type DownloadableFont,
  type DownloadProgress,
  type FontSource,
} from "./types.js";

export type FetchLike = typeof fetch;
export type ProgressCallback = (progress: DownloadProgress) => void;

export interface DownloaderOptions {
  /** 注入自定义 fetch（测试用）。默认 globalThis.fetch。 */
  fetchImpl?: FetchLike;
}

export class FontDownloader {
  private readonly fetchImpl: FetchLike;

  constructor(options: DownloaderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * 下载字体文件。按源优先级顺序尝试，首个成功源的字节流被返回。
   *
   * @throws {FontError} 所有源失败时抛 "network"；校验失败抛 "checksum"；
   *                    中途取消抛 "aborted"。
   */
  async download(
    entry: DownloadableFont,
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (entry.sources.length === 0) {
      throw new FontError("invalid-manifest", `Font ${entry.id} has no sources`);
    }
    if (signal?.aborted) throw new FontError("aborted", `Download aborted before start: ${entry.id}`);

    // 保护用户进度回调：回调抛错只 console.warn，绝不传播到下载流程——
    // 否则 UI 回调的 bug 会被误判为"该源失败"，错误 failover 到所有源并最终
    // 抛 network error，既浪费带宽又掩盖真正的错误原因。
    const safeProgress: ProgressCallback | undefined = onProgress
      ? (progress) => {
          try { onProgress(progress); }
          catch (e) { console.warn(`[FontDownloader] ${entry.id} onProgress callback threw:`, e); }
        }
      : undefined;

    const sorted = [...entry.sources].sort((a, b) => a.priority - b.priority);
    const errors: { source: FontSource; error: unknown }[] = [];

    for (const source of sorted) {
      try {
        const data = await this.fetchFromSource(source, entry, safeProgress, signal);
        if (entry.sha256) {
          const actual = await sha256Hex(data);
          if (actual !== entry.sha256.toLowerCase()) {
            throw new FontError(
              "checksum",
              `SHA-256 mismatch for ${entry.id} from ${source.url}: expected ${entry.sha256}, got ${actual}`,
            );
          }
        } else {
          console.warn(`[FontDownloader] ${entry.id} 缺少 sha256 校验和，跳过校验（仅开发态可接受）`);
        }
        return data;
      } catch (err) {
        // AbortError 立即向上抛，不再尝试其他源。
        if (err instanceof FontError && err.code === "aborted") throw err;
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new FontError("aborted", `Download aborted: ${entry.id}`, err);
        }
        errors.push({ source, error: err });
      }
    }

    const summary = errors
      .map((e) => `${e.source.url}: ${formatCause(e.error)}`)
      .join("; ");
    // 若所有源都是 checksum 失败，抛出更精确的 checksum 错误（manifest 校验和或所有源均坏）。
    const allChecksum = errors.every(
      (e) => e.error instanceof FontError && e.error.code === "checksum",
    );
    throw new FontError(
      allChecksum ? "checksum" : "network",
      `All ${sorted.length} sources failed for ${entry.id}. ${summary}`,
      errors,
    );
  }

  private async fetchFromSource(
    source: FontSource,
    entry: DownloadableFont,
    onProgress: ProgressCallback | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array> {
    const response = await this.fetchImpl(source.url, { signal });
    if (!response.ok) {
      // 非 2xx 时主动释放 body 流，避免 ReadableStream 资源泄漏。
      try { await response.body?.cancel(); } catch { /* ignore */ }
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentLengthHeader = response.headers.get("Content-Length");
    const declaredTotal = contentLengthHeader ? Number(contentLengthHeader) : NaN;
    const total = Number.isFinite(declaredTotal) ? declaredTotal : entry.sizeBytes || -1;

    // 有 body.getReader 时走流式，否则整体读取。
    const body = response.body;
    if (!body || typeof body.getReader !== "function") {
      const buf = await response.arrayBuffer();
      const data = new Uint8Array(buf);
      onProgress?.({ loaded: data.byteLength, total });
      return data;
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    let released = false;
    const releaseReader = async (): Promise<void> => {
      if (released) return;
      released = true;
      try { await reader.cancel(); } catch { /* ignore */ }
    };

    onProgress?.({ loaded: 0, total });
    try {
      while (true) {
        if (signal?.aborted) {
          await releaseReader();
          throw new FontError("aborted", `Download aborted: ${entry.id}`);
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.byteLength;
          onProgress?.({ loaded, total });
        }
      }
    } catch (err) {
      // 错误路径也要释放 reader，避免 ReadableStream 资源悬挂。
      await releaseReader();
      throw err;
    }
    return concatChunks(chunks, loaded);
  }
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** 计算 Uint8Array 的 SHA-256 十六进制（小写）。 */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new FontError("checksum", "crypto.subtle is required for SHA-256 verification");
  }
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function formatCause(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
