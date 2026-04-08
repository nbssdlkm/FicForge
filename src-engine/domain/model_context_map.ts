// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 模型 Context Window 映射 + 输出上限查询。参见 PRD §2.5、§4.1。 */

// ---------------------------------------------------------------------------
// Context Window 映射表（PRD §2.5）
// ---------------------------------------------------------------------------

export const MODEL_CONTEXT_MAP: Record<string, number> = {
  "deepseek-chat": 65_536,
  "deepseek-reasoner": 65_536,
  "claude-3-5-sonnet": 200_000,
  "claude-3-7-sonnet": 200_000,
  "claude-sonnet-4-6": 200_000,
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  "gemini-1.5-pro": 1_000_000,
  "gemini-2.0-flash": 1_000_000,
  "qwen-long": 1_000_000,
  "qwen-max": 32_768,
  "llama3": 131_072,
  "llama3.1": 131_072,
};

export const DEFAULT_CONTEXT_WINDOW = 32_000;

// ---------------------------------------------------------------------------
// 模型输出上限映射表（PRD §4.1）
// ---------------------------------------------------------------------------

export const MODEL_MAX_OUTPUT: Record<string, number> = {
  "deepseek-chat": 8_192,
  "deepseek-reasoner": 8_192,
  "claude-3-5-sonnet": 8_192,
  "claude-3-7-sonnet": 8_192,
  "claude-sonnet-4-6": 8_192,
  "gpt-4o": 4_096,
  "gpt-4-turbo": 4_096,
  "qwen-max": 8_192,
};

export const DEFAULT_MAX_OUTPUT = 4_096;

// ---------------------------------------------------------------------------
// 模糊匹配辅助
// ---------------------------------------------------------------------------

function fuzzyLookup(model_name: string, table: Record<string, number>, defaultVal: number): number {
  if (model_name in table) {
    return table[model_name];
  }

  // 前缀匹配：按 key 长度降序（最长前缀优先）
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (model_name.startsWith(key)) {
      return table[key];
    }
  }

  return defaultVal;
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/** 获取 context window 大小（PRD §2.5 三层优先级）。 */
export function get_context_window(project: { llm?: { context_window?: number; model?: string } }): number {
  // 第 1 层：手动填写
  const cw = project.llm?.context_window;
  if (typeof cw === "number" && cw > 0) {
    return cw;
  }

  // 第 2 层：映射表
  const model = project.llm?.model;
  if (typeof model === "string" && model) {
    return fuzzyLookup(model, MODEL_CONTEXT_MAP, DEFAULT_CONTEXT_WINDOW);
  }

  // 第 3 层：默认值
  return DEFAULT_CONTEXT_WINDOW;
}

/** 获取模型单次输出 token 上限（PRD §4.1）。 */
export function get_model_max_output(model_name: string): number {
  return fuzzyLookup(model_name, MODEL_MAX_OUTPUT, DEFAULT_MAX_OUTPUT);
}
