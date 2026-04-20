// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, type MutableRefObject } from 'react';
import type {
  ContextSummary,
  DraftGeneratedWith,
} from '../../api/engine-client';
import type { GenerateRequestState } from '../../utils/writerStorage';

type UseWriterResetOnAuChangeOptions<TDraft> = {
  auPath: string;
  pendingContextSummaryRef: MutableRefObject<ContextSummary | null>;
  setIsSettingsModeBusy: (busy: boolean) => void;
  setFocusSelection: (focus: string[]) => void;
  setDrafts: (drafts: TDraft[]) => void;
  setActiveDraftIndex: (index: number) => void;
  setRecoveryNotice: (show: boolean) => void;
  setLastConfirmedChapter: (chapter: number | null) => void;
  setUndoConfirmOpen: (open: boolean) => void;
  setDirtyBannerDismissed: (dismissed: boolean) => void;
  setIsGenerating: (generating: boolean) => void;
  setIsFinalizing: (finalizing: boolean) => void;
  setIsDiscarding: (discarding: boolean) => void;
  setStreamText: (text: string) => void;
  setGeneratedWith: (generatedWith: DraftGeneratedWith | null) => void;
  setBudgetReport: (report: any) => void;
  setLastGenerateRequest: (request: GenerateRequestState | null) => void;
  setDraftSummaries: (summaries: Record<string, ContextSummary>) => void;
  setInstructionText: (text: string) => void;
  setFinalizeConfirmOpen: (open: boolean) => void;
  setDiscardConfirmOpen: (open: boolean) => void;
  setDirtyOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
  setMobileToolsOpen: (open: boolean) => void;
  resetFactsExtraction: () => void;
};

export function useWriterResetOnAuChange<TDraft>({
  auPath,
  pendingContextSummaryRef,
  setIsSettingsModeBusy,
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
  resetFactsExtraction,
}: UseWriterResetOnAuChangeOptions<TDraft>) {
  useEffect(() => {
    setIsSettingsModeBusy(false);
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
    resetFactsExtraction();
    setStreamText('');
    setGeneratedWith(null);
    setBudgetReport(null);
    setLastGenerateRequest(null);
    setDraftSummaries({});
    pendingContextSummaryRef.current = null;
    setInstructionText('');
    setFinalizeConfirmOpen(false);
    setDiscardConfirmOpen(false);
    setDirtyOpen(false);
    setExportOpen(false);
    setMobileToolsOpen(false);
  }, [
    auPath,
    pendingContextSummaryRef,
    resetFactsExtraction,
    setActiveDraftIndex,
    setBudgetReport,
    setDirtyBannerDismissed,
    setDirtyOpen,
    setDiscardConfirmOpen,
    setDraftSummaries,
    setDrafts,
    setExportOpen,
    setFinalizeConfirmOpen,
    setFocusSelection,
    setGeneratedWith,
    setInstructionText,
    setIsDiscarding,
    setIsFinalizing,
    setIsGenerating,
    setIsSettingsModeBusy,
    setLastConfirmedChapter,
    setLastGenerateRequest,
    setMobileToolsOpen,
    setRecoveryNotice,
    setStreamText,
    setUndoConfirmOpen,
  ]);
}
