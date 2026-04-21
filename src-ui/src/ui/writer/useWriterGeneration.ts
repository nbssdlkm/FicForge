// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useRef, useState } from 'react';
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
  readSavedGenerateRequest,
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
  projectInfo: WriterProjectContext | null;
  settingsInfo: WriterSessionConfig | null;
  sessionLlmPayload: SessionLlmPayload;
  sessionTemp: number;
  sessionTopP: number;
  generateGuard: ActiveRequestGuard<string>;
  loadDraftByLabel: (
    chapterNum: number,
    label: string,
    fallbackContent?: string,
    fallbackGeneratedWith?: DraftGeneratedWith | null
  ) => Promise<DraftItem>;
  mergeDraftIntoState: (draft: DraftItem) => void;
  attachDraftSummary: (chapterNum: number, label: string, summary: ContextSummary) => void;
  appendStream: (text: string) => void;
  resetStream: () => void;
  markGeneratedWith: (generatedWith: DraftGeneratedWith | null) => void;
  markBudgetReport: (report: any) => void;
  markRecoveryNotice: (show: boolean) => void;
  attachPendingContextSummary: (summary: ContextSummary | null) => void;
  getPendingContextSummary: () => ContextSummary | null;
  showError: (error: unknown, fallback: string) => void;
  showToast: (message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  t: (key: string, params?: Record<string, unknown>) => string;
};

export function useWriterGeneration({
  auPath,
  state,
  drafts,
  instructionText,
  projectInfo,
  settingsInfo,
  sessionLlmPayload,
  sessionTemp,
  sessionTopP,
  generateGuard,
  loadDraftByLabel,
  mergeDraftIntoState,
  attachDraftSummary,
  appendStream,
  resetStream,
  markGeneratedWith,
  markBudgetReport,
  markRecoveryNotice,
  attachPendingContextSummary,
  getPendingContextSummary,
  showError,
  showToast,
  t,
}: UseWriterGenerationOptions) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationErrorDisplay, setGenerationErrorDisplay] = useState<{ message: string; actions: string[] } | null>(null);
  const [lastGenerateRequest, setLastGenerateRequest] = useState<GenerateRequestState | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setIsGenerating(false);
    setGenerationErrorDisplay(null);
    setLastGenerateRequest(null);
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, [auPath]);

  useEffect(() => () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  useEffect(() => {
    if (!state) {
      setLastGenerateRequest(null);
      return;
    }
    setLastGenerateRequest(readSavedGenerateRequest(auPath, state.current_chapter));
  }, [auPath, state?.current_chapter]);

  const handleGenerate = useCallback(async (request: GenerateRequestState) => {
    if (isGenerating || !state) return;
    const token = generateGuard.start();
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const projectLlmUsable = projectInfo?.llm?.mode && (projectInfo.llm.mode !== 'api' || projectInfo.llm.has_api_key);
    const effectiveLlm = projectLlmUsable ? projectInfo.llm : settingsInfo?.default_llm;
    const llmMode = effectiveLlm?.mode || 'api';
    if (llmMode === 'api' && !effectiveLlm?.has_api_key) {
      showError(null, t('error_messages.no_api_key'));
      return;
    }

    setIsGenerating(true);
    resetStream();
    markGeneratedWith(null);
    markBudgetReport(null);
    markRecoveryNotice(false);
    setGenerationErrorDisplay(null);
    attachPendingContextSummary(null);

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
      }, { signal: controller.signal })) {
        if (generateGuard.isStale(token)) {
          attachPendingContextSummary(null);
          return;
        }

        if (event.event === 'context_summary') {
          const summary = normalizeContextSummary(event.data);
          if (summary) {
            nextContextSummary = summary;
            attachPendingContextSummary(summary);
          }
          continue;
        }

        if (event.event === 'token') {
          const text = event.data.text || '';
          nextText += text;
          appendStream(text);
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
        if (!nextContextSummary) {
          nextContextSummary = getPendingContextSummary();
        }
        if (partialDraftLabel) {
          const partialDraft = await loadDraftByLabel(
            state.current_chapter,
            partialDraftLabel,
            nextText,
            nextGeneratedWith,
          );
          if (generateGuard.isStale(token)) {
            attachPendingContextSummary(null);
            return;
          }
          mergeDraftIntoState(partialDraft);
          markGeneratedWith(partialDraft.generatedWith || nextGeneratedWith || null);
          resetStream();
          markRecoveryNotice(true);
          if (nextContextSummary) {
            attachDraftSummary(state.current_chapter, partialDraftLabel, nextContextSummary);
          }
        } else {
          resetStream();
        }
        attachPendingContextSummary(null);
        throw generationError;
      }

      if (!nextDraftLabel) {
        attachPendingContextSummary(null);
        throw new Error(t('writer.generateErrorFallback'));
      }

      const nextDraft = createDraftItem(
        state.current_chapter,
        nextDraftLabel,
        nextText,
        nextGeneratedWith,
      );
      if (generateGuard.isStale(token)) {
        attachPendingContextSummary(null);
        return;
      }

      mergeDraftIntoState(nextDraft);
      if (nextContextSummary) {
        attachDraftSummary(state.current_chapter, nextDraftLabel, nextContextSummary);
      }
      markGeneratedWith(nextGeneratedWith);
      markBudgetReport(nextBudgetReport);
      attachPendingContextSummary(null);
      requestAnimationFrame(() => {
        if (!generateGuard.isStale(token)) resetStream();
      });
    } catch (error) {
      attachPendingContextSummary(null);
      const isAbort = error instanceof DOMException
        ? error.name === 'AbortError'
        : error instanceof Error && error.name === 'AbortError';
      if (isAbort) {
        return;
      }
      if (generateGuard.isStale(token)) return;
      const isNetwork = error instanceof TypeError && /fetch|network/i.test(error.message);
      if (isNetwork) {
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
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (!generateGuard.isStale(token)) {
        setIsGenerating(false);
      }
    }
  }, [
    attachDraftSummary,
    appendStream,
    attachPendingContextSummary,
    auPath,
    generateGuard,
    getPendingContextSummary,
    isGenerating,
    loadDraftByLabel,
    markBudgetReport,
    markGeneratedWith,
    markRecoveryNotice,
    mergeDraftIntoState,
    projectInfo,
    resetStream,
    sessionLlmPayload,
    sessionTemp,
    sessionTopP,
    setGenerationErrorDisplay,
    setIsGenerating,
    setLastGenerateRequest,
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
    const savedRequest = state ? readSavedGenerateRequest(auPath, state.current_chapter) : null;
    const request: GenerateRequestState = trimmedInstruction
      ? { inputType: 'instruction', userInput: trimmedInstruction }
      : (lastGenerateRequest || savedRequest || { inputType: 'continue', userInput: t('common.actions.continue') });

    await handleGenerate(request);
  }, [auPath, handleGenerate, instructionText, lastGenerateRequest, state, t]);

  const dismissError = useCallback(() => {
    setGenerationErrorDisplay(null);
  }, []);

  return {
    isGenerating,
    generationErrorDisplay,
    handleGenerateFromInput,
    handleRegenerate,
    dismissError,
  };
}
