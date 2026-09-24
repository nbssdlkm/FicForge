// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * SettingsChatRepository — 设定助手会话持久化接口。
 *
 * contextPath 是上下文根路径（fandom 助手 = fandomPath，AU 设定助手 = auPath），
 * 存储落在 `{contextPath}/.well-known/settings-chat-sessions/`。
 * 只有会话面——设定助手此前从未持久化，没有 legacy 兼容负担。
 */

import type { ChatSessionMeta } from "../../domain/simple_chat.js";
import type { SettingsChatFile, SettingsChatMessageEnvelope } from "../../domain/settings_chat.js";

export interface SettingsChatRepository {
  listSessions(contextPath: string): Promise<ChatSessionMeta[]>;
  createSession(contextPath: string, title?: string): Promise<ChatSessionMeta>;
  renameSession(contextPath: string, sessionId: string, title: string): Promise<void>;
  deleteSession(contextPath: string, sessionId: string): Promise<void>;
  getSession(contextPath: string, sessionId: string): Promise<SettingsChatFile>;
  saveSession(contextPath: string, sessionId: string, messages: SettingsChatMessageEnvelope[]): Promise<void>;
  updateSession(
    contextPath: string,
    sessionId: string,
    updater: (messages: SettingsChatMessageEnvelope[]) => SettingsChatMessageEnvelope[],
  ): Promise<void>;
}
