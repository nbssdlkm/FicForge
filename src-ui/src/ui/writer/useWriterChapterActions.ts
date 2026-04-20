// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from 'react';
import {
  confirmChapter,
  deleteDrafts,
  undoChapter,
  type ContextSummary,
  type StateInfo,
} from '../../api/engine-client';
import type { ActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import type { DraftItem } from './useWriterDraftController';

type UseWriterChapterActionsOptions = {
  auPath: string;
  state: StateInfo | null;
  drafts: DraftItem[];
  activeDraftIndex: number;
  chapterTitle: string;
  focusSelection: string[];
  getSkipFactsPrompt: () => boolean;
  loadGuard: ActiveRequestGuard<string>;
  clearDraftState: (discard?: boolean) => void;
  replaceDraftSummaries: (chapterNum: number, summaries: Record<string, ContextSummary>) => void;
  loadData: () => Promise<void>;
  focusInstructionInput: () => void;
  onChaptersChanged?: () => void;
  onCloseFinalizeConfirm: () => void;
  onCloseDiscardConfirm: () => void;
  onCloseUndoConfirm: () => void;
  onOpenFactsPrompt: () => void;
  showSuccess: (message: string) => void;
  showToast: (message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  showError: (error: unknown, fallback: string) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
};

export function useWriterChapterActions({
  auPath,
  state,
  drafts,
  activeDraftIndex,
  chapterTitle,
  focusSelection,
  getSkipFactsPrompt,
  loadGuard,
  clearDraftState,
  replaceDraftSummaries,
  loadData,
  focusInstructionInput,
  onChaptersChanged,
  onCloseFinalizeConfirm,
  onCloseDiscardConfirm,
  onCloseUndoConfirm,
  onOpenFactsPrompt,
  showSuccess,
  showToast,
  showError,
  t,
}: UseWriterChapterActionsOptions) {
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [lastConfirmedChapter, setLastConfirmedChapter] = useState<number | null>(null);

  useEffect(() => {
    setIsFinalizing(false);
    setIsDiscarding(false);
    setLastConfirmedChapter(null);
  }, [auPath]);

  const handleConfirm = useCallback(async () => {
    const currentDraft = drafts[activeDraftIndex];
    if (!currentDraft || !state) return;
    const requestAuPath = auPath;
    const confirmedFocus = [...focusSelection];
    const skipFactsPrompt = getSkipFactsPrompt();

    setIsFinalizing(true);
    try {
      const confirmedChapter = state.current_chapter;
      await confirmChapter(
        auPath,
        confirmedChapter,
        currentDraft.draftId,
        currentDraft.generatedWith || undefined,
        currentDraft.modified ? currentDraft.content : undefined,
        chapterTitle.trim() || undefined,
      );
      if (loadGuard.isKeyStale(requestAuPath)) return;

      clearDraftState(true);
      replaceDraftSummaries(confirmedChapter, {});
      onCloseFinalizeConfirm();
      setLastConfirmedChapter(confirmedChapter);
      await loadData();
      onChaptersChanged?.();

      if (skipFactsPrompt) {
        showSuccess(t('drafts.finalizeSuccess', { chapter: confirmedChapter }));
        if (confirmedFocus.length > 0) {
          showToast(t('focus.resolvePrompt'), 'info');
        }
        focusInstructionInput();
        return;
      }

      onOpenFactsPrompt();
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!loadGuard.isKeyStale(requestAuPath)) {
        setIsFinalizing(false);
      }
    }
  }, [
    activeDraftIndex,
    auPath,
    chapterTitle,
    clearDraftState,
    drafts,
    focusInstructionInput,
    focusSelection,
    getSkipFactsPrompt,
    loadData,
    loadGuard,
    onChaptersChanged,
    onCloseFinalizeConfirm,
    onOpenFactsPrompt,
    replaceDraftSummaries,
    showError,
    showSuccess,
    showToast,
    state,
    t,
  ]);

  const handleUndoConfirmed = useCallback(async () => {
    const requestAuPath = auPath;
    onCloseUndoConfirm();
    try {
      await undoChapter(auPath);
      if (loadGuard.isKeyStale(requestAuPath)) return;
      clearDraftState(true);
      showSuccess(t('writer.undoSuccess'));
      await loadData();
      onChaptersChanged?.();
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    }
  }, [
    auPath,
    clearDraftState,
    loadData,
    loadGuard,
    onChaptersChanged,
    onCloseUndoConfirm,
    showError,
    showSuccess,
    t,
  ]);

  const handleDiscardDrafts = useCallback(async () => {
    if (!state || drafts.length === 0) return;
    const requestAuPath = auPath;
    const currentDraft = drafts[activeDraftIndex];
    const isSingleDraft = drafts.length === 1;

    setIsDiscarding(true);
    try {
      await deleteDrafts(
        auPath,
        state.current_chapter,
        isSingleDraft ? currentDraft?.label : undefined,
      );
      if (loadGuard.isKeyStale(requestAuPath)) return;

      clearDraftState(true);
      replaceDraftSummaries(state.current_chapter, {});
      onCloseDiscardConfirm();
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
  }, [
    activeDraftIndex,
    auPath,
    clearDraftState,
    drafts,
    focusInstructionInput,
    loadGuard,
    onCloseDiscardConfirm,
    replaceDraftSummaries,
    showError,
    showToast,
    state,
    t,
  ]);

  return {
    isFinalizing,
    isDiscarding,
    lastConfirmedChapter,
    handleConfirm,
    handleUndoConfirmed,
    handleDiscardDrafts,
  };
}
