// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite (粮坊·简) — SimpleChatPanel 共享类型。
 *
 * 真相源已下沉引擎 `domain/simple_chat.ts`（盲审长期债④第一步）：消息 kind 判别
 * union 持久化在 chat.yaml 里，本来就是领域数据。本文件只做薄 re-export 让 UI 端
 * import 路径不变；DraftStatus / ToolCallStatus / SystemTone 是引擎侧
 * Simple 前缀命名的历史别名（UI 局部惯用名，引擎全局命名空间需要前缀防歧义）。
 * 增删字段 / kind 请改引擎 domain，勿在此加类型。
 */

export type {
  SimpleMessageKind,
  SimpleDraftStatus as DraftStatus,
  SimpleToolCallStatus as ToolCallStatus,
  SimpleSystemTone as SystemTone,
  SimpleUserMessage,
  SimpleAssistantToolCall,
  SimpleAssistantMessage,
  SimpleToolResultMessage,
  SimpleWritingDraftMessage,
  SimpleToolCallMessage,
  SimpleChapterPreviewMessage,
  SimpleSettingPreviewMessage,
  SimpleSystemMessage,
  SimpleChatMessage,
} from "@ficforge/engine";

/** 生成草稿 message id 时的前缀；C2 持久化时按 id 去重。 */
export const MESSAGE_ID_PREFIX = "smplmsg";

export function makeMessageId(): string {
  return `${MESSAGE_ID_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
