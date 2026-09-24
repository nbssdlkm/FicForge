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
import { takePendingSessionSelection } from "./pendingSessionSelection";
import {
  createChatSession,
  createSettingsChatSession,
  deleteChatSession,
  deleteSettingsChatSession,
  listChatSessions,
  listSettingsChatSessions,
  renameChatSession,
  renameSettingsChatSession,
  type ChatSessionMeta,
} from "../../api/engine-client";
import { logUiError } from "../../utils/ui-logger";

/** 会话索引存储面：对话 tab（chat-sessions）与设定助手（settings-chat-sessions）同一状态机。 */
export interface ChatSessionStore {
  list: (path: string) => Promise<ChatSessionMeta[]>;
  create: (path: string, title?: string) => Promise<ChatSessionMeta>;
  rename: (path: string, sessionId: string, title: string) => Promise<void>;
  remove: (path: string, sessionId: string) => Promise<void>;
}

const CHAT_STORE: ChatSessionStore = {
  list: listChatSessions,
  create: createChatSession,
  rename: renameChatSession,
  remove: deleteChatSession,
};

const SETTINGS_CHAT_STORE: ChatSessionStore = {
  list: listSettingsChatSessions,
  create: createSettingsChatSession,
  rename: renameSettingsChatSession,
  remove: deleteSettingsChatSession,
};

export interface UseChatSessionsResult {
  sessions: ChatSessionMeta[];
  /** 当前选中会话 id。加载完成前为 null。 */
  activeId: string | null;
  isLoaded: boolean;
  /** 会话列表加载失败标记（非空时 UI 应显示警告——此期间设定助手会话不持久化）。 */
  loadError: string | null;
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
  return useSessionList(auPath, CHAT_STORE, "chat");
}

/** 设定助手（fandom / AU 设定页 AI 助手）的会话列表。contextPath = fandomPath 或 auPath。 */
export function useSettingsChatSessions(contextPath: string): UseChatSessionsResult {
  return useSessionList(contextPath, SETTINGS_CHAT_STORE, "settings");
}

function useSessionList(path: string, store: ChatSessionStore, kind: "chat" | "settings"): UseChatSessionsResult {
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  /** 加载失败标记（kimi R8 major）：list 抛错时暴露给 UI 显示警告——否则设定助手场景
   * sessionId 恒 null，整段对话只活在内存、静默不落盘，用户毫无知觉。 */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** AU 快速切换 / 连续操作时丢弃迟到响应。 */
  /** load token：仅 load effect（path 切换重载）递增；create/remove/refresh 只快照
   * 不自增——并发操作互不作废（对抗审 2026-09-14：连删时第一个被 token 提前 return
   * 丢弃状态更新，留下 ghost），只有 load 能作废在途操作。 */
  const loadTokenRef = useRef(0);
  /** 操作内读最新 activeId（removeSession 判定是否删了选中项，不依赖闭包 stale 值）。 */
  const activeIdRef = useRef<string | null>(null);
  /** sessions 的 ref 镜像：并发连删两个会话时，第二个 remove 若用闭包旧快照算
   * remaining，会把已被磁盘删除的会话留在列表（对抗审 2026-09-14 minor）。 */
  const sessionsRef = useRef<ChatSessionMeta[]>([]);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // AU 切换：整体重载（reset 与 state 同文件）。空列表自愈建第一个会话。
  useEffect(() => {
    setSessions([]);
    setActiveId(null);
    setIsLoaded(false);
    setLoadError(null);
    // 无上下文路径（面板禁用态）：直接放行空态，不打存储
    if (!path) {
      setIsLoaded(true);
      return;
    }
    const token = ++loadTokenRef.current;
    void (async () => {
      try {
        let list = await store.list(path);
        if (loadTokenRef.current !== token) return;
        if (list.length === 0) {
          // 不传标题 → 仓储落 title_auto 占位，首条用户消息落盘后自动起名
          const created = await store.create(path);
          if (loadTokenRef.current !== token) return;
          list = [created];
        }
        // 合并而非覆盖：加载途中用户可能已手动 createNewSession（磁盘已有但 list 读取
        // 早于那次落盘），硬覆盖会让它在 UI 消失（复审 2026-09-14 minor）。
        // sessionsRef 全程同步回写（load/create/remove/refresh），这里读它即最新状态。
        const inList = new Set(list.map((s) => s.id));
        const merged = [...list, ...sessionsRef.current.filter((p) => !inList.has(p.id))];
        sessionsRef.current = merged;
        setSessions(merged);
        // 全局管理页接力（kimi R8 major）：跳转前登记的指定会话优先选中，一次性取走
        const wanted = takePendingSessionSelection(kind, path);
        const wantedHit = wanted !== null && merged.some((s) => s.id === wanted);
        // 默认选最近的（listSessions 已按 updated_at 倒序）；已有选中项且仍在列表里则不动
        const keep = activeIdRef.current !== null && merged.some((s) => s.id === activeIdRef.current);
        const nextId = wantedHit ? wanted : keep ? activeIdRef.current : (merged[0]?.id ?? null);
        activeIdRef.current = nextId;
        setActiveId(nextId);
        setIsLoaded(true);
      } catch (err) {
        if (loadTokenRef.current !== token) return;
        logUiError("chatSessions", "load sessions failed", err);
        setLoadError(err instanceof Error ? err.message : String(err));
        setIsLoaded(true); // 出错也放行 UI（面板可显示空态，不白屏）；loadError 供 UI 警告
      }
    })();
  }, [path, store, kind]);

  const selectSession = useCallback((sessionId: string) => {
    activeIdRef.current = sessionId; // 同步回写：与 removeSession 竞态时读到最新
    setActiveId(sessionId);
  }, []);

  const createNewSession = useCallback(
    async (title?: string) => {
      const token = loadTokenRef.current;
      // title 缺省 = 自动起名（title_auto）；显式传 title 才当用户命名
      let created: ChatSessionMeta;
      try {
        created = await store.create(path, title);
      } catch (err) {
        // 创建失败不再静默穿透（kimi 复审 R4 minor）
        logUiError("chatSessions", "create session failed", err);
        return;
      }
      if (loadTokenRef.current !== token) return;
      sessionsRef.current = [created, ...sessionsRef.current];
      activeIdRef.current = created.id;
      setSessions((prev) => [created, ...prev]);
      setActiveId(created.id);
    },
    [path, store],
  );

  const renameSessionById = useCallback(
    async (sessionId: string, title: string) => {
      const token = loadTokenRef.current;
      try {
        await store.rename(path, sessionId, title);
      } catch (err) {
        // 改名失败对用户不再静默（kimi 交叉验证 2026-09-14 minor）；状态不动，标题保持原样
        logUiError("chatSessions", "rename session failed", err);
        return;
      }
      if (loadTokenRef.current !== token) return; // 在途 load（path 切换）会整体覆写，这里不画蛇添足
      // 同步回写 sessionsRef（复审 R2 minor：漏同步会让 load 的合并读到旧标题）
      sessionsRef.current = sessionsRef.current.map((s) => (s.id === sessionId ? { ...s, title: title.trim() } : s));
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title: title.trim() } : s)));
    },
    [path, store],
  );

  const removeSession = useCallback(
    async (sessionId: string) => {
      const token = loadTokenRef.current;
      try {
        await store.remove(path, sessionId);
      } catch (err) {
        // 删除失败不再静默穿透成 unhandled rejection（kimi 交叉验证 2026-09-14 minor）
        logUiError("chatSessions", "remove session failed", err);
        return;
      }
      if (loadTokenRef.current !== token) return;
      // 并发连删安全：从 ref 镜像算 remaining 并同步回写 ref（下个 remove 不等
      // React render 就能读到最新值），再 setSessions——不用闭包快照（对抗审 2026-09-14）。
      const remaining = sessionsRef.current.filter((s) => s.id !== sessionId);
      sessionsRef.current = remaining;
      setSessions(remaining);
      if (activeIdRef.current === sessionId) {
        if (remaining.length > 0) {
          // remaining 保持原排序（updated_at 倒序），落最近的一个
          activeIdRef.current = remaining[0].id; // 同步回写，并发连删读到最新
          setActiveId(remaining[0].id);
        } else {
          // 删光了：自愈建一个，保证永远有可写会话
          let created: ChatSessionMeta;
          try {
            created = await store.create(path);
          } catch (err) {
            // 自愈失败：保持空列表 + 清空选中，下次 refresh/重载再试（kimi 复审 R4 minor）
            logUiError("chatSessions", "self-heal create after remove-all failed", err);
            activeIdRef.current = null;
            setActiveId(null);
            return;
          }
          if (loadTokenRef.current !== token) return;
          sessionsRef.current = [created];
          activeIdRef.current = created.id;
          setSessions([created]);
          setActiveId(created.id);
        }
      }
    },
    [path, store],
  );

  const refresh = useCallback(async () => {
    const token = loadTokenRef.current;
    let list: ChatSessionMeta[];
    try {
      list = await store.list(path);
    } catch (err) {
      // refresh 失败保持现状（防抖下轮再试），不穿透成 unhandled rejection（kimi 复审 R4 minor）
      logUiError("chatSessions", "refresh sessions failed", err);
      return;
    }
    if (loadTokenRef.current !== token) return;
    // 与 load 同款合并：refresh 途中用户 createNewSession 不被顶掉（复审 R2 minor）
    const inList = new Set(list.map((s) => s.id));
    const merged = [...list, ...sessionsRef.current.filter((p) => !inList.has(p.id))];
    sessionsRef.current = merged;
    setSessions(merged);
  }, [path, store]);

  return {
    sessions,
    activeId,
    isLoaded,
    loadError,
    selectSession,
    createNewSession,
    renameSessionById,
    removeSession,
    refresh,
  };
}
