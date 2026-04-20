// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useRef, useState } from 'react';
import { type ContextSummary } from '../../api/engine-client';
import { useKV } from '../../hooks/useKV';
import { useFeedback } from '../../hooks/useFeedback';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import { useTranslation } from '../../i18n/useAppTranslation';
import { Button } from '../shared/Button';
import { InlineBanner } from '../shared/InlineBanner';
import { SettingsChatPanel } from '../shared/settings-chat/SettingsChatPanel';
import { ChapterContentArea } from './ChapterContentArea';
import { ContextSummaryBar } from './ContextSummaryBar';
import { DirtyModal } from './DirtyModal';
import { ExportModal } from './ExportModal';
import { WriterFooter } from './WriterFooter';
import { WriterHeader } from './WriterHeader';
import { WriterModals } from './WriterModals';
import { WriterToolPanels } from './WriterToolPanels';
import { useConfirmedChapterEditor } from './useConfirmedChapterEditor';
import { useSessionParams } from './useSessionParams';
import { type DraftItem, useWriterDraftController } from './useWriterDraftController';
import { useWriterBootstrap } from './useWriterBootstrap';
import { useWriterChapterActions } from './useWriterChapterActions';
import { useWriterChromeState } from './useWriterChromeState';
import { useWriterFactsExtraction } from './useWriterFactsExtraction';
import { useWriterFocusController } from './useWriterFocusController';
import { useWriterGeneration } from './useWriterGeneration';
import { useWriterInstructionInput } from './useWriterInstructionInput';
import { useWriterModeController } from './useWriterModeController';
import { deriveWriterDisplayState } from './writerDisplayState';

type WriterLayoutProps = { auPath: string; onNavigate: (page: string) => void; viewChapter?: number | null; onClearViewChapter?: () => void; onChaptersChanged?: () => void };

export const WriterLayout = ({ auPath, onNavigate, viewChapter, onClearViewChapter, onChaptersChanged }: WriterLayoutProps) => {
  const { t, i18n } = useTranslation();
  const { showError, showSuccess, showToast } = useFeedback();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const loadGuard = useActiveRequestGuard(auPath);
  const refreshGuard = useActiveRequestGuard(auPath);
  const generateGuard = useActiveRequestGuard(auPath);
  const [isSettingsModeBusy, setIsSettingsModeBusy] = useState(false);
  const chrome = useWriterChromeState(auPath);
  const [fontSizeStr, setFontSizeKV] = useKV('ficforge.fontSize', '18');
  const [lineHeightStr, setLineHeightKV] = useKV('ficforge.lineHeight', '1.8');
  const fontSize = parseInt(fontSizeStr, 10) || 18;
  const lineHeight = parseFloat(lineHeightStr) || 1.8;
  const setFontSize = useCallback((value: number) => setFontSizeKV(String(value)), [setFontSizeKV]);
  const setLineHeight = useCallback((value: number) => setLineHeightKV(String(value)), [setLineHeightKV]);
  const bootstrapStateRef = useRef<{ current_chapter?: number } | null>(null);
  const sessionParamsBridgeRef = useRef<Pick<ReturnType<typeof useSessionParams>, 'getConfiguredLlmModel' | 'setSessionModel' | 'setSessionTemp' | 'setSessionTopP'>>({
    getConfiguredLlmModel: () => '',
    setSessionModel: () => {},
    setSessionTemp: () => {},
    setSessionTopP: () => {},
  });
  const draftControllerBridgeRef = useRef<Pick<ReturnType<typeof useWriterDraftController>, 'loadDraftsForChapter' | 'replaceDraftSummaries' | 'clearDraftState'>>({
    loadDraftsForChapter: async () => [],
    replaceDraftSummaries: () => {},
    clearDraftState: () => {},
  });
  const focusControllerBridgeRef = useRef<Pick<ReturnType<typeof useWriterFocusController>, 'setFocusFromState'>>({ setFocusFromState: () => {} });
  const instructionInputBridgeRef = useRef<Pick<ReturnType<typeof useWriterInstructionInput>, 'loadInstructionFromStorage'>>({ loadInstructionFromStorage: () => {} });
  const factsExtractionBridgeRef = useRef<Pick<ReturnType<typeof useWriterFactsExtraction>, 'skipFactsPrompt' | 'setFactsPromptOpen'>>({
    skipFactsPrompt: false,
    setFactsPromptOpen: () => {},
  });

  useEffect(() => {
    setIsSettingsModeBusy(false);
  }, [auPath]);

  const getConfiguredLlmModel = useCallback((llm: Parameters<ReturnType<typeof useSessionParams>['getConfiguredLlmModel']>[0]) => sessionParamsBridgeRef.current.getConfiguredLlmModel(llm), []);
  const setSessionModel = useCallback((model: string) => sessionParamsBridgeRef.current.setSessionModel(model), []);
  const setSessionTemp = useCallback((temperature: number) => sessionParamsBridgeRef.current.setSessionTemp(temperature), []);
  const setSessionTopP = useCallback((topP: number) => sessionParamsBridgeRef.current.setSessionTopP(topP), []);
  const loadDraftsForChapter = useCallback((chapterNum: number) => draftControllerBridgeRef.current.loadDraftsForChapter(chapterNum), []);
  const replaceDraftSummaries = useCallback((chapterNum: number, summaries: Record<string, ContextSummary>) => draftControllerBridgeRef.current.replaceDraftSummaries(chapterNum, summaries), []);
  const clearDraftState = useCallback((discard?: boolean) => draftControllerBridgeRef.current.clearDraftState(discard), []);
  const applyFocusFromState = useCallback((focus: string[]) => focusControllerBridgeRef.current.setFocusFromState(focus), []);
  const loadInstructionFromStorage = useCallback((chapterNum: number) => instructionInputBridgeRef.current.loadInstructionFromStorage(chapterNum), []);
  const getSkipFactsPrompt = useCallback(() => factsExtractionBridgeRef.current.skipFactsPrompt, []);
  const openFactsPrompt = useCallback(() => factsExtractionBridgeRef.current.setFactsPromptOpen(true), []);
  const { mode, showSettingsTooltip, handleModeChange, closeSettingsTooltip } = useWriterModeController({ isMobile, isSettingsModeBusy, showToast, t });

  const currentChapterNum = bootstrapStateRef.current?.current_chapter ?? 0;
  const instructionInput = useWriterInstructionInput({ auPath, currentChapterNum });
  instructionInputBridgeRef.current = { loadInstructionFromStorage: instructionInput.loadInstructionFromStorage };

  const draftCtrl = useWriterDraftController({
    auPath,
    currentChapterNum,
    onDraftSaveError: (error) => showError(error, t('error_messages.unknown')),
  });
  draftControllerBridgeRef.current = {
    loadDraftsForChapter: draftCtrl.loadDraftsForChapter,
    replaceDraftSummaries: draftCtrl.replaceDraftSummaries,
    clearDraftState: draftCtrl.clearDraftState,
  };

  const bootstrap = useWriterBootstrap<DraftItem>({
    auPath,
    loadGuard,
    refreshGuard,
    getConfiguredLlmModel,
    setSessionModel,
    setSessionTemp,
    setSessionTopP,
    loadDraftsForChapter,
    replaceDraftSummaries,
    clearDraftState,
    mergeDraftIntoState: draftCtrl.mergeDraftIntoState,
    selectDraft: draftCtrl.selectDraft,
    markRecoveryNotice: draftCtrl.markRecoveryNotice,
    showError,
    t,
    applyFocusFromState,
    loadInstructionFromStorage,
  });
  const { state, projectInfo, settingsInfo, currentContent, unresolvedFacts } = bootstrap.data;
  const { loading, applyStateSnapshot, loadData, refreshSettingsModeData } = bootstrap;
  const sessionParams = useSessionParams(auPath, projectInfo, settingsInfo, showSuccess, showError);
  bootstrapStateRef.current = state;
  sessionParamsBridgeRef.current = {
    getConfiguredLlmModel: sessionParams.getConfiguredLlmModel,
    setSessionModel: sessionParams.setSessionModel,
    setSessionTemp: sessionParams.setSessionTemp,
    setSessionTopP: sessionParams.setSessionTopP,
  };

  const focusController = useWriterFocusController({
    auPath,
    unresolvedFacts,
    lastConfirmedFocus: state?.last_confirmed_chapter_focus || [],
    loadGuard,
    showToast,
    showError,
    t,
  });
  focusControllerBridgeRef.current = { setFocusFromState: focusController.setFocusFromState };

  const chapterActions = useWriterChapterActions({
    auPath,
    state,
    drafts: draftCtrl.drafts,
    activeDraftIndex: draftCtrl.activeDraftIndex,
    chapterTitle: chrome.chapterTitle,
    focusSelection: focusController.focusSelection,
    getSkipFactsPrompt,
    loadGuard,
    clearDraftState,
    replaceDraftSummaries,
    loadData,
    focusInstructionInput: instructionInput.focusInstructionInput,
    onChaptersChanged,
    onCloseFinalizeConfirm: chrome.closeFinalizeConfirm,
    onCloseDiscardConfirm: chrome.closeDiscardConfirm,
    onCloseUndoConfirm: chrome.closeUndoConfirm,
    onOpenFactsPrompt: openFactsPrompt,
    showSuccess,
    showToast,
    showError,
    t,
  });

  const factsExtraction = useWriterFactsExtraction(auPath, chapterActions.lastConfirmedChapter);
  factsExtractionBridgeRef.current = {
    skipFactsPrompt: factsExtraction.skipFactsPrompt,
    setFactsPromptOpen: factsExtraction.setFactsPromptOpen,
  };

  const generation = useWriterGeneration({
    auPath,
    state,
    drafts: draftCtrl.drafts,
    instructionText: instructionInput.instructionText,
    projectInfo,
    settingsInfo,
    sessionLlmPayload: sessionParams.sessionLlmPayload,
    sessionTemp: sessionParams.sessionTemp,
    sessionTopP: sessionParams.sessionTopP,
    generateGuard,
    loadDraftByLabel: draftCtrl.loadDraftByLabel,
    mergeDraftIntoState: draftCtrl.mergeDraftIntoState,
    attachDraftSummary: draftCtrl.attachDraftSummary,
    appendStream: draftCtrl.appendStream,
    resetStream: draftCtrl.resetStream,
    markGeneratedWith: draftCtrl.markGeneratedWith,
    markBudgetReport: draftCtrl.markBudgetReport,
    markRecoveryNotice: draftCtrl.markRecoveryNotice,
    attachPendingContextSummary: draftCtrl.attachPendingContextSummary,
    getPendingContextSummary: draftCtrl.getPendingContextSummary,
    showError,
    showToast,
    t,
  });

  const displayState = deriveWriterDisplayState({
    auPath,
    state,
    drafts: draftCtrl.drafts,
    activeDraftIndex: draftCtrl.activeDraftIndex,
    draftSummaries: draftCtrl.draftSummaries,
    isGenerating: generation.isGenerating,
    isFinalizing: chapterActions.isFinalizing,
    isDiscarding: chapterActions.isDiscarding,
    isSettingsModeBusy,
    currentContent,
    streamText: draftCtrl.streamText,
    generatedWith: draftCtrl.generatedWith,
    budgetReport: draftCtrl.budgetReport,
    sessionModel: sessionParams.sessionModel,
    locale: i18n.resolvedLanguage === 'en' ? 'en-US' : 'zh-CN',
    t,
  });

  const confirmedEditor = useConfirmedChapterEditor({
    auPath,
    viewChapter,
    state,
    fallbackContent: displayState.fallbackDisplayContent,
    onClearViewChapter,
    onStateChange: applyStateSnapshot,
    onDirtyBannerReset: () => chrome.setDirtyBannerDismissed(false),
    onShowSuccess: (message) => showToast(message, 'success'),
    onShowError: showError,
    t,
  });
  const displayContent = confirmedEditor.isViewingHistory ? (confirmedEditor.viewingHistoryContent || '') : displayState.fallbackDisplayContent;
  const dirtyChapters = state?.chapters_dirty || [];
  const dirtyChapterNum = dirtyChapters[0] || 0;
  const lastConfirmedFocus = state?.last_confirmed_chapter_focus || [];
  const finalizedChapter = chapterActions.lastConfirmedChapter ?? displayState.currentChapter;
  const headerProps = {
    mode, onModeChange: handleModeChange, isSettingsModeBusy, isGenerating: generation.isGenerating,
    isViewingHistory: confirmedEditor.isViewingHistory, viewingHistoryNum: confirmedEditor.viewingHistoryNum, currentChapter: displayState.currentChapter,
    metaModel: displayState.metaModel, metaChars: displayState.metaChars, metaDuration: displayState.metaDuration, sessionTemp: sessionParams.sessionTemp,
    chaptersDirty: dirtyChapters, onOpenExport: chrome.openExport,
    onOpenDirty: () => { chrome.openDirty(dirtyChapterNum); showToast(t('writer.dirtyOpenHint'), 'info'); },
  };
  const chapterContentAreaProps = {
    loading, streamText: draftCtrl.streamText, isGenerating: generation.isGenerating, isViewingHistory: confirmedEditor.isViewingHistory,
    viewingHistoryContent: confirmedEditor.viewingHistoryContent, viewingHistoryNum: confirmedEditor.viewingHistoryNum, editingConfirmed: confirmedEditor.editingConfirmed,
    editingContent: confirmedEditor.editingContent, editingOriginalContent: confirmedEditor.editingOriginalContent, savingEdit: confirmedEditor.savingEdit,
    onEditingContentChange: confirmedEditor.setEditingContent, onSaveEdit: confirmedEditor.saveEditingConfirmed, onCancelEdit: confirmedEditor.cancelEditingConfirmed,
    currentDraft: displayState.currentDraft, onDraftChange: draftCtrl.handleCurrentDraftChange, displayContent,
    generationErrorDisplay: generation.generationErrorDisplay, onDismissError: generation.dismissError, onNavigate, fontSize, lineHeight,
  };
  const footerProps = {
    footerCollapsed: chrome.footerCollapsed, onToggleCollapsed: chrome.toggleFooterCollapsed, isGenerating: generation.isGenerating,
    writeActionsDisabled: displayState.writeActionsDisabled, isSettingsModeBusy, isDiscarding: chapterActions.isDiscarding, currentChapter: displayState.currentChapter,
    instructionText: instructionInput.instructionText, onInstructionTextChange: instructionInput.setInstructionText, instructionInputRef: instructionInput.instructionInputRef,
    onGenerate: (type: 'instruction' | 'continue') => { void generation.handleGenerateFromInput(type); },
    drafts: draftCtrl.drafts, activeDraftIndex: draftCtrl.activeDraftIndex, onSelectDraft: draftCtrl.selectDraft, currentDraft: displayState.currentDraft,
    hasPendingDrafts: displayState.hasPendingDrafts, currentDraftMeta: displayState.currentDraftMeta, onOpenFinalize: chrome.openFinalizeConfirm,
    onRegenerate: () => { void generation.handleRegenerate(); }, onOpenDiscard: chrome.openDiscardConfirm, onOpenUndo: chrome.openUndoConfirm,
    onNavigateFacts: () => onNavigate('facts'), onOpenMobileTools: chrome.openMobileTools, onBlockedToast: () => showToast(t('drafts.generatingBlocked'), 'warning'),
  };
  const sidePanelProps = {
    mode, unresolvedFacts, focusSelection: focusController.focusSelection, onFocusToggle: focusController.handleFocusToggle,
    onClearFocus: focusController.handleClearFocus, onContinueLastFocus: focusController.handleContinueLastFocus, lastConfirmedFocus,
    budgetReport: draftCtrl.budgetReport, contextLayers: displayState.contextLayers, layerSum: displayState.layerSum,
    sessionModel: sessionParams.sessionModel, onModelChange: sessionParams.setSessionModel, sessionTemp: sessionParams.sessionTemp, onTempChange: sessionParams.setSessionTemp,
    sessionTopP: sessionParams.sessionTopP, onTopPChange: sessionParams.setSessionTopP, onSaveGlobal: sessionParams.handleSaveGlobalParams, onSaveAu: sessionParams.handleSaveAuParams,
    fontSize, onFontSizeChange: setFontSize, lineHeight, onLineHeightChange: setLineHeight, onNavigate,
  };
  const modalProps = {
    isFinalizeConfirmOpen: chrome.isFinalizeConfirmOpen, onCloseFinalizeConfirm: chrome.closeFinalizeConfirm, currentChapter: displayState.currentChapter,
    chapterTitle: chrome.chapterTitle, onChapterTitleChange: chrome.setChapterTitle, previewText: displayState.previewText,
    onConfirmFinalize: () => void chapterActions.handleConfirm(), isFinalizing: chapterActions.isFinalizing, hasDraft: displayState.currentDraft !== null,
    isDiscardConfirmOpen: chrome.isDiscardConfirmOpen, onCloseDiscardConfirm: chrome.closeDiscardConfirm, draftsCount: draftCtrl.drafts.length,
    onDiscardDrafts: () => void chapterActions.handleDiscardDrafts(), isDiscarding: chapterActions.isDiscarding,
    isFactsPromptOpen: factsExtraction.isFactsPromptOpen, onCloseFactsPrompt: factsExtraction.handleSkipFactsPrompt, extractingFacts: factsExtraction.extractingFacts, skipFactsPrompt: factsExtraction.skipFactsPrompt,
    factsPromptTitle: t('drafts.finalizeSuccess', { chapter: finalizedChapter }), onOpenExtractReview: () => void factsExtraction.handleOpenExtractReview(),
    onFactsManualNavigate: () => { factsExtraction.setFactsPromptOpen(false); onNavigate('facts'); }, onSkipFactsPrompt: factsExtraction.handleSkipFactsPrompt, onFactsPromptToggle: factsExtraction.handleFactsPromptToggle,
    isExtractReviewOpen: factsExtraction.isExtractReviewOpen, onCloseExtractReview: () => { factsExtraction.setExtractReviewOpen(false); instructionInput.focusInstructionInput(); },
    extractedCandidates: factsExtraction.extractedCandidates, selectedExtractedKeys: factsExtraction.selectedExtractedKeys, getCandidateKey: factsExtraction.getCandidateKey,
    onToggleExtractedCandidate: factsExtraction.toggleExtractedCandidate, onSaveExtracted: () => void factsExtraction.handleSaveExtracted(), savingExtracted: factsExtraction.savingExtracted,
    isUndoConfirmOpen: chrome.isUndoConfirmOpen, onCloseUndoConfirm: chrome.closeUndoConfirm, undoChapterNum: displayState.currentChapter - 1, onConfirmUndo: chapterActions.handleUndoConfirmed,
  };

  return (
    <>
      <main className="relative flex h-full min-w-0 flex-1 flex-col bg-background transition-colors duration-200">
        {!chrome.dirtyBannerDismissed && dirtyChapters.length > 0 && (
          <InlineBanner
            tone="warning"
            layout="bar"
            compact
            message={t('dirty.banner', { count: dirtyChapters.length, chapters: dirtyChapters.join(', ') })}
            actions={<><Button tone="neutral" fill="plain" size="sm" className="h-11 text-xs md:h-6" onClick={() => chrome.openDirty(dirtyChapterNum)}>{t('dirty.goResolve')}</Button><Button tone="neutral" fill="plain" size="sm" className="h-11 text-xs text-text/50 md:h-6" onClick={chrome.dismissDirtyBanner}>{t('dirty.dismissBanner')}</Button></>}
          />
        )}
        <WriterHeader {...headerProps} />
        <div className={mode === 'write' ? 'flex flex-1 flex-col min-h-0' : 'hidden'}>
          <div className="flex flex-1 justify-center overflow-y-auto w-full pb-16 md:pb-12">
            <div className="w-full max-w-[720px] space-y-6 px-4 py-4 md:px-8 md:py-10">
              {confirmedEditor.isViewingHistory && (
                <InlineBanner
                  tone="info"
                  message={<>{t('workspace.chapterItem', { num: confirmedEditor.viewingHistoryNum })} 鈥?{t('writer.viewingHistory')}</>}
                  actions={<><Button tone="neutral" fill="plain" size="sm" onClick={confirmedEditor.startEditingConfirmed} disabled={confirmedEditor.editingConfirmed}>{t('writer.editChapter')}</Button><Button tone="neutral" fill="plain" size="sm" onClick={confirmedEditor.clearHistoryView}>{t('writer.backToCurrentChapter')}</Button></>}
                />
              )}
              {draftCtrl.recoveryNotice && displayState.hasPendingDrafts && <InlineBanner tone="warning" message={t('drafts.recoveryNotice')} />}
              <ChapterContentArea {...chapterContentAreaProps} />
              <ContextSummaryBar summary={displayState.currentDraftSummary} onAdjustCoreIncludes={() => onNavigate('settings')} />
            </div>
          </div>
          <WriterFooter {...footerProps} />
        </div>
        <div className={mode === 'settings' ? 'hidden min-h-0 flex-1 flex-col md:flex' : 'hidden'}>
          <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col px-6 py-6">
            {showSettingsTooltip ? (
              <InlineBanner
                className="mb-4"
                tone="info"
                message={t('settingsMode.firstTimeTooltip')}
                actions={<Button tone="neutral" fill="plain" size="sm" className="h-7 px-2 text-info" onClick={closeSettingsTooltip}>{t('common.actions.close')}</Button>}
              />
            ) : null}
            <SettingsChatPanel
              mode="au"
              basePath={auPath}
              fandomPath={displayState.settingsFandomPath}
              placeholder={t('settingsMode.placeholder')}
              currentChapter={displayState.currentChapter}
              sessionLlm={sessionParams.sessionLlmPayload}
              disabled={loading || !state}
              onBusyChange={setIsSettingsModeBusy}
              onAfterMutation={async () => { await refreshSettingsModeData(); }}
              className="min-h-0 flex-1"
            />
          </div>
        </div>
      </main>
      <WriterToolPanels sidePanelProps={sidePanelProps} rightCollapsed={chrome.rightCollapsed} onToggleRightCollapsed={chrome.toggleRightCollapsed} mobileToolsOpen={chrome.mobileToolsOpen} onCloseMobileTools={chrome.closeMobileTools} onOpenUndo={chrome.openUndoConfirm} onOpenExport={chrome.openExport} currentChapter={displayState.currentChapter} writeActionsDisabled={displayState.writeActionsDisabled} mobileToolsTitle={t('common.actions.more')} />
      <WriterModals {...modalProps} />
      <ExportModal isOpen={chrome.isExportOpen} onClose={chrome.closeExport} auPath={auPath} />
      <DirtyModal isOpen={chrome.isDirtyOpen} onClose={chrome.closeDirty} auPath={auPath} chapterNum={chrome.dirtyTargetChapter} onResolved={() => { chrome.closeDirty(); void loadData(); }} />
    </>
  );
};
