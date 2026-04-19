// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useKV } from '../../hooks/useKV';
import {
  type GenerateRequestState,
  normalizeContextSummary,
  saveContextSummaries,
  saveGenerateRequest,
  saveInstructionText,
  hasSeenSettingsModeTooltip,
  markSettingsModeTooltipSeen,
} from '../../utils/writerStorage';
import { useWriterFactsExtraction } from './useWriterFactsExtraction';
import { useSessionParams } from './useSessionParams';
import { useConfirmedChapterEditor } from './useConfirmedChapterEditor';
import { useWriterBootstrap } from './useWriterBootstrap';
import { useWriterResetOnAuChange } from './useWriterResetOnAuChange';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';
import { ExportModal } from './ExportModal';
import { DirtyModal } from './DirtyModal';
import { ContextSummaryBar } from './ContextSummaryBar';
import { ChapterContentArea } from './ChapterContentArea';
import { WriterSidePanelContent } from './WriterSidePanelContent';
import { WriterModals } from './WriterModals';
import { WriterHeader, type WriterMode } from './WriterHeader';
import { WriterFooter } from './WriterFooter';
import { Sidebar } from '../shared/Sidebar';
import { SettingsChatPanel } from '../shared/settings-chat/SettingsChatPanel';
import { InlineBanner } from '../shared/InlineBanner';

import { confirmChapter, undoChapter } from '../../api/engine-client';
import { listDrafts, getDraft, saveDraft, deleteDrafts, type DraftDetail, type DraftGeneratedWith } from '../../api/engine-client';
import { setChapterFocus, type StateInfo } from '../../api/engine-client';
import { type FactInfo } from '../../api/engine-client';
import { generateChapter, type ContextSummary } from '../../api/engine-client';
import { type WriterSessionConfig } from '../../api/engine-client';
import { type WriterProjectContext } from '../../api/engine-client';
import { ApiError, getFriendlyErrorMessage } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';

type ContextLayer = {
  key: string;
  label: string;
  percent: number;
  tokens: number;
  color: string;
};

type DraftItem = {
  label: string;
  draftId: string;
  content: string;
  generatedWith?: DraftGeneratedWith | null;
  modified: boolean;
};

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

function createDraftItemFromDetail(chapterNum: number, detail: DraftDetail): DraftItem {
  return createDraftItem(
    chapterNum,
    detail.variant,
    detail.content,
    detail.generated_with || null
  );
}

function sortDrafts(drafts: DraftItem[]): DraftItem[] {
  return [...drafts].sort((left, right) => left.label.localeCompare(right.label));
}

// localStorage helpers 已抽取至 utils/writerStorage.ts

function formatGeneratedMeta(generatedWith?: DraftGeneratedWith | null, locale = 'zh-CN'): string {
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

function getPreviewText(content: string, maxChars = 200): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}…`;
}

export const WriterLayout = ({ auPath, onNavigate, viewChapter, onClearViewChapter, onChaptersChanged }: { auPath: string, onNavigate: (page: string) => void, viewChapter?: number | null, onClearViewChapter?: () => void, onChaptersChanged?: () => void }) => {
  const { t, i18n } = useTranslation();
  const { showError, showSuccess, showToast } = useFeedback();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const instructionInputRef = useRef<HTMLInputElement | null>(null);
  const loadGuard = useActiveRequestGuard(auPath);
  const refreshGuard = useActiveRequestGuard(auPath);
  const generateGuard = useActiveRequestGuard(auPath);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftSaveRef = useRef<{ auPath: string; chapterNum: number; label: string; content: string } | null>(null);
  const [mode, setMode] = useState<WriterMode>('write');
  const [showSettingsTooltip, setShowSettingsTooltip] = useState(false);
  const [isSettingsModeBusy, setIsSettingsModeBusy] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isExportOpen, setExportOpen] = useState(false);
  const [isDirtyOpen, setDirtyOpen] = useState(false);
  const [dirtyTargetChapter, setDirtyTargetChapter] = useState<number>(0);
  const [isFinalizeConfirmOpen, setFinalizeConfirmOpen] = useState(false);
  const [chapterTitle, setChapterTitle] = useState('');
  const [isDiscardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const [state, setState] = useState<StateInfo | null>(null);
  const [projectInfo, setProjectInfo] = useState<WriterProjectContext | null>(null);
  const [settingsInfo, setSettingsInfo] = useState<WriterSessionConfig | null>(null);
  const [currentContent, setCurrentContent] = useState('');
  const [unresolvedFacts, setUnresolvedFacts] = useState<FactInfo[]>([]);
  const [focusSelection, setFocusSelection] = useState<string[]>([]);
  const [isUndoConfirmOpen, setUndoConfirmOpen] = useState(false);
  const [dirtyBannerDismissed, setDirtyBannerDismissed] = useState(false);
  const [footerCollapsed, setFooterCollapsed] = useState(false);

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


  useEffect(() => {
    if (isMobile && mode !== 'write') {
      setMode('write');
      setShowSettingsTooltip(false);
    }
  }, [isMobile, mode]);

  // 指令文本持久化：变化时自动保存到 localStorage
  const instructionSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentChapterNum = state?.current_chapter ?? 0;
  useEffect(() => {
    if (!currentChapterNum) return;
    if (instructionSaveRef.current) clearTimeout(instructionSaveRef.current);
    instructionSaveRef.current = setTimeout(() => {
      saveInstructionText(auPath, currentChapterNum, instructionText);
      instructionSaveRef.current = null;
    }, 500);
    return () => {
      // cleanup 时 flush：localStorage 是同步的，直接写入
      if (instructionSaveRef.current) {
        clearTimeout(instructionSaveRef.current);
        instructionSaveRef.current = null;
        saveInstructionText(auPath, currentChapterNum, instructionText);
      }
    };
  }, [instructionText, auPath, currentChapterNum]);

  const focusInstructionInput = () => {
    window.setTimeout(() => {
      instructionInputRef.current?.focus();
    }, 0);
  };

  /** 立即写入挂起的草稿编辑，然后清除定时器。 */
  const flushPendingDraftSave = (discard = false) => {
    if (draftSaveTimerRef.current) { clearTimeout(draftSaveTimerRef.current); draftSaveTimerRef.current = null; }
    const pending = pendingDraftSaveRef.current;
    if (pending && !discard) {
      saveDraft(pending.auPath, pending.chapterNum, pending.label, pending.content).catch(() => {});
    }
    pendingDraftSaveRef.current = null;
  };

  const clearDraftState = (discard = false) => {
    setDrafts([]);
    setActiveDraftIndex(0);
    setStreamText('');
    setGeneratedWith(null);
    setBudgetReport(null);
    setRecoveryNotice(false);
    setDraftSummaries({});
    pendingContextSummaryRef.current = null;
    flushPendingDraftSave(discard);
  };

  const replaceDraftSummaries = useCallback((chapterNum: number, summaries: Record<string, ContextSummary>) => {
    setDraftSummaries(summaries);
    saveContextSummaries(auPath, chapterNum, summaries);
  }, [auPath]);

  const attachDraftSummary = useCallback((chapterNum: number, label: string, summary: ContextSummary) => {
    setDraftSummaries((current) => {
      const next = {
        ...current,
        [label]: summary,
      };
      saveContextSummaries(auPath, chapterNum, next);
      return next;
    });
  }, [auPath]);

  const mergeDraftIntoState = useCallback((draft: DraftItem) => {
    setDrafts((current) => {
      const merged = sortDrafts([
        ...current.filter((item) => item.label !== draft.label),
        draft,
      ]);
      const nextIndex = merged.findIndex((item) => item.label === draft.label);
      setActiveDraftIndex(nextIndex >= 0 ? nextIndex : Math.max(merged.length - 1, 0));
      return merged;
    });
  }, []);

  const loadDraftByLabel = useCallback(async (
    chapterNum: number,
    label: string,
    fallbackContent = '',
    fallbackGeneratedWith?: DraftGeneratedWith | null
  ): Promise<DraftItem> => {
    try {
      const detail = await getDraft(auPath, chapterNum, label);
      return createDraftItemFromDetail(chapterNum, detail);
    } catch {
      return createDraftItem(chapterNum, label, fallbackContent, fallbackGeneratedWith || null);
    }
  }, [auPath]);

  const loadDraftsForChapter = useCallback(async (chapterNum: number): Promise<DraftItem[]> => {
    const list = await listDrafts(auPath, chapterNum);
    if (list.length === 0) return [];

    const details = await Promise.all(
      list.map((draft) => getDraft(auPath, chapterNum, draft.draft_label))
    );

    return sortDrafts(
      details.map((detail) => createDraftItemFromDetail(chapterNum, detail))
    );
  }, [auPath]);

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

  const handleFocusToggle = async (factId: string) => {
    const requestAuPath = auPath;
    let next: string[];
    if (focusSelection.includes(factId)) {
      next = focusSelection.filter(id => id !== factId);
    } else {
      if (focusSelection.length >= 2) {
        showToast(t('focus.maxTwo'), 'warning');
        return;
      }
      next = [...focusSelection, factId];
    }
    try {
      await setChapterFocus(auPath, next);
      if (loadGuard.isKeyStale(requestAuPath)) return;
      setFocusSelection(next);
      showToast(t('writer.focusSaved'), 'success');
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    }
  };

  const handleClearFocus = async () => {
    const requestAuPath = auPath;
    try {
      await setChapterFocus(auPath, []);
      if (loadGuard.isKeyStale(requestAuPath)) return;
      setFocusSelection([]);
      showToast(t('writer.focusSaved'), 'success');
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    }
  };

  const handleContinueLastFocus = async () => {
    const requestAuPath = auPath;
    const lastFocus = state?.last_confirmed_chapter_focus || [];
    const validIds = lastFocus.filter(id => unresolvedFacts.some(f => String(f.id) === id));
    if (validIds.length === 0) {
      showToast(t('focus.lastFocusExpired'), 'warning');
      return;
    }
    try {
      await setChapterFocus(auPath, validIds);
      if (loadGuard.isKeyStale(requestAuPath)) return;
      setFocusSelection(validIds);
      showToast(t('writer.focusSaved'), 'success');
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    }
  };

  const handleCurrentDraftChange = (content: string) => {
    setDrafts((current) =>
      current.map((draft, index) =>
        index === activeDraftIndex
          ? {
              ...draft,
              content,
              modified: true,
            }
          : draft
      )
    );

    // debounced auto-save：编辑 1.5s 后自动保存到磁盘
    const label = drafts[activeDraftIndex]?.label;
    const chapterNum = state?.current_chapter || 1;
    if (!label) return;
    pendingDraftSaveRef.current = { auPath, chapterNum, label, content };
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      saveDraft(auPath, chapterNum, label, content).catch(() => {});
      pendingDraftSaveRef.current = null;
    }, 1500);
  };

  // 组件卸载时 flush 未保存的编辑
  useEffect(() => () => flushPendingDraftSave(), []);

  const handleModeChange = (nextMode: WriterMode) => {
    if (nextMode === 'write' && isSettingsModeBusy) {
      showToast(t('settingsMode.busyWriteBlocked'), 'warning');
      return;
    }
    setMode(nextMode);
    if (nextMode === 'settings' && !hasSeenSettingsModeTooltip()) {
      setShowSettingsTooltip(true);
      markSettingsModeTooltipSeen();
      return;
    }
    if (nextMode !== 'settings') {
      setShowSettingsTooltip(false);
    }
  };

  const currentChapter = state?.current_chapter || 1;
  const hasPendingDrafts = drafts.length > 0;
  const writeActionsDisabled = isGenerating || isFinalizing || isDiscarding || isSettingsModeBusy;
  const currentDraft = drafts[activeDraftIndex] || null;
  const settingsSessionLlm = sessionParams.sessionLlmPayload;
  const fandomPathParts = auPath.split('/aus/');
  const settingsFandomPath = fandomPathParts.length >= 2 ? fandomPathParts[0] : auPath;
  const currentDraftSummary = !isGenerating && currentDraft ? draftSummaries[currentDraft.label] || null : null;
  const activeGeneratedWith = currentDraft?.generatedWith || generatedWith;
  const fallbackDisplayContent = streamText || currentDraft?.content || currentContent;
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
  const metaModel = activeGeneratedWith?.model || sessionParams.sessionModel;
  const metaChars = activeGeneratedWith?.char_count || displayContent.length;
  const metaDuration = activeGeneratedWith?.duration_ms
    ? `${(activeGeneratedWith.duration_ms / 1000).toFixed(1)}s`
    : t('writer.metaDurationUnknown');
  const currentDraftMeta = formatGeneratedMeta(
    currentDraft?.generatedWith,
    i18n.resolvedLanguage === 'en' ? 'en-US' : 'zh-CN'
  );
  const previewText = currentDraft ? getPreviewText(currentDraft.content) : '';

  const _layerSum = budgetReport ? (budgetReport.system_tokens || 0) + (budgetReport.p1_tokens || 0) + (budgetReport.p2_tokens || 0) + (budgetReport.p3_tokens || 0) + (budgetReport.p4_tokens || 0) + (budgetReport.p5_tokens || 0) : 1;
  const _pct = (tokens: number | undefined) => budgetReport && tokens ? Math.max(1, Math.round((tokens / (_layerSum || 1)) * 100)) : 0;
  const contextLayers: ContextLayer[] = budgetReport ? [
    { key: 'pinned', label: t('writer.memoryLayer.pinned'), percent: _pct(budgetReport.system_tokens), tokens: budgetReport.system_tokens || 0, color: 'bg-error/70' },
    ...((budgetReport.p2_tokens || 0) > 0 ? [{ key: 'recent', label: t('writer.memoryLayer.recentChapter'), percent: _pct(budgetReport.p2_tokens), tokens: budgetReport.p2_tokens || 0, color: 'bg-info/70' }] : []),
    ...((budgetReport.p3_tokens || 0) > 0 ? [{ key: 'facts', label: t('writer.memoryLayer.facts'), percent: _pct(budgetReport.p3_tokens), tokens: budgetReport.p3_tokens || 0, color: 'bg-accent/70' }] : []),
    ...((budgetReport.p4_tokens || 0) > 0 ? [{ key: 'rag', label: t('writer.memoryLayer.rag'), percent: _pct(budgetReport.p4_tokens), tokens: budgetReport.p4_tokens || 0, color: 'bg-success/70' }] : []),
    ...((budgetReport.p5_tokens || 0) > 0 ? [{ key: 'settings', label: t('writer.memoryLayer.characterSettings'), percent: _pct(budgetReport.p5_tokens), tokens: budgetReport.p5_tokens || 0, color: 'bg-warning/70' }] : []),
  ] : [];

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
                <Button tone="neutral" fill="plain" size="sm" className="h-11 text-xs md:h-6" onClick={() => { setDirtyTargetChapter((state?.chapters_dirty || [])[0] || 0); setDirtyOpen(true); }}>{t('dirty.goResolve')}</Button>
                <Button tone="neutral" fill="plain" size="sm" className="h-11 text-xs text-text/50 md:h-6" onClick={() => setDirtyBannerDismissed(true)}>{t('dirty.dismissBanner')}</Button>
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
            setDirtyTargetChapter((state?.chapters_dirty || [])[0] || 0);
            showToast(t('writer.dirtyOpenHint'), 'info');
            setDirtyOpen(true);
          }}
          onOpenExport={() => setExportOpen(true)}
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
            onToggleCollapsed={() => setFooterCollapsed(prev => !prev)}
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
            onOpenFinalize={() => { setChapterTitle(''); setFinalizeConfirmOpen(true); }}
            onRegenerate={() => { void handleRegenerate(); }}
            onOpenDiscard={() => setDiscardConfirmOpen(true)}
            onOpenUndo={() => setUndoConfirmOpen(true)}
            onNavigateFacts={() => onNavigate('facts')}
            onOpenMobileTools={() => setMobileToolsOpen(true)}
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
                  <Button tone="neutral" fill="plain" size="sm" className="h-7 px-2 text-info" onClick={() => setShowSettingsTooltip(false)}>
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

      <Sidebar position="right" width="320px" isCollapsed={rightCollapsed} onToggle={() => setRightCollapsed(!rightCollapsed)} className="hidden flex-col bg-surface/50 border-l border-black/10 dark:border-white/10 md:flex">
        <WriterSidePanelContent
          isMobile={false}
          mode={mode}
          unresolvedFacts={unresolvedFacts}
          focusSelection={focusSelection}
          onFocusToggle={handleFocusToggle}
          onClearFocus={handleClearFocus}
          onContinueLastFocus={handleContinueLastFocus}
          lastConfirmedFocus={state?.last_confirmed_chapter_focus || []}
          budgetReport={budgetReport}
          contextLayers={contextLayers}
          layerSum={_layerSum}
          sessionModel={sessionParams.sessionModel}
          onModelChange={sessionParams.setSessionModel}
          sessionTemp={sessionParams.sessionTemp}
          onTempChange={sessionParams.setSessionTemp}
          sessionTopP={sessionParams.sessionTopP}
          onTopPChange={sessionParams.setSessionTopP}
          onSaveGlobal={sessionParams.handleSaveGlobalParams}
          onSaveAu={sessionParams.handleSaveAuParams}
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
          lineHeight={lineHeight}
          onLineHeightChange={setLineHeight}
          onNavigate={onNavigate}
        />
      </Sidebar>

      <Modal isOpen={mobileToolsOpen} onClose={() => setMobileToolsOpen(false)} title={t('common.actions.more')}>
        <WriterSidePanelContent
          isMobile={true}
          onClose={() => setMobileToolsOpen(false)}
          onUndoClick={() => { setMobileToolsOpen(false); setUndoConfirmOpen(true); }}
          onExportClick={() => { setMobileToolsOpen(false); setExportOpen(true); }}
          currentChapter={currentChapter}
          writeActionsDisabled={writeActionsDisabled}
          mode={mode}
          unresolvedFacts={unresolvedFacts}
          focusSelection={focusSelection}
          onFocusToggle={handleFocusToggle}
          onClearFocus={handleClearFocus}
          onContinueLastFocus={handleContinueLastFocus}
          lastConfirmedFocus={state?.last_confirmed_chapter_focus || []}
          budgetReport={budgetReport}
          contextLayers={contextLayers}
          layerSum={_layerSum}
          sessionModel={sessionParams.sessionModel}
          onModelChange={sessionParams.setSessionModel}
          sessionTemp={sessionParams.sessionTemp}
          onTempChange={sessionParams.setSessionTemp}
          sessionTopP={sessionParams.sessionTopP}
          onTopPChange={sessionParams.setSessionTopP}
          onSaveGlobal={sessionParams.handleSaveGlobalParams}
          onSaveAu={sessionParams.handleSaveAuParams}
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
          lineHeight={lineHeight}
          onLineHeightChange={setLineHeight}
          onNavigate={onNavigate}
        />
      </Modal>

      <WriterModals
        isFinalizeConfirmOpen={isFinalizeConfirmOpen}
        onCloseFinalizeConfirm={() => setFinalizeConfirmOpen(false)}
        currentChapter={currentChapter}
        chapterTitle={chapterTitle}
        onChapterTitleChange={setChapterTitle}
        previewText={previewText}
        onConfirmFinalize={() => void handleConfirm()}
        isFinalizing={isFinalizing}
        hasDraft={currentDraft !== null}
        isDiscardConfirmOpen={isDiscardConfirmOpen}
        onCloseDiscardConfirm={() => setDiscardConfirmOpen(false)}
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
        onCloseUndoConfirm={() => setUndoConfirmOpen(false)}
        undoChapterNum={currentChapter - 1}
        onConfirmUndo={handleUndoConfirmed}
      />

      <ExportModal isOpen={isExportOpen} onClose={() => setExportOpen(false)} auPath={auPath} />
      <DirtyModal
        isOpen={isDirtyOpen}
        onClose={() => setDirtyOpen(false)}
        auPath={auPath}
        chapterNum={dirtyTargetChapter}
        onResolved={() => {
          setDirtyOpen(false);
          void loadData();
        }}
      />
    </>
  );
};
