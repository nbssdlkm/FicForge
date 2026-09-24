// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * pendingSessionSelection — 全局会话管理页 → 目标页会话列表的「打开指定会话」接力。
 *
 * 问题（kimi R8 major）：全局页点击会话行只能 onNavigate(page, contextPath)，
 * 目标页的会话 hook 默认选 updated_at 最新的会话——点非最新会话会落到别的对话里，
 * 用户可能在错误会话中继续发消息。
 *
 * 机制：跳转前写入一次性选择标记；目标页的 useSessionList 加载完成时取走并选中。
 * take 语义保证一次性（跳槽残留不会污染下次默认选择）。
 */

const TTL_MS = 60_000; // kimi R9 minor：登记后未跳转的残留防永久滞留
const pending = new Map<string, { sessionId: string; expiresAt: number }>();

function keyOf(kind: "chat" | "settings", contextPath: string): string {
  return `${kind}:${contextPath}`;
}

/** 跳转前登记：到这个上下文后请选中 sessionId。 */
export function markPendingSessionSelection(kind: "chat" | "settings", contextPath: string, sessionId: string): void {
  pending.set(keyOf(kind, contextPath), { sessionId, expiresAt: Date.now() + TTL_MS });
}

/** 会话列表加载完成时取走（一次性）；无登记返回 null。 */
export function takePendingSessionSelection(kind: "chat" | "settings", contextPath: string): string | null {
  const key = keyOf(kind, contextPath);
  const value = pending.get(key);
  if (value !== undefined) {
    pending.delete(key);
    return value.expiresAt > Date.now() ? value.sessionId : null; // 过期=作废
  }
  return null;
}
