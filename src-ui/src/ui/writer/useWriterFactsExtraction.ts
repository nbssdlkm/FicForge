// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useRef, useCallback, useEffect } from 'react';
import { extractFacts, addFact, type ExtractedFactCandidate } from '../../api/engine-client';
import {
  getSkipFactsPromptDefault,
  setSkipFactsPromptPersisted,
} from '../../utils/writerStorage';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import { useExtractedSelection, getCandidateKey } from '../../hooks/useExtractedSelection';

export function useWriterFactsExtraction(auPath: string, lastConfirmedChapter: number | null) {
  const { t } = useTranslation();
  const { showError, showSuccess, showToast } = useFeedback();
  const activeAuPathRef = useRef(auPath);
  activeAuPathRef.current = auPath;

  const [isFactsPromptOpen, setFactsPromptOpen] = useState(false);
  const [isExtractReviewOpen, setExtractReviewOpen] = useState(false);
  const [extractingFacts, setExtractingFacts] = useState(false);
  const [savingExtracted, setSavingExtracted] = useState(false);
  const [extractedCandidates, setExtractedCandidates] = useState<ExtractedFactCandidate[]>([]);
  const { selectedExtractedKeys, selectAll, clearSelection, toggleExtractedCandidate, filterSelected } = useExtractedSelection();
  const [skipFactsPrompt, setSkipFactsPrompt] = useState(getSkipFactsPromptDefault());

  const focusInstructionInput = useCallback(() => {
    // The parent component should provide its own focus mechanism;
    // this is a placeholder that mirrors the original inline helper.
    // Consumers can override via the returned closeFactsPrompt / handleSkipFactsPrompt.
  }, []);

  const handleFactsPromptToggle = useCallback((checked: boolean) => {
    setSkipFactsPrompt(checked);
    setSkipFactsPromptPersisted(checked);
  }, []);

  const closeFactsPrompt = useCallback(() => {
    setFactsPromptOpen(false);
    focusInstructionInput();
  }, [focusInstructionInput]);

  const handleSkipFactsPrompt = useCallback(() => {
    closeFactsPrompt();
  }, [closeFactsPrompt]);

  const handleOpenExtractReview = useCallback(async () => {
    if (!lastConfirmedChapter) return;
    const requestAuPath = auPath;

    setExtractingFacts(true);
    try {
      const result = await extractFacts(auPath, lastConfirmedChapter);
      if (activeAuPathRef.current !== requestAuPath) return;
      const candidates = result.facts || [];
      setExtractedCandidates(candidates);
      selectAll(candidates);
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
  }, [auPath, lastConfirmedChapter, showError, showToast, t, selectAll]);

  const handleSaveExtracted = useCallback(async () => {
    if (selectedExtractedKeys.length === 0) {
      setExtractReviewOpen(false);
      focusInstructionInput();
      return;
    }

    setSavingExtracted(true);
    const requestAuPath = auPath;
    try {
      const selectedCandidates = filterSelected(extractedCandidates);

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
      clearSelection();
      focusInstructionInput();
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setSavingExtracted(false);
      }
    }
  }, [auPath, extractedCandidates, filterSelected, focusInstructionInput, lastConfirmedChapter, clearSelection, showError, showSuccess, t]);

  const resetExtractionState = useCallback(() => {
    setExtractingFacts(false);
    setSavingExtracted(false);
    setExtractedCandidates([]);
    clearSelection();
    setFactsPromptOpen(false);
    setExtractReviewOpen(false);
  }, [clearSelection]);

  useEffect(() => {
    resetExtractionState();
  }, [auPath]);

  return {
    // state
    isFactsPromptOpen,
    setFactsPromptOpen,
    isExtractReviewOpen,
    setExtractReviewOpen,
    extractingFacts,
    setExtractingFacts,
    savingExtracted,
    setSavingExtracted,
    extractedCandidates,
    setExtractedCandidates,
    selectedExtractedKeys,
    clearSelection,
    skipFactsPrompt,
    setSkipFactsPrompt,

    // handlers
    handleFactsPromptToggle,
    closeFactsPrompt,
    handleSkipFactsPrompt,
    handleOpenExtractReview,
    handleSaveExtracted,
    toggleExtractedCandidate,

    // helper
    getCandidateKey,
  };
}
