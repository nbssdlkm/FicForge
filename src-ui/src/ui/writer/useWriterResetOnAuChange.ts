// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, type MutableRefObject } from 'react';
import type {
  ContextSummary,
  DraftGeneratedWith,
  ExtractedFactCandidate,
  FactInfo,
  StateInfo,
  WriterProjectContext,
  WriterSessionConfig,
} from '../../api/engine-client';
import type { GenerateRequestState } from '../../utils/writerStorage';

type UseWriterResetOnAuChangeOptions<TDraft> = {
  auPath: string;
  pendingContextSummaryRef: MutableRefObject<ContextSummary | null>;
  setLoading: (loading: boolean) => void;
  setIsSettingsModeBusy: (busy: boolean) => void;
  setState: (state: StateInfo | null) => void;
  setProjectInfo: (project: WriterProjectContext | null) => void;
  setSettingsInfo: (settings: WriterSessionConfig | null) => void;
  setCurrentContent: (content: string) => void;
  setUnresolvedFacts: (facts: FactInfo[]) => void;
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
  factsExtraction: {
    setExtractingFacts: (extracting: boolean) => void;
    setSavingExtracted: (saving: boolean) => void;
    setExtractedCandidates: (candidates: ExtractedFactCandidate[]) => void;
    clearSelection: () => void;
    setFactsPromptOpen: (open: boolean) => void;
    setExtractReviewOpen: (open: boolean) => void;
  };
};

export function useWriterResetOnAuChange<TDraft>({
  auPath,
  pendingContextSummaryRef,
  setLoading,
  setIsSettingsModeBusy,
  setState,
  setProjectInfo,
  setSettingsInfo,
  setCurrentContent,
  setUnresolvedFacts,
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
  factsExtraction,
}: UseWriterResetOnAuChangeOptions<TDraft>) {
  useEffect(() => {
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
  }, [
    auPath,
    factsExtraction,
    pendingContextSummaryRef,
    setActiveDraftIndex,
    setBudgetReport,
    setCurrentContent,
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
    setLoading,
    setMobileToolsOpen,
    setProjectInfo,
    setRecoveryNotice,
    setSettingsInfo,
    setState,
    setStreamText,
    setUndoConfirmOpen,
    setUnresolvedFacts,
  ]);
}
