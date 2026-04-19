// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, type MutableRefObject } from 'react';
import {
  getChapterContent,
  getState,
  getWriterProjectContext,
  getWriterSessionConfig,
  listFacts,
  type ContextSummary,
  type FactInfo,
  type StateInfo,
  type WriterProjectContext,
  type WriterSessionConfig,
} from '../../api/engine-client';
import {
  readSavedContextSummaries,
  readSavedGenerateRequest,
  readSavedInstructionText,
  type GenerateRequestState,
} from '../../utils/writerStorage';
import type { ActiveRequestGuard } from '../../hooks/useActiveRequestGuard';

type UseWriterBootstrapOptions<TDraft extends { label: string }> = {
  auPath: string;
  loadGuard: ActiveRequestGuard<string>;
  refreshGuard: ActiveRequestGuard<string>;
  getConfiguredLlmModel: (
    llm: WriterProjectContext['llm'] | WriterSessionConfig['default_llm'] | null | undefined,
  ) => string;
  setSessionModel: (model: string) => void;
  setSessionTemp: (temperature: number) => void;
  setSessionTopP: (topP: number) => void;
  loadDraftsForChapter: (chapterNum: number) => Promise<TDraft[]>;
  replaceDraftSummaries: (chapterNum: number, summaries: Record<string, ContextSummary>) => void;
  clearDraftState: () => void;
  pendingContextSummaryRef: MutableRefObject<ContextSummary | null>;
  showError: (error: unknown, fallback: string) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
  setLoading: (loading: boolean) => void;
  setState: (state: StateInfo | null) => void;
  setProjectInfo: (project: WriterProjectContext | null) => void;
  setSettingsInfo: (settings: WriterSessionConfig | null) => void;
  setCurrentContent: (content: string) => void;
  setUnresolvedFacts: (facts: FactInfo[]) => void;
  setFocusSelection: (focus: string[]) => void;
  setDrafts: (drafts: TDraft[]) => void;
  setActiveDraftIndex: (index: number) => void;
  setRecoveryNotice: (show: boolean) => void;
  setLastGenerateRequest: (request: GenerateRequestState | null) => void;
  setInstructionText: (text: string) => void;
};

export function useWriterBootstrap<TDraft extends { label: string }>({
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
}: UseWriterBootstrapOptions<TDraft>) {
  const loadData = useCallback(async () => {
    const token = loadGuard.start();
    setLoading(true);
    try {
      const [stateData, factsData, proj, settings] = await Promise.all([
        getState(auPath).catch(() => null),
        listFacts(auPath, 'unresolved').catch(() => []),
        getWriterProjectContext(auPath).catch(() => null),
        getWriterSessionConfig().catch(() => null),
      ]);
      if (loadGuard.isStale(token)) return;

      setState(stateData);
      setProjectInfo(proj);
      setSettingsInfo(settings);
      setUnresolvedFacts(factsData);
      setFocusSelection(stateData?.chapter_focus || []);

      let defModel = 'deepseek-chat';
      let defTemp = 1.0;
      let defTopP = 0.95;

      const globalConfiguredModel = getConfiguredLlmModel(settings?.default_llm);
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
        const override = proj.model_params_override[defModel];
        defTemp = (override.temperature as number) ?? defTemp;
        defTopP = (override.top_p as number) ?? defTopP;
      }

      setSessionModel(defModel);
      setSessionTemp(defTemp);
      setSessionTopP(defTopP);

      if (stateData && stateData.current_chapter > 1) {
        const latestNum = stateData.current_chapter - 1;
        try {
          const content = await getChapterContent(auPath, latestNum);
          if (loadGuard.isStale(token)) return;
          setCurrentContent(typeof content === 'string' ? content : '');
        } catch {
          if (loadGuard.isStale(token)) return;
          setCurrentContent(t('writer.contentLoadFailed'));
        }
      } else {
        setCurrentContent('');
      }

      if (stateData) {
        const loadedDrafts = await loadDraftsForChapter(stateData.current_chapter);
        if (loadGuard.isStale(token)) return;
        const storedSummaries = readSavedContextSummaries(auPath, stateData.current_chapter);
        const activeLabels = new Set(loadedDrafts.map((draft) => draft.label));
        const filteredSummaries = Object.entries(storedSummaries).reduce<Record<string, ContextSummary>>(
          (accumulator, [label, summary]) => {
            if (activeLabels.has(label)) {
              accumulator[label] = summary;
            }
            return accumulator;
          },
          {},
        );

        setDrafts(loadedDrafts);
        setActiveDraftIndex(loadedDrafts.length > 0 ? loadedDrafts.length - 1 : 0);
        setRecoveryNotice(loadedDrafts.length > 0);
        setLastGenerateRequest(readSavedGenerateRequest(auPath, stateData.current_chapter));
        setInstructionText(readSavedInstructionText(auPath, stateData.current_chapter));
        replaceDraftSummaries(stateData.current_chapter, filteredSummaries);
        pendingContextSummaryRef.current = null;
      } else {
        clearDraftState();
        setLastGenerateRequest(null);
        setInstructionText('');
        setProjectInfo(null);
      }
    } catch (error) {
      if (loadGuard.isStale(token)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!loadGuard.isStale(token)) {
        setLoading(false);
      }
    }
  }, [
    auPath,
    clearDraftState,
    getConfiguredLlmModel,
    loadDraftsForChapter,
    loadGuard,
    pendingContextSummaryRef,
    replaceDraftSummaries,
    setActiveDraftIndex,
    setCurrentContent,
    setDrafts,
    setFocusSelection,
    setInstructionText,
    setLastGenerateRequest,
    setLoading,
    setProjectInfo,
    setRecoveryNotice,
    setSessionModel,
    setSessionTemp,
    setSessionTopP,
    setSettingsInfo,
    setState,
    setUnresolvedFacts,
    showError,
    t,
  ]);

  const refreshSettingsModeData = useCallback(async () => {
    const token = refreshGuard.start();
    try {
      const [stateData, factsData, proj] = await Promise.all([
        getState(auPath).catch(() => null),
        listFacts(auPath, 'unresolved').catch(() => []),
        getWriterProjectContext(auPath).catch(() => null),
      ]);
      if (refreshGuard.isStale(token)) return;

      if (stateData) {
        setState(stateData);
        setFocusSelection(stateData.chapter_focus || []);
      }
      setProjectInfo(proj);
      setUnresolvedFacts(factsData);
    } catch (error) {
      if (refreshGuard.isStale(token)) return;
      showError(error, t('error_messages.unknown'));
    }
  }, [
    auPath,
    refreshGuard,
    setFocusSelection,
    setProjectInfo,
    setState,
    setUnresolvedFacts,
    showError,
    t,
  ]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return {
    loadData,
    refreshSettingsModeData,
  };
}
