import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ThemeToggle } from '../shared/ThemeToggle';
import { Button } from '../shared/Button';
import { Tag } from '../shared/Tag';
import { Modal } from '../shared/Modal';
import { EmptyState } from '../shared/EmptyState';
import { Textarea } from '../shared/Input';
import { SettingsPanel } from '../settings/SettingsPanel';
import {
  Undo2,
  Check,
  FileUp,
  AlertCircle,
  Loader2,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { ExportModal } from './ExportModal';
import { DirtyModal } from './DirtyModal';
import { ContextSummaryBar } from './ContextSummaryBar';
import { Sidebar } from '../shared/Sidebar';
import { SettingsChatPanel } from '../shared/settings-chat/SettingsChatPanel';

import { getChapterContent, confirmChapter, undoChapter } from '../../api/chapters';
import { listDrafts, getDraft, deleteDrafts, type DraftDetail, type DraftGeneratedWith } from '../../api/drafts';
import { getState, setChapterFocus, type StateInfo } from '../../api/state';
import { listFacts, addFact, extractFacts, type ExtractedFactCandidate, type FactInfo } from '../../api/facts';
import { generateChapter, type ContextSummary } from '../../api/generate';
import { getSettings, updateSettings, type SettingsInfo } from '../../api/settings';
import { getProject, updateProject, type ProjectInfo } from '../../api/project';
import { ApiError, getFriendlyErrorMessage } from '../../api/client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';
import { useFeedback } from '../../hooks/useFeedback';

type ContextLayer = {
  key: string;
  label: string;
  percent: number;
  color: string;
};

type DraftItem = {
  label: string;
  draftId: string;
  content: string;
  generatedWith?: DraftGeneratedWith | null;
  modified: boolean;
};

type GenerateRequestState = {
  inputType: 'continue' | 'instruction';
  userInput: string;
};

const FACTS_PROMPT_STORAGE_KEY = 'ficforge.writer.skipFactsPrompt';
const SETTINGS_MODE_TOOLTIP_STORAGE_KEY = 'ficforge.writer.settingsModeTipSeen';
const MAX_RECOMMENDED_DRAFTS = 5;

type WriterMode = 'write' | 'settings';

function hasSessionLlmOverride(llm: ProjectInfo['llm'] | null | undefined): boolean {
  return Boolean(
    llm && (
      llm.mode !== 'api'
      || llm.model
      || llm.api_base
      || llm.api_key
      || llm.local_model_path
      || llm.ollama_model
    )
  );
}

function getConfiguredLlmModel(llm: ProjectInfo['llm'] | null | undefined): string {
  if (!llm) return '';
  if (llm.mode === 'ollama') {
    return llm.ollama_model || llm.model || '';
  }
  if (llm.mode === 'local') {
    if (llm.model) return llm.model;
    const path = llm.local_model_path?.trim() || '';
    if (!path) return '';
    const segments = path.split(/[\\/]/).filter(Boolean);
    return segments[segments.length - 1] || path;
  }
  return llm.model || '';
}

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

function getGenerateRequestStorageKey(auPath: string, chapterNum: number): string {
  return `ficforge.writer.generateRequest:${auPath}:${chapterNum}`;
}

function getContextSummaryStorageKey(auPath: string, chapterNum: number): string {
  return `ficforge.writer.contextSummary:${auPath}:${chapterNum}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function normalizeContextSummary(value: unknown): ContextSummary | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<ContextSummary>;
  if (
    !isStringArray(candidate.characters_used)
    || !isStringArray(candidate.worldbuilding_used)
    || !isStringArray(candidate.facts_as_focus)
    || !isStringArray(candidate.truncated_layers)
    || !isStringArray(candidate.truncated_characters)
    || typeof candidate.facts_injected !== 'number'
    || typeof candidate.pinned_count !== 'number'
    || typeof candidate.rag_chunks_retrieved !== 'number'
    || typeof candidate.total_input_tokens !== 'number'
  ) {
    return null;
  }

  return {
    characters_used: candidate.characters_used,
    worldbuilding_used: candidate.worldbuilding_used,
    facts_injected: candidate.facts_injected,
    facts_as_focus: candidate.facts_as_focus,
    pinned_count: candidate.pinned_count,
    rag_chunks_retrieved: candidate.rag_chunks_retrieved,
    total_input_tokens: candidate.total_input_tokens,
    truncated_layers: candidate.truncated_layers,
    truncated_characters: candidate.truncated_characters,
  };
}

function readSavedContextSummaries(auPath: string, chapterNum: number): Record<string, ContextSummary> {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(getContextSummaryStorageKey(auPath, chapterNum));
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(parsed).reduce<Record<string, ContextSummary>>((accumulator, [label, value]) => {
      const summary = normalizeContextSummary(value);
      if (summary) {
        accumulator[label] = summary;
      }
      return accumulator;
    }, {});
  } catch {
    return {};
  }
}

function saveContextSummaries(
  auPath: string,
  chapterNum: number,
  summaries: Record<string, ContextSummary>
): void {
  if (typeof window === 'undefined') return;

  if (Object.keys(summaries).length === 0) {
    window.localStorage.removeItem(getContextSummaryStorageKey(auPath, chapterNum));
    return;
  }

  window.localStorage.setItem(
    getContextSummaryStorageKey(auPath, chapterNum),
    JSON.stringify(summaries)
  );
}

function readSavedGenerateRequest(auPath: string, chapterNum: number): GenerateRequestState | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getGenerateRequestStorageKey(auPath, chapterNum));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GenerateRequestState>;
    if (
      (parsed.inputType === 'continue' || parsed.inputType === 'instruction')
      && typeof parsed.userInput === 'string'
    ) {
      return {
        inputType: parsed.inputType,
        userInput: parsed.userInput,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function saveGenerateRequest(auPath: string, chapterNum: number, request: GenerateRequestState): void {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(
    getGenerateRequestStorageKey(auPath, chapterNum),
    JSON.stringify(request)
  );
}

function getSkipFactsPromptDefault(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(FACTS_PROMPT_STORAGE_KEY) === '1';
}

function setSkipFactsPromptPersisted(value: boolean): void {
  if (typeof window === 'undefined') return;
  if (value) {
    window.localStorage.setItem(FACTS_PROMPT_STORAGE_KEY, '1');
    return;
  }
  window.localStorage.removeItem(FACTS_PROMPT_STORAGE_KEY);
}

function hasSeenSettingsModeTooltip(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(SETTINGS_MODE_TOOLTIP_STORAGE_KEY) === '1';
}

function markSettingsModeTooltipSeen(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SETTINGS_MODE_TOOLTIP_STORAGE_KEY, '1');
}

function formatGeneratedMeta(generatedWith?: DraftGeneratedWith | null): string {
  if (!generatedWith) return '';

  const parts: string[] = [];
  if (generatedWith.generated_at) {
    const timestamp = new Date(generatedWith.generated_at);
    if (!Number.isNaN(timestamp.getTime())) {
      parts.push(
        new Intl.DateTimeFormat('zh-CN', {
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

function getCandidateKey(candidate: ExtractedFactCandidate, index: number): string {
  return `${candidate.content_clean}-${candidate.chapter}-${index}`;
}

export const WriterLayout = ({ auPath, onNavigate }: { auPath: string, onNavigate: (page: string) => void }) => {
  const { t } = useTranslation();
  const { showError, showSuccess, showToast } = useFeedback();
  const instructionInputRef = useRef<HTMLInputElement | null>(null);
  const activeAuPathRef = useRef(auPath);
  const loadRequestIdRef = useRef(0);
  const refreshRequestIdRef = useRef(0);
  activeAuPathRef.current = auPath;
  const [mode, setMode] = useState<WriterMode>('write');
  const [showSettingsTooltip, setShowSettingsTooltip] = useState(false);
  const [isSettingsModeBusy, setIsSettingsModeBusy] = useState(false);

  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isExportOpen, setExportOpen] = useState(false);
  const [isDirtyOpen, setDirtyOpen] = useState(false);
  const [isFinalizeConfirmOpen, setFinalizeConfirmOpen] = useState(false);
  const [isDiscardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [isFactsPromptOpen, setFactsPromptOpen] = useState(false);
  const [isExtractReviewOpen, setExtractReviewOpen] = useState(false);

  const [state, setState] = useState<StateInfo | null>(null);
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [settingsInfo, setSettingsInfo] = useState<SettingsInfo | null>(null);
  const [currentContent, setCurrentContent] = useState('');
  const [unresolvedFacts, setUnresolvedFacts] = useState<FactInfo[]>([]);
  const [focusSelection, setFocusSelection] = useState<string[]>([]);
  const [isUndoConfirmOpen, setUndoConfirmOpen] = useState(false);
  const [dirtyBannerDismissed, setDirtyBannerDismissed] = useState(false);

  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [activeDraftIndex, setActiveDraftIndex] = useState(0);
  const [recoveryNotice, setRecoveryNotice] = useState(false);
  const [lastConfirmedChapter, setLastConfirmedChapter] = useState<number | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [extractingFacts, setExtractingFacts] = useState(false);
  const [savingExtracted, setSavingExtracted] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [generatedWith, setGeneratedWith] = useState<DraftGeneratedWith | null>(null);
  const [budgetReport, setBudgetReport] = useState<any>(null);
  const [lastGenerateRequest, setLastGenerateRequest] = useState<GenerateRequestState | null>(null);
  const [draftSummaries, setDraftSummaries] = useState<Record<string, ContextSummary>>({});
  const pendingContextSummaryRef = useRef<ContextSummary | null>(null);

  const [loading, setLoading] = useState(true);
  const [instructionText, setInstructionText] = useState('');
  const [skipFactsPrompt, setSkipFactsPrompt] = useState(getSkipFactsPromptDefault());
  const [extractedCandidates, setExtractedCandidates] = useState<ExtractedFactCandidate[]>([]);
  const [selectedExtractedKeys, setSelectedExtractedKeys] = useState<string[]>([]);

  const [sessionModel, setSessionModel] = useState('deepseek-chat');
  const [sessionTemp, setSessionTemp] = useState(1.0);
  const [sessionTopP, setSessionTopP] = useState(0.95);

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
    setExtractingFacts(false);
    setSavingExtracted(false);
    setStreamText('');
    setGeneratedWith(null);
    setBudgetReport(null);
    setLastGenerateRequest(null);
    setDraftSummaries({});
    pendingContextSummaryRef.current = null;
    setInstructionText('');
    setExtractedCandidates([]);
    setSelectedExtractedKeys([]);
    setFinalizeConfirmOpen(false);
    setDiscardConfirmOpen(false);
    setFactsPromptOpen(false);
    setExtractReviewOpen(false);
    setDirtyOpen(false);
    setExportOpen(false);
  }, [auPath]);

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

      const globalConfiguredModel = getConfiguredLlmModel(settings?.default_llm as ProjectInfo['llm']);
      if (globalConfiguredModel) {
        defModel = globalConfiguredModel;
        const globalParams = settings?.model_params?.[defModel];
        if (globalParams) {
          defTemp = globalParams.temperature;
          defTopP = globalParams.top_p;
        }
      }

      const projectConfiguredModel = getConfiguredLlmModel(proj?.llm);
      if (projectConfiguredModel) {
        defModel = projectConfiguredModel;
      }
      if (proj?.model_params_override?.[defModel]) {
        defTemp = proj.model_params_override[defModel].temperature;
        defTopP = proj.model_params_override[defModel].top_p;
      }

      setSessionModel(defModel);
      setSessionTemp(defTemp);
      setSessionTopP(defTopP);

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

  const handleSaveGlobalParams = async () => {
    const requestAuPath = auPath;
    try {
      const settings = await getSettings();
      settings.model_params = settings.model_params || {};
      settings.model_params[sessionModel] = { temperature: sessionTemp, top_p: sessionTopP };
      await updateSettings('./fandoms', settings);
      if (activeAuPathRef.current !== requestAuPath) return;
      showSuccess(t('writer.saveGlobalSuccess'));
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    }
  };

  const handleSaveAuParams = async () => {
    const requestAuPath = auPath;
    try {
      const proj = await getProject(auPath);
      if (!proj.model_params_override) proj.model_params_override = {};
      proj.model_params_override[sessionModel] = { temperature: sessionTemp, top_p: sessionTopP };
      await updateProject(auPath, proj as any);
      if (activeAuPathRef.current !== requestAuPath) return;
      showSuccess(t('writer.saveAuSuccess'));
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    }
  };

  const sessionLlmPayload = useMemo(() => {
    if (!sessionModel) return null;

    const source = hasSessionLlmOverride(projectInfo?.llm)
      ? projectInfo?.llm
      : settingsInfo?.default_llm;
    const configuredModel = getConfiguredLlmModel(source as ProjectInfo['llm']) || sessionModel;

    return {
      mode: source?.mode || 'api',
      model: configuredModel,
      api_base: source?.api_base || '',
      api_key: source?.api_key || '',
      local_model_path: source?.local_model_path || '',
      ollama_model: source?.ollama_model || '',
    };
  }, [projectInfo, sessionModel, settingsInfo]);

  const handleGenerate = useCallback(async (request: GenerateRequestState) => {
    if (isGenerating || !state) return;
    const requestAuPath = auPath;

    setIsGenerating(true);
    setStreamText('');
    setGeneratedWith(null);
    setBudgetReport(null);
    setRecoveryNotice(false);
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
        session_llm: sessionLlmPayload || undefined,
        session_params: { temperature: sessionTemp, top_p: sessionTopP },
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
      setStreamText('');
      pendingContextSummaryRef.current = null;
    } catch (error) {
      pendingContextSummaryRef.current = null;
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('writer.generateErrorFallback'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setIsGenerating(false);
      }
    }
  }, [attachDraftSummary, auPath, loadDraftByLabel, mergeDraftIntoState, sessionLlmPayload, sessionTemp, sessionTopP, showError, state, t]);

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
        currentDraft.modified ? currentDraft.content : undefined
      );
      if (activeAuPathRef.current !== requestAuPath) return;

      clearDraftState();
      replaceDraftSummaries(confirmedChapter, {});
      setFinalizeConfirmOpen(false);
      setLastConfirmedChapter(confirmedChapter);
      await loadData();

      if (skipFactsPrompt) {
        showSuccess(t('drafts.finalizeSuccess', { chapter: confirmedChapter }));
        focusInstructionInput();
        return;
      }

      setFactsPromptOpen(true);
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
    setFocusSelection(next);
    try {
      await setChapterFocus(auPath, next);
      if (activeAuPathRef.current !== requestAuPath) return;
      showToast(t('writer.focusSaved'), 'success');
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    }
  };

  const handleClearFocus = async () => {
    const requestAuPath = auPath;
    setFocusSelection([]);
    try {
      await setChapterFocus(auPath, []);
      if (activeAuPathRef.current !== requestAuPath) return;
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
    setFocusSelection(validIds);
    try {
      await setChapterFocus(auPath, validIds);
      if (activeAuPathRef.current !== requestAuPath) return;
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

  const handleFactsPromptToggle = (checked: boolean) => {
    setSkipFactsPrompt(checked);
    setSkipFactsPromptPersisted(checked);
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

  const closeFactsPrompt = () => {
    setFactsPromptOpen(false);
    focusInstructionInput();
  };

  const handleSkipFactsPrompt = () => {
    closeFactsPrompt();
  };

  const handleOpenExtractReview = async () => {
    if (!lastConfirmedChapter) return;
    const requestAuPath = auPath;

    setExtractingFacts(true);
    try {
      const result = await extractFacts(auPath, lastConfirmedChapter);
      if (activeAuPathRef.current !== requestAuPath) return;
      const candidates = result.facts || [];
      setExtractedCandidates(candidates);
      setSelectedExtractedKeys(candidates.map((candidate, index) => getCandidateKey(candidate, index)));
      setFactsPromptOpen(false);
      setExtractReviewOpen(true);
      if (candidates.length === 0) {
        showToast(t('facts.extractNoResult'), 'info');
      }
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setExtractingFacts(false);
      }
    }
  };

  const handleSaveExtracted = async () => {
    if (selectedExtractedKeys.length === 0) {
      setExtractReviewOpen(false);
      focusInstructionInput();
      return;
    }

    setSavingExtracted(true);
    const requestAuPath = auPath;
    try {
      const selectedCandidates = extractedCandidates.filter((candidate, index) =>
        selectedExtractedKeys.includes(getCandidateKey(candidate, index))
      );

      for (const candidate of selectedCandidates) {
        await addFact(auPath, candidate.chapter || lastConfirmedChapter || 1, {
          content_raw: candidate.content_raw || candidate.content_clean,
          content_clean: candidate.content_clean,
          type: candidate.fact_type || candidate.type || 'plot_event',
          narrative_weight: candidate.narrative_weight || 'medium',
          status: candidate.status || 'active',
          characters: candidate.characters || [],
          ...(candidate.timeline ? { timeline: candidate.timeline } : {}),
        });
      }
      if (activeAuPathRef.current !== requestAuPath) return;

      showSuccess(t('facts.extractSaved', { count: selectedCandidates.length }));
      setExtractReviewOpen(false);
      setExtractedCandidates([]);
      setSelectedExtractedKeys([]);
      focusInstructionInput();
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setSavingExtracted(false);
      }
    }
  };

  const toggleExtractedCandidate = (key: string) => {
    setSelectedExtractedKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    );
  };

  const currentChapter = state?.current_chapter || 1;
  const hasPendingDrafts = drafts.length > 0;
  const writeActionsDisabled = isGenerating || isFinalizing || isDiscarding || isSettingsModeBusy;
  const currentDraft = drafts[activeDraftIndex] || null;
  const settingsSessionLlm = sessionLlmPayload;
  const fandomPathParts = auPath.split('/aus/');
  const settingsFandomPath = fandomPathParts.length >= 2 ? fandomPathParts[0] : auPath;
  const currentDraftSummary = !isGenerating && currentDraft ? draftSummaries[currentDraft.label] || null : null;
  const activeGeneratedWith = currentDraft?.generatedWith || generatedWith;
  const displayContent = streamText || currentDraft?.content || currentContent;
  const metaModel = activeGeneratedWith?.model || sessionModel;
  const metaChars = activeGeneratedWith?.char_count || displayContent.length;
  const metaDuration = activeGeneratedWith?.duration_ms
    ? `${(activeGeneratedWith.duration_ms / 1000).toFixed(1)}s`
    : t('writer.metaDurationUnknown');
  const currentDraftMeta = formatGeneratedMeta(currentDraft?.generatedWith);
  const previewText = currentDraft ? getPreviewText(currentDraft.content) : '';
  const isLastDraft = activeDraftIndex >= drafts.length - 1;
  const isFirstDraft = activeDraftIndex === 0;

  const contextLayers: ContextLayer[] = budgetReport ? [
    {
      key: 'pinned',
      label: t('writer.memoryLayer.pinned'),
      percent: Math.max(1, Math.round((budgetReport.system_tokens / (budgetReport.total_input_tokens || 1)) * 100)),
      color: 'bg-error/70',
    },
    {
      key: 'context',
      label: t('writer.memoryLayer.context'),
      percent: Math.max(1, Math.round((budgetReport.context_tokens / (budgetReport.total_input_tokens || 1)) * 100)),
      color: 'bg-info/70',
    },
  ] : [
    { key: 'pinned', label: t('writer.memoryLayer.pinned'), percent: 10, color: 'bg-error/70' },
    { key: 'recent', label: t('writer.memoryLayer.recentChapter'), percent: 35, color: 'bg-info/70' },
    { key: 'facts', label: t('writer.memoryLayer.facts'), percent: 20, color: 'bg-accent/70' },
  ];

  return (
    <>
      <main className="flex-1 flex flex-col min-w-0 bg-background relative transition-colors duration-200">
        {/* Dirty banner (sub-task 2) */}
        {!dirtyBannerDismissed && (state?.chapters_dirty || []).length > 0 && (
          <div className="bg-warning/10 border-b border-warning/20 px-6 py-2 flex items-center justify-between text-xs">
            <span className="text-warning">{t('dirty.banner', { count: (state?.chapters_dirty || []).length, chapters: (state?.chapters_dirty || []).join(', ') })}</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => setDirtyOpen(true)}>{t('dirty.goResolve')}</Button>
              <Button variant="ghost" size="sm" className="text-xs h-6 text-text/40" onClick={() => setDirtyBannerDismissed(true)}>{t('dirty.dismissBanner')}</Button>
            </div>
          </div>
        )}
        <header className="flex h-14 items-center justify-between border-b border-black/5 px-6 text-xs text-text/50 dark:border-white/5">
          <div className="flex items-center gap-4">
            <div className="inline-flex rounded-lg border border-black/10 bg-surface/60 p-1 dark:border-white/10">
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
            <div className="hidden items-center gap-4 md:flex">
              <span>{metaModel} · T{sessionTemp}</span>
              <span>{t('writer.metaWords', { count: metaChars })}</span>
              <span>{metaDuration}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'write' && isGenerating && <Tag variant="warning" className="mr-2">{t('common.status.generating')}</Tag>}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-warning"
              onClick={() => {
                showToast(t('writer.dirtyOpenHint'), 'info');
                setDirtyOpen(true);
              }}
              title={t('writer.dirtyButtonTitle')}
            >
              <AlertCircle size={16} />
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setExportOpen(true)} title={t('writer.exportButtonTitle')}>
              <FileUp size={16} />
            </Button>
            <ThemeToggle />
          </div>
        </header>

        <div className={mode === 'write' ? 'flex flex-1 flex-col min-h-0' : 'hidden'}>
          <div className="flex-1 overflow-y-auto w-full flex justify-center pb-32">
            <div className="w-full max-w-3xl px-8 py-10 space-y-6">
              {recoveryNotice && hasPendingDrafts && (
                <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                  {t('drafts.recoveryNotice')}
                </div>
              )}

              <div className="rounded-[24px] border border-black/10 bg-surface/35 p-6 shadow-subtle dark:border-white/10">
                {loading ? (
                  <div className="flex items-center justify-center py-24">
                    <Loader2 className="animate-spin text-accent" size={24} />
                  </div>
                ) : streamText ? (
                  <div className="text-lg font-serif leading-loose text-text/90 animate-in fade-in duration-200">
                    {streamText.split('\n').filter(Boolean).map((para: string, i: number) => (
                      <p key={i} className="mb-6 indent-8 opacity-90">{para}</p>
                    ))}
                    {isGenerating && <span className="inline-block h-5 w-0.5 bg-accent align-middle animate-pulse" />}
                  </div>
                ) : currentDraft ? (
                  <div className="space-y-4">
                    <Textarea
                      value={currentDraft.content}
                      onChange={(event) => handleCurrentDraftChange(event.target.value)}
                      className="min-h-[440px] border-0 bg-transparent px-0 py-0 font-serif text-lg leading-loose shadow-none focus:ring-0"
                    />
                  </div>
                ) : displayContent ? (
                  <div className="text-lg font-serif leading-loose text-text/90">
                    {displayContent.split('\n').filter(Boolean).map((para: string, i: number) => (
                      <p key={i} className="mb-6 indent-8">{para}</p>
                    ))}
                  </div>
                ) : (
                  <p className="py-24 text-center text-text/30">{t('writer.emptyContent')}</p>
                )}
              </div>

              <ContextSummaryBar
                summary={currentDraftSummary}
                onAdjustCoreIncludes={() => onNavigate('settings')}
              />
            </div>
          </div>

          <footer className="absolute bottom-0 w-full shrink-0 border-t border-black/10 dark:border-white/10 bg-surface/50 p-4 backdrop-blur-md flex flex-col gap-3">
            {hasPendingDrafts && currentDraft && (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-xl border border-black/10 bg-background/60 px-4 py-3 dark:border-white/10">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-2 text-sm font-sans text-text/75">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => setActiveDraftIndex((current) => Math.max(0, current - 1))}
                      disabled={isFirstDraft || writeActionsDisabled}
                      aria-label={t('drafts.previous')}
                    >
                      <ChevronLeft size={16} />
                    </Button>
                    <span className="min-w-[140px] text-center font-medium">
                      {t('drafts.count', { current: activeDraftIndex + 1, total: drafts.length })}
                      {currentDraft.modified ? <span className="ml-1 text-text/55">{t('drafts.modified')}</span> : null}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => setActiveDraftIndex((current) => Math.min(drafts.length - 1, current + 1))}
                      disabled={isLastDraft || writeActionsDisabled}
                      aria-label={t('drafts.next')}
                    >
                      <ChevronRight size={16} />
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button variant="primary" size="sm" className="h-8 gap-1" onClick={() => setFinalizeConfirmOpen(true)} disabled={writeActionsDisabled}>
                      <Check size={15} /> {t('drafts.finalize')}
                    </Button>
                    <Button variant="secondary" size="sm" className="h-8 gap-1" onClick={() => void handleRegenerate()} disabled={writeActionsDisabled}>
                      {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                      {t('drafts.regenerate')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 text-error/80 hover:bg-error/10 hover:text-error"
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

            <div className="mx-auto w-full max-w-3xl">
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
                className="h-9 w-full rounded-lg border border-black/10 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent/50 dark:border-white/10"
              />
            </div>

            <div className="mx-auto mt-2 flex w-full max-w-3xl items-center justify-between border-t border-black/5 pt-2 dark:border-white/5">
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
                  variant="secondary"
                  className="w-32 shadow-medium"
                  onClick={() => void handleGenerateFromInput('instruction')}
                  disabled={writeActionsDisabled || hasPendingDrafts || !instructionText.trim()}
                >
                  {t('common.actions.instruction')}
                </Button>
                <Button
                  variant="primary"
                  className="w-32 shadow-medium"
                  onClick={() => void handleGenerateFromInput('continue')}
                  disabled={writeActionsDisabled || hasPendingDrafts}
                >
                  {isGenerating ? <Loader2 size={16} className="animate-spin" /> : t('common.actions.continue')}
                </Button>
              </div>
            </div>
          </footer>
        </div>

        <div className={mode === 'settings' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
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

      <Sidebar position="right" width="320px" isCollapsed={rightCollapsed} onToggle={() => setRightCollapsed(!rightCollapsed)} className="flex flex-col bg-surface/50 border-l border-black/10 dark:border-white/10">
        <div className="flex-1 overflow-y-auto p-5 space-y-8">
          {mode === 'write' ? (
            <>
              <section>
                <h3 className="text-xs font-sans font-medium mb-3 text-text/70 tracking-wide uppercase">{t('writer.focusTitle')}</h3>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Button variant="ghost" size="sm" className="text-xs" onClick={handleClearFocus} disabled={focusSelection.length === 0}>
                      {t('writer.freeWrite')}
                    </Button>
                    {(state?.last_confirmed_chapter_focus || []).length > 0 && (
                      <Button variant="ghost" size="sm" className="text-xs" onClick={handleContinueLastFocus}>
                        {t('focus.continueLastChapter')}
                      </Button>
                    )}
                  </div>
                  {unresolvedFacts.map((fact) => {
                    const isHigh = fact.narrative_weight === 'high';
                    return (
                      <label key={fact.id} className={`flex items-start gap-2 p-2 rounded-md hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer border transition-colors ${focusSelection.includes(String(fact.id)) ? 'border-accent/30 bg-accent/5' : 'border-transparent hover:border-black/5 dark:hover:border-white/5'}`}>
                        <input type="checkbox" className="mt-1 accent-accent" checked={focusSelection.includes(String(fact.id))} onChange={() => handleFocusToggle(String(fact.id))} />
                        <div className="flex flex-col">
                          <span className="text-sm">{fact.content_clean}</span>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <Tag variant="warning" className="w-fit">{getEnumLabel('fact_status', 'unresolved', 'unresolved')}</Tag>
                            {isHigh && <Tag variant="info" className="w-fit text-[10px]">{t('focus.recommended')}</Tag>}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                  {focusSelection.length >= 2 && (
                    <p className="text-[10px] text-text/40 px-2">{t('focus.maxTwo')}</p>
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-xs font-sans font-medium mb-3 text-text/70 tracking-wide uppercase">{t('writer.memoryPanel')}</h3>
                <div className="space-y-3">
                  {contextLayers.map((item) => (
                    <div key={item.key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text/70">{item.label}</span>
                        <span className="text-text/50 font-mono">{item.percent}%</span>
                      </div>
                      <div className="h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden flex">
                        <div className={`${item.color} h-full`} style={{ width: `${item.percent}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <section className="rounded-2xl border border-black/10 bg-background/50 p-4 dark:border-white/10">
              <h3 className="mb-2 text-xs font-sans font-medium uppercase tracking-wide text-text/70">{t('settingsMode.sideTitle')}</h3>
              <p className="text-sm leading-relaxed text-text/65">{t('settingsMode.sideDescription')}</p>
            </section>
          )}

          <section className="pt-4 border-t border-black/10 dark:border-white/10">
            <SettingsPanel
              model={sessionModel}
              onModelChange={setSessionModel}
              temperature={sessionTemp}
              onTemperatureChange={setSessionTemp}
              topP={sessionTopP}
              onTopPChange={setSessionTopP}
              onSaveGlobal={handleSaveGlobalParams}
              onSaveAu={handleSaveAuParams}
            />
          </section>
        </div>
      </Sidebar>

      <Modal
        isOpen={isFinalizeConfirmOpen && currentDraft !== null}
        onClose={() => setFinalizeConfirmOpen(false)}
        title={t('drafts.confirmFinalize', { chapter: currentChapter })}
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-black/10 bg-surface/40 p-4 text-sm leading-relaxed text-text/80 dark:border-white/10">
            {previewText || t('writer.emptyContent')}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFinalizeConfirmOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void handleConfirm()} disabled={isFinalizing}>
              {isFinalizing ? <Loader2 size={16} className="animate-spin" /> : t('drafts.finalize')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isDiscardConfirmOpen}
        onClose={() => setDiscardConfirmOpen(false)}
        title={drafts.length > 1 ? t('drafts.discardAll') : t('drafts.discard')}
      >
        <div className="space-y-4">
          <p className="text-sm text-text/80">
            {drafts.length > 1
              ? t('drafts.confirmDiscardAll', { count: drafts.length })
              : t('drafts.confirmDiscard')}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDiscardConfirmOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button variant="primary" className="bg-red-600 text-white hover:bg-red-700" onClick={() => void handleDiscardDrafts()} disabled={isDiscarding}>
              {isDiscarding ? <Loader2 size={16} className="animate-spin" /> : t('common.actions.confirm')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isFactsPromptOpen}
        onClose={handleSkipFactsPrompt}
        title={lastConfirmedChapter ? t('drafts.finalizeSuccess', { chapter: lastConfirmedChapter }) : t('drafts.finalizeSuccess', { chapter: currentChapter })}
      >
        <div className="space-y-5">
          <p className="text-sm text-text/80">{t('drafts.factsPrompt')}</p>
          <div className="space-y-2">
            <Button variant="primary" className="w-full gap-2" onClick={() => void handleOpenExtractReview()} disabled={extractingFacts}>
              {extractingFacts ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {t('drafts.factsExtract')}
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => { setFactsPromptOpen(false); onNavigate('facts'); }}>
              {t('drafts.factsManual')}
            </Button>
            <Button variant="ghost" className="w-full" onClick={handleSkipFactsPrompt}>
              {t('drafts.factsSkip')}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm text-text/70">
            <input
              type="checkbox"
              className="accent-accent"
              checked={skipFactsPrompt}
              onChange={(event) => handleFactsPromptToggle(event.target.checked)}
            />
            <span>{t('drafts.factsNeverAsk')}</span>
          </label>
        </div>
      </Modal>

      <Modal
        isOpen={isExtractReviewOpen}
        onClose={() => {
          setExtractReviewOpen(false);
          focusInstructionInput();
        }}
        title={t('facts.extractReviewTitle')}
      >
        <div className="space-y-4">
          <p className="text-sm text-text/70">{t('facts.extractReviewDescription')}</p>
          <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {extractedCandidates.length === 0 ? (
              <EmptyState compact icon={<Sparkles size={28} />} title={t('facts.extractReviewEmpty')} description={t('facts.extractNoResult')} />
            ) : (
              extractedCandidates.map((candidate, index) => {
                const candidateType = candidate.fact_type || candidate.type || 'plot_event';
                const key = getCandidateKey(candidate, index);
                const checked = selectedExtractedKeys.includes(key);

                return (
                  <label key={key} className={`flex cursor-pointer gap-3 rounded-lg border p-4 dark:border-white/10 ${checked ? 'border-accent/40 bg-accent/5' : 'border-black/10 bg-surface/40'}`}>
                    <input
                      type="checkbox"
                      className="mt-1 accent-accent"
                      checked={checked}
                      onChange={() => toggleExtractedCandidate(key)}
                    />
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Tag variant="info">{getEnumLabel('fact_type', candidateType, candidateType)}</Tag>
                        <Tag variant="warning">{getEnumLabel('narrative_weight', candidate.narrative_weight, candidate.narrative_weight)}</Tag>
                        <Tag variant="default">{getEnumLabel('fact_status', candidate.status, candidate.status)}</Tag>
                        <span className="text-xs text-text/50">{t('facts.extractSourceChapter', { chapter: candidate.chapter })}</span>
                      </div>
                      <p className="text-sm text-text/85">{candidate.content_clean}</p>
                      {candidate.characters.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {candidate.characters.map((character) => (
                            <span key={character} className="text-xs font-medium text-accent/80">@{character}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
            <Button variant="ghost" onClick={() => {
              setExtractReviewOpen(false);
              focusInstructionInput();
            }}>
              {t('common.actions.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void handleSaveExtracted()} disabled={savingExtracted || selectedExtractedKeys.length === 0}>
              {savingExtracted ? <Loader2 size={16} className="animate-spin" /> : t('drafts.extractSaveSelected')}
            </Button>
          </div>
        </div>
      </Modal>

      <ExportModal isOpen={isExportOpen} onClose={() => setExportOpen(false)} />
      <DirtyModal
        isOpen={isDirtyOpen}
        onClose={() => setDirtyOpen(false)}
        auPath={auPath}
        chapterNum={currentChapter}
        onResolved={() => {
          setDirtyOpen(false);
          void loadData();
        }}
      />

      {/* Undo confirmation modal (sub-task 3) */}
      <Modal isOpen={isUndoConfirmOpen} onClose={() => setUndoConfirmOpen(false)} title={t('undo.confirmTitle', { chapter: currentChapter - 1 })}>
        <div className="space-y-4">
          <div className="text-sm text-text/80 whitespace-pre-line">{t('undo.confirmDesc')}</div>
          <p className="text-sm text-red-500 font-medium">{t('undo.irreversible')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setUndoConfirmOpen(false)}>{t('undo.cancel')}</Button>
            <Button variant="danger" onClick={handleUndoConfirmed}>{t('undo.confirmAction')}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
