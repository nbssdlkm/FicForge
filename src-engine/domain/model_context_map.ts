// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 模型 Context Window 映射 + 输出上限查询。参见 PRD §2.5、§4.1。 */

// ---------------------------------------------------------------------------
// Context Window 映射表（PRD §2.5）
//
// 数据口径（调研 2026-07-07-model-landscape-research.md）：
//   - ctx / max output 优先官方文档；`⚠️` 注释 = 二手/未官方确证，取保守值。
//   - key 用「裸模型名小写」形态（不含 org/ 前缀）；fuzzyLookup 会先 strip
//     `org/` 前缀 + 小写化再匹配，故 SiliconFlow/OpenRouter 的 `org/Model`
//     形态 id（如 `deepseek-ai/DeepSeek-V4-Pro`）也能命中同一条目。
//   - **保留旧条目**（deepseek-chat=65536 等）：存量用户配置仍在用（deepseek-chat
//     官方 2026-07-24 才停用），删了会退到 DEFAULT 兜底。
//   - 命中规则：exact > 最长前缀。新增条目务必确保不会成为已有测试里
//     「应落 DEFAULT」的合成模型名（unmapped-model-x / m-proj 等）的前缀。
// ---------------------------------------------------------------------------

export const MODEL_CONTEXT_MAP: Record<string, number> = {
  // --- DeepSeek ---
  // 旧 id：官方 2026-07-24 15:59 UTC 起废弃（映射至 v4-flash），存量配置保留兜底。来源：DeepSeek api-docs（官方）
  "deepseek-chat": 65_536,
  "deepseek-reasoner": 65_536,
  // V4 系列：1M ctx / 384K out。来源：DeepSeek api-docs（官方）
  "deepseek-v4-flash": 1_000_000,
  "deepseek-v4-pro": 1_000_000,

  // --- 阿里 Qwen / 百炼 DashScope ---
  // qwen3.7 旗舰/性价比：1M ctx。来源：阿里云百炼 help（官方 ctx）
  "qwen3.7-max": 1_000_000,
  "qwen3.7-plus": 1_000_000,
  // qwen-long：超长文档 10M ctx。来源：阿里云百炼 help（官方）
  "qwen-long": 10_000_000,
  // 旧旗舰 qwen-max：32K（保留兜底；前缀 fuzzy 不再误命中 qwen3.7-*，因后者是独立更长前缀）。来源：阿里云百炼 help（官方）
  "qwen-max": 32_768,

  // --- Moonshot Kimi ---
  // K2.x 系列：262144 ctx。来源：Kimi platform（官方 ctx）；max out ⚠️ 未确证
  "kimi-k2.7-code": 262_144,
  "kimi-k2.6": 262_144,
  // org/ 形态兜底（SiliconFlow/OpenRouter 常见大小写变体，strip+lower 后命中上面裸名；此处无需重复列）

  // --- 智谱 GLM ---
  // glm-5.2：1M ctx / 128K out。来源：docs.bigmodel.cn（官方 ctx/max out）
  "glm-5.2": 1_000_000,
  // glm-4.7：200K ctx / 128K out，官方点名 creative writing/roleplay 强。来源：docs.bigmodel.cn（官方）
  "glm-4.7": 200_000,

  // --- 字节豆包 / 方舟 Ark ---
  // doubao-seed-2.0 pro/lite：256K ctx。来源：调研表 ⚠️（火山方舟二手；max out 128K⚠️）
  "doubao-seed-2-0-pro-260215": 256_000,
  "doubao-seed-2-0-lite-260215": 256_000,
  // 前缀兜底：未来 doubao-seed-2 系列日期后缀变体，按 256K 估。来源：调研表 ⚠️
  "doubao-seed-2": 256_000,

  // --- MiniMax ---
  // M3：1M ctx。来源：MiniMax platform docs（官方 ctx）
  "minimax-m3": 1_000_000,
  // M2.7：204800 ctx。来源：MiniMax platform docs（官方 ctx）；max out ~196K⚠️
  "minimax-m2.7": 204_800,

  // --- OpenAI ---
  // gpt-5.5 / 5.4：1M ctx / 128K out；5.4-mini 400K。来源：OpenAI developers docs（官方）
  "gpt-5.5": 1_000_000,
  "gpt-5.4-mini": 400_000, // 更长前缀须排在 gpt-5.4 之前的逻辑由 fuzzyLookup 最长前缀保证
  "gpt-5.4": 1_000_000,
  // 旧条目：保留兜底。来源：OpenAI（官方，遗留）
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,

  // --- Google Gemini ---
  // gemini-3.x：1M ctx / 64K out。来源：ai.google.dev（官方 OpenAI 兼容页）
  "gemini-3.1-pro-preview": 1_000_000,
  "gemini-3.5-flash": 1_000_000,
  // 前缀兜底：gemini-3 系列其他变体。来源：ai.google.dev（官方）
  "gemini-3": 1_000_000,
  // 旧条目：保留兜底。来源：Google（官方，遗留/退役）
  "gemini-1.5-pro": 1_000_000,
  "gemini-2.0-flash": 1_000_000,

  // --- Anthropic Claude ---
  // opus-4-8 / sonnet-5 / sonnet-4-6：1M ctx / 128K out。来源：Anthropic platform docs（官方）
  "claude-opus-4-8": 1_000_000,
  "claude-sonnet-5": 1_000_000,
  "claude-sonnet-4-6": 1_000_000, // ⚠️ 修订：旧值 200000 系过时，实为 1M（调研诊断）
  // haiku-4-5：200K ctx / 64K out。来源：Anthropic platform docs（官方）
  "claude-haiku-4-5": 200_000,
  // 旧条目：保留兜底。来源：Anthropic（官方，遗留）
  "claude-3-5-sonnet": 200_000,
  "claude-3-7-sonnet": 200_000,

  // --- Embedding（provider manifest 派生用；不参与生成预算，仅供选择器展示）---
  // bge-m3：8K ctx。来源：BAAI model card（官方）
  "bge-m3": 8_192,

  // --- 本地 / Ollama 常见基座（保留旧条目）---
  // 来源：Meta（官方，遗留）
  llama3: 131_072,
  "llama3.1": 131_072,
};

export const DEFAULT_CONTEXT_WINDOW = 32_000;

// ---------------------------------------------------------------------------
// 模型输出上限映射表（PRD §4.1）
//
// 同上口径。`⚠️` = 未官方确证，取保守值。多数国产厂商 max output 官方未明示，
// 保守取一个不会撑爆响应的值；确证的（DeepSeek 384K / Claude 128K/64K / GLM 128K）按官方。
// ---------------------------------------------------------------------------

export const MODEL_MAX_OUTPUT: Record<string, number> = {
  // --- DeepSeek ---
  "deepseek-chat": 8_192, // 旧条目保留。来源：DeepSeek（官方，遗留）
  "deepseek-reasoner": 8_192, // 旧条目保留。来源：DeepSeek（官方，遗留）
  "deepseek-v4-flash": 384_000, // 来源：DeepSeek api-docs（官方）
  "deepseek-v4-pro": 384_000, // 来源：DeepSeek api-docs（官方）

  // --- 智谱 GLM（官方确证 128K）---
  "glm-5.2": 128_000, // 来源：docs.bigmodel.cn（官方）
  "glm-4.7": 128_000, // 来源：docs.bigmodel.cn（官方）

  // --- OpenAI（官方 128K；mini 保守同旗舰）---
  "gpt-5.5": 128_000, // 来源：OpenAI developers docs（官方）
  "gpt-5.4-mini": 128_000, // 来源：OpenAI developers docs（官方）
  "gpt-5.4": 128_000, // 来源：OpenAI developers docs（官方）
  "gpt-4o": 4_096, // 旧条目保留。来源：OpenAI（官方，遗留）
  "gpt-4-turbo": 4_096, // 旧条目保留。来源：OpenAI（官方，遗留）

  // --- Google Gemini（官方 64K）---
  "gemini-3.1-pro-preview": 64_000, // 来源：ai.google.dev（官方）
  "gemini-3.5-flash": 64_000, // 来源：ai.google.dev（官方）
  "gemini-3": 64_000, // 前缀兜底。来源：ai.google.dev（官方）

  // --- Anthropic Claude（官方 128K / haiku 64K）---
  "claude-opus-4-8": 128_000, // 来源：Anthropic platform docs（官方）
  "claude-sonnet-5": 128_000, // 来源：Anthropic platform docs（官方）
  "claude-sonnet-4-6": 128_000, // 来源：Anthropic platform docs（官方；旧值 8192 严重偏低）
  "claude-haiku-4-5": 64_000, // 来源：Anthropic platform docs（官方）
  "claude-3-5-sonnet": 8_192, // 旧条目保留。来源：Anthropic（官方，遗留）
  "claude-3-7-sonnet": 8_192, // 旧条目保留。来源：Anthropic（官方，遗留）

  // --- Moonshot Kimi（max out 官方未明示，保守取 16K）---
  "kimi-k2.7-code": 16_384, // ⚠️ 未确证，保守值。来源：调研表 ⚠️
  "kimi-k2.6": 16_384, // ⚠️ 未确证，保守值。来源：调研表 ⚠️

  // --- 阿里 Qwen（max out 官方未明示，保守取 8K）---
  "qwen3.7-max": 8_192, // ⚠️ 未确证，保守值。来源：调研表 ⚠️
  "qwen3.7-plus": 8_192, // ⚠️ 未确证，保守值。来源：调研表 ⚠️
  "qwen-long": 8_192, // ⚠️ 未确证，保守值。来源：调研表 ⚠️
  "qwen-max": 8_192, // 旧条目保留。来源：阿里（官方，遗留）

  // --- 字节豆包 / MiniMax（max out 二手，保守值）---
  "doubao-seed-2-0-pro-260215": 128_000, // ⚠️ 未确证 128K⚠️。来源：调研表 ⚠️
  "doubao-seed-2-0-lite-260215": 16_384, // ⚠️ 未确证，保守值。来源：调研表 ⚠️
  "doubao-seed-2": 16_384, // 前缀兜底，保守值。来源：调研表 ⚠️
  "minimax-m3": 16_384, // ⚠️ 未确证，保守值。来源：调研表 ⚠️
  "minimax-m2.7": 196_000, // ⚠️ ~196K⚠️（调研标注）。来源：调研表 ⚠️
};

export const DEFAULT_MAX_OUTPUT = 4_096;

// ---------------------------------------------------------------------------
// 模糊匹配辅助
// ---------------------------------------------------------------------------

/**
 * 归一化模型 id 用于 fuzzy 匹配：strip 组织前缀（`org/Model` → `Model`）+ 全小写。
 *
 * SiliconFlow / OpenRouter 返回的模型 id 带组织前缀（`deepseek-ai/DeepSeek-V4-Pro`、
 * `moonshotai/Kimi-K2.6`、`zai-org/GLM-4.7`），且大小写与官方裸名不同 —— 旧 `startsWith`
 * 逻辑对这类 id 全部落 DEFAULT(32k)，导致 1M 模型被当 32k 用（浪费 97% 预算，调研诊断）。
 * 此处只取最后一段 `/` 之后的部分并小写化：`deepseek-ai/DeepSeek-V4-Pro` → `deepseek-v4-pro`。
 * MODEL_CONTEXT_MAP 的 key 也统一存裸名小写形态，两侧同源比较。
 */
export function normalizeModelId(model_name: string): string {
  const lastSlash = model_name.lastIndexOf("/");
  const bare = lastSlash >= 0 ? model_name.slice(lastSlash + 1) : model_name;
  return bare.toLowerCase();
}

function fuzzyLookup(model_name: string, table: Record<string, number>, defaultVal: number): number {
  const normalized = normalizeModelId(model_name);

  if (normalized in table) {
    return table[normalized];
  }

  // 前缀匹配：按 key 长度降序（最长前缀优先）。table 的 key 已是小写裸名。
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (normalized.startsWith(key)) {
      return table[key];
    }
  }

  return defaultVal;
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/** 获取 context window 大小（PRD §2.5 三层优先级）。 */
export function getContextWindow(project: { llm?: { context_window?: number; model?: string } }): number {
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
export function getModelMaxOutput(model_name: string): number {
  return fuzzyLookup(model_name, MODEL_MAX_OUTPUT, DEFAULT_MAX_OUTPUT);
}

/**
 * 按模型名查 context window（fuzzy：strip org/ 前缀 + 小写 + 最长前缀）。
 * provider_manifest 的推荐模型 ctx/out 从本表派生（盲审 2026-07-11 重复维：
 * 此前 manifest 双写同值字面量，口径变化时两处漂移）。查不到返回 null，
 * 让调用方显式处理「本表未收录」而不是拿到兜底值误当官方口径。
 */
export function lookupModelContextWindow(model_name: string): number | null {
  const v = fuzzyLookup(model_name, MODEL_CONTEXT_MAP, -1);
  return v === -1 ? null : v;
}

/** 同 lookupModelContextWindow，输出上限侧。 */
export function lookupModelMaxOutput(model_name: string): number | null {
  const v = fuzzyLookup(model_name, MODEL_MAX_OUTPUT, -1);
  return v === -1 ? null : v;
}
