// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — SimpleChatPanel（粮坊·简对话面板）
 *
 * 简版默认 AU 视图，承担：
 * - 用户对话 → 单次 LLM streaming + tools 调度（dispatchSimpleChat）
 * - 写章节路径：流式输出到 WritingDraftCard，用户接受后 confirmChapter
 * - 查看路径：show_chapter / show_setting tool 自动转成 ChapterPreviewCard /
 *   SettingPreviewCard inline 折叠展示
 * - 修改路径：modify_*_file / add_pinned_context 等 emit ToolCallCard，等用户
 *   确认（C2-续：execute 沿用 settings_chat 栈，目前是占位）
 *
 * 状态下沉后（长期债②同族收尾）本组件只做 props 接线 + JSX 编排。状态住六个 hook：
 * - useSimpleChatPanelConfig：配置四件套 + R1-1 边沿重拉 + canAutoExtract gate
 * - useSimpleChapterContext：下一章号 / 已确认章数 + 对抗审 F3 边沿重拉
 * - useSimpleDraftActions：接受 / 丢弃草稿（含审计 H3 / R1-8 章号 guard）
 * - useSimpleDispatchFlow：inputText / thinking 占位 + 发送 / 取消 / 再生成
 * - useSimpleToolCardActions：工具卡确认 / 跳过 / 撤销（内部 useSimpleToolExecutor）
 * - useSimpleChatChrome：抽屉 / 清空确认 / 字号行距
 * Hook 5 铁律：state + reset 同文件、不暴露 raw setter、跨 hook 只传 value。
 */

import { useEffect, useMemo, useRef } from "react";
import { BarChart3, ChevronDown, Eraser, MessageSquare, Settings, X } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { useFeedback } from "../../hooks/useFeedback";
import { useSessionParams } from "../writer/useSessionParams";
import { useWriterFactsExtraction } from "../writer/useWriterFactsExtraction";
import { ExtractReviewModal } from "../writer/WriterModals";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { MobileSheet } from "../mobile/MobileSheet";
import { Spinner } from "../shared/Spinner";
import { SimpleSettingsDrawer } from "./SimpleSettingsDrawer";
import { SimpleChatHistory } from "./SimpleChatHistory";
import { SimpleChatInput } from "./SimpleChatInput";
import { useSimpleChat } from "./useSimpleChat";
import { useChatSessions } from "./useChatSessions";
import { ChatSessionList } from "./ChatSessionList";
import { useSimpleDispatch } from "./useSimpleDispatch";
import { useContextTokenCount } from "./useContextTokenCount";
import { useSimpleChatPanelConfig } from "./useSimpleChatPanelConfig";
import { useSimpleChapterContext } from "./useSimpleChapterContext";
import { useSimpleDraftActions } from "./useSimpleDraftActions";
import { useSimpleDispatchFlow } from "./useSimpleDispatchFlow";
import { useSimpleToolCardActions } from "./useSimpleToolCardActions";
import { useSimpleChatChrome } from "./useSimpleChatChrome";

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
  // chat-sessions 底座：会话列表归 sessions hook，消息归 chat hook（activeId 驱动重载）。
  // 加载完成前 activeId=null → chat 走 legacy 兼容路径读 default 会话，列表就绪后
  // 若 activeId 不同会再重载一次（一次性，可接受）。
  const sessions = useChatSessions(auPath);
  const chat = useSimpleChat(auPath, sessions.activeId ?? undefined);
  const dispatch = useSimpleDispatch(auPath, sessions.activeId ?? undefined);

  const config = useSimpleChatPanelConfig(auPath, isActiveTab);
  const chapterContext = useSimpleChapterContext(auPath, isActiveTab);
  const sessionParams = useSessionParams(auPath, config.projectInfo, config.settingsInfo, showSuccess, showError);

  // M9 接线：复用 writer 侧事实提取 hook（自带 review 状态机 + 落库）。对话接受走自动触发，
  // 不再单独弹 FactsPromptModal —— 对话路径「记忆=自动为主」。
  const factsExtraction = useWriterFactsExtraction(auPath);

  const draftActions = useSimpleDraftActions({
    auPath,
    sessionId: sessions.activeId ?? undefined,
    chat,
    canAutoExtract: config.canAutoExtract,
    factsExtraction,
    refreshChapterContext: chapterContext.refreshChapterContext,
    onChaptersChanged,
    cancelDispatch: dispatch.cancelDispatch,
  });

  const flow = useSimpleDispatchFlow({
    auPath,
    chat,
    dispatch,
    pendingChapterNum: chapterContext.pendingChapterNum,
    projectInfo: config.projectInfo,
    settingsInfo: config.settingsInfo,
    sessionLlmPayload: sessionParams.sessionLlmPayload,
    sessionTemp: sessionParams.sessionTemp,
    sessionTopP: sessionParams.sessionTopP,
    acceptingDraftId: draftActions.acceptingDraftId,
  });

  const toolActions = useSimpleToolCardActions({ auPath, chat });
  const chrome = useSimpleChatChrome(auPath);

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

  // 会话元数据跟随消息落盘刷新（自动标题 / 消息数）：防抖 500ms，流式期 chunk
  // 高频变更只触发最后一次。refresh 只回写索引 state，不动 activeId，无重载循环。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——chat.messages 只作变更信号，体内读 sessions 的语义化方法
  useEffect(() => {
    if (!sessions.isLoaded || !chat.isLoaded) return;
    const id = setTimeout(() => void sessions.refresh(), 500);
    return () => clearTimeout(id);
  }, [chat.messages, chat.isLoaded, sessions.isLoaded]);

  const globalBusy =
    !sessions.isLoaded || // 会话索引未就绪前禁发送：此时 chat 走 legacy default 路径，消息会滞留不可见（kimi 交叉验证 minor）
    dispatch.isStreaming ||
    draftActions.acceptingDraftId !== null ||
    toolActions.executingToolId !== null;

  // C5: token 估算。chapterCount 变化（接受后）触发重算。面板常驻挂载后隐藏期
  // 暂停 30s 兜底轮询（对抗审 A-4）。sessionLlmPayload 让 badge 与 dispatch 同走
  // 三层解析（H4）——会话切模型时窗口/预警即时跟随。
  const tokenCount = useContextTokenCount(
    auPath,
    chapterContext.chapterCount,
    chat.messages,
    isActiveTab !== false,
    sessionParams.sessionLlmPayload,
  );

  const tokenBadge = useMemo(() => {
    const est = tokenCount.estimate;
    if (!est) return null;
    const formatThousand = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
    const valueText = formatThousand(est.inputTokens);
    return (
      <span className="inline-flex items-baseline gap-1 rounded-full border border-rule bg-surface px-[7px] py-[3px] font-mono text-[9px] uppercase tracking-[0.08em] text-ink-muted">
        <BarChart3 size={10} className="self-center" />
        <strong className="font-display text-[11px] font-semibold not-italic tracking-normal">{valueText}</strong>
        <span>{t("simple.header.tokensUnit", { defaultValue: "tokens" })}</span>
      </span>
    );
  }, [tokenCount.estimate, t]);

  return (
    <div
      // w-full + min-w-0：桌面工作台把本面板挂在 flex-row 容器里（常驻挂载 CSS 隐藏方案），
      // flex item 默认 shrink-to-fit 会把面板压成内容宽度（2026-09-09 卡拉实拍：对话页只
      // 占左下角一条 ~420px，右半屏全空）；显式声明占满槽位、允许收缩防撑爆。
      className={`flex h-full min-h-0 w-full min-w-0 flex-col bg-background ${className}`}
      style={
        {
          // 注入 drawer 字号 / 行距 → 子组件正文 div 用 var(--ff-body-fs) /
          // var(--ff-body-lh) 引用（问题 #3a：drawer 调字号同步对话界面正文）
          "--ff-body-fs": `${chrome.fontSize}px`,
          "--ff-body-lh": String(chrome.lineHeight),
        } as React.CSSProperties
      }
    >
      <header className="flex items-center gap-x-3 gap-y-2 flex-wrap border-b border-rule bg-surface px-4 py-3">
        {/* 移动端会话入口：桌面是常驻侧栏，小屏点这里开底栏弹层选会话 */}
        <button
          type="button"
          onClick={chrome.openSessionsSheet}
          className="inline-flex h-8 max-w-[45%] items-center gap-1.5 rounded-sm border border-rule-soft px-2 text-[12px] text-text/80 transition-colors hover:bg-rule-soft focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-gold-bright md:hidden"
          aria-label={t("chatSessions.listTitle", { defaultValue: "对话" })}
        >
          <MessageSquare size={13} className="shrink-0 text-accent" />
          <span className="truncate">
            {(() => {
              // title_auto 占位标题按界面语言显示（kimi R9 minor，同其他三处渲染点）
              const active = sessions.sessions.find((s) => s.id === sessions.activeId);
              return (
                (active ? (active.title_auto ? t("chatSessions.untitled") : active.title) : null) ??
                t("chatSessions.listTitle", { defaultValue: "对话" })
              );
            })()}
          </span>
          <ChevronDown size={12} className="shrink-0 text-ink-faint" />
        </button>
        <span className="inline-flex items-baseline gap-1 font-mono text-[9px] uppercase tracking-[0.08em] text-ink-muted">
          <span>{t("simple.header.chaptersLabel", { defaultValue: "Chapters" })}</span>
          <strong className="font-display text-[12px] font-semibold not-italic tracking-normal text-accent">
            {chapterContext.chapterCount}
          </strong>
          <span className="text-ink-faint">·</span>
          <span>{t("simple.header.nextLabel", { defaultValue: "Next" })}</span>
          <strong className="font-display text-[12px] font-semibold not-italic tracking-normal text-accent">
            {chapterContext.pendingChapterNum ?? 1}
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
              className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-rule-soft hover:text-text focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-gold-bright"
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
            chrome.openClearChatConfirm();
          }}
          disabled={chat.messages.length === 0 || dispatch.isStreaming}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-rule-soft hover:text-text focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-gold-bright disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-muted"
          aria-label={t("simple.clearChat.label", { defaultValue: "清空对话" })}
          title={t("simple.clearChat.label", { defaultValue: "清空对话" })}
        >
          <Eraser size={14} />
        </button>
        <button
          type="button"
          onClick={chrome.openDrawer}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-rule-soft hover:text-text focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-gold-bright"
          aria-label={t("simple.settings.openLabel", { defaultValue: "打开续写设置" })}
        >
          <Settings size={14} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <ChatSessionList
          sessions={sessions.sessions}
          activeId={sessions.activeId}
          loadError={sessions.loadError}
          onSelect={sessions.selectSession}
          onCreate={() => void sessions.createNewSession()}
          onRename={(id, title) => void sessions.renameSessionById(id, title)}
          onDelete={(id) => void sessions.removeSession(id)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden">
            <SimpleChatHistory
              messages={chat.messages}
              auPath={auPath}
              fandomPath={fandomPath}
              isStreaming={dispatch.isStreaming}
              globalBusy={globalBusy}
              thinkingActive={flow.thinkingActive}
              isActiveTab={isActiveTab}
              onAcceptDraft={draftActions.handleAcceptDraftSync}
              onRegenerateDraft={flow.handleRegenerateDraft}
              onDiscardDraft={draftActions.handleDiscardDraft}
              onConfirmTool={toolActions.handleConfirmTool}
              onSkipTool={toolActions.handleSkipTool}
              onUndoTool={toolActions.handleUndoTool}
              onTogglePreview={chat.togglePreviewExpanded}
            />
          </div>

          <SimpleChatInput
            value={flow.inputText}
            onChange={flow.setInputText}
            onSend={flow.handleSend}
            isStreaming={dispatch.isStreaming}
            onCancelStreaming={flow.handleCancel}
            busy={globalBusy}
          />
        </div>
      </div>
      {/* 移动端会话列表：同一个 ChatSessionList 组件，全宽常显 + 操作按钮常显 */}
      <MobileSheet
        isOpen={chrome.sessionsSheetOpen}
        onClose={chrome.closeSessionsSheet}
        title={t("chatSessions.listTitle", { defaultValue: "对话" })}
        contentClassName="px-0 py-0 flex flex-col"
      >
        <ChatSessionList
          sessions={sessions.sessions}
          activeId={sessions.activeId}
          loadError={sessions.loadError}
          onSelect={(id) => {
            sessions.selectSession(id);
            chrome.closeSessionsSheet();
          }}
          onCreate={() => void sessions.createNewSession()}
          onRename={(id, title) => void sessions.renameSessionById(id, title)}
          onDelete={(id) => void sessions.removeSession(id)}
          className="flex min-h-0 w-full flex-1 flex-col bg-surface"
          alwaysShowActions
        />
      </MobileSheet>
      <SimpleSettingsDrawer
        isOpen={chrome.drawerOpen}
        isLoading={config.projectInfo === null && config.settingsInfo === null}
        onClose={chrome.closeDrawer}
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
        fontSize={chrome.fontSize}
        onFontSizeChange={chrome.setFontSize}
        lineHeight={chrome.lineHeight}
        onLineHeightChange={chrome.setLineHeight}
      />
      <ConfirmDialog
        isOpen={chrome.clearChatConfirmOpen}
        onClose={chrome.closeClearChatConfirm}
        onConfirm={() => {
          chrome.closeClearChatConfirm();
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
