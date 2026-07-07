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

/**
 * 把某条写作草稿的 accepted 终态直接钉进 simple-chat.yaml（锁内 read-modify-write）。
 *
 * 为什么不走 UI 内存 + 防抖 save：confirmChapter 内部串行跑多个 LLM 调用（数秒~数十秒），
 * 期间用户切走 / 离开工作区会让内存标记与防抖保存双双失效 → 章节已定稿但草稿永远显示
 * 可点「接受」，再点一次就重复确认覆写同章（审计 H3）。这里的写入不依赖组件存活。
 *
 * revision 传 null 表示未知（标记恢复场景），只钉 status/acceptedAt 不写 acceptedRevision。
 */
export async function markSimpleChatDraftAccepted(
  auPath: string,
  messageId: string,
  revision: number | null,
): Promise<void> {
  const { simpleChat } = getEngine().repos;
  await simpleChat.update(auPath, (messages) =>
    messages.map((m) => {
      if (m.id !== messageId || m.kind !== "writing-draft") return m;
      const next: SimpleChatMessageEnvelope = {
        ...m,
        status: "accepted",
        acceptedAt: new Date().toISOString(),
        ...(revision !== null ? { acceptedRevision: revision } : {}),
      };
      // 终态清掉历史错误文案，避免「accepted 却挂着 error 信息」的矛盾展示
      delete next.errorMessage;
      return next;
    }),
  );
}
