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
 */

import { encode } from "gpt-tokenizer/encoding/cl100k_base";

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
 * 分词器路由（PRD §2.4）。
 *
 * @param text 要计算 token 数的文本。
 * @param llm_config LLMConfig 或类似对象，需要 mode 属性。
 * @returns TokenCount
 */
export function count_tokens(
  text: string,
  _llm_config?: { mode?: string; local_model_path?: string },
): TokenCount {
  if (!text) {
    return { count: 0, is_estimate: false };
  }

  // gpt-tokenizer cl100k_base（覆盖 api / ollama / local 所有模式）
  try {
    const tokens = encode(text);
    return { count: tokens.length, is_estimate: false };
  } catch {
    // fallback
  }

  // 最终 fallback：char_mul1.5
  return { count: Math.trunc(text.length * 1.5), is_estimate: true };
}

/**
 * 清空 tokenizer 缓存。
 * gpt-tokenizer 无需手动清缓存，保留接口兼容。
 */
export function clear_tokenizer_cache(): void {
  // no-op for gpt-tokenizer
}
