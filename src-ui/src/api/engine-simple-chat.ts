// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Simple Chat — FicForge Lite C2 chat 持久化 API。
 *
 * 单 AU 一份 simple-chat.yaml；每次 message 改动后由 useSimpleChat 防抖保存。
 */

import type { SimpleChatFile, SimpleChatMessageEnvelope } from "@ficforge/engine";
import { getEngine } from "./engine-instance";

export type { SimpleChatFile, SimpleChatMessageEnvelope };

/** 读取 AU 的 chat 历史。文件不存在 / 损坏时返回空白 SimpleChatFile（不抛错）。 */
export async function getSimpleChat(auPath: string): Promise<SimpleChatFile> {
  const { simpleChat } = getEngine().repos;
  return await simpleChat.get(auPath);
}

/** 全量替换写入 chat 历史。 */
export async function saveSimpleChat(
  auPath: string,
  messages: SimpleChatMessageEnvelope[],
): Promise<void> {
  const { simpleChat } = getEngine().repos;
  await simpleChat.save(auPath, messages);
}

/** 清空 AU 的 chat 历史。 */
export async function clearSimpleChat(auPath: string): Promise<void> {
  const { simpleChat } = getEngine().repos;
  await simpleChat.clear(auPath);
}
