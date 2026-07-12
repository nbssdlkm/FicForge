// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 供应商主导模型选择器 —— 内置供应商 + 推荐模型清单（单一真相源）。
 *
 * 决策：`docs/internal/plans/2026-07-07-model-picker-decision.md`（方案 B）。
 * 数据：`docs/internal/plans/2026-07-07-model-landscape-research.md`（ctx/max out 口径同 model_context_map）。
 * 蓝图：`docs/internal/plans/2026-07-07-kelivo-model-picker-notes.md` §三（Kelivo ProviderConfig + Cherry 三层合并）。
 *
 * 职责边界（纯数据 + 纯函数，零 I/O）：
 *   - 只放**内置**供应商与推荐模型。用户自定义供应商/模型走 UI 阶段的 settings 存储，
 *     **不进本 manifest** —— 但类型（ProviderEntry / RecommendedModel）刻意设计成
 *     「用户自定义条目与内置条目同构」（蓝图硬性要求），UI 阶段可直接复用同一形状做三层合并。
 *   - contextWindow 单一真相源分层（见 contextWindowForModel 注释）：
 *       manifest 推荐模型的 ctx（权威） > MODEL_CONTEXT_MAP fuzzy（按 id 推断） > undefined（调用方兜 DEFAULT）。
 */

import {
  MODEL_CONTEXT_MAP,
  getContextWindow,
  lookupModelContextWindow,
  lookupModelMaxOutput,
  normalizeModelId,
} from "./model_context_map.js";

// ---------------------------------------------------------------------------
// 类型（参照 Kelivo ProviderConfig + Cherry ModelInfo，蓝图 §三.3-4）
// ---------------------------------------------------------------------------

/** 模型能力标签（UI 场景标注；对中文写手排序用）。 */
export type ModelTag = "flagship" | "value" | "long_context" | "creative";

/** 模型类型（Kelivo type 二分：对话 / 向量）。 */
export type ModelKind = "chat" | "embedding";

/** 中英双语显示名（UI i18n 直接取）。 */
export interface LocalizedName {
  zh: string;
  en: string;
}

/**
 * 推荐模型条目。
 *
 * 与「用户自定义模型」同构：UI 阶段用户手填的模型也用这个形状，
 * 故 contextWindow 是必填权威值（喂 computeInputBudget），maxOutputTokens 可选。
 */
export interface RecommendedModel {
  /** 模型 id（发给 API 的名字，可能带 org/ 前缀，如 SiliconFlow 的 `deepseek-ai/DeepSeek-V4-Pro`）。 */
  id: string;
  /** UI 展示名（简短，不含 org/ 前缀）。 */
  displayName: string;
  /** context window（权威值，喂 computeInputBudget）。 */
  contextWindow: number;
  /** 单次输出上限（可选；官方未明示时省略，调用方回退 MODEL_MAX_OUTPUT / DEFAULT）。 */
  maxOutputTokens?: number;
  /** chat / embedding。 */
  type: ModelKind;
  /** 场景标签（可选）。 */
  tags?: ModelTag[];
}

/**
 * 供应商条目。
 *
 * 与「用户自定义供应商」同构：UI 阶段用户添加的 OpenAI 兼容供应商也用这个形状，
 * 只是 recommendedModels 由用户 settings 填充。内置条目 recommendedModels 是预填清单。
 */
export interface ProviderEntry {
  /** 供应商稳定 id（复合主键 `providerId::modelId` 的前半，蓝图必抄）。 */
  id: string;
  /** 中英双语显示名。 */
  displayName: LocalizedName;
  /** 默认 API base（OpenAI 兼容端点，含 /v1 等路径）。 */
  baseUrl: string;
  /** 可选自定义 chat 路径（默认 /chat/completions；豆包/特殊网关用）。 */
  chatPath?: string;
  /** 推荐模型数组（每家 2-4 个；Ollama 为空，运行时 ctx 需手填）。 */
  recommendedModels: RecommendedModel[];
}

// ---------------------------------------------------------------------------
// 内置供应商清单（单一真相源）
//
// 排序 = 对中文写手重要性（蓝图 §三；DeepSeek/硅基流动/Kimi/GLM 靠前）。
// baseUrl 来源见调研表第 1 节；ctx/max out 不在此双写 —— 构建期从
// MODEL_CONTEXT_MAP / MODEL_MAX_OUTPUT 派生（单一真相源，盲审 2026-07-11 重复维）。
// ⚠️ = 二手/未官方确证，取保守值。
// ---------------------------------------------------------------------------

// 内置清单的「原始」形态：不含 ctx/out —— 这两个数字唯一活在 MODEL_CONTEXT_MAP /
// MODEL_MAX_OUTPUT（domain/model_context_map.ts），构建期注入，防两处字面量漂移。
type RawRecommendedModel = Omit<RecommendedModel, "contextWindow" | "maxOutputTokens">;
type RawProviderEntry = Omit<ProviderEntry, "recommendedModels"> & {
  recommendedModels: RawRecommendedModel[];
};

const _RAW_PROVIDERS: readonly RawProviderEntry[] = [
  {
    id: "deepseek",
    displayName: { zh: "DeepSeek 深度求索", en: "DeepSeek" },
    baseUrl: "https://api.deepseek.com",
    recommendedModels: [
      // 来源：DeepSeek api-docs（官方 ctx/max out）
      {
        id: "deepseek-v4-flash",
        displayName: "DeepSeek V4 Flash",
        type: "chat",
        tags: ["value", "long_context"],
      },
      {
        id: "deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro",
        type: "chat",
        tags: ["flagship", "long_context"],
      },
    ],
  },
  {
    id: "siliconflow",
    displayName: { zh: "硅基流动 SiliconFlow", en: "SiliconFlow" },
    baseUrl: "https://api.siliconflow.cn/v1",
    recommendedModels: [
      // 硅基流动托管：模型 id **带组织前缀**（调研表明确）。ctx/max out 同基座。
      // 来源：SiliconFlow docs（官方 base_url）；基座数据来源 DeepSeek/智谱官方
      {
        id: "deepseek-ai/DeepSeek-V4-Pro",
        displayName: "DeepSeek V4 Pro",
        type: "chat",
        tags: ["flagship", "long_context"],
      },
      {
        id: "zai-org/GLM-4.7",
        displayName: "GLM-4.7",
        type: "chat",
        tags: ["creative"],
      },
      {
        // embedding：bge-m3（免费状态待真机核，调研 ⚠️）。来源：SiliconFlow docs
        id: "BAAI/bge-m3",
        displayName: "BGE-M3 (embedding)",
        type: "embedding",
      },
    ],
  },
  {
    id: "moonshot",
    displayName: { zh: "月之暗面 Kimi", en: "Moonshot Kimi" },
    baseUrl: "https://api.moonshot.cn/v1",
    recommendedModels: [
      // ctx 262144 官方；max out ⚠️ 未确证保守 16K。中文创作口碑好（调研）
      // 来源：Kimi platform（官方 ctx）
      {
        id: "kimi-k2.7-code",
        displayName: "Kimi K2.7 Code",
        type: "chat",
        tags: ["flagship", "long_context"],
      },
      {
        id: "kimi-k2.6",
        displayName: "Kimi K2.6",
        type: "chat",
        tags: ["long_context", "creative"],
      },
    ],
  },
  {
    id: "zhipu",
    displayName: { zh: "智谱 GLM", en: "Zhipu GLM" },
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    recommendedModels: [
      // 来源：docs.bigmodel.cn（官方 ctx/max out）
      {
        id: "glm-5.2",
        displayName: "GLM-5.2",
        type: "chat",
        tags: ["flagship", "long_context"],
      },
      {
        // 官方点名 creative writing / roleplay 强（调研）
        id: "glm-4.7",
        displayName: "GLM-4.7",
        type: "chat",
        tags: ["creative", "value"],
      },
    ],
  },
  {
    id: "dashscope",
    displayName: { zh: "阿里通义千问 / 百炼", en: "Alibaba Qwen / DashScope" },
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    recommendedModels: [
      // ctx 官方；max out ⚠️ 未确证保守 8K。来源：阿里云百炼 help（官方 ctx）
      {
        id: "qwen3.7-max",
        displayName: "Qwen3.7 Max",
        type: "chat",
        tags: ["flagship", "long_context"],
      },
      {
        id: "qwen3.7-plus",
        displayName: "Qwen3.7 Plus",
        type: "chat",
        tags: ["value", "long_context"],
      },
      {
        id: "qwen-long",
        displayName: "Qwen Long (10M)",
        type: "chat",
        tags: ["long_context"],
      },
    ],
  },
  {
    id: "ark",
    displayName: { zh: "字节豆包 / 火山方舟", en: "ByteDance Doubao / Ark" },
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    recommendedModels: [
      // ctx 256K；max out 128K⚠️（调研二手）。来源：调研表 ⚠️（火山方舟）
      {
        id: "doubao-seed-2-0-pro-260215",
        displayName: "Doubao Seed 2.0 Pro",
        type: "chat",
        tags: ["flagship", "long_context"],
      },
      {
        id: "doubao-seed-2-0-lite-260215",
        displayName: "Doubao Seed 2.0 Lite",
        type: "chat",
        tags: ["value", "long_context"],
      },
    ],
  },
  {
    id: "minimax",
    displayName: { zh: "MiniMax", en: "MiniMax" },
    baseUrl: "https://api.minimaxi.com/v1",
    recommendedModels: [
      // 来源：MiniMax platform docs（官方 ctx）；max out ⚠️
      {
        id: "MiniMax-M3",
        displayName: "MiniMax M3",
        type: "chat",
        tags: ["flagship", "long_context"],
      },
      {
        id: "MiniMax-M2.7",
        displayName: "MiniMax M2.7",
        type: "chat",
        tags: ["long_context"],
      },
    ],
  },
  {
    id: "openrouter",
    displayName: { zh: "OpenRouter 聚合", en: "OpenRouter" },
    baseUrl: "https://openrouter.ai/api/v1",
    recommendedModels: [
      // OpenRouter 用 `org/model` 形态；ctx 随基座。/models 端点返回富元数据（唯一）。
      // 来源：OpenRouter docs（base_url）；基座数据来源 Anthropic/智谱官方
      {
        id: "anthropic/claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        type: "chat",
        tags: ["flagship", "creative", "long_context"],
      },
      {
        id: "z-ai/glm-4.7",
        displayName: "GLM-4.7",
        type: "chat",
        tags: ["creative", "value"],
      },
    ],
  },
  {
    id: "openai",
    displayName: { zh: "OpenAI", en: "OpenAI" },
    baseUrl: "https://api.openai.com/v1",
    recommendedModels: [
      // 来源：OpenAI developers docs（官方）。大陆不可直连（调研备注）
      {
        id: "gpt-5.5",
        displayName: "GPT-5.5",
        type: "chat",
        tags: ["flagship", "long_context"],
      },
      {
        id: "gpt-5.4",
        displayName: "GPT-5.4",
        type: "chat",
        tags: ["long_context"],
      },
      {
        id: "gpt-5.4-mini",
        displayName: "GPT-5.4 Mini",
        type: "chat",
        tags: ["value"],
      },
    ],
  },
  {
    id: "gemini",
    displayName: { zh: "Google Gemini", en: "Google Gemini" },
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    recommendedModels: [
      // 来源：ai.google.dev（官方 OpenAI 兼容页）。大陆不可直连（调研备注）
      {
        id: "gemini-3.1-pro-preview",
        displayName: "Gemini 3.1 Pro",
        type: "chat",
        tags: ["flagship", "long_context"],
      },
      {
        id: "gemini-3.5-flash",
        displayName: "Gemini 3.5 Flash",
        type: "chat",
        tags: ["value", "long_context"],
      },
    ],
  },
  {
    id: "anthropic",
    displayName: { zh: "Anthropic Claude", en: "Anthropic Claude" },
    // 官方注明 OpenAI 兼容层非生产推荐；大陆多经 OpenRouter（调研）
    baseUrl: "https://api.anthropic.com/v1/",
    recommendedModels: [
      // 来源：Anthropic platform docs（官方 ctx/max out）。中文小说圈文笔口碑第一（调研）
      {
        id: "claude-opus-4-8",
        displayName: "Claude Opus 4.8",
        type: "chat",
        tags: ["flagship", "creative", "long_context"],
      },
      {
        id: "claude-sonnet-5",
        displayName: "Claude Sonnet 5",
        type: "chat",
        tags: ["creative", "long_context"],
      },
      {
        id: "claude-haiku-4-5",
        displayName: "Claude Haiku 4.5",
        type: "chat",
        tags: ["value"],
      },
    ],
  },
  {
    id: "ollama",
    displayName: { zh: "Ollama 本地", en: "Ollama (local)" },
    baseUrl: "http://localhost:11434/v1",
    // 推荐模型留空：本地模型 id/ctx 因人而异，且 Ollama 默认 num_ctx=4096，
    // 标称 ctx ≠ 运行时 ctx（调研）—— UI 应强提示用户手填 context window。
    recommendedModels: [],
  },
];

/**
 * 构建期注入 ctx/out（fail-fast：manifest 推荐模型必须在 MODEL_CONTEXT_MAP 有条目，
 * 缺条目属编码错误 —— 与 mustProvider 同哲学，不静默兜底成 DEFAULT 伪装权威值）。
 * maxOutputTokens 查不到则省略（RecommendedModel 该字段可选，调用方自兜）。
 */
function withModelContext(m: RawRecommendedModel): RecommendedModel {
  const ctx = lookupModelContextWindow(m.id);
  if (ctx === null) {
    throw new Error(`MODEL_CONTEXT_MAP 缺少 provider manifest 推荐模型 "${m.id}" 的条目`);
  }
  const out = lookupModelMaxOutput(m.id);
  return { ...m, contextWindow: ctx, ...(out !== null ? { maxOutputTokens: out } : {}) };
}

const _PROVIDERS: readonly ProviderEntry[] = _RAW_PROVIDERS.map((p) => ({
  ...p,
  recommendedModels: p.recommendedModels.map(withModelContext),
}));

// ---------------------------------------------------------------------------
// 查询函数（纯函数）
// ---------------------------------------------------------------------------

/** 全部内置供应商（按对中文写手重要性排序，顺序即 UI 分区顺序 —— 单一真相源）。 */
export function listProviders(): readonly ProviderEntry[] {
  return _PROVIDERS;
}

/** 按 id 取供应商条目（未命中返回 undefined）。 */
export function getProvider(providerId: string): ProviderEntry | undefined {
  return _PROVIDERS.find((p) => p.id === providerId);
}

/** 内置条目必取（manifest 静态数据，缺条目属编码错误，fail-fast 而非静默回退）。 */
function mustProvider(providerId: string): ProviderEntry {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`provider manifest 缺少内置条目 ${providerId}`);
  return provider;
}

/**
 * Ollama 默认 /v1 端点 —— 字面量唯一定义在上方 manifest 条目内，
 * 引擎兜底（config_resolver）与 UI 表单默认值均从此导出取值。
 */
export const OLLAMA_DEFAULT_BASE_URL = mustProvider("ollama").baseUrl;

/**
 * 在指定供应商内查推荐模型（精确 id 匹配）。
 * providerId 未命中 → undefined；modelId 未命中 → undefined。
 */
export function findRecommendedModel(providerId: string, modelId: string): RecommendedModel | undefined {
  const provider = getProvider(providerId);
  if (!provider) return undefined;
  return provider.recommendedModels.find((m) => m.id === modelId);
}

/**
 * 查模型的 context window —— 单一真相源分层（本任务核心 helper）。
 *
 * 优先级（层与层之间"命中即返回"）：
 *   1. **manifest 推荐模型的 ctx（权威）** —— 若给了 providerId 且该供应商内精确命中 modelId，
 *      直接返回其 contextWindow（内置权威值，最准）。
 *   2. **MODEL_CONTEXT_MAP fuzzy** —— 按 model id 推断（strip org/ + 小写 + 前缀匹配）。
 *      注意：getContextWindow 对未知 id 返回 DEFAULT_CONTEXT_WINDOW（不返回 undefined），
 *      故本层用「fuzzy 命中的裸名是否真在 MODEL_CONTEXT_MAP 里」判定是否算命中。
 *   3. **undefined** —— 前两层都没有权威数据，交给调用方自己兜 DEFAULT（不在此静默 fallback，
 *      避免把"猜测的 32k"伪装成"权威值"；蓝图 §三.4 明确禁静默 fallback）。
 *
 * @param model 模型 id（可带 org/ 前缀）。
 * @param providerId 可选；给了才走第 1 层 manifest 权威查询。
 * @returns 有权威/推断值时返回数字；完全未知返回 undefined。
 */
export function contextWindowForModel(model: string, providerId?: string): number | undefined {
  // 第 1 层：manifest 推荐模型权威 ctx
  if (providerId) {
    const recommended = findRecommendedModel(providerId, model);
    if (recommended) return recommended.contextWindow;
  }

  // 第 2 层：MODEL_CONTEXT_MAP fuzzy —— 仅当归一化 id 真的落在表内（exact 或前缀）才算命中，
  // 否则 getContextWindow 会返回 DEFAULT，那属于"没查到"，应交给调用方兜（第 3 层）。
  // 复用 MODEL_CONTEXT_MAP 的 key 集合做命中判据（单一真相源，不重复实现 fuzzyLookup）。
  const normalized = normalizeModelId(model);
  const hit = Object.keys(MODEL_CONTEXT_MAP).some((key) => normalized === key || normalized.startsWith(key));
  if (hit) {
    return getContextWindow({ llm: { context_window: 0, model } });
  }

  // 第 3 层：未知，交调用方兜 DEFAULT
  return undefined;
}
