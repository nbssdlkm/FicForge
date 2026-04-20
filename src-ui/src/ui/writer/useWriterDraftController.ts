// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDraft,
  listDrafts,
  saveDraft,
  type ContextSummary,
  type DraftDetail,
  type DraftGeneratedWith,
  type StateInfo,
} from '../../api/engine-client';
import { readSavedContextSummaries, saveContextSummaries } from '../../utils/writerStorage';

export type DraftItem = {
  label: string;
  draftId: string;
  content: string;
  generatedWith?: DraftGeneratedWith | null;
  modified: boolean;
};

function buildDraftId(chapterNum: number, label: string): string {
  return `ch${String(chapterNum).padStart(4, '0')}_draft_${label}.md`;
}

export function createDraftItem(
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

type PendingDraftSave = {
  auPath: string;
  chapterNum: number;
  label: string;
  content: string;
};

type UseWriterDraftControllerOptions = {
  auPath: string;
  state: StateInfo | null;   // Phase 5c: 接管 draft 加载，自主 watch state.current_chapter
  onDraftSaveError?: (error: unknown) => void;
};

export function useWriterDraftController({
  auPath,
  state,
  onDraftSaveError,
}: UseWriterDraftControllerOptions) {
  const currentChapterNum = state?.current_chapter ?? 0;
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [activeDraftIndex, setActiveDraftIndex] = useState(0);
  const [streamText, setStreamText] = useState('');
  const [generatedWith, setGeneratedWith] = useState<DraftGeneratedWith | null>(null);
  const [budgetReport, setBudgetReport] = useState<any>(null);
  const [recoveryNotice, setRecoveryNotice] = useState(false);
  const [draftSummaries, setDraftSummaries] = useState<Record<string, ContextSummary>>({});
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftSaveRef = useRef<PendingDraftSave | null>(null);
  const pendingContextSummaryRef = useRef<ContextSummary | null>(null);
  const draftSaveErrorShownRef = useRef(false);
  const onDraftSaveErrorRef = useRef(onDraftSaveError);
  onDraftSaveErrorRef.current = onDraftSaveError;

  const persistDraft = useCallback(async (pending: PendingDraftSave) => {
    try {
      await saveDraft(pending.auPath, pending.chapterNum, pending.label, pending.content);
      draftSaveErrorShownRef.current = false;
    } catch (error) {
      if (!draftSaveErrorShownRef.current) {
        draftSaveErrorShownRef.current = true;
        onDraftSaveErrorRef.current?.(error);
      }
    }
  }, []);

  const flushPendingDraftSave = useCallback((discard = false) => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }

    const pending = pendingDraftSaveRef.current;
    if (pending && !discard) {
      void persistDraft(pending);
    }

    pendingDraftSaveRef.current = null;
  }, [persistDraft]);

  const appendStream = useCallback((text: string) => {
    setStreamText((current) => current + text);
  }, []);

  const resetStream = useCallback(() => {
    setStreamText('');
  }, []);

  const markGeneratedWith = useCallback((value: DraftGeneratedWith | null) => {
    setGeneratedWith(value);
  }, []);

  const markBudgetReport = useCallback((report: any) => {
    setBudgetReport(report);
  }, []);

  const markRecoveryNotice = useCallback((show: boolean) => {
    setRecoveryNotice(show);
  }, []);

  const attachPendingContextSummary = useCallback((summary: ContextSummary | null) => {
    pendingContextSummaryRef.current = summary;
  }, []);

  const getPendingContextSummary = useCallback(() => pendingContextSummaryRef.current, []);

  const selectDraft = useCallback((index: number) => {
    if (drafts.length === 0) {
      setActiveDraftIndex(0);
      return;
    }
    setActiveDraftIndex(Math.max(0, Math.min(drafts.length - 1, index)));
  }, [drafts.length]);

  const clearDraftState = useCallback((discard = false) => {
    setDrafts([]);
    setActiveDraftIndex(0);
    resetStream();
    markGeneratedWith(null);
    markBudgetReport(null);
    markRecoveryNotice(false);
    setDraftSummaries({});
    pendingContextSummaryRef.current = null;
    flushPendingDraftSave(discard);
  }, [
    flushPendingDraftSave,
    markBudgetReport,
    markGeneratedWith,
    markRecoveryNotice,
    resetStream,
  ]);

  const replaceDraftSummaries = useCallback((chapterNum: number, summaries: Record<string, ContextSummary>) => {
    setDraftSummaries(summaries);
    saveContextSummaries(auPath, chapterNum, summaries);
  }, [auPath, setDraftSummaries]);

  const attachDraftSummary = useCallback((chapterNum: number, label: string, summary: ContextSummary) => {
    setDraftSummaries((current) => {
      const next = {
        ...current,
        [label]: summary,
      };
      saveContextSummaries(auPath, chapterNum, next);
      return next;
    });
  }, [auPath, setDraftSummaries]);

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
  }, [setActiveDraftIndex, setDrafts]);

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

  const handleCurrentDraftChange = useCallback((content: string) => {
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

    const label = drafts[activeDraftIndex]?.label;
    if (!label) return;

    const chapterNum = currentChapterNum || 1;
    pendingDraftSaveRef.current = { auPath, chapterNum, label, content };
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
    }
    draftSaveTimerRef.current = setTimeout(() => {
      void persistDraft({ auPath, chapterNum, label, content });
      pendingDraftSaveRef.current = null;
      draftSaveTimerRef.current = null;
    }, 1500);
  }, [activeDraftIndex, auPath, currentChapterNum, drafts, persistDraft, setDrafts]);

  // Phase 5c: 消除 draftControllerBridgeRef。draftCtrl 自主 watch state，
  // 当 state 为 null（切 AU 或重置）→ 清空；当 state.current_chapter 变化 → 加载该章节 drafts + summaries。
  // 原来这段编排在 bootstrap.loadData 里通过 bridge 反注入 draftCtrl 的 setters。
  useEffect(() => {
    // 切 AU 或 state 为 null（bootstrap 正在 reset）→ 清空所有 draft 状态
    if (!state) {
      setDrafts([]);
      setActiveDraftIndex(0);
      setStreamText('');
      setGeneratedWith(null);
      setBudgetReport(null);
      setRecoveryNotice(false);
      setDraftSummaries({});
      pendingContextSummaryRef.current = null;
      flushPendingDraftSave(true);
      return;
    }

    // state 可用 → 加载当前章节的 drafts + summaries
    const chapterNum = state.current_chapter;
    let cancelled = false;
    (async () => {
      try {
        const list = await listDrafts(auPath, chapterNum);
        if (cancelled) return;
        const details = await Promise.all(
          list.map((draft) => getDraft(auPath, chapterNum, draft.draft_label)),
        );
        if (cancelled) return;

        const loadedDrafts = sortDrafts(
          details.map((detail) => createDraftItemFromDetail(chapterNum, detail)),
        );
        const storedSummaries = readSavedContextSummaries(auPath, chapterNum);
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

        // 重置然后 populate（顺序：先清、再设）
        setStreamText('');
        setGeneratedWith(null);
        setBudgetReport(null);
        pendingContextSummaryRef.current = null;
        setDrafts(loadedDrafts);
        setActiveDraftIndex(loadedDrafts.length > 0 ? loadedDrafts.length - 1 : 0);
        setRecoveryNotice(loadedDrafts.length > 0);
        setDraftSummaries(filteredSummaries);
        saveContextSummaries(auPath, chapterNum, filteredSummaries);
        flushPendingDraftSave(true);
      } catch {
        // listDrafts / getDraft 失败时静默 —— drafts 保持空
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auPath, state?.current_chapter, flushPendingDraftSave]);

  useEffect(() => () => flushPendingDraftSave(), [flushPendingDraftSave]);

  return {
    drafts,
    activeDraftIndex,
    streamText,
    generatedWith,
    budgetReport,
    recoveryNotice,
    draftSummaries,
    appendStream,
    resetStream,
    markGeneratedWith,
    markBudgetReport,
    markRecoveryNotice,
    attachPendingContextSummary,
    getPendingContextSummary,
    selectDraft,
    clearDraftState,
    replaceDraftSummaries,
    attachDraftSummary,
    mergeDraftIntoState,
    loadDraftByLabel,
    loadDraftsForChapter,
    handleCurrentDraftChange,
  };
}
