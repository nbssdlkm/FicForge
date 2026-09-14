// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useChatSessions — 对话页会话列表（chat-sessions 底座）。
 *
 * 职责：会话索引的加载 / 选中 / 新建 / 改名 / 删除。消息本体归 useSimpleChat
 * （activeId 作为它的第二参数传入，切会话即触发它的重载）。
 *
 * Hook 5 铁律：不接收 setter；state + reset 同文件（auPath 切换整体重载）；
 * 只暴露语义化动词方法；跨 hook 只传 value（activeId 是 string，不是 state 引用）。
 *
 * 空列表自愈：AU 没有任何会话时自动建一个（本地化默认标题），保证「打开对话页
 * 永远有一个可写的会话」。删除当前选中会话后按同一规则落到最近会话或新建。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChatSession,
  deleteChatSession,
  listChatSessions,
  renameChatSession,
  type ChatSessionMeta,
} from "../../api/engine-client";
import { logUiError } from "../../utils/ui-logger";

export interface UseChatSessionsResult {
  sessions: ChatSessionMeta[];
  /** 当前选中会话 id。加载完成前为 null。 */
  activeId: string | null;
  isLoaded: boolean;
  /** 选中并切换会话（useSimpleChat 随 activeId 变化重载消息）。 */
  selectSession: (sessionId: string) => void;
  /** 新建并选中。title 缺省走本地化默认（仓储在首条用户消息落盘后自动改名）。 */
  createNewSession: (title?: string) => Promise<void>;
  renameSessionById: (sessionId: string, title: string) => Promise<void>;
  /** 删除会话；若删的是当前选中，自动落到最近的其余会话（无其余则新建一个）。 */
  removeSession: (sessionId: string) => Promise<void>;
  /** 重新拉索引（消息数/时间变化后的外部刷新入口）。 */
  refresh: () => Promise<void>;
}

export function useChatSessions(auPath: string): UseChatSessionsResult {
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  /** AU 快速切换 / 连续操作时丢弃迟到响应。 */
  const tokenRef = useRef(0);
  /** 操作内读最新 activeId（removeSession 判定是否删了选中项，不依赖闭包 stale 值）。 */
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // AU 切换：整体重载（reset 与 state 同文件）。空列表自愈建第一个会话。
  useEffect(() => {
    setSessions([]);
    setActiveId(null);
    setIsLoaded(false);
    const token = ++tokenRef.current;
    void (async () => {
      try {
        let list = await listChatSessions(auPath);
        if (tokenRef.current !== token) return;
        if (list.length === 0) {
          // 不传标题 → 仓储落 title_auto 占位，首条用户消息落盘后自动起名
          const created = await createChatSession(auPath);
          if (tokenRef.current !== token) return;
          list = [created];
        }
        setSessions(list);
        // 默认选最近的（listSessions 已按 updated_at 倒序）
        setActiveId(list[0]?.id ?? null);
        setIsLoaded(true);
      } catch (err) {
        if (tokenRef.current !== token) return;
        logUiError("chatSessions", "load sessions failed", err);
        setIsLoaded(true); // 出错也放行 UI（面板可显示空态，不白屏）
      }
    })();
  }, [auPath]);

  const selectSession = useCallback((sessionId: string) => {
    setActiveId(sessionId);
  }, []);

  const createNewSession = useCallback(
    async (title?: string) => {
      const token = ++tokenRef.current;
      // title 缺省 = 自动起名（title_auto）；显式传 title 才当用户命名
      const created = await createChatSession(auPath, title);
      if (tokenRef.current !== token) return;
      setSessions((prev) => [created, ...prev]);
      setActiveId(created.id);
    },
    [auPath],
  );

  const renameSessionById = useCallback(
    async (sessionId: string, title: string) => {
      await renameChatSession(auPath, sessionId, title);
      const token = tokenRef.current;
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title: title.trim() } : s)));
      void token; // rename 是即时本地更新，不碰 token（与在途 load 不冲突：load 会整体覆写）
    },
    [auPath],
  );

  const removeSession = useCallback(
    async (sessionId: string) => {
      const token = ++tokenRef.current;
      await deleteChatSession(auPath, sessionId);
      if (tokenRef.current !== token) return;
      const remaining = sessions.filter((s) => s.id !== sessionId);
      setSessions(remaining);
      if (activeIdRef.current === sessionId) {
        if (remaining.length > 0) {
          // remaining 保持原排序（updated_at 倒序），落最近的一个
          setActiveId(remaining[0].id);
        } else {
          // 删光了：自愈建一个，保证永远有可写会话
          const created = await createChatSession(auPath);
          if (tokenRef.current !== token) return;
          setSessions([created]);
          setActiveId(created.id);
        }
      }
    },
    [auPath, sessions],
  );

  const refresh = useCallback(async () => {
    const token = tokenRef.current;
    const list = await listChatSessions(auPath);
    if (tokenRef.current !== token) return;
    setSessions(list);
  }, [auPath]);

  return {
    sessions,
    activeId,
    isLoaded,
    selectSession,
    createNewSession,
    renameSessionById,
    removeSession,
    refresh,
  };
}
