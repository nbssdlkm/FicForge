// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useKV } from '../../hooks/useKV';
import {
  type GenerateRequestState,
  normalizeContextSummary,
  readSavedContextSummaries,
  saveContextSummaries,
  readSavedGenerateRequest,
  saveGenerateRequest,
  hasSeenSettingsModeTooltip,
  markSettingsModeTooltipSeen,
} from '../../utils/writerStorage';
import { useWriterFactsExtraction } from './useWriterFactsExtraction';
import { useSessionParams } from './useSessionParams';
import { ThemeToggle } from '../shared/ThemeToggle';
import { Button } from '../shared/Button';
import { Tag } from '../shared/Tag';
import { Modal } from '../shared/Modal';
import { Textarea } from '../shared/Input';
import {
  Undo2,
  Check,
  FileUp,
  AlertCircle,
  Loader2,
  BookOpen,
  RefreshCw,
  Trash2,
  ChevronsDown,
  ChevronsUp,
} from 'lucide-react';
import { ExportModal } from './ExportModal';
import { DirtyModal } from './DirtyModal';
import { ContextSummaryBar } from './ContextSummaryBar';
import { ChapterContentArea } from './ChapterContentArea';
import { WriterSidePanelContent } from './WriterSidePanelContent';
import { WriterModals } from './WriterModals';
import { DraftNavigator } from './DraftNavigator';
import { Sidebar } from '../shared/Sidebar';
import { SettingsChatPanel } from '../shared/settings-chat/SettingsChatPanel';

import { getChapterContent, confirmChapter, undoChapter, updateChapterContent } from '../../api/engine-client';
import { listDrafts, getDraft, deleteDrafts, type DraftDetail, type DraftGeneratedWith } from '../../api/engine-client';
import { getState, setChapterFocus, type StateInfo } from '../../api/engine-client';
import { listFacts, type FactInfo } from '../../api/engine-client';
import { generateChapter, type ContextSummary } from '../../api/engine-client';
import { getSettings, type SettingsInfo } from '../../api/engine-client';
import { getProject, type ProjectInfo } from '../../api/engine-client';
import { ApiError, getFriendlyErrorMessage } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import { useMediaQuery } from '../../hooks/useMediaQuery';

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
const MAX_RECOMMENDED_DRAFTS = 5;

type WriterMode = 'write' | 'settings';

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
  const activeAuPathRef = useRef(auPath);
  const loadRequestIdRef = useRef(0);
  const refreshRequestIdRef = useRef(0);
  activeAuPathRef.current = auPath;
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
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [settingsInfo, setSettingsInfo] = useState<SettingsInfo | null>(null);
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
  const [viewingHistoryContent, setViewingHistoryContent] = useState<string | null>(null);
  const [viewingHistoryNum, setViewingHistoryNum] = useState<number | null>(null);
  const [draftSummaries, setDraftSummaries] = useState<Record<string, ContextSummary>>({});
  const pendingContextSummaryRef = useRef<ContextSummary | null>(null);

  const [loading, setLoading] = useState(true);
  const [instructionText, setInstructionText] = useState('');

  const factsExtraction = useWriterFactsExtraction(auPath, lastConfirmedChapter);
  const sessionParams = useSessionParams(auPath, projectInfo, settingsInfo, showSuccess, showError);

  // 编辑已确认章节（FIX-006）
  const [editingConfirmed, setEditingConfirmed] = useState(false);
  const [editingContent, setEditingContent] = useState('');
  const [editingOriginalContent, setEditingOriginalContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // 阅读偏好（跨平台 KV 持久化）
  const [fontSizeStr, setFontSizeKV] = useKV('ficforge.fontSize', '18');
  const fontSize = parseInt(fontSizeStr, 10) || 18;
  const setFontSize = useCallback((v: number) => setFontSizeKV(String(v)), [setFontSizeKV]);
  const [lineHeightStr, setLineHeightKV] = useKV('ficforge.lineHeight', '2.0');
  const lineHeight = parseFloat(lineHeightStr) || 2.0;
  const setLineHeight = useCallback((v: number) => setLineHeightKV(String(v)), [setLineHeightKV]);

  // 查看历史章节
  useEffect(() => {
    // 切换章节时重置编辑状态
    setEditingConfirmed(false);
    setEditingContent('');
    setEditingOriginalContent('');

    if (!viewChapter || !state) return;
    // 如果点击的是当前正在写的章节，清除查看状态
    if (viewChapter >= state.current_chapter) {
      setViewingHistoryContent(null);
      setViewingHistoryNum(null);
      return;
    }
    let cancelled = false;
    getChapterContent(auPath, viewChapter).then((result: any) => {
      if (cancelled) return;
      const text = typeof result === 'string' ? result : result?.content || '';
      setViewingHistoryContent(text);
      setViewingHistoryNum(viewChapter);
    }).catch(() => {
      if (cancelled) return;
      setViewingHistoryContent(null);
      setViewingHistoryNum(null);
    });
    return () => { cancelled = true; };
  }, [viewChapter, auPath, state]);

  useEffect(() => {
    activeAuPathRef.current = auPath;
    loadRequestIdRef.current += 1;
    refreshRequestIdRef.current += 1;
    setLoading(true);
    setIsSettingsModeBusy(false);
    setState(null);
    setProjectInfo(null);
    setSettingsInfo(null);
    setCurrentContent('');
    setUnresolvedFacts([]);
    setFocusSelection([]);
    setDrafts([]);
    setActiveDraftIndex(0);
    setRecoveryNotice(false);
    setLastConfirmedChapter(null);
    setUndoConfirmOpen(false);
    setDirtyBannerDismissed(false);
    setIsGenerating(false);
    setIsFinalizing(false);
    setIsDiscarding(false);
    factsExtraction.setExtractingFacts(false);
    factsExtraction.setSavingExtracted(false);
    setStreamText('');
    setGeneratedWith(null);
    setBudgetReport(null);
    setLastGenerateRequest(null);
    setDraftSummaries({});
    pendingContextSummaryRef.current = null;
    setInstructionText('');
    factsExtraction.setExtractedCandidates([]);
    factsExtraction.clearSelection();
    setFinalizeConfirmOpen(false);
    setDiscardConfirmOpen(false);
    factsExtraction.setFactsPromptOpen(false);
    factsExtraction.setExtractReviewOpen(false);
    setDirtyOpen(false);
    setExportOpen(false);
    setMobileToolsOpen(false);
  }, [auPath]);

  useEffect(() => {
    if (isMobile && mode !== 'write') {
      setMode('write');
      setShowSettingsTooltip(false);
    }
  }, [isMobile, mode]);

  const focusInstructionInput = () => {
    window.setTimeout(() => {
      instructionInputRef.current?.focus();
    }, 0);
  };

  const clearDraftState = () => {
    setDrafts([]);
    setActiveDraftIndex(0);
    setStreamText('');
    setGeneratedWith(null);
    setBudgetReport(null);
    setRecoveryNotice(false);
    setDraftSummaries({});
    pendingContextSummaryRef.current = null;
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

  const loadData = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    const requestAuPath = auPath;
    setLoading(true);
    try {
      const [stateData, factsData, proj, settings] = await Promise.all([
        getState(auPath).catch(() => null),
        listFacts(auPath, 'unresolved').catch(() => []),
        getProject(auPath).catch(() => null),
        getSettings().catch(() => null),
      ]);
      if (requestId !== loadRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;

      setState(stateData);
      setProjectInfo(proj);
      setSettingsInfo(settings);
      setUnresolvedFacts(factsData);
      setFocusSelection(stateData?.chapter_focus || []);

      let defModel = 'deepseek-chat';
      let defTemp = 1.0;
      let defTopP = 0.95;

      const globalConfiguredModel = sessionParams.getConfiguredLlmModel(settings?.default_llm as ProjectInfo['llm']);
      if (globalConfiguredModel) {
        defModel = globalConfiguredModel;
        const globalParams = settings?.model_params?.[defModel];
        if (globalParams) {
          defTemp = globalParams.temperature;
          defTopP = globalParams.top_p;
        }
      }

      const projectConfiguredModel = sessionParams.getConfiguredLlmModel(proj?.llm);
      if (projectConfiguredModel) {
        defModel = projectConfiguredModel;
      }
      if (proj?.model_params_override?.[defModel]) {
        const override = proj.model_params_override[defModel];
        defTemp = (override.temperature as number) ?? defTemp;
        defTopP = (override.top_p as number) ?? defTopP;
      }

      sessionParams.setSessionModel(defModel);
      sessionParams.setSessionTemp(defTemp);
      sessionParams.setSessionTopP(defTopP);

      if (stateData && stateData.current_chapter > 1) {
        const latestNum = stateData.current_chapter - 1;
        try {
          const content = await getChapterContent(auPath, latestNum);
          if (requestId !== loadRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;
          setCurrentContent(typeof content === 'string' ? content : '');
        } catch {
          if (requestId !== loadRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;
          setCurrentContent(t('writer.contentLoadFailed'));
        }
      } else {
        setCurrentContent('');
      }

      if (stateData) {
        const loadedDrafts = await loadDraftsForChapter(stateData.current_chapter);
        if (requestId !== loadRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;
        const storedSummaries = readSavedContextSummaries(auPath, stateData.current_chapter);
        const activeLabels = new Set(loadedDrafts.map((draft) => draft.label));
        const filteredSummaries = Object.entries(storedSummaries).reduce<Record<string, ContextSummary>>((accumulator, [label, summary]) => {
          if (activeLabels.has(label)) {
            accumulator[label] = summary;
          }
          return accumulator;
        }, {});

        setDrafts(loadedDrafts);
        setActiveDraftIndex(loadedDrafts.length > 0 ? loadedDrafts.length - 1 : 0);
        setRecoveryNotice(loadedDrafts.length > 0);
        setLastGenerateRequest(readSavedGenerateRequest(auPath, stateData.current_chapter));
        replaceDraftSummaries(stateData.current_chapter, filteredSummaries);
        pendingContextSummaryRef.current = null;
      } else {
        clearDraftState();
        setLastGenerateRequest(null);
        setProjectInfo(null);
      }
    } catch (error) {
      if (requestId !== loadRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (requestId === loadRequestIdRef.current && activeAuPathRef.current === requestAuPath) {
        setLoading(false);
      }
    }
  }, [auPath, loadDraftsForChapter, replaceDraftSummaries, showError, t]);

  const refreshSettingsModeData = useCallback(async () => {
    const requestId = ++refreshRequestIdRef.current;
    const requestAuPath = auPath;
    try {
      const [stateData, factsData, proj] = await Promise.all([
        getState(auPath).catch(() => null),
        listFacts(auPath, 'unresolved').catch(() => []),
        getProject(auPath).catch(() => null),
      ]);
      if (requestId !== refreshRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;

      if (stateData) {
        setState(stateData);
        setFocusSelection(stateData.chapter_focus || []);
      }
      setProjectInfo(proj);
      setUnresolvedFacts(factsData);
    } catch (error) {
      if (requestId !== refreshRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    }
  }, [auPath, showError, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleGenerate = useCallback(async (request: GenerateRequestState) => {
    if (isGenerating || !state) return;

    const projectLlmUsable = projectInfo?.llm?.mode && (projectInfo.llm.mode !== 'api' || projectInfo.llm.api_key);
    const effectiveLlm = projectLlmUsable ? projectInfo!.llm : settingsInfo?.default_llm;
    const llmMode = effectiveLlm?.mode || 'api';
    if (llmMode === 'api' && !effectiveLlm?.api_key) {
      showError(null, t('error_messages.no_api_key'));
      return;
    }

    const requestAuPath = auPath;

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
        if (activeAuPathRef.current !== requestAuPath) {
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
          if (activeAuPathRef.current !== requestAuPath) {
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
      if (activeAuPathRef.current !== requestAuPath) {
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
      // 避免 displayContent 在两者之间短暂为空
      requestAnimationFrame(() => setStreamText(''));
    } catch (error) {
      pendingContextSummaryRef.current = null;
      if (activeAuPathRef.current !== requestAuPath) return;
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
      if (activeAuPathRef.current === requestAuPath) {
        setIsGenerating(false);
      }
    }
  }, [attachDraftSummary, auPath, loadDraftByLabel, mergeDraftIntoState, sessionParams.sessionLlmPayload, sessionParams.sessionTemp, sessionParams.sessionTopP, showError, state, t]);

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
      if (activeAuPathRef.current !== requestAuPath) return;

      clearDraftState();
      replaceDraftSummaries(confirmedChapter, {});
      setFinalizeConfirmOpen(false);
      setLastConfirmedChapter(confirmedChapter);
      await loadData();
      onChaptersChanged?.();

      if (factsExtraction.skipFactsPrompt) {
        showSuccess(t('drafts.finalizeSuccess', { chapter: confirmedChapter }));
        focusInstructionInput();
        return;
      }

      factsExtraction.setFactsPromptOpen(true);
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setIsFinalizing(false);
      }
    }
  };

  const handleUndoConfirmed = async () => {
    const requestAuPath = auPath;
    setUndoConfirmOpen(false);
    try {
      await undoChapter(auPath);
      if (activeAuPathRef.current !== requestAuPath) return;
      clearDraftState();
      showSuccess(t('writer.undoSuccess'));
      await loadData();
      onChaptersChanged?.();
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
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
      if (activeAuPathRef.current !== requestAuPath) return;

      clearDraftState();
      replaceDraftSummaries(state.current_chapter, {});
      setDiscardConfirmOpen(false);
      if (isSingleDraft) {
        showToast(t('drafts.discardSuccess'), 'info');
      } else {
        showToast(t('drafts.discardAllSuccess'), 'info');
      }
      focusInstructionInput();
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setIsDiscarding(false);
      }
    }
  };

  // --- 编辑已确认章节（FIX-006）---
  const handleStartEditConfirmed = () => {
    if (!displayContent) return;
    setEditingOriginalContent(displayContent);
    setEditingContent(displayContent);
    setEditingConfirmed(true);
  };

  const handleCancelEditConfirmed = () => {
    setEditingConfirmed(false);
    setEditingContent('');
    setEditingOriginalContent('');
  };

  const handleSaveEditConfirmed = async () => {
    if (!viewingHistoryNum || !state) return;
    setSavingEdit(true);
    try {
      await updateChapterContent(auPath, viewingHistoryNum, editingContent);
      // 刷新状态以反映 dirty 标记
      const newState = await getState(auPath);
      setState(newState);
      // 刷新显示内容
      setViewingHistoryContent(editingContent);
      setEditingConfirmed(false);
      setEditingContent('');
      setEditingOriginalContent('');
      setDirtyBannerDismissed(false);
      showToast(t('writer.editSaveSuccess'), 'success');
    } catch (error) {
      showError(error, t('error_messages.unknown'));
    } finally {
      setSavingEdit(false);
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
      if (activeAuPathRef.current !== requestAuPath) return;
      setFocusSelection(next);
      showToast(t('writer.focusSaved'), 'success');
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    }
  };

  const handleClearFocus = async () => {
    const requestAuPath = auPath;
    try {
      await setChapterFocus(auPath, []);
      if (activeAuPathRef.current !== requestAuPath) return;
      setFocusSelection([]);
      showToast(t('writer.focusSaved'), 'success');
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
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
      if (activeAuPathRef.current !== requestAuPath) return;
      setFocusSelection(validIds);
      showToast(t('writer.focusSaved'), 'success');
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
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
  };

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
  const isViewingHistory = viewingHistoryContent !== null && viewingHistoryNum !== null;
  const displayContent = isViewingHistory ? viewingHistoryContent : (streamText || currentDraft?.content || currentContent);
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
        {/* Dirty banner (sub-task 2) */}
        {!dirtyBannerDismissed && (state?.chapters_dirty || []).length > 0 && (
          <div className="flex flex-col gap-2 border-b border-warning/20 bg-warning/10 px-4 py-2 text-xs md:flex-row md:items-center md:justify-between md:px-6">
            <span className="text-warning">{t('dirty.banner', { count: (state?.chapters_dirty || []).length, chapters: (state?.chapters_dirty || []).join(', ') })}</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-11 text-xs md:h-6" onClick={() => { setDirtyTargetChapter((state?.chapters_dirty || [])[0] || 0); setDirtyOpen(true); }}>{t('dirty.goResolve')}</Button>
              <Button variant="ghost" size="sm" className="h-11 text-xs text-text/40 md:h-6" onClick={() => setDirtyBannerDismissed(true)}>{t('dirty.dismissBanner')}</Button>
            </div>
          </div>
        )}
        <header className="flex min-h-[64px] items-center justify-between border-b border-black/5 px-4 text-xs text-text/50 dark:border-white/5 md:h-14 md:px-6">
          <div className="flex items-center gap-4">
            <div className="hidden rounded-lg border border-black/10 bg-surface/60 p-1 dark:border-white/10 md:inline-flex">
              <Button
                variant={mode === 'write' ? 'primary' : 'ghost'}
                size="sm"
                className="h-8"
                onClick={() => handleModeChange('write')}
                disabled={isSettingsModeBusy}
              >
                {t('settingsMode.tabWrite')}
              </Button>
              <Button
                variant={mode === 'settings' ? 'primary' : 'ghost'}
                size="sm"
                className="h-8"
                onClick={() => handleModeChange('settings')}
              >
                {t('settingsMode.tabSettings')}
              </Button>
            </div>
            <div className="md:hidden">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-text/35">{t('writer.modeWrite')}</p>
              <p className="mt-1 text-sm font-medium text-text/70">
                {isViewingHistory
                  ? t('workspace.chapterItem', { num: viewingHistoryNum })
                  : t('workspace.chapterItem', { num: currentChapter })}
              </p>
              <p className="mt-0.5 text-[10px] text-text/35">{metaModel} · {t('writer.metaWords', { count: metaChars })} · {metaDuration}</p>
            </div>
            <div className="hidden items-center gap-4 md:flex">
              <span>{metaModel} · T{sessionParams.sessionTemp}</span>
              <span>{t('writer.metaWords', { count: metaChars })}</span>
              <span>{metaDuration}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'write' && isGenerating && <Tag variant="warning" className="mr-2">{t('common.status.generating')}</Tag>}
            {(state?.chapters_dirty || []).length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-11 text-warning md:h-8"
                onClick={() => {
                  setDirtyTargetChapter((state?.chapters_dirty || [])[0] || 0);
                  showToast(t('writer.dirtyOpenHint'), 'info');
                  setDirtyOpen(true);
                }}
                title={t('writer.dirtyButtonTitle')}
              >
                <AlertCircle size={16} />
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-11 md:h-8" onClick={() => setExportOpen(true)} title={t('writer.exportButtonTitle')}>
              <FileUp size={16} />
            </Button>
            <span className="hidden md:inline-flex"><ThemeToggle /></span>
          </div>
        </header>

        <div className={mode === 'write' ? 'flex flex-1 flex-col min-h-0' : 'hidden'}>
          <div className="flex flex-1 justify-center overflow-y-auto w-full pb-16 md:pb-12">
            <div className="w-full max-w-3xl space-y-6 px-4 py-4 md:px-8 md:py-10">
              {isViewingHistory && (
                <div className="flex flex-col gap-3 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm text-info md:flex-row md:items-center md:justify-between">
                  <span>{t('workspace.chapterItem', { num: viewingHistoryNum })} — {t('writer.viewingHistory')}</span>
                  <Button variant="ghost" size="sm" onClick={() => { setViewingHistoryContent(null); setViewingHistoryNum(null); onClearViewChapter?.(); }}>
                    {t('writer.backToCurrentChapter')}
                  </Button>
                </div>
              )}
              {recoveryNotice && hasPendingDrafts && (
                <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                  {t('drafts.recoveryNotice')}
                </div>
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
                onSaveEdit={handleSaveEditConfirmed}
                onCancelEdit={handleCancelEditConfirmed}
                onStartEdit={handleStartEditConfirmed}
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

          <footer className="safe-area-bottom w-full shrink-0 border-t border-black/10 dark:border-white/10 bg-surface/80 backdrop-blur-md flex flex-col">
            {/* Collapse toggle */}
            <button
              className="mx-auto flex min-h-[44px] items-center gap-1 px-4 py-1 text-[10px] text-text/40 transition-colors hover:text-text/60"
              onClick={() => setFooterCollapsed(prev => !prev)}
            >
              {footerCollapsed ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
              {footerCollapsed ? t('writer.expandToolbar') : t('writer.collapseToolbar')}
            </button>

            {footerCollapsed ? (
              /* Collapsed: minimal bar with just 续写 button */
              <div className="flex items-center justify-center gap-3 pb-2">
                <Button
                  variant="primary"
                  size="sm"
                  className="shadow-medium"
                  onClick={() => { setFooterCollapsed(false); void handleGenerateFromInput(instructionText.trim() ? 'instruction' : 'continue'); }}
                  disabled={writeActionsDisabled || hasPendingDrafts}
                >
                  {isGenerating ? <Loader2 size={16} className="animate-spin" /> : t('common.actions.continue')}
                </Button>
                {hasPendingDrafts && (
                  <Button variant="primary" size="sm" onClick={() => { setFooterCollapsed(false); setChapterTitle(''); setFinalizeConfirmOpen(true); }} disabled={writeActionsDisabled}>
                    <Check size={15} /> {t('drafts.finalize')}
                  </Button>
                )}
              </div>
            ) : (
              /* Expanded: full toolbar */
              <div className="flex flex-col gap-3 p-4 pb-6 md:pb-4">
                {hasPendingDrafts && currentDraft && (
                  <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-xl border border-black/10 bg-background/60 px-4 py-3 dark:border-white/10">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <DraftNavigator
                        drafts={drafts}
                        activeDraftIndex={activeDraftIndex}
                        onSelect={setActiveDraftIndex}
                        disabled={writeActionsDisabled}
                        modified={currentDraft.modified}
                      />

                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button variant="primary" size="sm" className="h-11 gap-1 md:h-8" onClick={() => { setChapterTitle(''); setFinalizeConfirmOpen(true); }} disabled={writeActionsDisabled}>
                          <Check size={15} /> {t('drafts.finalize')}
                        </Button>
                        <Button variant="secondary" size="sm" className="h-11 gap-1 md:h-8" onClick={() => void handleRegenerate()} disabled={writeActionsDisabled}>
                          {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                          {t('drafts.regenerate')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-11 gap-1 text-error/80 hover:bg-error/10 hover:text-error md:h-8"
                          onClick={() => setDiscardConfirmOpen(true)}
                          disabled={isGenerating || isDiscarding || isSettingsModeBusy}
                        >
                          <Trash2 size={15} />
                          {drafts.length > 1 ? t('drafts.discardAll') : t('drafts.discard')}
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 text-xs text-text/50 lg:flex-row lg:items-center lg:justify-between">
                      <span>{currentDraftMeta || t('writer.metaDurationUnknown')}</span>
                      {drafts.length > MAX_RECOMMENDED_DRAFTS && (
                        <span>{t('drafts.tooMany', { count: drafts.length })}</span>
                      )}
                    </div>
                  </div>
                )}

                <div className="mx-auto hidden w-full max-w-3xl md:block">
                  <input
                    ref={instructionInputRef}
                    type="text"
                    placeholder={t('writer.inputPlaceholder')}
                    value={instructionText}
                    onChange={(event) => setInstructionText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || writeActionsDisabled) return;

                      if (hasPendingDrafts) {
                        showToast(t('drafts.generatingBlocked'), 'warning');
                        return;
                      }

                      void handleGenerateFromInput(instructionText.trim() ? 'instruction' : 'continue');
                    }}
                    disabled={writeActionsDisabled}
                    className="h-9 w-full rounded-lg border border-black/10 bg-background px-3 text-sm text-text placeholder:text-text/40 outline-none focus:ring-2 focus:ring-accent/50 dark:border-white/10"
                  />
                </div>

                <div className="mx-auto w-full max-w-3xl md:hidden">
                  <Textarea
                    value={instructionText}
                    onChange={(event) => setInstructionText(event.target.value)}
                    placeholder={t('writer.inputPlaceholder')}
                    disabled={writeActionsDisabled}
                    className="min-h-[80px] resize-none bg-background/90 text-text"
                  />
                </div>

                <div className="mx-auto mt-2 hidden w-full max-w-3xl items-center justify-between border-t border-black/5 pt-2 dark:border-white/5 md:flex">
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="text-text/60 hover:text-text" onClick={() => setUndoConfirmOpen(true)} disabled={currentChapter <= 1 || writeActionsDisabled}>
                      <Undo2 size={16} className="mr-2" /> {t('common.actions.undoPreviousChapter')}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-text/60 hover:text-text" onClick={() => onNavigate('facts')}>
                      <BookOpen size={16} className="mr-1" /> {t('writer.factsShortcut')}
                    </Button>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="primary"
                      className="w-32 shadow-medium"
                      onClick={() => void handleGenerateFromInput(instructionText.trim() ? 'instruction' : 'continue')}
                      disabled={writeActionsDisabled || hasPendingDrafts}
                    >
                      {isGenerating ? <Loader2 size={16} className="animate-spin" /> : (instructionText.trim() ? t('common.actions.instruction') : t('common.actions.continue'))}
                    </Button>
                  </div>
                </div>

                <div className="mx-auto mt-2 flex w-full max-w-3xl items-center justify-between border-t border-black/5 pt-3 dark:border-white/5 md:hidden">
                  <Button variant="secondary" size="sm" className="px-4" onClick={() => setMobileToolsOpen(true)}>
                    {t('common.actions.more')}
                  </Button>
                  <div className="flex items-center gap-2">
                    {hasPendingDrafts ? (
                      <Button variant="primary" size="sm" onClick={() => { setChapterTitle(''); setFinalizeConfirmOpen(true); }} disabled={writeActionsDisabled}>
                        <Check size={15} className="mr-1" /> {t('drafts.finalize')}
                      </Button>
                    ) : null}
                    <Button
                      variant="primary"
                      size="sm"
                      className="min-w-[110px]"
                      onClick={() => void handleGenerateFromInput(instructionText.trim() ? 'instruction' : 'continue')}
                      disabled={writeActionsDisabled || hasPendingDrafts}
                    >
                      {isGenerating ? <Loader2 size={16} className="animate-spin" /> : (instructionText.trim() ? t('common.actions.instruction') : t('common.actions.continue'))}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </footer>
        </div>

        <div className={mode === 'settings' ? 'hidden min-h-0 flex-1 flex-col md:flex' : 'hidden'}>
          <div className="mx-auto flex h-full w-full max-w-4xl min-h-0 flex-col px-6 py-6">
            {showSettingsTooltip ? (
              <div className="mb-4 flex items-start justify-between gap-4 rounded-2xl border border-info/20 bg-info/10 px-4 py-3 text-sm text-info">
                <p>{t('settingsMode.firstTimeTooltip')}</p>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-info" onClick={() => setShowSettingsTooltip(false)}>
                  {t('common.actions.close')}
                </Button>
              </div>
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
