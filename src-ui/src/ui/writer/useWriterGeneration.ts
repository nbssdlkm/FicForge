// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  ApiError,
  generateChapter,
  getFriendlyErrorMessage,
  type ContextSummary,
  type DraftGeneratedWith,
  type StateInfo,
  type WriterProjectContext,
  type WriterSessionConfig,
} from '../../api/engine-client';
import type { ActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import {
  normalizeContextSummary,
  saveGenerateRequest,
  type GenerateRequestState,
} from '../../utils/writerStorage';
import { createDraftItem, type DraftItem } from './useWriterDraftController';

type SessionLlmPayload = {
  mode: string;
  model: string;
  api_base: string;
  local_model_path: string;
  ollama_model: string;
} | null;

type UseWriterGenerationOptions = {
  auPath: string;
  state: StateInfo | null;
  drafts: DraftItem[];
  instructionText: string;
  lastGenerateRequest: GenerateRequestState | null;
  isGenerating: boolean;
  projectInfo: WriterProjectContext | null;
  settingsInfo: WriterSessionConfig | null;
  sessionLlmPayload: SessionLlmPayload;
  sessionTemp: number;
  sessionTopP: number;
  generateGuard: ActiveRequestGuard<string>;
  pendingContextSummaryRef: MutableRefObject<ContextSummary | null>;
  loadDraftByLabel: (
    chapterNum: number,
    label: string,
    fallbackContent?: string,
    fallbackGeneratedWith?: DraftGeneratedWith | null
  ) => Promise<DraftItem>;
  mergeDraftIntoState: (draft: DraftItem) => void;
  attachDraftSummary: (chapterNum: number, label: string, summary: ContextSummary) => void;
  setIsGenerating: (busy: boolean) => void;
  setStreamText: Dispatch<SetStateAction<string>>;
  setGeneratedWith: (generatedWith: DraftGeneratedWith | null) => void;
  setBudgetReport: (report: any) => void;
  setRecoveryNotice: (show: boolean) => void;
  setGenerationErrorDisplay: (value: { message: string; actions: string[] } | null) => void;
  setLastGenerateRequest: (request: GenerateRequestState | null) => void;
  showError: (error: unknown, fallback: string) => void;
  showToast: (message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  t: (key: string, params?: Record<string, unknown>) => string;
};

export function useWriterGeneration({
  auPath,
  state,
  drafts,
  instructionText,
  lastGenerateRequest,
  isGenerating,
  projectInfo,
  settingsInfo,
  sessionLlmPayload,
  sessionTemp,
  sessionTopP,
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
}: UseWriterGenerationOptions) {
  const handleGenerate = useCallback(async (request: GenerateRequestState) => {
    if (isGenerating || !state) return;
    const token = generateGuard.start();

    const projectLlmUsable = projectInfo?.llm?.mode && (projectInfo.llm.mode !== 'api' || projectInfo.llm.has_api_key);
    const effectiveLlm = projectLlmUsable ? projectInfo.llm : settingsInfo?.default_llm;
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
        session_llm: sessionLlmPayload || undefined,
        session_params: { temperature: sessionTemp, top_p: sessionTopP },
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
            event.data.message,
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
            nextGeneratedWith,
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
        nextGeneratedWith,
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
      requestAnimationFrame(() => {
        if (!generateGuard.isStale(token)) setStreamText('');
      });
    } catch (error) {
      pendingContextSummaryRef.current = null;
      if (generateGuard.isStale(token)) return;
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
  }, [
    attachDraftSummary,
    auPath,
    generateGuard,
    isGenerating,
    loadDraftByLabel,
    mergeDraftIntoState,
    pendingContextSummaryRef,
    projectInfo,
    sessionLlmPayload,
    sessionTemp,
    sessionTopP,
    setBudgetReport,
    setGeneratedWith,
    setGenerationErrorDisplay,
    setIsGenerating,
    setLastGenerateRequest,
    setRecoveryNotice,
    setStreamText,
    settingsInfo,
    showError,
    showToast,
    state,
    t,
  ]);

  const handleGenerateFromInput = useCallback(async (inputType: 'continue' | 'instruction') => {
    if (drafts.length > 0) {
      showToast(t('drafts.generatingBlocked'), 'warning');
      return;
    }

    const userInput = inputType === 'instruction' && instructionText.trim()
      ? instructionText.trim()
      : t('common.actions.continue');

    await handleGenerate({ inputType, userInput });
  }, [drafts.length, handleGenerate, instructionText, showToast, t]);

  const handleRegenerate = useCallback(async () => {
    const trimmedInstruction = instructionText.trim();
    const request: GenerateRequestState = trimmedInstruction
      ? { inputType: 'instruction', userInput: trimmedInstruction }
      : (lastGenerateRequest || { inputType: 'continue', userInput: t('common.actions.continue') });

    await handleGenerate(request);
  }, [handleGenerate, instructionText, lastGenerateRequest, t]);

  return {
    handleGenerateFromInput,
    handleRegenerate,
  };
}
