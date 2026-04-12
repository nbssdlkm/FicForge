// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Tokenizer 路由 + Cache。参见 PRD §2.4。
 *
 * 三种模式：
 * - api / ollama → gpt-tokenizer cl100k_base
 * - local → gpt-tokenizer（无本地 tokenizer.json 支持，直接走 cl100k_base）
 *
 * fallback：gpt-tokenizer 加载失败 → char_mul1.5 估算。
 *
 * gpt-tokenizer（~950KB）通过动态 import 懒加载，不阻塞首屏渲染。
 * 调用方在 async 入口处调用 `await ensureTokenizer()` 预加载，
 * 之后所有 `count_tokens` 调用同步返回，无需改签名。
 */

// ---------------------------------------------------------------------------
// 懒加载缓存
// ---------------------------------------------------------------------------

type EncodeFn = (text: string) => number[];

let _encodeFn: EncodeFn | null = null;
let _loadPromise: Promise<void> | null = null;

/**
 * 预加载 gpt-tokenizer。在生成/RAG 等重计算入口调用一次即可。
 * 多次调用安全（只加载一次），加载失败静默降级为 char_mul1.5。
 */
export async function ensureTokenizer(): Promise<void> {
  if (_encodeFn) return;
  if (!_loadPromise) {
    _loadPromise = import("gpt-tokenizer/encoding/cl100k_base")
      .then((m) => { _encodeFn = m.encode; })
      .catch(() => { /* 降级为估算 */ });
  }
  await _loadPromise;
}

// ---------------------------------------------------------------------------
// Token 计数结果
// ---------------------------------------------------------------------------

export interface TokenCount {
  count: number;
  /** is_estimate=true 表示使用了 char_mul1.5 降级估算。 */
  is_estimate: boolean;
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/**
 * 分词器路由（PRD §2.4）。同步调用。
 * 如果 ensureTokenizer() 已完成，使用精确分词；否则 fallback 为 char_mul1.5。
 */
export function count_tokens(
  text: string,
  _llm_config?: { mode?: string; local_model_path?: string },
): TokenCount {
  if (!text) {
    return { count: 0, is_estimate: false };
  }

  if (_encodeFn) {
    try {
      const tokens = _encodeFn(text);
      return { count: tokens.length, is_estimate: false };
    } catch {
      // fallback
    }
  }

  // gpt-tokenizer 未加载或编码失败 → char_mul1.5
  return { count: Math.trunc(text.length * 1.5), is_estimate: true };
}

/**
 * 清空 tokenizer 缓存。
 * gpt-tokenizer 无需手动清缓存，保留接口兼容。
 */
export function clear_tokenizer_cache(): void {
  // no-op for gpt-tokenizer
}
