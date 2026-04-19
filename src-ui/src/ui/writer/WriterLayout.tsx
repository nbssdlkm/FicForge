// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useCallback, useRef } from 'react';
import { useKV } from '../../hooks/useKV';
import {
  type GenerateRequestState,
  normalizeContextSummary,
  saveGenerateRequest,
} from '../../utils/writerStorage';
import { useWriterFactsExtraction } from './useWriterFactsExtraction';
import { useSessionParams } from './useSessionParams';
import { useConfirmedChapterEditor } from './useConfirmedChapterEditor';
import { useWriterBootstrap } from './useWriterBootstrap';
import { useWriterResetOnAuChange } from './useWriterResetOnAuChange';
import { type DraftItem, useWriterDraftController } from './useWriterDraftController';
import { useWriterFocusController } from './useWriterFocusController';
import { useWriterInstructionInput } from './useWriterInstructionInput';
import { useWriterModeController } from './useWriterModeController';
import { useWriterChromeState } from './useWriterChromeState';
import { deriveWriterDisplayState } from './writerDisplayState';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';
import { ExportModal } from './ExportModal';
import { DirtyModal } from './DirtyModal';
import { ContextSummaryBar } from './ContextSummaryBar';
import { ChapterContentArea } from './ChapterContentArea';
import { WriterSidePanelContent } from './WriterSidePanelContent';
import { WriterModals } from './WriterModals';
import { WriterHeader } from './WriterHeader';
import { WriterFooter } from './WriterFooter';
import { Sidebar } from '../shared/Sidebar';
import { SettingsChatPanel } from '../shared/settings-chat/SettingsChatPanel';
import { InlineBanner } from '../shared/InlineBanner';

import { confirmChapter, undoChapter } from '../../api/engine-client';
import { deleteDrafts, type DraftGeneratedWith } from '../../api/engine-client';
import { type StateInfo } from '../../api/engine-client';
import { type FactInfo } from '../../api/engine-client';
import { generateChapter, type ContextSummary } from '../../api/engine-client';
import { type WriterSessionConfig } from '../../api/engine-client';
import { type WriterProjectContext } from '../../api/engine-client';
import { ApiError, getFriendlyErrorMessage } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';


// GenerateRequestState imported from utils/writerStorage

// 存储工具已抽取到 utils/writerStorage.ts

function buildDraftId(chapterNum: number, label: string): string {
  return `ch${String(chapterNum).padStart(4, '0')}_draft_${label}.md`;
}

function createDraftItem(
  chapterNum: number,
  label: string,
  content: string,
  generatedWith?: DraftGeneratedWith | null
): DraftItem {
  return {
    label,
    draftId: buildDraftId(chapterNum, label),
    content,
    generatedWith: generatedWith || null,
    modified: false,
  };
}



// localStorage helpers 已抽取至 utils/writerStorage.ts

export function formatGeneratedMeta(generatedWith?: DraftGeneratedWith | null, locale = 'zh-CN'): string {
  if (!generatedWith) return '';

  const parts: string[] = [];
  if (generatedWith.generated_at) {
    const timestamp = new Date(generatedWith.generated_at);
    if (!Number.isNaN(timestamp.getTime())) {
      parts.push(
        new Intl.DateTimeFormat(locale, {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(timestamp)
      );
    }
  }

  if (generatedWith.model) {
    parts.push(generatedWith.model);
  }

  return parts.join(' · ');
}

export function getPreviewText(content: string, maxChars = 200): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}…`;
}

export const WriterLayout = ({ auPath, onNavigate, viewChapter, onClearViewChapter, onChaptersChanged }: { auPath: string, onNavigate: (page: string) => void, viewChapter?: number | null, onClearViewChapter?: () => void, onChaptersChanged?: () => void }) => {
  const { t, i18n } = useTranslation();
  const { showError, showSuccess, showToast } = useFeedback();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const loadGuard = useActiveRequestGuard(auPath);
  const refreshGuard = useActiveRequestGuard(auPath);
  const generateGuard = useActiveRequestGuard(auPath);
  const [isSettingsModeBusy, setIsSettingsModeBusy] = useState(false);
  const {
    mobileToolsOpen,
    setMobileToolsOpen,
    rightCollapsed,
    isExportOpen,
    setExportOpen,
    isDirtyOpen,
    setDirtyOpen,
    dirtyTargetChapter,
    isFinalizeConfirmOpen,
    setFinalizeConfirmOpen,
    chapterTitle,
    setChapterTitle,
    isDiscardConfirmOpen,
    setDiscardConfirmOpen,
    isUndoConfirmOpen,
    setUndoConfirmOpen,
    dirtyBannerDismissed,
    setDirtyBannerDismissed,
    footerCollapsed,
    toggleRightCollapsed,
    openExport,
    closeExport,
    openDirty,
    closeDirty,
    openFinalizeConfirm,
    closeFinalizeConfirm,
    openDiscardConfirm,
    closeDiscardConfirm,
    openUndoConfirm,
    closeUndoConfirm,
    dismissDirtyBanner,
    toggleFooterCollapsed,
    openMobileTools,
    closeMobileTools,
  } = useWriterChromeState();

  const [state, setState] = useState<StateInfo | null>(null);
  const [projectInfo, setProjectInfo] = useState<WriterProjectContext | null>(null);
  const [settingsInfo, setSettingsInfo] = useState<WriterSessionConfig | null>(null);
  const [currentContent, setCurrentContent] = useState('');
  const [unresolvedFacts, setUnresolvedFacts] = useState<FactInfo[]>([]);
  const [focusSelection, setFocusSelection] = useState<string[]>([]);

  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [activeDraftIndex, setActiveDraftIndex] = useState(0);
  const [recoveryNotice, setRecoveryNotice] = useState(false);
  const [lastConfirmedChapter, setLastConfirmedChapter] = useState<number | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [generatedWith, setGeneratedWith] = useState<DraftGeneratedWith | null>(null);
  const [budgetReport, setBudgetReport] = useState<any>(null);
  const [lastGenerateRequest, setLastGenerateRequest] = useState<GenerateRequestState | null>(null);
  const [generationErrorDisplay, setGenerationErrorDisplay] = useState<{ message: string; actions: string[] } | null>(null);
  const [draftSummaries, setDraftSummaries] = useState<Record<string, ContextSummary>>({});
  const pendingContextSummaryRef = useRef<ContextSummary | null>(null);

  const [loading, setLoading] = useState(true);
  const [instructionText, setInstructionText] = useState('');

  const factsExtraction = useWriterFactsExtraction(auPath, lastConfirmedChapter);
  const sessionParams = useSessionParams(auPath, projectInfo, settingsInfo, showSuccess, showError);
  const {
    mode,
    showSettingsTooltip,
    handleModeChange,
    closeSettingsTooltip,
  } = useWriterModeController({
    isMobile,
    isSettingsModeBusy,
    showToast,
    t,
  });

  // 编辑已确认章节（FIX-006）

  // 阅读偏好（跨平台 KV 持久化）
  const [fontSizeStr, setFontSizeKV] = useKV('ficforge.fontSize', '18');
  const fontSize = parseInt(fontSizeStr, 10) || 18;
  const setFontSize = useCallback((v: number) => setFontSizeKV(String(v)), [setFontSizeKV]);
  const [lineHeightStr, setLineHeightKV] = useKV('ficforge.lineHeight', '1.8');
  const lineHeight = parseFloat(lineHeightStr) || 1.8;
  const setLineHeight = useCallback((v: number) => setLineHeightKV(String(v)), [setLineHeightKV]);

  useWriterResetOnAuChange<DraftItem>({
    auPath,
    pendingContextSummaryRef,
    setLoading,
    setIsSettingsModeBusy,
    setState,
    setProjectInfo,
    setSettingsInfo,
    setCurrentContent,
    setUnresolvedFacts,
    setFocusSelection,
    setDrafts,
    setActiveDraftIndex,
    setRecoveryNotice,
    setLastConfirmedChapter,
    setUndoConfirmOpen,
    setDirtyBannerDismissed,
    setIsGenerating,
    setIsFinalizing,
    setIsDiscarding,
    setStreamText,
    setGeneratedWith,
    setBudgetReport,
    setLastGenerateRequest,
    setDraftSummaries,
    setInstructionText,
    setFinalizeConfirmOpen,
    setDiscardConfirmOpen,
    setDirtyOpen,
    setExportOpen,
    setMobileToolsOpen,
    factsExtraction,
  });



  // 指令文本持久化：变化时自动保存到 localStorage
  const currentChapterNum = state?.current_chapter ?? 0;
  const { instructionInputRef, focusInstructionInput } = useWriterInstructionInput({
    auPath,
    currentChapterNum,
    instructionText,
  });

  /** 立即写入挂起的草稿编辑，然后清除定时器。 */
  const {
    clearDraftState,
    replaceDraftSummaries,
    attachDraftSummary,
    mergeDraftIntoState,
    loadDraftByLabel,
    loadDraftsForChapter,
    handleCurrentDraftChange,
  } = useWriterDraftController({
    auPath,
    drafts,
    activeDraftIndex,
    currentChapterNum,
    pendingContextSummaryRef,
    setDrafts,
    setActiveDraftIndex,
    setStreamText,
    setGeneratedWith,
    setBudgetReport,
    setRecoveryNotice,
    setDraftSummaries,
  });

  const { loadData, refreshSettingsModeData } = useWriterBootstrap<DraftItem>({
    auPath,
    loadGuard,
    refreshGuard,
    getConfiguredLlmModel: sessionParams.getConfiguredLlmModel,
    setSessionModel: sessionParams.setSessionModel,
    setSessionTemp: sessionParams.setSessionTemp,
    setSessionTopP: sessionParams.setSessionTopP,
    loadDraftsForChapter,
    replaceDraftSummaries,
    clearDraftState,
    pendingContextSummaryRef,
    showError,
    t,
    setLoading,
    setState,
    setProjectInfo,
    setSettingsInfo,
    setCurrentContent,
    setUnresolvedFacts,
    setFocusSelection,
    setDrafts,
    setActiveDraftIndex,
    setRecoveryNotice,
    setLastGenerateRequest,
    setInstructionText,
  });

  const handleGenerate = useCallback(async (request: GenerateRequestState) => {
    if (isGenerating || !state) return;
    const token = generateGuard.start();

    const projectLlmUsable = projectInfo?.llm?.mode && (projectInfo.llm.mode !== 'api' || projectInfo.llm.has_api_key);
    const effectiveLlm = projectLlmUsable ? projectInfo!.llm : settingsInfo?.default_llm;
    const llmMode = effectiveLlm?.mode || 'api';
    if (llmMode === 'api' && !effectiveLlm?.has_api_key) {
      showError(null, t('error_messages.no_api_key'));
      return;
    }

    setIsGenerating(true);
    setStreamText('');
    setGeneratedWith(null);
    setBudgetReport(null);
    setRecoveryNotice(false);
    setGenerationErrorDisplay(null);
    pendingContextSummaryRef.current = null;

    setLastGenerateRequest(request);
    saveGenerateRequest(auPath, state.current_chapter, request);

    let nextDraftLabel = '';
    let nextGeneratedWith: DraftGeneratedWith | null = null;
    let nextBudgetReport: any = null;
    let nextText = '';
    let partialDraftLabel = '';
    let generationError: unknown = null;
    let nextContextSummary: ContextSummary | null = null;

    try {
      for await (const event of generateChapter({
        au_path: auPath,
        chapter_num: state.current_chapter,
        user_input: request.userInput,
        input_type: request.inputType,
        session_llm: sessionParams.sessionLlmPayload || undefined,
        session_params: { temperature: sessionParams.sessionTemp, top_p: sessionParams.sessionTopP },
      })) {
        if (generateGuard.isStale(token)) {
          pendingContextSummaryRef.current = null;
          return;
        }

        if (event.event === 'context_summary') {
          const summary = normalizeContextSummary(event.data);
          if (summary) {
            nextContextSummary = summary;
            pendingContextSummaryRef.current = summary;
          }
          continue;
        }

        if (event.event === 'token') {
          const text = event.data.text || '';
          nextText += text;
          setStreamText((prev) => prev + text);
          continue;
        }

        if (event.event === 'done') {
          nextDraftLabel = event.data.draft_label;
          nextGeneratedWith = event.data.generated_with || null;
          nextBudgetReport = event.data.budget_report;
          continue;
        }

        if (event.event === 'error') {
          partialDraftLabel = event.data.partial_draft_label || '';
          generationError = new ApiError(
            event.data.error_code || 'UNKNOWN',
            getFriendlyErrorMessage(event.data),
            event.data.actions || [],
            event.data.message
          );
          break;
        }
      }

      if (generationError) {
        if (partialDraftLabel) {
          const partialDraft = await loadDraftByLabel(
            state.current_chapter,
            partialDraftLabel,
            nextText,
            nextGeneratedWith
          );
          if (generateGuard.isStale(token)) {
            pendingContextSummaryRef.current = null;
            return;
          }
          mergeDraftIntoState(partialDraft);
          setGeneratedWith(partialDraft.generatedWith || nextGeneratedWith || null);
          setStreamText('');
          setRecoveryNotice(true);
          if (nextContextSummary) {
            attachDraftSummary(state.current_chapter, partialDraftLabel, nextContextSummary);
          }
        } else {
          setStreamText('');
        }
        pendingContextSummaryRef.current = null;
        throw generationError;
      }

      if (!nextDraftLabel) {
        pendingContextSummaryRef.current = null;
        throw new Error(t('writer.generateErrorFallback'));
      }

      const nextDraft = createDraftItem(
        state.current_chapter,
        nextDraftLabel,
        nextText,
        nextGeneratedWith
      );
      if (generateGuard.isStale(token)) {
        pendingContextSummaryRef.current = null;
        return;
      }

      mergeDraftIntoState(nextDraft);
      if (nextContextSummary) {
        attachDraftSummary(state.current_chapter, nextDraftLabel, nextContextSummary);
      }
      setGeneratedWith(nextGeneratedWith);
      setBudgetReport(nextBudgetReport);
      pendingContextSummaryRef.current = null;
      // 延迟清除 streamText，等 drafts + activeDraftIndex 先渲染，
      // 避免 displayContent 在两者之间短暂为空。
      // Guard.isStale 防止新一轮生成启动后被旧 RAF 误清。
      requestAnimationFrame(() => {
        if (!generateGuard.isStale(token)) setStreamText('');
      });
    } catch (error) {
      pendingContextSummaryRef.current = null;
      if (generateGuard.isStale(token)) return;
      // 区分连接中断和 API 错误
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      const isNetwork = error instanceof TypeError && /fetch|network/i.test(error.message);
      if (isAbort || isNetwork) {
        showToast(t('writer.generateInterrupted'), 'warning');
      } else {
        showError(error, t('writer.generateErrorFallback'));
      }
      if (error instanceof ApiError) {
        setGenerationErrorDisplay({ message: error.userMessage || error.message, actions: error.actions });
      } else if (error instanceof Error && !isAbort && !isNetwork) {
        setGenerationErrorDisplay({ message: error.message, actions: [] });
      }
    } finally {
      if (!generateGuard.isStale(token)) {
        setIsGenerating(false);
      }
    }
  }, [attachDraftSummary, auPath, generateGuard, isGenerating, loadDraftByLabel, mergeDraftIntoState, projectInfo, sessionParams.sessionLlmPayload, sessionParams.sessionTemp, sessionParams.sessionTopP, settingsInfo, showError, showToast, state, t]);

  const handleGenerateFromInput = async (inputType: 'continue' | 'instruction') => {
    if (drafts.length > 0) {
      showToast(t('drafts.generatingBlocked'), 'warning');
      return;
    }

    const userInput = inputType === 'instruction' && instructionText.trim()
      ? instructionText.trim()
      : t('common.actions.continue');

    await handleGenerate({ inputType, userInput });
  };

  const handleRegenerate = async () => {
    const trimmedInstruction = instructionText.trim();
    const request: GenerateRequestState = trimmedInstruction
      ? { inputType: 'instruction', userInput: trimmedInstruction }
      : (lastGenerateRequest || { inputType: 'continue', userInput: t('common.actions.continue') });

    await handleGenerate(request);
  };

  const handleConfirm = async () => {
    const currentDraft = drafts[activeDraftIndex];
    if (!currentDraft || !state) return;
    const requestAuPath = auPath;

    setIsFinalizing(true);
    const confirmedFocus = [...focusSelection]; // 保存定稿前的 focus
    try {
      const confirmedChapter = state.current_chapter;
      await confirmChapter(
        auPath,
        confirmedChapter,
        currentDraft.draftId,
        currentDraft.generatedWith || undefined,
        currentDraft.modified ? currentDraft.content : undefined,
        chapterTitle.trim() || undefined
      );
      if (loadGuard.isKeyStale(requestAuPath)) return;

      clearDraftState(true); // 草稿内容已通过 content_override 提交，无需再 flush
      replaceDraftSummaries(confirmedChapter, {});
      setFinalizeConfirmOpen(false);
      setLastConfirmedChapter(confirmedChapter);
      await loadData();
      onChaptersChanged?.();

      if (factsExtraction.skipFactsPrompt) {
        showSuccess(t('drafts.finalizeSuccess', { chapter: confirmedChapter }));
        // 跳过 facts 提取时，单独提示待填坑标记
        if (confirmedFocus.length > 0) {
          showToast(t('focus.resolvePrompt'), 'info');
        }
        focusInstructionInput();
        return;
      }

      factsExtraction.setFactsPromptOpen(true);
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!loadGuard.isKeyStale(requestAuPath)) {
        setIsFinalizing(false);
      }
    }
  };

  const handleUndoConfirmed = async () => {
    const requestAuPath = auPath;
    setUndoConfirmOpen(false);
    try {
      await undoChapter(auPath);
      if (loadGuard.isKeyStale(requestAuPath)) return;
      clearDraftState(true); // undo 删除草稿，无需 flush
      showSuccess(t('writer.undoSuccess'));
      await loadData();
      onChaptersChanged?.();
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    }
  };

  const handleDiscardDrafts = async () => {
    if (!state || drafts.length === 0) return;
    const requestAuPath = auPath;

    setIsDiscarding(true);
    try {
      const currentDraft = drafts[activeDraftIndex];
      const isSingleDraft = drafts.length === 1;
      await deleteDrafts(
        auPath,
        state.current_chapter,
        isSingleDraft ? currentDraft?.label : undefined
      );
      if (loadGuard.isKeyStale(requestAuPath)) return;

      clearDraftState(true); // discard=true: 用户主动丢弃，不 flush 到磁盘
      replaceDraftSummaries(state.current_chapter, {});
      setDiscardConfirmOpen(false);
      if (isSingleDraft) {
        showToast(t('drafts.discardSuccess'), 'info');
      } else {
        showToast(t('drafts.discardAllSuccess'), 'info');
      }
      focusInstructionInput();
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!loadGuard.isKeyStale(requestAuPath)) {
        setIsDiscarding(false);
      }
    }
  };

  const {
    handleFocusToggle,
    handleClearFocus,
    handleContinueLastFocus,
  } = useWriterFocusController({
    auPath,
    focusSelection,
    unresolvedFacts,
    lastConfirmedFocus: state?.last_confirmed_chapter_focus || [],
    loadGuard,
    setFocusSelection,
    showToast,
    showError,
    t,
  });

  const settingsSessionLlm = sessionParams.sessionLlmPayload;
  const {
    currentChapter,
    hasPendingDrafts,
    writeActionsDisabled,
    currentDraft,
    settingsFandomPath,
    currentDraftSummary,
    fallbackDisplayContent,
    metaModel,
    metaChars,
    metaDuration,
    currentDraftMeta,
    previewText,
    layerSum,
    contextLayers,
  } = deriveWriterDisplayState({
    auPath,
    state,
    drafts,
    activeDraftIndex,
    draftSummaries,
    isGenerating,
    isFinalizing,
    isDiscarding,
    isSettingsModeBusy,
    currentContent,
    streamText,
    generatedWith,
    budgetReport,
    sessionModel: sessionParams.sessionModel,
    locale: i18n.resolvedLanguage === 'en' ? 'en-US' : 'zh-CN',
    t,
  });
  const {
    viewingHistoryContent,
    viewingHistoryNum,
    editingConfirmed,
    editingContent,
    editingOriginalContent,
    savingEdit,
    isViewingHistory,
    setEditingContent,
    clearHistoryView,
    startEditingConfirmed,
    cancelEditingConfirmed,
    saveEditingConfirmed,
  } = useConfirmedChapterEditor({
    auPath,
    viewChapter,
    state,
    fallbackContent: fallbackDisplayContent,
    onClearViewChapter,
    onStateChange: setState,
    onDirtyBannerReset: () => setDirtyBannerDismissed(false),
    onShowSuccess: (message) => showToast(message, 'success'),
    onShowError: showError,
    t,
  });
  const displayContent = isViewingHistory ? (viewingHistoryContent || '') : fallbackDisplayContent;
  const sharedSidePanelProps = {
    mode,
    unresolvedFacts,
    focusSelection,
    onFocusToggle: handleFocusToggle,
    onClearFocus: handleClearFocus,
    onContinueLastFocus: handleContinueLastFocus,
    lastConfirmedFocus: state?.last_confirmed_chapter_focus || [],
    budgetReport,
    contextLayers,
    layerSum,
    sessionModel: sessionParams.sessionModel,
    onModelChange: sessionParams.setSessionModel,
    sessionTemp: sessionParams.sessionTemp,
    onTempChange: sessionParams.setSessionTemp,
    sessionTopP: sessionParams.sessionTopP,
    onTopPChange: sessionParams.setSessionTopP,
    onSaveGlobal: sessionParams.handleSaveGlobalParams,
    onSaveAu: sessionParams.handleSaveAuParams,
    fontSize,
    onFontSizeChange: setFontSize,
    lineHeight,
    onLineHeightChange: setLineHeight,
    onNavigate,
  };

  return (
    <>
      <main className="flex h-full flex-1 flex-col min-w-0 bg-background relative transition-colors duration-200">
        {!dirtyBannerDismissed && (state?.chapters_dirty || []).length > 0 && (
          <InlineBanner
            tone="warning"
            layout="bar"
            compact
            message={t('dirty.banner', { count: (state?.chapters_dirty || []).length, chapters: (state?.chapters_dirty || []).join(', ') })}
            actions={
              <>
                <Button tone="neutral" fill="plain" size="sm" className="h-11 text-xs md:h-6" onClick={() => openDirty((state?.chapters_dirty || [])[0] || 0)}>{t('dirty.goResolve')}</Button>
                <Button tone="neutral" fill="plain" size="sm" className="h-11 text-xs text-text/50 md:h-6" onClick={dismissDirtyBanner}>{t('dirty.dismissBanner')}</Button>
              </>
            }
          />
        )}
        <WriterHeader
          mode={mode}
          onModeChange={handleModeChange}
          isSettingsModeBusy={isSettingsModeBusy}
          isGenerating={isGenerating}
          isViewingHistory={isViewingHistory}
          viewingHistoryNum={viewingHistoryNum}
          currentChapter={currentChapter}
          metaModel={metaModel}
          metaChars={metaChars}
          metaDuration={metaDuration}
          sessionTemp={sessionParams.sessionTemp}
          chaptersDirty={state?.chapters_dirty || []}
          onOpenDirty={() => {
            openDirty((state?.chapters_dirty || [])[0] || 0);
            showToast(t('writer.dirtyOpenHint'), 'info');
          }}
          onOpenExport={openExport}
        />

        <div className={mode === 'write' ? 'flex flex-1 flex-col min-h-0' : 'hidden'}>
          <div className="flex flex-1 justify-center overflow-y-auto w-full pb-16 md:pb-12">
            <div className="w-full max-w-[720px] space-y-6 px-4 py-4 md:px-8 md:py-10">
              {isViewingHistory && (
                <InlineBanner
                  tone="info"
                  message={<>{t('workspace.chapterItem', { num: viewingHistoryNum })} — {t('writer.viewingHistory')}</>}
                  actions={
                    <>
                      <Button tone="neutral" fill="plain" size="sm" onClick={startEditingConfirmed} disabled={editingConfirmed}>
                        {t('writer.editChapter')}
                      </Button>
                      <Button tone="neutral" fill="plain" size="sm" onClick={clearHistoryView}>
                        {t('writer.backToCurrentChapter')}
                      </Button>
                    </>
                  }
                />
              )}
              {recoveryNotice && hasPendingDrafts && (
                <InlineBanner tone="warning" message={t('drafts.recoveryNotice')} />
              )}

              <ChapterContentArea
                loading={loading}
                streamText={streamText}
                isGenerating={isGenerating}
                isViewingHistory={isViewingHistory}
                viewingHistoryContent={viewingHistoryContent}
                viewingHistoryNum={viewingHistoryNum}
                editingConfirmed={editingConfirmed}
                editingContent={editingContent}
                editingOriginalContent={editingOriginalContent}
                savingEdit={savingEdit}
                onEditingContentChange={setEditingContent}
                onSaveEdit={saveEditingConfirmed}
                onCancelEdit={cancelEditingConfirmed}
                currentDraft={currentDraft}
                onDraftChange={handleCurrentDraftChange}
                displayContent={displayContent}
                generationErrorDisplay={generationErrorDisplay}
                onDismissError={() => setGenerationErrorDisplay(null)}
                onNavigate={onNavigate}
                fontSize={fontSize}
                lineHeight={lineHeight}
              />

              <ContextSummaryBar
                summary={currentDraftSummary}
                onAdjustCoreIncludes={() => onNavigate('settings')}
              />
            </div>
          </div>

          <WriterFooter
            footerCollapsed={footerCollapsed}
            onToggleCollapsed={toggleFooterCollapsed}
            isGenerating={isGenerating}
            writeActionsDisabled={writeActionsDisabled}
            isSettingsModeBusy={isSettingsModeBusy}
            isDiscarding={isDiscarding}
            currentChapter={currentChapter}
            instructionText={instructionText}
            onInstructionTextChange={setInstructionText}
            instructionInputRef={instructionInputRef}
            onGenerate={(type) => { void handleGenerateFromInput(type); }}
            drafts={drafts}
            activeDraftIndex={activeDraftIndex}
            onSelectDraft={setActiveDraftIndex}
            currentDraft={currentDraft}
            hasPendingDrafts={hasPendingDrafts}
            currentDraftMeta={currentDraftMeta}
            onOpenFinalize={openFinalizeConfirm}
            onRegenerate={() => { void handleRegenerate(); }}
            onOpenDiscard={openDiscardConfirm}
            onOpenUndo={openUndoConfirm}
            onNavigateFacts={() => onNavigate('facts')}
            onOpenMobileTools={openMobileTools}
            onBlockedToast={() => showToast(t('drafts.generatingBlocked'), 'warning')}
          />
        </div>

        <div className={mode === 'settings' ? 'hidden min-h-0 flex-1 flex-col md:flex' : 'hidden'}>
          <div className="mx-auto flex h-full w-full max-w-4xl min-h-0 flex-col px-6 py-6">
            {showSettingsTooltip ? (
              <InlineBanner
                className="mb-4"
                tone="info"
                message={t('settingsMode.firstTimeTooltip')}
                actions={
                  <Button tone="neutral" fill="plain" size="sm" className="h-7 px-2 text-info" onClick={closeSettingsTooltip}>
                    {t('common.actions.close')}
                  </Button>
                }
              />
            ) : null}
            <SettingsChatPanel
              mode="au"
              basePath={auPath}
              fandomPath={settingsFandomPath}
              placeholder={t('settingsMode.placeholder')}
              currentChapter={currentChapter}
              sessionLlm={settingsSessionLlm}
              disabled={loading || !state}
              onBusyChange={setIsSettingsModeBusy}
              onAfterMutation={async () => {
                await refreshSettingsModeData();
              }}
              className="min-h-0 flex-1"
            />
          </div>
        </div>
      </main>

      <Sidebar position="right" width="320px" isCollapsed={rightCollapsed} onToggle={toggleRightCollapsed} className="hidden flex-col bg-surface/50 border-l border-black/10 dark:border-white/10 md:flex">
        <WriterSidePanelContent
          isMobile={false}
          {...sharedSidePanelProps}
        />
      </Sidebar>

      <Modal isOpen={mobileToolsOpen} onClose={closeMobileTools} title={t('common.actions.more')}>
        <WriterSidePanelContent
          isMobile={true}
          onClose={closeMobileTools}
          onUndoClick={() => { closeMobileTools(); openUndoConfirm(); }}
          onExportClick={() => { closeMobileTools(); openExport(); }}
          currentChapter={currentChapter}
          writeActionsDisabled={writeActionsDisabled}
          {...sharedSidePanelProps}
        />
      </Modal>

      <WriterModals
        isFinalizeConfirmOpen={isFinalizeConfirmOpen}
        onCloseFinalizeConfirm={closeFinalizeConfirm}
        currentChapter={currentChapter}
        chapterTitle={chapterTitle}
        onChapterTitleChange={setChapterTitle}
        previewText={previewText}
        onConfirmFinalize={() => void handleConfirm()}
        isFinalizing={isFinalizing}
        hasDraft={currentDraft !== null}
        isDiscardConfirmOpen={isDiscardConfirmOpen}
        onCloseDiscardConfirm={closeDiscardConfirm}
        draftsCount={drafts.length}
        onDiscardDrafts={() => void handleDiscardDrafts()}
        isDiscarding={isDiscarding}
        isFactsPromptOpen={factsExtraction.isFactsPromptOpen}
        onCloseFactsPrompt={factsExtraction.handleSkipFactsPrompt}
        factsPromptTitle={lastConfirmedChapter ? t('drafts.finalizeSuccess', { chapter: lastConfirmedChapter }) : t('drafts.finalizeSuccess', { chapter: currentChapter })}
        extractingFacts={factsExtraction.extractingFacts}
        skipFactsPrompt={factsExtraction.skipFactsPrompt}
        onOpenExtractReview={() => void factsExtraction.handleOpenExtractReview()}
        onFactsManualNavigate={() => { factsExtraction.setFactsPromptOpen(false); onNavigate('facts'); }}
        onSkipFactsPrompt={factsExtraction.handleSkipFactsPrompt}
        onFactsPromptToggle={factsExtraction.handleFactsPromptToggle}
        isExtractReviewOpen={factsExtraction.isExtractReviewOpen}
        onCloseExtractReview={() => { factsExtraction.setExtractReviewOpen(false); focusInstructionInput(); }}
        extractedCandidates={factsExtraction.extractedCandidates}
        selectedExtractedKeys={factsExtraction.selectedExtractedKeys}
        getCandidateKey={factsExtraction.getCandidateKey}
        onToggleExtractedCandidate={factsExtraction.toggleExtractedCandidate}
        onSaveExtracted={() => void factsExtraction.handleSaveExtracted()}
        savingExtracted={factsExtraction.savingExtracted}
        isUndoConfirmOpen={isUndoConfirmOpen}
        onCloseUndoConfirm={closeUndoConfirm}
        undoChapterNum={currentChapter - 1}
        onConfirmUndo={handleUndoConfirmed}
      />

      <ExportModal isOpen={isExportOpen} onClose={closeExport} auPath={auPath} />
      <DirtyModal
        isOpen={isDirtyOpen}
        onClose={closeDirty}
        auPath={auPath}
        chapterNum={dirtyTargetChapter}
        onResolved={() => {
          closeDirty();
          void loadData();
        }}
      />
    </>
  );
};
