// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — useSimpleChat
 *
 * Owns the in-memory chat history for SimpleChatPanel. Single AU = single thread；
 * AU 切换时自动清空（C2 接入持久化后改为读 chat.yaml）。
 *
 * 严格遵守主仓库 hook 5 铁律：
 * - 不接收 setter
 * - state + reset 同文件（auPath 切换时 reset）
 * - 不暴露 raw setter，只暴露语义化 method
 * - 跨 hook 只传 value（streaming hook 调本 hook 的 method 改 message）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { asSimpleChatMessages, getSimpleChat, saveSimpleChat } from "../../api/engine-client";
import { warnUi } from "../../utils/ui-logger";
import {
  makeMessageId,
  nowIso,
  type SimpleAssistantMessage,
  type SimpleAssistantToolCall,
  type SimpleChatMessage,
  type SimpleSystemMessage,
  type SimpleToolCallMessage,
  type SimpleToolResultMessage,
  type SimpleUserMessage,
  type SimpleWritingDraftMessage,
  type DraftStatus,
  type ToolCallStatus,
  type SystemTone,
} from "./types";

export interface UseSimpleChatResult {
  messages: SimpleChatMessage[];
  /** chat 历史已从 chat.yaml 加载完成（C2 持久化）。加载完前调用方应展示 loading。 */
  isLoaded: boolean;
  /** 加载报错（损坏 / 权限）。null 表示无错。 */
  loadError: string | null;
  /** 添加用户消息，返回 message id。 */
  appendUserMessage: (content: string) => string;
  /** 添加 AI 闲聊回答消息（chat_reply tool 路径），或携带 toolCalls 的 agent 一轮。
   * toolCalls 仅在 agent loop 调 read-only tool 时填（content 可为空字符串）。
   * 闲聊路径只传 content，保持旧 caller 不需要改动。 */
  appendAssistantMessage: (content: string, toolCalls?: SimpleAssistantToolCall[]) => string;
  /** 流式增量追加到 assistant 消息 content（chat_reply 流式路径）。
   * 实现内部用 ref buffer + requestAnimationFrame 节流（V1 真机：原版每 chunk
   * 一次 setMessages 让 SimpleChatHistory 整列重 reconcile + smooth scroll
   * 跟用户手势抢 scrollTop → 流式期屏幕"上下卡"）。chunks 累积到 buffer，
   * rAF 回调时批量 flush（一次 setMessages 应用所有 pending chunks）。
   * 调用方在终态前必须调 flushStreamingChunks 保证 buffer 落地。 */
  appendAssistantChunk: (id: string, chunk: string) => void;
  /** 添加 agent loop 自动 fetch 的工具结果消息，喂回下一轮 LLM。返回 message id。 */
  appendToolResultMessage: (init: {
    toolCallId: string;
    toolName: string;
    content: string;
    errorMessage?: string;
  }) => string;
  /** 添加写作草稿消息，初始 status='streaming'。返回 message id。 */
  appendDraftMessage: (init: { chapterNum: number; draftLabel?: string }) => string;
  /** streaming 期增量追加 chunk。同 appendAssistantChunk，rAF 节流。 */
  appendDraftChunk: (id: string, chunk: string) => void;
  /** 强制立即 flush 所有 pending streaming chunks 到 messages。
   * 必须在终态 callback (onDoneText / onDoneTools / onError / onCancelled) 前
   * 调用一次，确保 replaceDraftContent / markDraftStatus 等覆盖性写入前 buffer 已落地，
   * 否则 rAF 还没跑就被新 setState 覆盖 → 末尾几个 chunks 丢失。 */
  flushStreamingChunks: () => void;
  /** 用 finalText 替换 streaming 内容（用于 done 事件）。 */
  replaceDraftContent: (id: string, finalText: string) => void;
  /** 用引擎返回的真实 draft label 替换流式期占位的 "?"。 */
  assignDraftLabel: (id: string, label: string) => void;
  /** 保存引擎返回的 generated_with 元数据，confirm 时回传引擎做 ops 审计。 */
  recordDraftGeneratedWith: (id: string, generatedWith: Record<string, unknown>) => void;
  /** 修改草稿状态（streaming → pending → accepted/rejected/discarded/error）。 */
  markDraftStatus: (id: string, status: DraftStatus, opts?: { errorMessage?: string; revision?: number }) => void;
  /** 接受草稿后回填元数据（acceptedAt + revision），同时把 status 设为 'accepted'。
   * revision 传 null 表示未知（标记恢复场景），不写 acceptedRevision。 */
  markDraftAccepted: (id: string, revision: number | null) => void;
  /** 添加 tool call 消息（status='pending'）。 */
  appendToolCallMessage: (init: { toolName: string; toolArgs: Record<string, unknown> }) => string;
  /** 修改 tool call 状态；可一并写入 resultNote / errorMessage / undoMeta。
   * undoMeta=null 等同 unset；undoMeta=undefined 表示不变（向后兼容）。 */
  markToolCallStatus: (
    id: string,
    status: ToolCallStatus,
    opts?: {
      resultNote?: string;
      errorMessage?: string;
      undoMeta?: import("../shared/settings-chat/types").ToolUndoMeta | null;
    },
  ) => void;
  /** 添加章节预览消息。 */
  appendChapterPreviewMessage: (chapterNum: number) => string;
  /** 添加设定预览消息。 */
  appendSettingPreviewMessage: (filePath: string) => string;
  /** 章节/设定预览展开/折叠切换。 */
  togglePreviewExpanded: (id: string) => void;
  /** 添加系统消息（提示/警告/错误条幅）。 */
  appendSystemMessage: (tone: SystemTone, content: string) => string;
  /** 删除指定 id 的消息。 */
  removeMessage: (id: string) => void;
  /** 清空（AU 切换内部已自动调，这里暴露给"清除聊天"按钮）。 */
  clearMessages: () => void;
}

const DEBOUNCE_MS = 200;

/** 单 message 累积 chunk 字节超此值强制同步 flush，绕过 rAF。防止 tab 切后台
 * rAF throttle 时 buffer 无限增长（低端设备后台 1fps，30KB+ 章节内存压力）。 */
const BUFFER_FLUSH_THRESHOLD = 50_000;

export function useSimpleChat(auPath: string): UseSimpleChatResult {
  const [messages, setMessages] = useState<SimpleChatMessage[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const messagesRef = useRef<SimpleChatMessage[]>([]);
  /** 区分 load token 防止 AU 快速切换时旧 load resolve 覆盖新 AU 的状态。 */
  const loadTokenRef = useRef(0);
  /** 区分 save token 同样防 AU 切换后旧 save 串到新 AU。 */
  const auPathRef = useRef(auPath);
  /** 离场 flush 需要在 cleanup 里读到最新值（cleanup 闭包捕获的是旧 render 的 state）。 */
  const isLoadedRef = useRef(false);
  const loadErrorRef = useRef<string | null>(null);
  /** 最后一次已交给 saveSimpleChat 的 messages 数组引用 —— 离场时与当前引用比对，
   * 相同说明防抖窗口里没有未落盘变更，跳过多余写入。
   * 语义（盲审 2026-07-09 中危修复）：发起 save 前乐观置位（防并发重复写），
   * save **失败时必须回滚为 null** —— 否则后续离场/pagehide flush 会把这批消息
   * 误判为「已保存」而跳过，磁盘满/权限瞬时拒绝一次就永久丢消息。 */
  const lastSavedMessagesRef = useRef<SimpleChatMessage[] | null>(null);

  /** save 失败统一处理：撤销「已保存」标记让后续 flush 重试，并落日志。 */
  const rollbackSaveMark = useCallback((attempted: SimpleChatMessage[], err: unknown) => {
    if (lastSavedMessagesRef.current === attempted) {
      lastSavedMessagesRef.current = null;
    }
    warnUi("useSimpleChat", "saveSimpleChat failed; save mark rolled back for retry on next flush", err);
  }, []);
  /** 流式 chunk 缓冲：messageId → 待 append 的累积 chunk 字符串。rAF 触发批量
   * 应用到 messages，避免每 chunk 一次 setMessages 让 SimpleChatHistory 整列
   * 重 reconcile（V1 真机卡顿根因之一）。 */
  const pendingChunksRef = useRef<Map<string, string>>(new Map());
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    auPathRef.current = auPath;
  }, [auPath]);

  useEffect(() => {
    isLoadedRef.current = isLoaded;
  }, [isLoaded]);

  useEffect(() => {
    loadErrorRef.current = loadError;
  }, [loadError]);

  // AU 切换：清空 + 异步 load chat.yaml（铁律 2：state 与 reset 同文件）。
  useEffect(() => {
    setMessages([]);
    setIsLoaded(false);
    setLoadError(null);
    const token = ++loadTokenRef.current;

    void getSimpleChat(auPath)
      .then((file) => {
        if (loadTokenRef.current !== token) return;
        // engine 宽容读取壳 → 正式 domain union，走 domain 的唯一窄化点
        // asSimpleChatMessages（repo 已校验 id/timestamp/kind 三件套；详细字段
        // 不验证，向后兼容旧版 message 形状）。
        const loaded = asSimpleChatMessages(file.messages);
        // 刚 load 的内容即磁盘现状，标记为"已保存"，避免离场 flush / 防抖把它原样重写一遍
        lastSavedMessagesRef.current = loaded;
        setMessages(loaded);
        setIsLoaded(true);
      })
      .catch((err) => {
        if (loadTokenRef.current !== token) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setIsLoaded(true); // 即便错也允许写新 chat
      });
  }, [auPath]);

  // 防抖保存（仅在加载完成且无 loadError 时触发）。
  // 关键：loadError 非空时**不 save**——load 失败原因可能是临时（文件锁、权限瞬时拒绝），
  // 磁盘上其实有内容；自动 save 会用空 [] 覆盖造成静默数据丢失（v4 盲审 P0-2）。
  // 用户能看到 loadError 提示，但内存里的新消息不入磁盘，等下次成功 load 后再恢复。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——auPath 只作触发键重新起防抖；体内读的是 auPathRef.current 快照（保证串写到正确 AU）；删除它不影响正确性但故意保留作防御性重跑
  useEffect(() => {
    if (!isLoaded) return;
    if (loadError !== null) return;
    if (messages === lastSavedMessagesRef.current) return;
    const targetAuPath = auPathRef.current;
    const timeout = setTimeout(() => {
      if (auPathRef.current !== targetAuPath) return;
      lastSavedMessagesRef.current = messages;
      void saveSimpleChat(targetAuPath, messages).catch((err) => {
        // save 失败不阻断 UX，但必须回滚标记让离场/pagehide flush 重试（否则永久丢消息）
        rollbackSaveMark(messages, err);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [auPath, isLoaded, loadError, messages, rollbackSaveMark]);

  // 离场 flush（审计 H3）：AU 切换 / 卸载时，200ms 防抖窗口内未落盘的最后一笔立即写出。
  // 没有它，「已接受」等收尾状态回写恰好落在离场前的防抖窗口里就静默丢失 —— 重载后草稿
  // 回到 pending，用户可再点一次接受重复确认同章。cleanup 先于新 auPath 的 effect 运行，
  // 各 ref 里还是旧 AU 的值，闭包 auPath 也是旧值，不会串写到新 AU。
  useEffect(() => {
    return () => {
      if (!isLoadedRef.current || loadErrorRef.current !== null) return;
      const msgs = messagesRef.current;
      if (msgs === lastSavedMessagesRef.current) return;
      lastSavedMessagesRef.current = msgs;
      void saveSimpleChat(auPath, msgs).catch((err) => {
        // 离场路径无宿主可提示；回滚标记 + 落日志（pagehide flush 仍可能兜到）
        rollbackSaveMark(msgs, err);
      });
    };
  }, [auPath, rollbackSaveMark]);

  // pagehide flush（R1-6）：关标签页 / PWA 进后台被回收 / SW 更新强刷时组件 cleanup
  // 不保证执行，防抖窗口内的最后一笔会静默丢。与离场 flush 同一判定逻辑（有未落盘才写），
  // 全走 ref 读最新值 —— pagehide 时闭包 state 可能已 stale。
  useEffect(() => {
    const flushOnPageHide = () => {
      if (!isLoadedRef.current || loadErrorRef.current !== null) return;
      const msgs = messagesRef.current;
      if (msgs === lastSavedMessagesRef.current) return;
      lastSavedMessagesRef.current = msgs;
      void saveSimpleChat(auPathRef.current, msgs).catch((err) => {
        // 页面正在离场，无宿主可提示；回滚标记 +落日志（bfcache 回退后还有机会重试）
        rollbackSaveMark(msgs, err);
      });
    };
    window.addEventListener("pagehide", flushOnPageHide);
    return () => window.removeEventListener("pagehide", flushOnPageHide);
  }, [rollbackSaveMark]);

  const appendMessage = useCallback((message: SimpleChatMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  /** 把 pendingChunksRef 里所有缓冲 chunk 一次性应用到 messages。snapshot+clear
   * 模式防止 rAF 跑期间新 chunk 进来漏掉（新 chunk 进 buffer，下次 rAF 再 flush）。 */
  const flushChunks = useCallback(() => {
    rafIdRef.current = null;
    const pending = pendingChunksRef.current;
    if (pending.size === 0) return;
    const snapshot = new Map(pending);
    pending.clear();
    setMessages((prev) =>
      prev.map((m) => {
        const chunk = snapshot.get(m.id);
        if (chunk === undefined) return m;
        if (m.kind === "assistant") return { ...m, content: m.content + chunk };
        if (m.kind === "writing-draft") return { ...m, content: m.content + chunk };
        return m;
      }),
    );
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(flushChunks);
  }, [flushChunks]);

  const flushStreamingChunks = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    flushChunks();
  }, [flushChunks]);

  // AU 切换 / unmount cleanup：cancel 挂着的 rAF 并清空 buffer，防止旧 AU 的
  // 缓冲 chunks 在新 AU 错位 append 到 id 不存在的 message（map 会 noop 但 buffer
  // 一直占内存）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——cleanup 仅随 auPath 变化跑（cancel 旧 AU 的 rAF）；auPath 只作触发键、体内不读取；删除会使切 AU 不再清缓冲
  useEffect(() => {
    return () => {
      pendingChunksRef.current.clear();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [auPath]);

  const updateMessage = useCallback((id: string, updater: (prev: SimpleChatMessage) => SimpleChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  }, []);

  const appendUserMessage = useCallback(
    (content: string): string => {
      const message: SimpleUserMessage = {
        id: makeMessageId(),
        kind: "user",
        timestamp: nowIso(),
        content,
      };
      appendMessage(message);
      return message.id;
    },
    [appendMessage],
  );

  const appendAssistantMessage = useCallback(
    (content: string, toolCalls?: SimpleAssistantToolCall[]): string => {
      const message: SimpleAssistantMessage = {
        id: makeMessageId(),
        kind: "assistant",
        timestamp: nowIso(),
        content,
        // 不带 tool_calls 时不写空字段，保持旧版闲聊消息形状不变（chat.yaml diff 干净）
        ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      };
      appendMessage(message);
      return message.id;
    },
    [appendMessage],
  );

  const appendAssistantChunk = useCallback(
    (id: string, chunk: string) => {
      const cur = pendingChunksRef.current.get(id) ?? "";
      const next = cur + chunk;
      pendingChunksRef.current.set(id, next);
      if (next.length > BUFFER_FLUSH_THRESHOLD) {
        flushChunks();
      } else {
        scheduleFlush();
      }
    },
    [scheduleFlush, flushChunks],
  );

  const appendToolResultMessage = useCallback(
    (init: { toolCallId: string; toolName: string; content: string; errorMessage?: string }): string => {
      const message: SimpleToolResultMessage = {
        id: makeMessageId(),
        kind: "tool-result",
        timestamp: nowIso(),
        tool_call_id: init.toolCallId,
        tool_name: init.toolName,
        content: init.content,
        ...(init.errorMessage !== undefined ? { error_message: init.errorMessage } : {}),
      };
      appendMessage(message);
      return message.id;
    },
    [appendMessage],
  );

  const appendDraftMessage = useCallback(
    (init: { chapterNum: number; draftLabel?: string }): string => {
      const message: SimpleWritingDraftMessage = {
        id: makeMessageId(),
        kind: "writing-draft",
        timestamp: nowIso(),
        chapter_num: init.chapterNum,
        draft_label: init.draftLabel ?? "?",
        content: "",
        status: "streaming",
      };
      appendMessage(message);
      return message.id;
    },
    [appendMessage],
  );

  const appendDraftChunk = useCallback(
    (id: string, chunk: string) => {
      const cur = pendingChunksRef.current.get(id) ?? "";
      const next = cur + chunk;
      pendingChunksRef.current.set(id, next);
      if (next.length > BUFFER_FLUSH_THRESHOLD) {
        flushChunks();
      } else {
        scheduleFlush();
      }
    },
    [scheduleFlush, flushChunks],
  );

  const replaceDraftContent = useCallback(
    (id: string, finalText: string) => {
      updateMessage(id, (prev) => {
        if (prev.kind !== "writing-draft") return prev;
        return { ...prev, content: finalText };
      });
    },
    [updateMessage],
  );

  const assignDraftLabel = useCallback(
    (id: string, label: string) => {
      updateMessage(id, (prev) => {
        if (prev.kind !== "writing-draft") return prev;
        return { ...prev, draft_label: label };
      });
    },
    [updateMessage],
  );

  const recordDraftGeneratedWith = useCallback(
    (id: string, generatedWith: Record<string, unknown>) => {
      updateMessage(id, (prev) => {
        if (prev.kind !== "writing-draft") return prev;
        return { ...prev, generated_with: generatedWith };
      });
    },
    [updateMessage],
  );

  const markDraftStatus = useCallback(
    (id: string, status: DraftStatus, opts?: { errorMessage?: string; revision?: number }) => {
      updateMessage(id, (prev) => {
        if (prev.kind !== "writing-draft") return prev;
        return {
          ...prev,
          status,
          ...(opts?.errorMessage !== undefined ? { error_message: opts.errorMessage } : {}),
          ...(opts?.revision !== undefined ? { accepted_revision: opts.revision } : {}),
        };
      });
    },
    [updateMessage],
  );

  const markDraftAccepted = useCallback(
    (id: string, revision: number | null) => {
      updateMessage(id, (prev) => {
        if (prev.kind !== "writing-draft") return prev;
        return {
          ...prev,
          status: "accepted",
          accepted_at: nowIso(),
          ...(revision !== null ? { accepted_revision: revision } : {}),
          error_message: undefined,
        };
      });
    },
    [updateMessage],
  );

  const appendToolCallMessage = useCallback(
    (init: { toolName: string; toolArgs: Record<string, unknown> }): string => {
      const message: SimpleToolCallMessage = {
        id: makeMessageId(),
        kind: "tool-call",
        timestamp: nowIso(),
        tool_name: init.toolName,
        tool_args: init.toolArgs,
        status: "pending",
      };
      appendMessage(message);
      return message.id;
    },
    [appendMessage],
  );

  const markToolCallStatus = useCallback(
    (
      id: string,
      status: ToolCallStatus,
      opts?: {
        resultNote?: string;
        errorMessage?: string;
        undoMeta?: import("../shared/settings-chat/types").ToolUndoMeta | null;
      },
    ) => {
      updateMessage(id, (prev) => {
        if (prev.kind !== "tool-call") return prev;
        return {
          ...prev,
          status,
          ...(opts?.resultNote !== undefined ? { result_note: opts.resultNote } : {}),
          ...(opts?.errorMessage !== undefined ? { error_message: opts.errorMessage } : {}),
          ...(opts?.undoMeta !== undefined ? { undo_meta: opts.undoMeta } : {}),
        };
      });
    },
    [updateMessage],
  );

  const appendChapterPreviewMessage = useCallback(
    (chapterNum: number): string => {
      const message: SimpleChatMessage = {
        id: makeMessageId(),
        kind: "chapter-preview",
        timestamp: nowIso(),
        chapter_num: chapterNum,
        expanded: false,
      };
      appendMessage(message);
      return message.id;
    },
    [appendMessage],
  );

  const appendSettingPreviewMessage = useCallback(
    (filePath: string): string => {
      const message: SimpleChatMessage = {
        id: makeMessageId(),
        kind: "setting-preview",
        timestamp: nowIso(),
        file_path: filePath,
        expanded: false,
      };
      appendMessage(message);
      return message.id;
    },
    [appendMessage],
  );

  const togglePreviewExpanded = useCallback(
    (id: string) => {
      updateMessage(id, (prev) => {
        if (prev.kind === "chapter-preview" || prev.kind === "setting-preview") {
          return { ...prev, expanded: !prev.expanded };
        }
        return prev;
      });
    },
    [updateMessage],
  );

  const appendSystemMessage = useCallback(
    (tone: SystemTone, content: string): string => {
      const message: SimpleSystemMessage = {
        id: makeMessageId(),
        kind: "system",
        timestamp: nowIso(),
        tone,
        content,
      };
      appendMessage(message);
      return message.id;
    },
    [appendMessage],
  );

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return useMemo(
    () => ({
      messages,
      isLoaded,
      loadError,
      appendUserMessage,
      appendAssistantMessage,
      appendAssistantChunk,
      appendToolResultMessage,
      appendDraftMessage,
      appendDraftChunk,
      flushStreamingChunks,
      replaceDraftContent,
      assignDraftLabel,
      recordDraftGeneratedWith,
      markDraftStatus,
      markDraftAccepted,
      appendToolCallMessage,
      markToolCallStatus,
      appendChapterPreviewMessage,
      appendSettingPreviewMessage,
      togglePreviewExpanded,
      appendSystemMessage,
      removeMessage,
      clearMessages,
    }),
    // 全部列出：3 个 state 值 + 20 个 useCallback 稳定回调（均只闭包 appendMessage/
    // updateMessage/flushChunks 等 []-dep 方法，跨渲染 identity 恒定）。列出稳定回调
    // 零行为变化——memo identity 仍只随 messages/isLoaded/loadError 改变——但满足
    // exhaustive-deps 且未来某回调若失稳能被正确捕获（比 ignore 更稳健）。
    [
      messages,
      isLoaded,
      loadError,
      appendUserMessage,
      appendAssistantMessage,
      appendAssistantChunk,
      appendToolResultMessage,
      appendDraftMessage,
      appendDraftChunk,
      flushStreamingChunks,
      replaceDraftContent,
      assignDraftLabel,
      recordDraftGeneratedWith,
      markDraftStatus,
      markDraftAccepted,
      appendToolCallMessage,
      markToolCallStatus,
      appendChapterPreviewMessage,
      appendSettingPreviewMessage,
      togglePreviewExpanded,
      appendSystemMessage,
      removeMessage,
      clearMessages,
    ],
  );
}
