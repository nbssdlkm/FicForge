// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useSimpleDispatchFlow — 单次发送的编排：dispatch 决定走 write 还是 tool。
 *
 * 自身只持有 inputText（textarea 受控绑定）与 thinkingActive（transient 占位）；
 * 消息流经 chat 的语义化 method 写入，流控制经 dispatch（startDispatch/cancelDispatch）。
 * 配置 / 章号 / 会话参数 / 接受在途闸（acceptingDraftId）均以 value 注入 —— 本 hook
 * 不碰它们的内部状态（铁律③）。
 *
 * 「再生成」也住这里（相对简报建议的微调）：它本质是 cancel + 重发 dispatch，放草稿
 * 动作 hook 会形成「草稿 hook 要 startDispatchForUserInput、flow hook 要 acceptingDraftId」
 * 的双向依赖，只能靠 bridge ref 解 —— 归位到 flow 侧则单向依赖自然成立。
 */

import { useCallback, useEffect, useState } from "react";
import {
  getFriendlyErrorMessage,
  SIMPLE_TOOL_SHOW_CHAPTER,
  SIMPLE_TOOL_SHOW_SETTING,
  type WriterProjectContext,
  type WriterSessionConfig,
} from "../../api/engine-client";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";
import { chatToOpenAIMessages, type OpenAIChatMessage } from "./chat-to-llm";
import type { useSimpleChat } from "./useSimpleChat";
import type { UseSimpleDispatchResult } from "./useSimpleDispatch";

interface UseSimpleDispatchFlowParams {
  auPath: string;
  chat: ReturnType<typeof useSimpleChat>;
  dispatch: UseSimpleDispatchResult;
  /** 下一章号（chapterContext hook 的 value）。 */
  pendingChapterNum: number | null;
  /** 配置四件套中 send gate 所需的两件（config hook 的 value）。 */
  projectInfo: WriterProjectContext | null;
  settingsInfo: WriterSessionConfig | null;
  /** 会话层 LLM 覆盖 + 参数（useSessionParams 的 value）。 */
  sessionLlmPayload: Record<string, string> | null;
  sessionTemp: number;
  sessionTopP: number;
  /** 接受在途闸（draftActions hook 的 value）：接受期间不允许并发发送。 */
  acceptingDraftId: string | null;
}

export function useSimpleDispatchFlow({
  auPath,
  chat,
  dispatch,
  pendingChapterNum,
  projectInfo,
  settingsInfo,
  sessionLlmPayload,
  sessionTemp,
  sessionTopP,
  acceptingDraftId,
}: UseSimpleDispatchFlowParams) {
  const { t } = useTranslation();
  const { showError, showToast } = useFeedback();

  const [inputText, setInputText] = useState("");
  // Transient "AI 思考中…" 占位 — 不进 chat.messages 避免 persist 到 chat.yaml
  // 后切 tab / 重启时残留 (用户报告: 切 tab thinking 卡死)。
  const [thinkingActive, setThinkingActive] = useState(false);

  // 切 AU reset（铁律②：state 与 reset 同文件）
  useEffect(() => {
    setInputText("");
    setThinkingActive(false);
  }, [auPath]);

  // chat.yaml load 完成后一次性清理 stale state（上次 session 中断遗留）：
  //  1. streaming-status draft → discarded（dispatch 没收尾就被切 tab 中断了）
  //  2. tone="info" system message → 删除（旧版 thinking placeholder 持久化的产物，
  //     现已改用 transient thinkingActive useState 不再 persist）
  // 仅在 isLoaded 切 true 那一刻跑（auPath 切换会先切 false 再切 true，自然触发新一轮）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅 isLoaded 切 true 时跑一次
  useEffect(() => {
    if (!chat.isLoaded) return;
    for (const m of chat.messages) {
      if (m.kind === "writing-draft" && m.status === "streaming") {
        chat.markDraftStatus(m.id, "discarded");
      } else if (m.kind === "system" && m.tone === "info") {
        chat.removeMessage(m.id);
      }
    }
  }, [chat.isLoaded]);

  // ===========================================================================
  // 单次发送：dispatch 决定走 write 还是 tool
  // 关键设计：deferred draft creation —— 等到首个 token 到来才 append draft message。
  // 如果 LLM 选择 tool 路径就完全不创建草稿，避免一堆"discarded"占位污染对话流。
  // ===========================================================================

  const startDispatchForUserInput = useCallback(
    (userInput: string, history: OpenAIChatMessage[]) => {
      const chapterNum = pendingChapterNum ?? 1;
      let draftId: string | null = null;
      // 跟踪 done_text 是否到达，用于 onDoneTools 区分双 emit / forceToolOnly。
      // 双 emit（finish='stop' + fullText + tools 共存）：done_text 先 emit 把 draft
      // 设为 pending，done_tools 后到不动它。forceToolOnly（finish='tool_calls' 但
      // 中途已 stream 了 token）：done_text 不会 emit，done_tools 触发 discard
      // 兜底，避免 draft 永远卡 streaming 污染对话流（v4 盲审 P0-1）。
      let doneTextReceived = false;
      // chat_reply 流式：第一个 chunk 时 append 空 assistant message 并保存 id，
      // 后续 chunks append 进 content。dispatch 流式期间不 emit chat_reply 的
      // tool_call，所以 onToolCall(chat_reply) 不会重复添加（用户实测 Option A）。
      let chatReplyStreamingId: string | null = null;

      // 立即 show thinking placeholder（transient state，不进 chat.messages）。
      // 首个 token / tool_call / done / error 到达时清除。
      setThinkingActive(true);
      let thinkingCleared = false;
      const clearThinking = () => {
        if (thinkingCleared) return;
        setThinkingActive(false);
        thinkingCleared = true;
      };

      const ensureDraft = (): string => {
        clearThinking();
        if (!draftId) {
          draftId = chat.appendDraftMessage({ chapterNum });
        }
        return draftId;
      };

      void dispatch.startDispatch(
        {
          au_path: auPath,
          chapter_num: chapterNum,
          user_input: userInput,
          history,
          session_llm: sessionLlmPayload,
          session_params: { temperature: sessionTemp, top_p: sessionTopP },
        },
        {
          onToken: (chunk) => {
            const id = ensureDraft();
            chat.appendDraftChunk(id, chunk);
          },
          onChatReplyChunk: (delta) => {
            clearThinking();
            if (!chatReplyStreamingId) {
              chatReplyStreamingId = chat.appendAssistantMessage("");
            }
            chat.appendAssistantChunk(chatReplyStreamingId, delta);
          },
          onToolResult: ({ toolCallId, toolName, content, errorMessage }) => {
            // agent loop 自动 fetch 的工具结果 → 落 chat.yaml 让 reload 后 LLM 看到
            // 完整 reasoning 链路。dispatch 已把 result 注入 internalHistory 喂下一
            // 轮 LLM，这里仅持久化。
            chat.appendToolResultMessage({ toolCallId, toolName, content, errorMessage });
          },
          onToolCall: (toolName, toolArgs, toolCallId) => {
            clearThinking();
            if (toolName === "chat_reply") {
              // AI 闲聊回答 — 显示成对话气泡，不进 ToolCallCard
              const content = String(toolArgs.content ?? "");
              if (content) {
                chat.appendAssistantMessage(content);
              } else {
                chat.appendSystemMessage(
                  "warning",
                  t("simple.tool.invalidChatReplyArg", {
                    defaultValue: "chat_reply 收到空 content",
                  }),
                );
              }
            } else if (toolName === SIMPLE_TOOL_SHOW_CHAPTER) {
              // agent loop read-only：先持久化 assistant.toolCalls 让 chat-to-llm 能
              // 产 role:"assistant" tool_calls=[...] 配对紧随的 SimpleToolResultMessage
              // (role:"tool" tool_call_id) → OpenAI 协议要求 tool 消息前必须有匹配 assistant
              // tool_calls (真机 2026-05-04 P0 修复)。Preview card 仍另外 append 用于 UI 渲染。
              chat.appendAssistantMessage("", [
                {
                  id: toolCallId,
                  name: toolName,
                  args: JSON.stringify(toolArgs),
                },
              ]);
              const num = Number(toolArgs.chapter_num);
              if (Number.isFinite(num) && num > 0) {
                chat.appendChapterPreviewMessage(num);
              } else {
                chat.appendSystemMessage(
                  "warning",
                  t("simple.tool.invalidChapterArg", {
                    defaultValue: "show_chapter 收到非法 chapter_num：{{val}}",
                    val: String(toolArgs.chapter_num),
                  }),
                );
              }
            } else if (toolName === SIMPLE_TOOL_SHOW_SETTING) {
              chat.appendAssistantMessage("", [
                {
                  id: toolCallId,
                  name: toolName,
                  args: JSON.stringify(toolArgs),
                },
              ]);
              const path = String(toolArgs.file_path ?? "");
              if (path) {
                chat.appendSettingPreviewMessage(path);
              } else {
                chat.appendSystemMessage(
                  "warning",
                  t("simple.tool.invalidSettingArg", {
                    defaultValue: "show_setting 收到空 file_path",
                  }),
                );
              }
            } else {
              // modify_*_file / add_pinned_context / etc → 走 ToolCallCard
              chat.appendToolCallMessage({ toolName, toolArgs });
            }
          },
          onDoneText: (data) => {
            // 终态前必须 flush rAF buffer，否则缓冲未刷的 chunks 会在
            // replaceDraftContent(full_text) 之后 append → final content = full_text + 残余 chunks。
            chat.flushStreamingChunks();
            doneTextReceived = true;
            const id = ensureDraft();
            chat.replaceDraftContent(id, data.full_text);
            if (data.draft_label) chat.assignDraftLabel(id, data.draft_label);
            if (data.generated_with && typeof data.generated_with === "object") {
              chat.recordDraftGeneratedWith(id, data.generated_with as Record<string, unknown>);
            }
            chat.markDraftStatus(id, "pending");
          },
          onDoneTools: () => {
            // chat_reply 流式期累积的 chunks 在 buffer 里，markDraftStatus(discarded)
            // 前必须 flush，否则 chat_reply 末尾几个字符丢失。
            chat.flushStreamingChunks();
            clearThinking();
            // tool calls 已在 onToolCall 里逐个 append；done_tools 仅作为流结束信号。
            // - 双 emit（fullText + tools 共存）：done_text 已先到，draft 是 pending，不动
            // - forceToolOnly 但中途已 stream 了 token：done_text 不发，draft 卡 streaming
            //   要 discard 避免污染对话流（v4 盲审 P0-1）
            if (draftId && !doneTextReceived) {
              chat.markDraftStatus(draftId, "discarded");
            }
          },
          onError: (data) => {
            // partial draft / partial chat_reply 内容应该完整落地后再显示 error。
            chat.flushStreamingChunks();
            clearThinking();
            // M26：走 friendly 映射（对齐写文路径 useWriterGeneration），把 error_code
            // 翻成用户可读文案（含 UNSUPPORTED_MODE → error_messages.unsupported_mode 的
            // 中英对称 i18n）。旧代码直接拼 `[code] message` 把机器码 + 引擎原始中文串
            // 抛给用户。partialSuffix 仍单独拼接（friendly 映射不含它）。
            const friendly = getFriendlyErrorMessage({
              error_code: data.error_code,
              message: data.message,
            });
            const partialSuffix = data.partial_draft_label
              ? t("simple.error.partialSavedAs", {
                  defaultValue: "（部分草稿已保存为 {{label}}）",
                  label: data.partial_draft_label,
                })
              : "";
            const message = `${friendly}${partialSuffix}`;
            if (draftId) {
              chat.markDraftStatus(draftId, "error", { errorMessage: message });
            } else {
              chat.appendSystemMessage("error", message);
            }
          },
          onCancelled: () => {
            chat.flushStreamingChunks();
            clearThinking();
            if (draftId) chat.markDraftStatus(draftId, "discarded");
          },
        },
      );
    },
    [auPath, chat, dispatch, pendingChapterNum, t, sessionLlmPayload, sessionTemp, sessionTopP],
  );

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    if (dispatch.isStreaming) return;
    if (acceptingDraftId) return;

    // 配置就绪 gate（R1-2，对齐 useWriterGeneration 同款判据）：settingsInfo 未加载 /
    // 加载失败 / resolve 无可用连接时，不发出捏造 payload 让引擎端报错，直接 toast 指路。
    // session 层覆盖（sessionLlmPayload）只换模型不带 key，可用性仍由 project/settings 决定。
    const projectLlmUsable = projectInfo?.llm?.mode && (projectInfo.llm.mode !== "api" || projectInfo.llm.has_api_key);
    const effectiveLlm = projectLlmUsable ? projectInfo!.llm : settingsInfo?.default_llm;
    const llmMode = effectiveLlm?.mode || "api";
    if (llmMode === "api" && !effectiveLlm?.has_api_key) {
      showError(null, t("error_messages.no_api_key"));
      return;
    }

    // 转 history 时 chat.messages 还不含当前 user（appendUserMessage 是 setState 异步）。
    // 简版"全塞"哲学：不截取不简化，token 消耗在顶部 badge 显示让用户监控。
    const history = chatToOpenAIMessages(chat.messages);
    chat.appendUserMessage(text);
    setInputText("");
    startDispatchForUserInput(text, history);
  }, [
    acceptingDraftId,
    chat,
    dispatch.isStreaming,
    inputText,
    projectInfo,
    settingsInfo,
    showError,
    startDispatchForUserInput,
    t,
  ]);

  const handleCancel = useCallback(() => {
    dispatch.cancelDispatch();
  }, [dispatch]);

  const handleRegenerateDraft = useCallback(
    (draftId: string) => {
      const target = chat.messages.find((m) => m.id === draftId);
      if (!target || target.kind !== "writing-draft") return;

      const idx = chat.messages.findIndex((m) => m.id === draftId);
      let lastUserContent = "";
      for (let i = idx - 1; i >= 0; i--) {
        const m = chat.messages[i];
        if (m.kind === "user") {
          lastUserContent = m.content;
          break;
        }
      }
      if (!lastUserContent) {
        showToast(
          t("simple.draftCard.regenerateNoUserMsg", { defaultValue: "找不到对应的用户指令，无法再生成" }),
          "warning",
        );
        return;
      }

      if (dispatch.isStreaming) {
        dispatch.cancelDispatch();
      }
      chat.markDraftStatus(draftId, "discarded");
      // 再生成：用整段历史（含刚被丢弃的 draft，会被 chatToOpenAIMessages 标 [已丢弃]
      // 让 LLM 知道用户要重写）。markDraftStatus 是 setState 异步，这里读到的还是旧
      // 数组（含 status="streaming" 或 "pending" 的 draft），但 chat-to-llm 把
      // streaming 跳过、其他状态加 marker，行为可接受。
      const history = chatToOpenAIMessages(chat.messages);
      startDispatchForUserInput(lastUserContent, history);
    },
    [chat, dispatch, showToast, startDispatchForUserInput, t],
  );

  return {
    inputText,
    setInputText, // 受控绑定（hook 规则 5 例外①：SimpleChatInput textarea 双向绑定）
    thinkingActive,
    handleSend,
    handleCancel,
    handleRegenerateDraft,
  };
}
