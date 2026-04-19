// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useCallback, useRef } from 'react';
import { useKV } from '../../hooks/useKV';
import {
  type GenerateRequestState,
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
import { useWriterChapterActions } from './useWriterChapterActions';
import { useWriterGeneration } from './useWriterGeneration';
import { deriveWriterDisplayState } from './writerDisplayState';
import { WriterToolPanels } from './WriterToolPanels';
import { Button } from '../shared/Button';
import { ExportModal } from './ExportModal';
import { DirtyModal } from './DirtyModal';
import { ContextSummaryBar } from './ContextSummaryBar';
import { ChapterContentArea } from './ChapterContentArea';
import { WriterModals } from './WriterModals';
import { WriterHeader } from './WriterHeader';
import { WriterFooter } from './WriterFooter';
import { SettingsChatPanel } from '../shared/settings-chat/SettingsChatPanel';
import { InlineBanner } from '../shared/InlineBanner';

import { type DraftGeneratedWith } from '../../api/engine-client';
import { type StateInfo } from '../../api/engine-client';
import { type FactInfo } from '../../api/engine-client';
import { type ContextSummary } from '../../api/engine-client';
import { type WriterSessionConfig } from '../../api/engine-client';
import { type WriterProjectContext } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';

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

  // 缂栬緫宸茬‘璁ょ珷鑺傦紙FIX-006锛?

  // 闃呰鍋忓ソ锛堣法骞冲彴 KV 鎸佷箙鍖栵級
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



  // 鎸囦护鏂囨湰鎸佷箙鍖栵細鍙樺寲鏃惰嚜鍔ㄤ繚瀛樺埌 localStorage
  const currentChapterNum = state?.current_chapter ?? 0;
  const { instructionInputRef, focusInstructionInput } = useWriterInstructionInput({
    auPath,
    currentChapterNum,
    instructionText,
  });

  /** 绔嬪嵆鍐欏叆鎸傝捣鐨勮崏绋跨紪杈戯紝鐒跺悗娓呴櫎瀹氭椂鍣ㄣ€?*/
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

  const {
    handleConfirm,
    handleUndoConfirmed,
    handleDiscardDrafts,
  } = useWriterChapterActions({
    auPath,
    state,
    drafts,
    activeDraftIndex,
    chapterTitle,
    focusSelection,
    skipFactsPrompt: factsExtraction.skipFactsPrompt,
    setIsFinalizing,
    setIsDiscarding,
    loadGuard,
    clearDraftState,
    replaceDraftSummaries,
    loadData,
    focusInstructionInput,
    onChaptersChanged,
    onLastConfirmedChapter: setLastConfirmedChapter,
    onCloseFinalizeConfirm: closeFinalizeConfirm,
    onCloseDiscardConfirm: closeDiscardConfirm,
    onCloseUndoConfirm: closeUndoConfirm,
    onOpenFactsPrompt: () => factsExtraction.setFactsPromptOpen(true),
    showSuccess,
    showToast,
    showError,
    t,
  });

  const {
    handleGenerateFromInput,
    handleRegenerate,
  } = useWriterGeneration({
    auPath,
    state,
    drafts,
    instructionText,
    lastGenerateRequest,
    isGenerating,
    projectInfo,
    settingsInfo,
    sessionLlmPayload: sessionParams.sessionLlmPayload,
    sessionTemp: sessionParams.sessionTemp,
    sessionTopP: sessionParams.sessionTopP,
    generateGuard,
    pendingContextSummaryRef,
    loadDraftByLabel,
    mergeDraftIntoState,
    attachDraftSummary,
    setIsGenerating,
    setStreamText,
    setGeneratedWith,
    setBudgetReport,
    setRecoveryNotice,
    setGenerationErrorDisplay,
    setLastGenerateRequest,
    showError,
    showToast,
    t,
  });
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
                  message={<>{t('workspace.chapterItem', { num: viewingHistoryNum })} 鈥?{t('writer.viewingHistory')}</>}
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

      <WriterToolPanels
        sidePanelProps={sharedSidePanelProps}
        rightCollapsed={rightCollapsed}
        onToggleRightCollapsed={toggleRightCollapsed}
        mobileToolsOpen={mobileToolsOpen}
        onCloseMobileTools={closeMobileTools}
        onOpenUndo={openUndoConfirm}
        onOpenExport={openExport}
        currentChapter={currentChapter}
        writeActionsDisabled={writeActionsDisabled}
        mobileToolsTitle={t('common.actions.more')}
      />

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


