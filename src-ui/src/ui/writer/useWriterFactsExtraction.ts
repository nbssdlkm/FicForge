// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useRef, useCallback } from 'react';
import { extractFacts, addFact, type ExtractedFactCandidate } from '../../api/engine-client';
import {
  getSkipFactsPromptDefault,
  setSkipFactsPromptPersisted,
} from '../../utils/writerStorage';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';

function getCandidateKey(candidate: ExtractedFactCandidate, index: number): string {
  return `${candidate.content_clean}-${candidate.chapter}-${index}`;
}

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
  const [selectedExtractedKeys, setSelectedExtractedKeys] = useState<string[]>([]);
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
      setSelectedExtractedKeys(candidates.map((candidate, index) => getCandidateKey(candidate, index)));
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
  }, [auPath, lastConfirmedChapter, showError, showToast, t]);

  const handleSaveExtracted = useCallback(async () => {
    if (selectedExtractedKeys.length === 0) {
      setExtractReviewOpen(false);
      focusInstructionInput();
      return;
    }

    setSavingExtracted(true);
    const requestAuPath = auPath;
    try {
      const selectedCandidates = extractedCandidates.filter((candidate, index) =>
        selectedExtractedKeys.includes(getCandidateKey(candidate, index))
      );

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
      setSelectedExtractedKeys([]);
      focusInstructionInput();
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setSavingExtracted(false);
      }
    }
  }, [auPath, extractedCandidates, focusInstructionInput, lastConfirmedChapter, selectedExtractedKeys, showError, showSuccess, t]);

  const toggleExtractedCandidate = useCallback((key: string) => {
    setSelectedExtractedKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    );
  }, []);

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
    setSelectedExtractedKeys,
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
