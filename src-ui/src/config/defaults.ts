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
 * 供应商相关值（端点 / 模型 id）一律从引擎 provider manifest 派生，本文件不允许
 * 出现与 manifest 重复的字面量 —— 「默认选哪家/哪个模型」是 UI 产品决策，
 * 「这家的端点/模型叫什么」的真相源在 manifest。
 *
 * 不收录：供应商/模型目录本身（manifest + ModelCatalog，目录 ≠ 默认值）、
 * 测试字面量（测试要显式值）、纯展示性的 placeholder 示例文案。
 */

import {
  DEFAULT_CHAPTER_LENGTH as ENGINE_DEFAULT_CHAPTER_LENGTH,
  EmotionStyle,
  findRecommendedModel,
  getProvider,
  OLLAMA_DEFAULT_BASE_URL,
  Perspective,
} from "@ficforge/engine";

/** manifest 内置条目必取（静态数据，缺条目属编码错误，fail-fast 而非静默回退）。 */
function mustProvider(providerId: string) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`provider manifest 缺少内置条目 ${providerId} —— defaults.ts 与 manifest 失配`);
  return provider;
}

/** Ollama 本地服务默认 /v1 端点（api_base 为空时的兜底；真相源 = manifest） */
export const DEFAULT_OLLAMA_BASE_URL = OLLAMA_DEFAULT_BASE_URL;

/**
 * UI 表单默认 context window（tokens）。
 * R2-3 后表单不再预填此值（"" = 未知，引擎按模型推断 / 0 哨兵），当前无消费者；
 * 保留仅作历史锚点，新代码不应再引用 —— 需要默认时走引擎推断链。
 */
export const DEFAULT_CONTEXT_WINDOW = 128000;

/**
 * 默认 LLM 模型标识（DeepSeek）。「默认用 v4-flash」是产品决策（R2-8：deepseek-chat
 * 官方 2026-07-24 停用，ctx 1M；存量用户已保存的配置不受默认值影响）；
 * 模型 id 必须存在于 manifest 推荐列表，漂移时下方断言 fail-fast。
 */
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
if (!findRecommendedModel("deepseek", DEFAULT_DEEPSEEK_MODEL)) {
  throw new Error(`provider manifest 的 deepseek 推荐列表缺少默认模型 ${DEFAULT_DEEPSEEK_MODEL}`);
}

/** 默认在线 API 端点（DeepSeek；真相源 = manifest） */
export const DEFAULT_DEEPSEEK_API_BASE = mustProvider("deepseek").baseUrl;

/**
 * 默认 embedding 配置（硅基流动 bge-m3；新手引导「自定义 embedding」预填）。
 * 端点真相源 = manifest；模型 id 必须存在于 manifest，漂移 fail-fast。
 */
export const DEFAULT_EMBEDDING_MODEL = "BAAI/bge-m3";
if (!findRecommendedModel("siliconflow", DEFAULT_EMBEDDING_MODEL)) {
  throw new Error(`provider manifest 的 siliconflow 推荐列表缺少默认 embedding 模型 ${DEFAULT_EMBEDDING_MODEL}`);
}
export const DEFAULT_EMBEDDING_API_BASE = mustProvider("siliconflow").baseUrl;

/** AU 续写默认章节目标字数（真相源 = 引擎 DEFAULT_CHAPTER_LENGTH；表单初值/回显兜底共用，
 *  与引擎 createProject 缺省 + assembler 预算兜底对齐，杜绝 1500/2000 漂移） */
export const DEFAULT_CHAPTER_LENGTH = ENGINE_DEFAULT_CHAPTER_LENGTH;

/** AU 续写默认视角（真相源 = 引擎 Perspective 枚举） */
export const DEFAULT_PERSPECTIVE: string = Perspective.THIRD_PERSON;

/** AU 续写默认情绪风格（真相源 = 引擎 EmotionStyle 枚举） */
export const DEFAULT_EMOTION_STYLE: string = EmotionStyle.IMPLICIT;
