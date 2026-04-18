// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * LLM / Embedding 模式的平台能力矩阵 —— UI 与引擎共享的单一权威。
 *
 * ============================================================================
 * 问题背景
 * ============================================================================
 * 历史上 UI 的 <option> 列表（api / local / ollama）是在多个组件里硬编码的：
 *   - GlobalSettingsModal.tsx
 *   - AuSettingsLayout.tsx
 *   - MobileOnboarding.tsx
 * 而引擎的 create_provider 真正支持哪些模式，又是另一份真相。
 * 结果：UI 允许用户选中 local，但生成时引擎拒绝 → "配置页可选、实际使用报错"。
 *
 * 本模块用**一份静态数据**回答两个问题：
 *   1) 某个模式在某个平台上能不能用？
 *   2) 如果不能用，为什么？（敬请期待 / 本平台不支持）
 *
 * UI 消费这份数据渲染 <option>；引擎的 create_provider 独立校验运行时（防手改 YAML）。
 *
 * ============================================================================
 * 扩展新模式的方法
 * ============================================================================
 * 例：将来想支持 Anthropic 原生 Messages API（非 OpenAI 兼容），步骤：
 *   1) create_provider 新增分支
 *   2) GENERATION_MATRIX 加一行，指定各平台的 available
 *   3) UI 会自动渲染新选项（不需要改任何 UI 组件）
 */

/**
 * 模式 key 的字符串联合。刻意与 domain/enums.ts 里的 LLMMode 枚举保持
 * **值相等**但**类型不同** —— 本文件不 import 枚举是为了让 UI 消费能力矩阵时
 * 的类型收窄更简单（能直接用字符串字面量）。矩阵的 key 永远和枚举值对齐，
 * 由 listGenerationModes 的单测保证。
 */
export type LLMModeKey = "api" | "local" | "ollama";
export type EmbeddingModeKey = "api" | "local";
export type Platform = "tauri" | "capacitor" | "web";

export interface ModeAvailability {
  available: boolean;
  /** 不可用原因的机器可读 key。UI 据此显示合适的本地化提示。 */
  reason?:
    | "coming_soon"          // 未来版本计划支持 → UI 可渲染但禁用
    | "platform_unsupported" // 本平台永远不会支持 → UI 不渲染
    | "desktop_only";        // 仅桌面端支持 → UI 在非桌面端不渲染
  /** 给用户看的 i18n hint key（由 UI 层翻译）。可选。 */
  hintKey?: string;
}

// ---------------------------------------------------------------------------
// 生成模式矩阵
// ---------------------------------------------------------------------------

/**
 * 章节续写生成可用的模式。
 *
 * - api：所有平台都是一等公民
 * - ollama：协议兼容 OpenAI，三端都能跑；但移动端/Web 默认 localhost 连不上，
 *   用户需要自己填局域网 IP 或反向代理地址 —— 用 hintKey 提示
 * - local：当前需要 Python sidecar 扩展（未实现），三端都暂不可用。
 *   桌面端标记 coming_soon（UI 渲染但禁用），移动端/Web 标记 desktop_only（不渲染）
 */
const GENERATION_MATRIX: Record<Platform, Record<LLMModeKey, ModeAvailability>> = {
  tauri: {
    api: { available: true },
    ollama: { available: true },
    local: { available: false, reason: "coming_soon" },
  },
  capacitor: {
    api: { available: true },
    ollama: { available: true, hintKey: "settings.ollama.mobileRemoteHint" },
    local: { available: false, reason: "desktop_only" },
  },
  web: {
    api: { available: true },
    ollama: { available: true, hintKey: "settings.ollama.mobileRemoteHint" },
    local: { available: false, reason: "desktop_only" },
  },
};

export function getGenerationModeAvailability(
  platform: Platform,
): Record<LLMModeKey, ModeAvailability> {
  return GENERATION_MATRIX[platform];
}

/** UI 渲染 <option> 时需要的模式列表（顺序即展示顺序，不可用但 coming_soon 的会在末尾）。 */
export function listGenerationModes(platform: Platform): {
  mode: LLMModeKey;
  availability: ModeAvailability;
}[] {
  const matrix = GENERATION_MATRIX[platform];
  const order: LLMModeKey[] = ["api", "ollama", "local"];
  return order
    .map((mode) => ({ mode, availability: matrix[mode] }))
    // 剔除 platform_unsupported / desktop_only（UI 不应渲染）
    .filter(({ availability }) => {
      if (availability.available) return true;
      return availability.reason === "coming_soon";
    });
}

// ---------------------------------------------------------------------------
// Embedding 模式矩阵
// ---------------------------------------------------------------------------

/**
 * Embedding 可用的模式。
 *
 * - api：所有平台 —— 远程 embedding 服务（OpenAI / Voyage / 智谱等）
 * - local：
 *   - 桌面端(Tauri) 设计上通过 Python sidecar 跑内置 bge-small-zh；
 *     但 TS 引擎目前**只实现了 RemoteEmbeddingProvider**，sidecar `/embed` 端点
 *     尚未接入 createEmbeddingProvider（见 TD-005）。为避免"UI 允许但实际不工作"
 *     的断层，桌面端也先标 coming_soon。等 sidecar 消费路径接好后再改回 available。
 *   - 移动端 / Web：Python 运行时本来就不可用，标 desktop_only。
 */
const EMBEDDING_MATRIX: Record<Platform, Record<EmbeddingModeKey, ModeAvailability>> = {
  tauri: {
    api: { available: true },
    local: { available: false, reason: "coming_soon" },
  },
  capacitor: {
    api: { available: true },
    local: { available: false, reason: "desktop_only" },
  },
  web: {
    api: { available: true },
    local: { available: false, reason: "desktop_only" },
  },
};

export function getEmbeddingModeAvailability(
  platform: Platform,
): Record<EmbeddingModeKey, ModeAvailability> {
  return EMBEDDING_MATRIX[platform];
}
