// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useRef, useState } from 'react';
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
  mergeDraftIntoState: (draft: TDraft) => void;
  selectDraft: (index: number) => void;
  markRecoveryNotice: (show: boolean) => void;
  showError: (error: unknown, fallback: string) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
  applyFocusFromState: (focus: string[]) => void;
  loadInstructionFromStorage: (chapterNum: number) => void;
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
  mergeDraftIntoState,
  selectDraft,
  markRecoveryNotice,
  showError,
  t,
  applyFocusFromState,
  loadInstructionFromStorage,
}: UseWriterBootstrapOptions<TDraft>) {
  const [state, setState] = useState<StateInfo | null>(null);
  const [projectInfo, setProjectInfo] = useState<WriterProjectContext | null>(null);
  const [settingsInfo, setSettingsInfo] = useState<WriterSessionConfig | null>(null);
  const [currentContent, setCurrentContent] = useState('');
  const [unresolvedFacts, setUnresolvedFacts] = useState<FactInfo[]>([]);
  const [loading, setLoading] = useState(true);

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
      applyFocusFromState(stateData?.chapter_focus || []);

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

        clearDraftState();
        loadedDrafts.forEach((draft) => {
          mergeDraftIntoState(draft);
        });
        selectDraft(loadedDrafts.length > 0 ? loadedDrafts.length - 1 : 0);
        markRecoveryNotice(loadedDrafts.length > 0);
        loadInstructionFromStorage(stateData.current_chapter);
        replaceDraftSummaries(stateData.current_chapter, filteredSummaries);
      } else {
        clearDraftState();
        applyFocusFromState([]);
        loadInstructionFromStorage(0);
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
    applyFocusFromState,
    auPath,
    clearDraftState,
    getConfiguredLlmModel,
    loadDraftsForChapter,
    loadGuard,
    loadInstructionFromStorage,
    markRecoveryNotice,
    mergeDraftIntoState,
    replaceDraftSummaries,
    setSessionModel,
    setSessionTemp,
    setSessionTopP,
    selectDraft,
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
        applyFocusFromState(stateData.chapter_focus || []);
      }
      setProjectInfo(proj);
      setUnresolvedFacts(factsData);
    } catch (error) {
      if (refreshGuard.isStale(token)) return;
      showError(error, t('error_messages.unknown'));
    }
  }, [
    applyFocusFromState,
    auPath,
    refreshGuard,
    showError,
    t,
  ]);

  useEffect(() => {
    setState(null);
    setProjectInfo(null);
    setSettingsInfo(null);
    setCurrentContent('');
    setUnresolvedFacts([]);
    setLoading(true);
  }, [auPath]);

  // loadData 的 useCallback 有 24 个依赖；其中某个在每次 render 时引用不稳，
  // 直接 useEffect([loadData]) 会无限重触发 → loadData 跑一遍 → setState 触发 re-render
  // → loadData 重建 → useEffect 又触发，每秒 100+ 次。Android 真机肉眼可见加载圈不停。
  // 用 ref 持有最新 loadData，useEffect 仅按 auPath 触发。Phase 1 状态下沉后 deps
  // 自然减少，可重新评估是否回到 [loadData]。
  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;

  useEffect(() => {
    void loadDataRef.current();
  }, [auPath]);

  const applyStateSnapshot = useCallback((nextState: StateInfo) => {
    setState(nextState);
  }, []);

  return {
    data: {
      state,
      projectInfo,
      settingsInfo,
      currentContent,
      unresolvedFacts,
    },
    loading,
    applyStateSnapshot,
    loadData,
    refreshSettingsModeData,
  };
}
