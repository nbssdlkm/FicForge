// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useRef, useState } from "react";
import { sendSettingsChat, type SettingsChatSessionLlm } from "../../../api/engine-client";
import { useActiveRequestGuard } from "../../../hooks/useActiveRequestGuard";
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

function buildOutboundUserMessage(
  rawInput: string,
  intent: LargeTextIntent,
  t: TranslateFn
): string {
  if (intent === "character") {
    return [
      t("settingsMode.prompt.largeTextCharacter"),
      rawInput,
    ].join("\n\n");
  }

  if (intent === "worldbuilding") {
    return [
      t("settingsMode.prompt.largeTextWorldbuilding"),
      rawInput,
    ].join("\n\n");
  }

  return rawInput;
}

function serializeAssistantMessage(
  message: SettingsChatMessage,
  t: TranslateFn
): string {
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
  t: TranslateFn
): { role: "user" | "assistant"; content: string }[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.role === "assistant"
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
}: SettingsChatConversationParams) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const chatGuard = useActiveRequestGuard(`chat:${mode}:${basePath ?? ""}`);

  const [messages, setMessages] = useState<SettingsChatMessage[]>([]);
  const messagesRef = useRef<SettingsChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [isPostMutationBusy, setPostMutationBusy] = useState(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 切上下文 reset（铁律②：state 与 reset 同文件）
  useEffect(() => {
    setSending(false);
    setPostMutationBusy(false);
    setMessages([]);
    setInputText("");
  }, [basePath, mode]);

  const hasLoadingCards = messages.some((message) =>
    (message.toolCalls || []).some((card) => card.isLoading)
  );
  const mutationBusy = sending || hasLoadingCards || isPostMutationBusy;

  const updateMessageCards = useCallback((
    messageId: string,
    updater: (cards: ToolCallCardState[]) => ToolCallCardState[]
  ) => {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== messageId || !message.toolCalls) return message;
        return {
          ...message,
          toolCalls: updater(message.toolCalls),
        };
      })
    );
  }, []);

  const updateSingleCard = useCallback((
    messageId: string,
    cardId: string,
    updater: (card: ToolCallCardState) => ToolCallCardState
  ) => {
    updateMessageCards(messageId, (cards) =>
      cards.map((card) => (card.id === cardId ? updater(card) : card))
    );
  }, [updateMessageCards]);

  // async 闭包的同步读口（不暴露 messagesRef）
  const getToolCards = useCallback((messageId: string): ToolCallCardState[] => {
    const message = messagesRef.current.find((item) => item.id === messageId);
    return message?.toolCalls || [];
  }, []);

  const findToolCard = useCallback(
    (messageId: string, cardId: string): ToolCallCardState | undefined =>
      getToolCards(messageId).find((item) => item.id === cardId),
    [getToolCards]
  );

  // postMutationBusy 的语义化开合（hook 规则 3；供 toolActions 用）
  const beginPostMutationRefresh = useCallback(() => setPostMutationBusy(true), []);
  const endPostMutationRefresh = useCallback(() => setPostMutationBusy(false), []);

  const sendMessage = useCallback(async (intent: LargeTextIntent) => {
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
        messages: [
          ...toApiMessages(messagesRef.current, t),
          { role: "user", content: outgoing },
        ],
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
  }, [basePath, chatGuard, disabled, fandomPath, inputText, mode, mutationBusy, sessionLlm, showError, t]);

  return {
    messages,
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
