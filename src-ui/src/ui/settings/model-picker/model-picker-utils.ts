// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * 供应商主导模型选择器 —— 纯函数层（零 I/O，可独立单测）。
 *
 * 数据来源三层合并（决策 2026-07-07 方案 B / Kelivo 蓝图 §三）：
 *   1. 内置 manifest（engine listProviders，顺序即分区顺序 —— 单一真相源）
 *   2. 用户目录（Settings.custom_providers + enabled_models，经 ModelCatalog 查询视图）
 *   3. 手填（自由文本，ctx 走估算/未知提示路径）
 *
 * ctx 判定分层沿用 engine contextWindowForModel 的口径：
 *   authoritative（manifest 权威）> manual（用户手填）> estimated（MODEL_CONTEXT_MAP fuzzy）
 *   > unknown（三层皆无 —— UI 必须显式提示，禁静默兜底 32k）。
 */

import {
  contextWindowForModel,
  listProviders,
  type CustomModelEntry,
  type ModelKind,
  type ModelTag,
  type RecommendedModel,
} from "@ficforge/engine";
import type { ModelCatalog } from "../../../api/settings";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type CtxSource = "authoritative" | "manual" | "estimated" | "unknown";

export interface CtxInfo {
  source: CtxSource;
  /** authoritative/manual = 权威值；estimated = 估算值；unknown = undefined。 */
  value?: number;
}

/** 下拉选项的统一形状（内置推荐 / 已启用 / 自定义模型合并后）。 */
export interface PickerModelOption {
  id: string;
  displayName: string;
  type: ModelKind;
  tags?: ModelTag[];
  ctx: CtxInfo;
  /** 来源分组（optgroup 显示）。 */
  origin: "recommended" | "enabled" | "custom";
}

/** 供应商的统一视图（内置 + 用户自定义同构合并）。 */
export interface PickerProvider {
  id: string;
  label: string;
  baseUrl: string;
  chatPath?: string;
  isCustom: boolean;
  recommended: readonly RecommendedModel[];
  /** 自定义供应商的手填模型（内置供应商恒为空数组）。 */
  customModels: CustomModelEntry[];
  /** 拉取清单勾选的已启用模型。 */
  enabledModels: CustomModelEntry[];
}

export type SessionLayer = "session" | "au" | "global";

// ---------------------------------------------------------------------------
// 供应商合并视图
// ---------------------------------------------------------------------------

/**
 * 内置（manifest 顺序）+ 用户自定义（追加尾部）合并成选择器供应商清单。
 * catalog 为 null（未加载）时只给内置清单。
 */
export function buildPickerProviders(catalog: ModelCatalog | null, lang: "zh" | "en"): PickerProvider[] {
  const enabled = catalog?.enabled_models ?? {};
  const builtin: PickerProvider[] = listProviders().map((p) => ({
    id: p.id,
    label: p.displayName[lang],
    baseUrl: p.baseUrl,
    ...(p.chatPath ? { chatPath: p.chatPath } : {}),
    isCustom: false,
    recommended: p.recommendedModels,
    customModels: [],
    enabledModels: enabled[p.id] ?? [],
  }));
  const custom: PickerProvider[] = (catalog?.custom_providers ?? []).map((p) => ({
    id: p.id,
    label: p.displayName,
    baseUrl: p.baseUrl,
    ...(p.chatPath ? { chatPath: p.chatPath } : {}),
    isCustom: true,
    recommended: [],
    customModels: p.models,
    enabledModels: enabled[p.id] ?? [],
  }));
  return [...builtin, ...custom];
}

/** 按 api_base 匹配供应商（大小写不敏感 + 尾斜杠归一）。未命中返回 undefined。 */
export function matchProviderByBaseUrl(providers: PickerProvider[], apiBase: string): PickerProvider | undefined {
  const normalized = normalizeBaseUrl(apiBase);
  if (!normalized) return undefined;
  return providers.find((p) => normalizeBaseUrl(p.baseUrl) === normalized);
}

/**
 * baseUrl 归一后相等判定（与 matchProviderByBaseUrl 同口径：大小写不敏感 + 尾斜杠归一）。
 * 双空视为不等（空表单不「匹配」任何供应商）。
 */
export function sameBaseUrl(a: string, b: string): boolean {
  const na = normalizeBaseUrl(a);
  return na !== "" && na === normalizeBaseUrl(b);
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// 模型选项合并 + ctx 分层
// ---------------------------------------------------------------------------

function userEntryToOption(entry: CustomModelEntry, origin: "enabled" | "custom"): PickerModelOption {
  return {
    id: entry.id,
    displayName: entry.displayName || entry.id,
    type: entry.type,
    ctx:
      typeof entry.contextWindow === "number"
        ? { source: "manual", value: entry.contextWindow }
        : estimateCtx(entry.id),
    origin,
  };
}

function estimateCtx(modelId: string): CtxInfo {
  const estimated = contextWindowForModel(modelId);
  return estimated !== undefined ? { source: "estimated", value: estimated } : { source: "unknown" };
}

/**
 * 供应商内可选模型（推荐 > 自定义 > 已启用，按 id 去重前者优先），
 * 按 kind 过滤（embedding 槽位只显示 embedding 类型 —— 实施项 5 的过滤参数）。
 */
export function modelOptionsForProvider(provider: PickerProvider, kind: ModelKind): PickerModelOption[] {
  const seen = new Set<string>();
  const options: PickerModelOption[] = [];

  for (const m of provider.recommended) {
    if (m.type !== kind || seen.has(m.id)) continue;
    seen.add(m.id);
    options.push({
      id: m.id,
      displayName: m.displayName,
      type: m.type,
      ...(m.tags ? { tags: m.tags } : {}),
      ctx: { source: "authoritative", value: m.contextWindow },
      origin: "recommended",
    });
  }
  for (const m of provider.customModels) {
    if (m.type !== kind || seen.has(m.id)) continue;
    seen.add(m.id);
    options.push(userEntryToOption(m, "custom"));
  }
  for (const m of provider.enabledModels) {
    if (m.type !== kind || seen.has(m.id)) continue;
    seen.add(m.id);
    options.push(userEntryToOption(m, "enabled"));
  }
  return options;
}

/**
 * 任意 model id 的 ctx 判定：先在当前选项里精确命中（authoritative/manual），
 * 否则走 engine fuzzy 估算，再否则 unknown。手填模型也经此路径。
 */
export function ctxInfoForModel(options: PickerModelOption[], modelId: string): CtxInfo {
  const hit = options.find((o) => o.id === modelId);
  if (hit) return hit.ctx;
  if (!modelId.trim()) return { source: "unknown" };
  return estimateCtx(modelId);
}

// ---------------------------------------------------------------------------
// 展示辅助
// ---------------------------------------------------------------------------

/** token 数 → 简短标签（十进制口径，与厂商宣传一致）：1_000_000 → "1M"、262_144 → "262K"、8_192 → "8K"。 */
export function formatCtx(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    const rounded = Math.round(m * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return String(tokens);
}

// ---------------------------------------------------------------------------
// 拉取清单：embedding 启发式 + 系列分组（Kelivo 蓝图 §一 模型管理②）
// ---------------------------------------------------------------------------

const EMBEDDING_ID_RE =
  /(embed|embedding|(^|[-_/])bge([-_/]|$)|bge-|text-embedding|(^|[-_/])gte[-_]|m3e|(^|[-_/])e5[-_]|voyage|jina)/i;

/** 模型 id 是否像 embedding 模型（拉取清单自动预标 type，用户可改）。 */
export function isLikelyEmbeddingId(id: string): boolean {
  return EMBEDDING_ID_RE.test(id);
}

/** 系列分组 key（i18n label 走 modelPicker.group.{key}）。embedding 优先归组。 */
const MODEL_SERIES: { key: string; re: RegExp }[] = [
  { key: "gpt", re: /gpt|(^|\/)o[0-9]+(-|$)/i },
  { key: "claude", re: /claude/i },
  { key: "gemini", re: /gemini|gemma/i },
  { key: "deepseek", re: /deepseek/i },
  { key: "qwen", re: /qwen|qwq|qvq/i },
  { key: "glm", re: /(^|[-_/])glm|chatglm/i },
  { key: "kimi", re: /kimi|moonshot/i },
  { key: "doubao", re: /doubao/i },
  { key: "minimax", re: /minimax|abab/i },
  { key: "llama", re: /llama/i },
  { key: "mistral", re: /mistral|mixtral|ministral/i },
];

export function modelGroupKey(id: string): string {
  if (isLikelyEmbeddingId(id)) return "embedding";
  for (const series of MODEL_SERIES) {
    if (series.re.test(id)) return series.key;
  }
  return "other";
}

/** 分组顺序 = MODEL_SERIES 顺序 + embedding + other（拉取 sheet 展示序）。 */
export const MODEL_GROUP_ORDER: readonly string[] = [...MODEL_SERIES.map((s) => s.key), "embedding", "other"];

// ---------------------------------------------------------------------------
// 会话级生效层级（实施项 6 badge 判据 —— 读 useSessionParams 现有解析结果）
// ---------------------------------------------------------------------------

/**
 * 三层生效判定：
 *   session — 会话下拉临时改过（≠ 配置层解析出的模型）
 *   au      — 本篇 AU 覆盖生效中
 *   global  — 全局默认
 */
export function resolveSessionLayer(args: {
  sessionModel: string;
  configuredModel: string;
  hasAuOverride: boolean;
}): SessionLayer {
  if (args.sessionModel && args.sessionModel !== args.configuredModel) return "session";
  return args.hasAuOverride ? "au" : "global";
}
