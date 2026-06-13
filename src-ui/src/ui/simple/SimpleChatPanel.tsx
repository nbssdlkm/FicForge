// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — SimpleChatPanel（粮坊·简对话面板）
 *
 * 简版默认 AU 视图，承担：
 * - 用户对话 → 单次 LLM streaming + tools 调度（dispatch_simple_chat）
 * - 写章节路径：流式输出到 WritingDraftCard，用户接受后 confirmChapter
 * - 查看路径：show_chapter / show_setting tool 自动转成 ChapterPreviewCard /
 *   SettingPreviewCard inline 折叠展示
 * - 修改路径：modify_*_file / add_pinned_context 等 emit ToolCallCard，等用户
 *   确认（C2-续：execute 沿用 settings_chat 栈，目前是占位）
 *
 * Hook 5 铁律：state + reset 同文件、不暴露 raw setter、跨 hook 只传 value。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Eraser, Settings } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { useFeedback } from "../../hooks/useFeedback";
import { useKV } from "../../hooks/useKV";
import {
  confirmChapter,
  getState,
  getWriterProjectContext,
  getWriterSessionConfig,
  SIMPLE_TOOL_SHOW_CHAPTER,
  SIMPLE_TOOL_SHOW_SETTING,
  type WriterProjectContext,
  type WriterSessionConfig,
} from "../../api/engine-client";
import { useSessionParams } from "../writer/useSessionParams";
import { SimpleSettingsDrawer } from "./SimpleSettingsDrawer";
import { SimpleChatHistory } from "./SimpleChatHistory";
import { SimpleChatInput } from "./SimpleChatInput";
import { useSimpleChat } from "./useSimpleChat";
import { useSimpleDispatch } from "./useSimpleDispatch";
import { useContextTokenCount } from "./useContextTokenCount";
import { useSimpleToolExecutor } from "./useSimpleToolExecutor";
import { chatToOpenAIMessages, type OpenAIChatMessage } from "./chat-to-llm";

interface SimpleChatPanelProps {
  auPath: string;
  fandomPath?: string;
  className?: string;
}

export function SimpleChatPanel({
  auPath,
  fandomPath,
  className = "",
}: SimpleChatPanelProps) {
  const { t } = useTranslation();
  const { showError, showSuccess, showToast } = useFeedback();
  const chat = useSimpleChat(auPath);
  const dispatch = useSimpleDispatch(auPath);

  const [inputText, setInputText] = useState("");
  const [pendingChapterNum, setPendingChapterNum] = useState<number | null>(null);
  const [acceptingDraftId, setAcceptingDraftId] = useState<string | null>(null);
  const [executingToolId, setExecutingToolId] = useState<string | null>(null);
  const [chapterCount, setChapterCount] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [projectInfo, setProjectInfo] = useState<WriterProjectContext | null>(null);
  const [settingsInfo, setSettingsInfo] = useState<WriterSessionConfig | null>(null);
  // Transient "AI 思考中…" 占位 — 不进 chat.messages 避免 persist 到 chat.yaml
  // 后切 tab / 重启时残留 (用户报告: 切 tab thinking 卡死)。
  const [thinkingActive, setThinkingActive] = useState(false);

  const toolExecutor = useSimpleToolExecutor({ auPath });

  const [fontSizeStr, setFontSizeKV] = useKV("ficforge.fontSize", "18");
  const [lineHeightStr, setLineHeightKV] = useKV("ficforge.lineHeight", "1.8");
  const fontSize = parseInt(fontSizeStr, 10) || 18;
  const lineHeight = parseFloat(lineHeightStr) || 1.8;

  useEffect(() => {
    setInputText("");
    setPendingChapterNum(null);
    setAcceptingDraftId(null);
    setExecutingToolId(null);
    setChapterCount(0);
    setDrawerOpen(false);
    setProjectInfo(null);
    setSettingsInfo(null);
    setThinkingActive(false);
  }, [auPath]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getWriterProjectContext(auPath).catch(() => null),
      getWriterSessionConfig().catch(() => null),
    ]).then(([proj, settings]) => {
      if (cancelled) return;
      setProjectInfo(proj);
      setSettingsInfo(settings);
    });
    return () => { cancelled = true; };
  }, [auPath]);

  const sessionParams = useSessionParams(auPath, projectInfo, settingsInfo, showSuccess, showError);

  const refreshChapterContext = useCallback(async () => {
    try {
      const st = await getState(auPath);
      setPendingChapterNum(st.current_chapter ?? 1);
      setChapterCount(Math.max(0, (st.current_chapter ?? 1) - 1));
    } catch (err) {
      showError(err, t("error_messages.unknown"));
    }
  }, [auPath, showError, t]);

  useEffect(() => {
    void refreshChapterContext();
  }, [refreshChapterContext]);

  // chat.yaml load 完成后一次性清理 stale state（上次 session 中断遗留）：
  //  1. streaming-status draft → discarded（dispatch 没收尾就被切 tab 中断了）
  //  2. tone="info" system message → 删除（旧版 thinking placeholder 持久化的产物，
  //     现已改用 transient thinkingActive useState 不再 persist）
  // 仅在 isLoaded 切 true 那一刻跑（auPath 切换会先切 false 再切 true，自然触发新一轮）。
  useEffect(() => {
    if (!chat.isLoaded) return;
    for (const m of chat.messages) {
      if (m.kind === "writing-draft" && m.status === "streaming") {
        chat.setDraftStatus(m.id, "discarded");
      } else if (m.kind === "system" && m.tone === "info") {
        chat.removeMessage(m.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 isLoaded 切 true 时跑一次
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
          session_llm: sessionParams.sessionLlmPayload,
          session_params: { temperature: sessionParams.sessionTemp, top_p: sessionParams.sessionTopP },
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
                chat.appendSystemMessage("warning", t("simple.tool.invalidChatReplyArg", {
                  defaultValue: "chat_reply 收到空 content",
                }));
              }
            } else if (toolName === SIMPLE_TOOL_SHOW_CHAPTER) {
              // agent loop read-only：先持久化 assistant.toolCalls 让 chat-to-llm 能
              // 产 role:"assistant" tool_calls=[...] 配对紧随的 SimpleToolResultMessage
              // (role:"tool" tool_call_id) → OpenAI 协议要求 tool 消息前必须有匹配 assistant
              // tool_calls (真机 2026-05-04 P0 修复)。Preview card 仍另外 append 用于 UI 渲染。
              chat.appendAssistantMessage("", [{
                id: toolCallId,
                name: toolName,
                args: JSON.stringify(toolArgs),
              }]);
              const num = Number(toolArgs.chapter_num);
              if (Number.isFinite(num) && num > 0) {
                chat.appendChapterPreviewMessage(num);
              } else {
                chat.appendSystemMessage("warning", t("simple.tool.invalidChapterArg", {
                  defaultValue: "show_chapter 收到非法 chapter_num：{{val}}",
                  val: String(toolArgs.chapter_num),
                }));
              }
            } else if (toolName === SIMPLE_TOOL_SHOW_SETTING) {
              chat.appendAssistantMessage("", [{
                id: toolCallId,
                name: toolName,
                args: JSON.stringify(toolArgs),
              }]);
              const path = String(toolArgs.file_path ?? "");
              if (path) {
                chat.appendSettingPreviewMessage(path);
              } else {
                chat.appendSystemMessage("warning", t("simple.tool.invalidSettingArg", {
                  defaultValue: "show_setting 收到空 file_path",
                }));
              }
            } else {
              // modify_*_file / add_pinned_context / etc → 走 ToolCallCard
              chat.appendToolCallMessage({ toolName, toolArgs });
            }
          },
          onDoneText: (data) => {
            // 终态前必须 flush rAF buffer，否则缓冲未刷的 chunks 会在
            // setDraftContent(full_text) 之后 append → final content = full_text + 残余 chunks。
            chat.flushStreamingChunks();
            doneTextReceived = true;
            const id = ensureDraft();
            chat.setDraftContent(id, data.full_text);
            if (data.draft_label) chat.setDraftLabel(id, data.draft_label);
            if (data.generated_with && typeof data.generated_with === "object") {
              chat.setDraftGeneratedWith(id, data.generated_with as Record<string, unknown>);
            }
            chat.setDraftStatus(id, "pending");
          },
          onDoneTools: () => {
            // chat_reply 流式期累积的 chunks 在 buffer 里，setDraftStatus(discarded)
            // 前必须 flush，否则 chat_reply 末尾几个字符丢失。
            chat.flushStreamingChunks();
            clearThinking();
            // tool calls 已在 onToolCall 里逐个 append；done_tools 仅作为流结束信号。
            // - 双 emit（fullText + tools 共存）：done_text 已先到，draft 是 pending，不动
            // - forceToolOnly 但中途已 stream 了 token：done_text 不发，draft 卡 streaming
            //   要 discard 避免污染对话流（v4 盲审 P0-1）
            if (draftId && !doneTextReceived) {
              chat.setDraftStatus(draftId, "discarded");
            }
          },
          onError: (data) => {
            // partial draft / partial chat_reply 内容应该完整落地后再显示 error。
            chat.flushStreamingChunks();
            clearThinking();
            const codeSuffix = data.error_code ? `[${data.error_code}] ` : "";
            const partialSuffix = data.partial_draft_label
              ? t("simple.error.partialSavedAs", {
                  defaultValue: "（部分草稿已保存为 {{label}}）",
                  label: data.partial_draft_label,
                })
              : "";
            const message = `${codeSuffix}${data.message ?? "unknown"}${partialSuffix}`;
            if (draftId) {
              chat.setDraftStatus(draftId, "error", { errorMessage: message });
            } else {
              chat.appendSystemMessage("error", message);
            }
          },
          onCancelled: () => {
            chat.flushStreamingChunks();
            clearThinking();
            if (draftId) chat.setDraftStatus(draftId, "discarded");
          },
        },
      );
    },
    [auPath, chat, dispatch, pendingChapterNum, t, sessionParams.sessionLlmPayload, sessionParams.sessionTemp, sessionParams.sessionTopP],
  );

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    if (dispatch.isStreaming) return;
    if (acceptingDraftId) return;

    // 转 history 时 chat.messages 还不含当前 user（appendUserMessage 是 setState 异步）。
    // 简版"全塞"哲学：不截取不简化，token 消耗在顶部 badge 显示让用户监控。
    const history = chatToOpenAIMessages(chat.messages);
    chat.appendUserMessage(text);
    setInputText("");
    startDispatchForUserInput(text, history);
  }, [acceptingDraftId, chat, dispatch.isStreaming, inputText, startDispatchForUserInput]);

  const handleCancel = useCallback(() => {
    dispatch.cancelDispatch();
  }, [dispatch]);

  // ===========================================================================
  // 草稿动作
  // ===========================================================================

  const handleAcceptDraft = useCallback(
    async (messageId: string) => {
      const target = chat.messages.find((m) => m.id === messageId);
      if (!target || target.kind !== "writing-draft") return;
      if (target.status !== "pending" && target.status !== "error") return;
      setAcceptingDraftId(messageId);
      const draftLabel = target.draftLabel && target.draftLabel !== "?" ? target.draftLabel : "A";
      const draftFileId = `ch${String(target.chapterNum).padStart(4, "0")}_draft_${draftLabel}.md`;
      try {
        const result = await confirmChapter(
          auPath,
          target.chapterNum,
          draftFileId,
          target.generatedWith,
          target.content,
        );
        chat.markDraftAccepted(messageId, result.revision);
        chat.appendChapterPreviewMessage(target.chapterNum);
        showSuccess(
          t("simple.draftCard.acceptedToast", {
            defaultValue: "已接受为第 {{num}} 章",
            num: target.chapterNum,
          }),
        );
        await refreshChapterContext();
      } catch (err) {
        chat.setDraftStatus(messageId, "error", {
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        showError(err, t("error_messages.unknown"));
      } finally {
        setAcceptingDraftId(null);
      }
    },
    [auPath, chat, refreshChapterContext, showError, showSuccess, t],
  );

  const handleAcceptDraftSync = useCallback(
    (messageId: string) => { void handleAcceptDraft(messageId); },
    [handleAcceptDraft],
  );

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
      chat.setDraftStatus(draftId, "discarded");
      // 再生成：用整段历史（含刚被丢弃的 draft，会被 chatToOpenAIMessages 标 [已丢弃]
      // 让 LLM 知道用户要重写）。setDraftStatus 是 setState 异步，这里读到的还是旧
      // 数组（含 status="streaming" 或 "pending" 的 draft），但 chat-to-llm 把
      // streaming 跳过、其他状态加 marker，行为可接受。
      const history = chatToOpenAIMessages(chat.messages);
      startDispatchForUserInput(lastUserContent, history);
    },
    [chat, dispatch, showToast, startDispatchForUserInput, t],
  );

  const handleDiscardDraft = useCallback(
    (draftId: string) => {
      const target = chat.messages.find((m) => m.id === draftId);
      if (!target || target.kind !== "writing-draft") return;
      if (target.status === "streaming") {
        dispatch.cancelDispatch();
      }
      chat.setDraftStatus(draftId, "discarded");
    },
    [chat, dispatch],
  );

  // ===========================================================================
  // 工具卡片：modify_* / add_pinned_context / update_writing_style 等
  //
  // 复用 useSimpleToolExecutor hook（其内部 dispatch 到主仓库已实现的 saveLore /
  // addPinned / saveProjectWritingStyle 等 API + frontmatter 守护 + cast_registry
  // rollback 等）。验证 / 防覆盖 / 防重复全在 hook 里，error 已 i18n 化直接展示。
  // ===========================================================================

  const handleConfirmTool = useCallback(
    async (messageId: string) => {
      const target = chat.messages.find((m) => m.id === messageId);
      if (!target || target.kind !== "tool-call") return;
      if (target.status !== "pending" && target.status !== "error") return;
      if (executingToolId) return;

      setExecutingToolId(messageId);
      try {
        const result = await toolExecutor.execute(target.toolName, target.toolArgs);
        chat.setToolCallStatus(messageId, "confirmed", {
          resultNote: result.resultNote,
          undoMeta: result.undoMeta,
          errorMessage: undefined,
        });
        if (result.warningMessage) {
          showToast(result.warningMessage, "warning");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        chat.setToolCallStatus(messageId, "error", { errorMessage: message });
        showError(err, t("error_messages.unknown"));
      } finally {
        setExecutingToolId(null);
      }
    },
    [chat, executingToolId, showError, showToast, t, toolExecutor],
  );

  const handleSkipTool = useCallback(
    (messageId: string) => chat.setToolCallStatus(messageId, "skipped"),
    [chat],
  );

  const handleUndoTool = useCallback(
    async (messageId: string) => {
      const target = chat.messages.find((m) => m.id === messageId);
      if (!target || target.kind !== "tool-call") return;
      if (target.status !== "confirmed") return;
      if (!target.undoMeta || target.undoMeta.kind === "unsupported") {
        // modify_* 主仓库也不支持 undo，温和提示
        showToast(
          t("simple.toolCard.undoUnsupported", {
            defaultValue: "此操作不支持撤销",
          }),
          "warning",
        );
        return;
      }
      if (executingToolId) return;

      setExecutingToolId(messageId);
      try {
        const result = await toolExecutor.undo(target.undoMeta);
        chat.setToolCallStatus(messageId, "undone", {
          resultNote: result.resultNote,
          undoMeta: null,
          errorMessage: undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        chat.setToolCallStatus(messageId, "error", { errorMessage: message });
        showError(err, t("error_messages.unknown"));
      } finally {
        setExecutingToolId(null);
      }
    },
    [chat, executingToolId, showError, showToast, t, toolExecutor],
  );

  const globalBusy =
    dispatch.isStreaming || acceptingDraftId !== null || executingToolId !== null;

  // C5: token 估算。chapterCount 变化（接受后）触发重算。
  const tokenCount = useContextTokenCount(auPath, chapterCount, chat.messages);

  const tokenBadge = useMemo(() => {
    const est = tokenCount.estimate;
    if (!est) return null;
    const formatThousand = (n: number) =>
      n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
    const valueText = formatThousand(est.inputTokens);
    return (
      <span
        className="inline-flex items-baseline gap-1 rounded-full border border-rule bg-surface px-[7px] py-[3px] font-mono text-[9px] uppercase tracking-[0.08em] text-ink-muted"
      >
        <BarChart3 size={10} className="self-center" />
        <strong className="font-display text-[11px] font-semibold not-italic tracking-normal">
          {valueText}
        </strong>
        <span>{t("simple.header.tokensUnit", { defaultValue: "tokens" })}</span>
      </span>
    );
  }, [tokenCount.estimate, t]);

  return (
    <div
      className={`flex h-full min-h-0 flex-col bg-background ${className}`}
      style={{
        // 注入 drawer 字号 / 行距 → 子组件正文 div 用 var(--ff-body-fs) /
        // var(--ff-body-lh) 引用（问题 #3a：drawer 调字号同步对话界面正文）
        "--ff-body-fs": `${fontSize}px`,
        "--ff-body-lh": String(lineHeight),
      } as React.CSSProperties}
    >
      <header className="flex items-center gap-x-3 gap-y-2 flex-wrap border-b border-rule bg-surface px-4 py-3">
        <span className="inline-flex items-baseline gap-1 font-mono text-[9px] uppercase tracking-[0.08em] text-ink-muted">
          <span>{t("simple.header.chaptersLabel", { defaultValue: "Chapters" })}</span>
          <strong className="font-display text-[12px] font-semibold not-italic tracking-normal text-accent">
            {chapterCount}
          </strong>
          <span className="text-ink-faint">·</span>
          <span>{t("simple.header.nextLabel", { defaultValue: "Next" })}</span>
          <strong className="font-display text-[12px] font-semibold not-italic tracking-normal text-accent">
            {pendingChapterNum ?? 1}
          </strong>
        </span>
        {tokenBadge}
        <button
          type="button"
          onClick={() => {
            if (chat.messages.length === 0) return;
            const confirmText = t("simple.clearChat.confirm", {
              defaultValue: "清空当前 AU 的所有对话历史？此操作不可撤销。",
            });
            // 简版仅 Capacitor / Web，window.confirm 在两端可用且原生 modal UX 一致
            if (typeof window !== "undefined" && window.confirm(confirmText)) {
              chat.clearMessages();
              showSuccess(t("simple.clearChat.done", { defaultValue: "对话已清空" }));
            }
          }}
          disabled={chat.messages.length === 0 || dispatch.isStreaming}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-rule-soft hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold-bright disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-muted"
          aria-label={t("simple.clearChat.label", { defaultValue: "清空对话" })}
          title={t("simple.clearChat.label", { defaultValue: "清空对话" })}
        >
          <Eraser size={14} />
        </button>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-rule-soft hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold-bright"
          aria-label={t("simple.settings.openLabel", { defaultValue: "打开续写设置" })}
        >
          <Settings size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <SimpleChatHistory
          messages={chat.messages}
          auPath={auPath}
          fandomPath={fandomPath}
          isStreaming={dispatch.isStreaming}
          globalBusy={globalBusy}
          thinkingActive={thinkingActive}
          onAcceptDraft={handleAcceptDraftSync}
          onRegenerateDraft={handleRegenerateDraft}
          onDiscardDraft={handleDiscardDraft}
          onConfirmTool={handleConfirmTool}
          onSkipTool={handleSkipTool}
          onUndoTool={handleUndoTool}
          onTogglePreview={chat.togglePreviewExpanded}
        />
      </div>

      <SimpleChatInput
        value={inputText}
        onChange={setInputText}
        onSend={handleSend}
        isStreaming={dispatch.isStreaming}
        onCancelStreaming={handleCancel}
        busy={globalBusy}
      />
      <SimpleSettingsDrawer
        isOpen={drawerOpen}
        isLoading={projectInfo === null && settingsInfo === null}
        onClose={() => setDrawerOpen(false)}
        model={sessionParams.sessionModel}
        onModelChange={sessionParams.setSessionModel}
        temperature={sessionParams.sessionTemp}
        onTemperatureChange={sessionParams.setSessionTemp}
        topP={sessionParams.sessionTopP}
        onTopPChange={sessionParams.setSessionTopP}
        onSaveGlobal={sessionParams.handleSaveGlobalParams}
        onSaveAu={sessionParams.handleSaveAuParams}
        fontSize={fontSize}
        onFontSizeChange={(v) => setFontSizeKV(String(v))}
        lineHeight={lineHeight}
        onLineHeightChange={(v) => setLineHeightKV(String(v))}
      />
    </div>
  );
}
