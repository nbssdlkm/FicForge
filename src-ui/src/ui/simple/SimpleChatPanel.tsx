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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Eraser, Settings, X } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { useFeedback } from "../../hooks/useFeedback";
import { useKV } from "../../hooks/useKV";
import {
  confirmChapter,
  draftFilename,
  getChapterContent,
  getFactsExtractionReadiness,
  getFriendlyErrorMessage,
  getSettingsSummary,
  getState,
  getWriterProjectContext,
  getWriterSessionConfig,
  logCatch,
  markSimpleChatDraftAccepted,
  SIMPLE_TOOL_SHOW_CHAPTER,
  SIMPLE_TOOL_SHOW_SETTING,
  type SettingsSummary,
  type WriterProjectContext,
  type WriterSessionConfig,
} from "../../api/engine-client";
import { useSessionParams } from "../writer/useSessionParams";
import { useWriterFactsExtraction } from "../writer/useWriterFactsExtraction";
import { ExtractReviewModal } from "../writer/WriterModals";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { Spinner } from "../shared/Spinner";
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
  /** 对话接受章节落库后通知宿主刷新章节列表（桌面侧栏 / 移动「章节」tab，审计 H1）。 */
  onChaptersChanged?: () => void;
  /** 面板当前是否为可见 tab。面板常驻挂载（隐藏不卸载，审计 H2/H3），提取完成时
   * 若用户在别的 tab，用 toast 提示回来看 —— modal 挂在隐藏容器里用户看不见。 */
  isActiveTab?: boolean;
}

export function SimpleChatPanel({
  auPath,
  fandomPath,
  className = "",
  onChaptersChanged,
  isActiveTab,
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
  const [clearChatConfirmOpen, setClearChatConfirmOpen] = useState(false);
  const [projectInfo, setProjectInfo] = useState<WriterProjectContext | null>(null);
  const [settingsInfo, setSettingsInfo] = useState<WriterSessionConfig | null>(null);
  const [settingsSummary, setSettingsSummary] = useState<SettingsSummary | null>(null);
  // 自动提取就位（审计④）：与 resolveFactsProvider 同源的「有无可用连接」判断，
  // 由引擎按 project+settings 解析得出，取代 UI 侧只看全局 default_llm 的旧口径。
  const [extractionReady, setExtractionReady] = useState<{ has_usable_connection: boolean } | null>(null);
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
    setClearChatConfirmOpen(false);
    setProjectInfo(null);
    setSettingsInfo(null);
    setSettingsSummary(null);
    setExtractionReady(null);
    setThinkingActive(false);
  }, [auPath]);

  // 面板配置四件套（projectInfo / settingsInfo / settingsSummary / extractionReady）的
  // 可重调用加载函数（R1-1）：挂载时跑一次；面板常驻挂载后，settings tab 改 LLM 配置 /
  // 开关提取开关不会重挂本面板 —— 切回对话 tab 的边沿也要重拉，否则 dispatch payload
  // 与 canAutoExtract gate 永久用旧配置。token 防 AU 快切/并发刷新的旧结果倒灌。
  const configLoadTokenRef = useRef(0);
  const refreshPanelConfig = useCallback(async () => {
    const token = ++configLoadTokenRef.current;
    const [proj, settings, summary, readiness] = await Promise.all([
      getWriterProjectContext(auPath).catch(() => null),
      getWriterSessionConfig().catch(() => null),
      getSettingsSummary().catch(() => null),
      getFactsExtractionReadiness(auPath).catch(() => null),
    ]);
    if (configLoadTokenRef.current !== token) return;
    setProjectInfo(proj);
    setSettingsInfo(settings);
    setSettingsSummary(summary);
    setExtractionReady(readiness);
  }, [auPath]);

  useEffect(() => {
    void refreshPanelConfig();
  }, [refreshPanelConfig]);

  const sessionParams = useSessionParams(auPath, projectInfo, settingsInfo, showSuccess, showError);

  // M9 接线：复用 writer 侧事实提取 hook（自带 review 状态机 + 落库）。对话接受走自动触发，
  // 不再单独弹 FactsPromptModal —— 对话路径「记忆=自动为主」。
  const factsExtraction = useWriterFactsExtraction(auPath);

  // 自动提取 gate：① settings 已加载且「增强事实提取」开关未被显式关闭（默认开，对齐 `!== false`）；
  //   settingsSummary 为 null（加载失败）时 fail-closed，不擅自提取。
  // ② LLM 就位（extractFacts 内部 react/plain 都需 LLM；未配会空跑报错）。任一不满足静默跳过。
  // 注：② 用 extractionReady（引擎按 project+settings 解析，与实际提取的 resolveFactsProvider 同源），
  // 不再用只看全局 default_llm 的 settingsSummary.default_llm——否则 AU 级独立配 LLM 时会误判为不可用（审计④）。
  const canAutoExtract =
    settingsSummary != null &&
    settingsSummary.app?.react_extraction_enabled !== false &&
    Boolean(extractionReady?.has_usable_connection);

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

  // 切回对话 tab 时刷新章节上下文（对抗审 F3）：常驻挂载后，写文 tab 的 confirm/undo
  // 推进 current_chapter 但对话面板拿不到通知 —— 不刷新的话下一次 dispatch 会带过期
  // chapter_num 打到已确认章（接受侧另有 H3 章号 guard 兜底，这里把源头对齐）。
  // R1-1（终审 1-A）：同一边沿一并重拉配置四件套 —— settings tab 改 LLM 配置 / 开关
  // 「增强事实提取」后，dispatch payload 与 canAutoExtract 必须用新值，不能停在挂载时快照。
  const wasActiveTabRef = useRef(isActiveTab !== false);
  useEffect(() => {
    const nowActive = isActiveTab !== false;
    const wasActive = wasActiveTabRef.current;
    wasActiveTabRef.current = nowActive;
    if (nowActive && !wasActive) {
      void refreshChapterContext();
      void refreshPanelConfig();
    }
  }, [isActiveTab, refreshChapterContext, refreshPanelConfig]);

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
  }, [acceptingDraftId, chat, dispatch.isStreaming, inputText, projectInfo, settingsInfo, showError, startDispatchForUserInput, t]);

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
      // 防重入（对抗审 A-1）：confirm 是数秒~数十秒的多 LLM 串行调用，期间内存状态
      // 未变，双击同一按钮或给同章的另一条 pending 草稿点接受都能二次进入 ——
      // 下面的章号 guard 是 TOCTOU（两次都读到旧 current_chapter），拦不住并发形态。
      if (acceptingDraftId) return;
      setAcceptingDraftId(messageId);
      const draftLabel = target.draftLabel && target.draftLabel !== "?" ? target.draftLabel : "A";
      const draftFileId = draftFilename(target.chapterNum, draftLabel);
      try {
        // 防重复接受（审计 H3）：接受只对「下一章」合法。三种到得了这里的非法状态 ——
        // 接受标记落盘失败后的残留 pending、连点、陈旧会话里的旧草稿 —— 都会覆写
        // 已确认章节 + 重复触发提取，必须在 confirm 之前拦下。
        const st = await getState(auPath);
        const expectedChapter = st.current_chapter ?? 1;
        if (target.chapterNum !== expectedChapter) {
          const existing = await getChapterContent(auPath, target.chapterNum).catch(() => null);
          if (existing !== null && existing.trim() === target.content.trim()) {
            // 章节内容与草稿逐字一致 → 此前已接受过、只是标记没落盘（切 tab 竞态遗留），
            // 补回标记而不是再确认一次。
            await markSimpleChatDraftAccepted(auPath, messageId, null).catch((e) =>
              logCatch("simple", "restore accepted marker failed", e),
            );
            chat.markDraftAccepted(messageId, null);
            showToast(
              t("simple.draftCard.alreadyAccepted", {
                defaultValue: "该草稿此前已接受为第 {{num}} 章，已恢复标记",
                num: target.chapterNum,
              }),
              "info",
            );
          } else {
            // 覆盖三种场景（对抗审 A-6，避免误导性断言）：章已被其他内容确认、
            // 草稿超前于当前进度（undo 后遗留）、章内容读取瞬时失败 —— 统一用
            // 「与当前进度不符」的中性表述，不声称「已确认过其他内容」。
            showToast(
              t("simple.draftCard.chapterTaken", {
                defaultValue: "第 {{num}} 章与当前写作进度不符（下一章应为第 {{expected}} 章），未执行接受",
                num: target.chapterNum,
                expected: expectedChapter,
              }),
              "warning",
            );
          }
          return;
        }

        // R1-8（终审鲜眼）：num === expected 但该章已有**不同**内容 —— undo/confirm 半成功
        // 残留、回收站恢复等会造成「进度指针在 N、ch{N} 文件却已存在」。直接 confirm 会静默
        // 覆盖那份内容（用户资产）。旧文案复用 chapterTaken 会产出「第 3 章与当前进度不符
        //（下一章应为第 3 章）」的自相矛盾句 —— 拆专用 key，指路写文页处理。
        // 内容逐字一致（同章重接、confirm 半成功后重试）→ 放行 confirm：引擎带备份覆盖 +
        // 推进 state，正是修复半成功所需。
        const existingCurrent = await getChapterContent(auPath, target.chapterNum).catch(() => null);
        if (existingCurrent !== null && existingCurrent.trim() !== target.content.trim()) {
          showToast(
            t("simple.draftCard.chapterTakenSameNum", {
              defaultValue: "第 {{num}} 章当前已有不同内容，未覆盖；如需替换请先在写文页处理该章",
              num: target.chapterNum,
            }),
            "warning",
          );
          return;
        }

        const result = await confirmChapter(
          auPath,
          target.chapterNum,
          draftFileId,
          target.generatedWith,
          target.content,
        );
        // 立即把 accepted 终态直写 chat.yaml（锁内 read-modify-write，不依赖组件存活）。
        // confirm 要串行跑多个 LLM 调用，期间用户完全可能已离开工作区 —— 只靠下面的
        // 内存标记 + 防抖保存，标记会静默丢失（审计 H3 根因）。
        await markSimpleChatDraftAccepted(auPath, messageId, result.revision).catch((e) =>
          logCatch("simple", "persist accepted marker failed", e),
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
        // 通知宿主刷新章节列表（桌面侧栏 / 移动「章节」tab），否则对话里接受的新章
        // 在另一个 tab 看不见（审计 H1）。
        onChaptersChanged?.();
        // M9：接受落章后自动跑事实提取（异步、不阻塞接受收尾）。gate 满足才弹 review；
        // 否则静默跳过（增强提取关 / LLM 未配）。extractFacts 内部再按 react_extraction_enabled
        // 决定 react vs plain，这里只 gate「是否自动触发」。目标章号由 hook 内部记录。
        if (canAutoExtract) {
          void factsExtraction.handleOpenExtractReview(target.chapterNum);
        }
      } catch (err) {
        chat.setDraftStatus(messageId, "error", {
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        showError(err, t("error_messages.unknown"));
      } finally {
        setAcceptingDraftId(null);
      }
    },
    [acceptingDraftId, auPath, canAutoExtract, chat, factsExtraction.handleOpenExtractReview, onChaptersChanged, refreshChapterContext, showError, showSuccess, showToast, t],
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

  // 提取完成弹 review 时若面板处于隐藏 tab（常驻挂载，modal 在 display:none 容器里
  // 用户看不见），用 toast（挂在工作区级 FeedbackProvider，任何 tab 可见）提示回来看。
  const extractReviewWasOpenRef = useRef(false);
  useEffect(() => {
    const opened = factsExtraction.isExtractReviewOpen && !extractReviewWasOpenRef.current;
    extractReviewWasOpenRef.current = factsExtraction.isExtractReviewOpen;
    if (opened && isActiveTab === false) {
      showToast(
        t("simple.extract.readyWhileAway", {
          defaultValue: "剧情笔记提取完成，回「对话」查看",
        }),
        "info",
      );
    }
  }, [factsExtraction.isExtractReviewOpen, isActiveTab, showToast, t]);

  const globalBusy =
    dispatch.isStreaming || acceptingDraftId !== null || executingToolId !== null;

  // C5: token 估算。chapterCount 变化（接受后）触发重算。面板常驻挂载后隐藏期
  // 暂停 30s 兜底轮询（对抗审 A-4）。sessionLlmPayload 让 badge 与 dispatch 同走
  // 三层解析（H4）——会话切模型时窗口/预警即时跟随。
  const tokenCount = useContextTokenCount(auPath, chapterCount, chat.messages, isActiveTab !== false, sessionParams.sessionLlmPayload);

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
        {factsExtraction.extractingFacts && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-accent">
            <Spinner size="sm" />
            <span className="font-serif tracking-normal normal-case">
              {t("simple.header.extracting", { defaultValue: "提取剧情笔记中…" })}
            </span>
            {/* R1-7：提取是多秒 LLM 调用，给用户一个当场取消的出口（abort 静默收尾，不 toast 报错） */}
            <button
              type="button"
              onClick={factsExtraction.cancelExtraction}
              className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-rule-soft hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold-bright"
              aria-label={t("simple.header.cancelExtract", { defaultValue: "取消提取" })}
              title={t("simple.header.cancelExtract", { defaultValue: "取消提取" })}
            >
              <X size={12} />
            </button>
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            if (chat.messages.length === 0) return;
            // 应用内 ConfirmDialog 替代 window.confirm（审计 M13）：融合后本面板恒挂
            // Tauri 桌面，wry 对 window.confirm 支持不完整（可能点了无反应）。
            setClearChatConfirmOpen(true);
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
          isActiveTab={isActiveTab}
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
        sessionLayer={sessionParams.sessionLayer}
        sessionModelOptions={sessionParams.sessionModelOptions}
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
      <ConfirmDialog
        isOpen={clearChatConfirmOpen}
        onClose={() => setClearChatConfirmOpen(false)}
        onConfirm={() => {
          setClearChatConfirmOpen(false);
          chat.clearMessages();
          showSuccess(t("simple.clearChat.done", { defaultValue: "对话已清空" }));
        }}
        title={t("simple.clearChat.label", { defaultValue: "清空对话" })}
        message={t("simple.clearChat.confirm", {
          defaultValue: "清空当前 AU 的所有对话历史？此操作不可撤销。",
        })}
        destructive
      />
      <ExtractReviewModal
        isOpen={factsExtraction.isExtractReviewOpen}
        onClose={factsExtraction.closeExtractReview}
        extractedCandidates={factsExtraction.extractedCandidates}
        selectedExtractedKeys={factsExtraction.selectedExtractedKeys}
        getCandidateKey={factsExtraction.getCandidateKey}
        onToggleCandidate={factsExtraction.toggleExtractedCandidate}
        onSave={() => void factsExtraction.handleSaveExtracted(null)}
        savingExtracted={factsExtraction.savingExtracted}
      />
    </div>
  );
}
