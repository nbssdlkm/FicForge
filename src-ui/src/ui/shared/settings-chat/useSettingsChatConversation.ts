// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSettingsChatSession,
  saveSettingsChatSession,
  sendSettingsChat,
  type SettingsChatMessageEnvelope,
  type SettingsChatSessionLlm,
} from "../../../api/engine-client";
import { useActiveRequestGuard } from "../../../hooks/useActiveRequestGuard";
import { logUiError } from "../../../utils/ui-logger";
import { useFeedback } from "../../../hooks/useFeedback";
import { useTranslation } from "../../../i18n/useAppTranslation";
import {
  createToolCallCardState,
  getToolCallName,
  getToolStatusSummary,
  type LargeTextIntent,
  type SettingsChatMessage,
  type SettingsMode,
  type ToolCallCardState,
} from "./types";

const MESSAGE_STORAGE_PREFIX = "settings-mode";

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildOutboundUserMessage(rawInput: string, intent: LargeTextIntent, t: TranslateFn): string {
  if (intent === "character") {
    return [t("settingsMode.prompt.largeTextCharacter"), rawInput].join("\n\n");
  }

  if (intent === "worldbuilding") {
    return [t("settingsMode.prompt.largeTextWorldbuilding"), rawInput].join("\n\n");
  }

  return rawInput;
}

function serializeAssistantMessage(message: SettingsChatMessage, t: TranslateFn): string {
  const toolSummaries = (message.toolCalls || []).map((card) => {
    const args = Object.entries(card.parsedArgs)
      .slice(0, 4)
      .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(t("common.listSeparator")) : String(value)}`)
      .join(t("common.listComma"));
    return `${getToolCallName(card)}${args ? `${t("common.parenOpen")}${args}${t("common.parenClose")}` : ""}`;
  });
  const summaries = (message.toolCalls || [])
    .map((card) => getToolStatusSummary(card, t))
    .filter((item): item is string => Boolean(item));

  const parts = [message.content];
  if (toolSummaries.length > 0) {
    parts.push(t("settingsMode.historyPreviousTools", { tools: `- ${toolSummaries.join("\n- ")}` }));
  }
  if (summaries.length > 0) {
    parts.push(t("settingsMode.historyProcessedTools", { tools: `- ${summaries.join("\n- ")}` }));
  }
  return parts.filter(Boolean).join("\n\n");
}

function toApiMessages(
  messages: SettingsChatMessage[],
  t: TranslateFn,
): { role: "user" | "assistant"; content: string }[] {
  return messages.map((message) => ({
    role: message.role,
    content:
      message.role === "assistant"
        ? serializeAssistantMessage(message, t)
        : (message.requestContent ?? message.content),
  }));
}

interface SettingsChatConversationParams {
  mode: SettingsMode;
  basePath?: string;
  fandomPath?: string;
  sessionLlm?: SettingsChatSessionLlm | null;
  disabled: boolean;
  /** 会话底座：选中会话 id（useSettingsChatSessions 驱动）。null = 未就绪，不加载不持久化。 */
  sessionId?: string | null;
}

/** 引擎信封 → UI 消息的唯一窄化点：仓储里就是本 hook 防抖保存的原形状（透传键含 toolCalls）。 */
function asSettingsChatMessages(envelopes: SettingsChatMessageEnvelope[]): SettingsChatMessage[] {
  return envelopes as SettingsChatMessage[];
}

/** UI 消息 → 引擎信封（spread 补 index signature；同一形状的双向边界，与上方成对）。 */
function toSettingsChatEnvelopes(messages: SettingsChatMessage[]): SettingsChatMessageEnvelope[] {
  return messages.map((m) => ({ ...m }));
}

/**
 * useSettingsChatConversation — 设定对话的会话状态（消息流 / 输入框 / busy 编排）。
 *
 * 消息数组同时承载工具卡状态（ToolCallCardState 挂在 assistant 消息上），
 * 所以卡片更新入口（updateMessageCards / updateSingleCard）也住这里；
 * useSettingsChatToolActions 经这些语义化 method 写卡片，不碰 setMessages。
 *
 * postMutationBusy：工具执行成功后的 loadSupportData + onAfterMutation 刷新窗口，
 * 归属会话 busy 全景（mutationBusy = sending ∥ hasLoadingCards ∥ postMutationBusy），
 * toolActions 经 begin/endPostMutationRefresh 语义化开合（hook 规则 3）。
 */
export function useSettingsChatConversation({
  mode,
  basePath,
  fandomPath,
  sessionLlm,
  disabled,
  sessionId = null,
}: SettingsChatConversationParams) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const chatGuard = useActiveRequestGuard(`chat:${mode}:${basePath ?? ""}:${sessionId ?? ""}`);

  const [messages, setMessages] = useState<SettingsChatMessage[]>([]);
  const messagesRef = useRef<SettingsChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [isPostMutationBusy, setPostMutationBusy] = useState(false);
  /** 会话消息从磁盘就绪前不持久化（防加载途中被空数组覆写）。 */
  const [isLoaded, setIsLoaded] = useState(false);
  /** 加载失败闸门（kimi R8 blocker）：load 出错时磁盘上可能有内容，此时 messages=[]
   * 若放行持久化会把会话历史清空——loadError 非空期间防抖与 flush 双禁写
   * （与 useSimpleChat 同款契约）。 */
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadErrorRef = useRef<string | null>(null);
  /** isLoaded / basePath / sessionId 的 ref 镜像：防抖点火与离场 flush 在闭包里读最新值。 */
  const isLoadedRef = useRef(false);
  const basePathRef = useRef(basePath);
  const sessionIdRef = useRef(sessionId);
  /** 最后一次交给落盘的 messages 引用——防抖点火前比对跳过重写，失败回滚重试
   * （与 useSimpleChat 同款；缺它则 save 失败后用户再无改动时最后一笔永久丢，
   * 对抗审 2026-09-14 minor）。 */
  const lastSavedMessagesRef = useRef<SettingsChatMessage[] | null>(null);
  const loadTokenRef = useRef(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    isLoadedRef.current = isLoaded;
  }, [isLoaded]);

  useEffect(() => {
    basePathRef.current = basePath;
  }, [basePath]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    loadErrorRef.current = loadError;
  }, [loadError]);

  // 切上下文 / 切会话：reset + 从磁盘加载该会话消息（铁律②：state 与 reset 同文件）。
  // sessionId=null（会话索引未就绪）只 reset 不加载、保持不持久化。
  useEffect(() => {
    setSending(false);
    setPostMutationBusy(false);
    setMessages([]);
    setInputText("");
    setIsLoaded(false);
    setLoadError(null);
    if (!basePath || !sessionId) return;
    const token = ++loadTokenRef.current;
    void (async () => {
      try {
        const file = await getSettingsChatSession(basePath, sessionId);
        if (loadTokenRef.current !== token) return;
        const loaded = asSettingsChatMessages(file.messages);
        lastSavedMessagesRef.current = loaded; // 刚 load 的内容即磁盘现状
        setMessages(loaded);
        setIsLoaded(true);
      } catch (err) {
        if (loadTokenRef.current !== token) return;
        // 走到这里多半是适配器级故障（ensureIndex/statEntry 瞬时抛错）。放行 UI 空白可写，
        // 但必须立 loadError 闸门禁持久化——否则防抖会以空数组覆写磁盘历史（kimi R8 blocker）。
        logUiError("settingsChat", "load session failed", err);
        setLoadError(err instanceof Error ? err.message : String(err));
        setIsLoaded(true);
      }
    })();
  }, [basePath, sessionId]);

  // 持久化：消息变更防抖 400ms 落盘当前会话（工具卡确认/跳过/撤销终态同消息一起存）。
  // 加载未就绪 / 无会话上下文时跳过；发送中途的中间态也会被最后一次防抖收敛。
  // 点火时再核 basePath/sessionId 最新值（防抖窗口内切会话不写串，对抗审 2026-09-14）。
  useEffect(() => {
    if (!isLoaded || loadError !== null || !basePath || !sessionId) return;
    if (messages === lastSavedMessagesRef.current) return;
    const targetPath = basePath;
    const targetSession = sessionId;
    const attempted = messages;
    const timer = setTimeout(() => {
      if (basePathRef.current !== targetPath || sessionIdRef.current !== targetSession) return;
      lastSavedMessagesRef.current = attempted;
      void saveSettingsChatSession(targetPath, targetSession, toSettingsChatEnvelopes(messagesRef.current)).catch(
        (err) => {
          // 失败回滚标记：下一次消息变更 / 换会话 flush 重试，不静默丢最后一笔
          if (lastSavedMessagesRef.current === attempted) lastSavedMessagesRef.current = null;
          logUiError("settingsChat", "save session failed", err);
        },
      );
    }, 400);
    return () => clearTimeout(timer);
    // messages 只作变更信号，落盘读 messagesRef 最新值（防抖语义）
  }, [messages, isLoaded, loadError, basePath, sessionId]);

  // 换会话 / 切上下文 / 卸载 flush：防抖窗口内未落盘的最后一笔立即写给【旧】会话
  // （cleanup 闭包捕获旧 basePath/sessionId；useSimpleChat 同款，对抗审 2026-09-14 major：
  // 400ms 窗口内切会话丢消息）。
  useEffect(() => {
    return () => {
      if (!isLoadedRef.current || loadErrorRef.current !== null || !basePath || !sessionId) return;
      if (messagesRef.current === lastSavedMessagesRef.current) return;
      const attempted = messagesRef.current;
      lastSavedMessagesRef.current = attempted;
      void saveSettingsChatSession(basePath, sessionId, toSettingsChatEnvelopes(attempted)).catch((err) => {
        if (lastSavedMessagesRef.current === attempted) lastSavedMessagesRef.current = null;
        logUiError("settingsChat", "flush on switch/unmount failed", err);
      });
    };
  }, [basePath, sessionId]);

  const hasLoadingCards = messages.some((message) => (message.toolCalls || []).some((card) => card.isLoading));
  const mutationBusy = sending || hasLoadingCards || isPostMutationBusy;

  const updateMessageCards = useCallback(
    (messageId: string, updater: (cards: ToolCallCardState[]) => ToolCallCardState[]) => {
      setMessages((current) =>
        current.map((message) => {
          if (message.id !== messageId || !message.toolCalls) return message;
          return {
            ...message,
            toolCalls: updater(message.toolCalls),
          };
        }),
      );
    },
    [],
  );

  const updateSingleCard = useCallback(
    (messageId: string, cardId: string, updater: (card: ToolCallCardState) => ToolCallCardState) => {
      updateMessageCards(messageId, (cards) => cards.map((card) => (card.id === cardId ? updater(card) : card)));
    },
    [updateMessageCards],
  );

  // async 闭包的同步读口（不暴露 messagesRef）
  const getToolCards = useCallback((messageId: string): ToolCallCardState[] => {
    const message = messagesRef.current.find((item) => item.id === messageId);
    return message?.toolCalls || [];
  }, []);

  const findToolCard = useCallback(
    (messageId: string, cardId: string): ToolCallCardState | undefined =>
      getToolCards(messageId).find((item) => item.id === cardId),
    [getToolCards],
  );

  // postMutationBusy 的语义化开合（hook 规则 3；供 toolActions 用）
  const beginPostMutationRefresh = useCallback(() => setPostMutationBusy(true), []);
  const endPostMutationRefresh = useCallback(() => setPostMutationBusy(false), []);

  const sendMessage = useCallback(
    async (intent: LargeTextIntent) => {
      const trimmed = inputText.trim();
      if (!trimmed || !basePath || mutationBusy || disabled) return;

      const token = chatGuard.start();
      const outgoing = buildOutboundUserMessage(trimmed, intent, t);
      const userMessageId = createMessageId(MESSAGE_STORAGE_PREFIX);
      const nextMessages = [
        ...messagesRef.current,
        {
          id: userMessageId,
          role: "user" as const,
          content: trimmed,
          requestContent: outgoing,
        },
      ];

      setMessages(nextMessages);
      setSending(true);

      try {
        const response = await sendSettingsChat({
          base_path: basePath,
          mode,
          // 对话历史全量发送，由后端 settings_chat 负责截断（保留最近 5 轮）。
          messages: [...toApiMessages(messagesRef.current, t), { role: "user", content: outgoing }],
          ...(fandomPath ? { fandom_path: fandomPath } : {}),
          ...(sessionLlm ? { session_llm: sessionLlm } : {}),
        });
        if (chatGuard.isStale(token)) return;
        const toolCalls = Array.isArray(response.tool_calls) ? response.tool_calls : [];

        const assistantMessage: SettingsChatMessage = {
          id: createMessageId(MESSAGE_STORAGE_PREFIX),
          role: "assistant",
          content: response.content || t("settingsMode.emptyAssistant"),
          toolCalls: toolCalls.map((toolCall) => createToolCallCardState(toolCall)),
        };

        setMessages((current) => [...current, assistantMessage]);
        setInputText("");
      } catch (error) {
        if (chatGuard.isStale(token)) return;
        setMessages((current) => current.filter((message) => message.id !== userMessageId));
        showError(error, t("error_messages.unknown"));
      } finally {
        if (!chatGuard.isStale(token)) {
          setSending(false);
        }
      }
    },
    [basePath, chatGuard, disabled, fandomPath, inputText, mode, mutationBusy, sessionLlm, showError, t],
  );

  return {
    messages,
    isLoaded,
    loadError,
    inputText,
    setInputText, // 受控绑定（hook 规则 5 例外①：textarea 双向绑定）
    sending,
    isPostMutationBusy,
    hasLoadingCards,
    mutationBusy,
    sendMessage,
    updateMessageCards,
    updateSingleCard,
    getToolCards,
    findToolCard,
    beginPostMutationRefresh,
    endPostMutationRefresh,
  };
}

export type SettingsChatConversation = ReturnType<typeof useSettingsChatConversation>;
