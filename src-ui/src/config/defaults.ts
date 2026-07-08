// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * UI 侧默认值单一真相源。
 *
 * 这些是 UI 表单层 / API wrapper 层的语义默认值（表单初值、useState 初值、
 * `api_base || 默认` 兜底），**不是**引擎的 fallback floor —— 引擎自有
 * `model_context_map.ts` 的 DEFAULT_CONTEXT_WINDOW(32000)，语义不同，刻意不对齐。
 *
 * 不收录：供应商/模型目录（engine provider manifest + ModelCatalog，目录 ≠ 默认值）、
 * 测试字面量（测试要显式值）、纯展示性的 placeholder 示例文案。
 */

/** Ollama 本地服务默认 /v1 端点（api_base 为空时的兜底） */
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

/** UI 表单默认 context window（tokens）。允许最大历史上下文。 */
export const DEFAULT_CONTEXT_WINDOW = 128000;

/** 默认 LLM 模型标识（DeepSeek） */
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

/** 默认在线 API 端点（DeepSeek） */
export const DEFAULT_DEEPSEEK_API_BASE = "https://api.deepseek.com";

/** AU 续写默认视角 */
export const DEFAULT_PERSPECTIVE = "third_person";

/** AU 续写默认情绪风格（含蓄/显式） */
export const DEFAULT_EMOTION_STYLE = "implicit";
