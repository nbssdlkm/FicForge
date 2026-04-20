// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  getDraft,
  listDrafts,
  saveDraft,
  type ContextSummary,
  type DraftDetail,
  type DraftGeneratedWith,
} from '../../api/engine-client';
import { saveContextSummaries } from '../../utils/writerStorage';

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
  drafts: DraftItem[];
  activeDraftIndex: number;
  currentChapterNum: number;
  pendingContextSummaryRef: MutableRefObject<ContextSummary | null>;
  setDrafts: Dispatch<SetStateAction<DraftItem[]>>;
  setActiveDraftIndex: Dispatch<SetStateAction<number>>;
  setStreamText: (text: string) => void;
  setGeneratedWith: (generatedWith: DraftGeneratedWith | null) => void;
  setBudgetReport: (report: any) => void;
  setRecoveryNotice: (show: boolean) => void;
  setDraftSummaries: Dispatch<SetStateAction<Record<string, ContextSummary>>>;
  onDraftSaveError?: (error: unknown) => void;
};

export function useWriterDraftController({
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
  onDraftSaveError,
}: UseWriterDraftControllerOptions) {
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftSaveRef = useRef<PendingDraftSave | null>(null);
  const draftSaveErrorShownRef = useRef(false);

  const persistDraft = useCallback(async (pending: PendingDraftSave) => {
    try {
      await saveDraft(pending.auPath, pending.chapterNum, pending.label, pending.content);
      draftSaveErrorShownRef.current = false;
    } catch (error) {
      if (!draftSaveErrorShownRef.current) {
        draftSaveErrorShownRef.current = true;
        onDraftSaveError?.(error);
      }
    }
  }, [onDraftSaveError]);

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

  const clearDraftState = useCallback((discard = false) => {
    setDrafts([]);
    setActiveDraftIndex(0);
    setStreamText('');
    setGeneratedWith(null);
    setBudgetReport(null);
    setRecoveryNotice(false);
    setDraftSummaries({});
    pendingContextSummaryRef.current = null;
    flushPendingDraftSave(discard);
  }, [
    flushPendingDraftSave,
    pendingContextSummaryRef,
    setActiveDraftIndex,
    setBudgetReport,
    setDraftSummaries,
    setDrafts,
    setGeneratedWith,
    setRecoveryNotice,
    setStreamText,
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

  useEffect(() => () => flushPendingDraftSave(), [flushPendingDraftSave]);

  return {
    clearDraftState,
    replaceDraftSummaries,
    attachDraftSummary,
    mergeDraftIntoState,
    loadDraftByLabel,
    loadDraftsForChapter,
    handleCurrentDraftChange,
  };
}
