// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Settings Chat — 设定助手会话（fandom / AU 设定页 AI 助手）的持久化域类型。
 *
 * 与 simple_chat（对话 tab）的关系：
 * - 复用同一套会话索引类型（ChatSessionMeta / ChatSessionIndex）与存储机制
 *   （index.yaml + 逐会话文件），但目录独立（settings-chat-sessions），
 *   因为两类助手的工具域不同，会话不可混排。
 * - 消息形状镜像 UI 侧 SettingsChatMessage（camelCase 键透传：requestContent /
 *   toolCalls），引擎不消费内容，只做验证 + 透传存储——避免 UI↔引擎双层映射。
 * - 无 legacy 迁移：设定助手此前从未落盘，没有旧文件要兼容。
 */

import { CHAT_SESSION_TITLE_MAX } from "./simple_chat.js";

export const SETTINGS_CHAT_VERSION = 1;

export type SettingsChatRole = "user" | "assistant";

/**
 * 设定助手消息信封：id/role/content 三键验证，其余键（toolCalls / requestContent）
 * 原样透传——工具卡状态（含确认/跳过/撤销终态）随消息一起持久化，重载后原样恢复。
 */
export interface SettingsChatMessageEnvelope {
  id: string;
  role: SettingsChatRole;
  content: string;
  [key: string]: unknown;
}

export interface SettingsChatFile {
  version: number;
  /** 上下文路径：fandom 助手 = fandomPath，AU 设定助手 = auPath。 */
  context_path: string;
  created_at: string;
  updated_at: string;
  messages: SettingsChatMessageEnvelope[];
}

export function createSettingsChatFile(init?: Partial<SettingsChatFile>): SettingsChatFile {
  const now = new Date().toISOString();
  return {
    version: SETTINGS_CHAT_VERSION,
    context_path: init?.context_path ?? "",
    created_at: init?.created_at ?? now,
    updated_at: init?.updated_at ?? now,
    messages: init?.messages ?? [],
  };
}

/** 自动标题：第一条用户消息（空白折叠）截断；没有用户消息时用 fallback 占位。 */
export function deriveSettingsChatTitle(messages: SettingsChatMessageEnvelope[], fallback: string): string {
  const firstUser = messages.find((m) => m.role === "user" && typeof m.content === "string" && m.content.trim());
  if (!firstUser) return fallback;
  const collapsed = firstUser.content.replace(/\s+/g, " ").trim();
  return collapsed.length > CHAT_SESSION_TITLE_MAX ? collapsed.slice(0, CHAT_SESSION_TITLE_MAX) : collapsed;
}
