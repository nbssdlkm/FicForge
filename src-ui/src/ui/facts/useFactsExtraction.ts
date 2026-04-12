// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useRef } from 'react';
import { addFact, extractFactsBatch, type StateInfo } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';

type ExtractedFactCandidate = {
  content_raw: string;
  content_clean: string;
  characters: string[];
  fact_type?: string;
  type?: string;
  narrative_weight: string;
  status: string;
  chapter: number;
  timeline?: string;
};

export function useFactsExtraction(auPath: string, state: StateInfo | null, onSaved: () => void) {
  const { t } = useTranslation();
  const { showError, showSuccess, showToast } = useFeedback();

  const activeAuPathRef = useRef(auPath);
  activeAuPathRef.current = auPath;

  const [extracting, setExtracting] = useState(false);
  const [extractModalOpen, setExtractModalOpen] = useState(false);
  const [extractedCandidates, setExtractedCandidates] = useState<ExtractedFactCandidate[]>([]);
  const [extractRangeOpen, setExtractRangeOpen] = useState(false);
  const [extractRange, setExtractRange] = useState<[number, number]>([1, 1]);
  const [extractProgress, setExtractProgress] = useState(0);
  const [savingExtraction, setSavingExtraction] = useState(false);

  const handleExtractClick = () => {
    const totalConfirmed = (state?.current_chapter || 1) - 1;
    if (totalConfirmed <= 0) {
      showToast(t('facts.extractNoChapter'), 'info');
      return;
    }
    setExtractRange([1, totalConfirmed]);
    setExtractRangeOpen(true);
  };

  const handleExtractConfirm = async () => {
    setExtractRangeOpen(false);
    const [from, to] = extractRange;

    const requestAuPath = auPath;
    setExtracting(true);
    setExtractProgress(0);
    try {
      const allCandidates: ExtractedFactCandidate[] = [];
      const totalChapters = to - from + 1;
      const batchSize = 3; // 每 3 章合并为一个 LLM 请求
      let done = 0;
      for (let start = from; start <= to; start += batchSize) {
        const chapterNums: number[] = [];
        for (let ch = start; ch <= Math.min(start + batchSize - 1, to); ch++) {
          chapterNums.push(ch);
        }
        const result = await extractFactsBatch(requestAuPath, chapterNums).catch(() => ({ facts: [] }));
        if (activeAuPathRef.current !== requestAuPath) return;
        allCandidates.push(...((result?.facts || []) as ExtractedFactCandidate[]));
        done += chapterNums.length;
        setExtractProgress(Math.round((done / totalChapters) * 100));
      }
      if (activeAuPathRef.current !== requestAuPath) return;
      setExtractedCandidates(allCandidates);
      setExtractModalOpen(true);
      if (allCandidates.length === 0) {
        showToast(t('facts.extractNoResult'), 'info');
      }
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setExtracting(false);
      }
    }
  };

  const handleSaveExtracted = async () => {
    if (extractedCandidates.length === 0) {
      setExtractModalOpen(false);
      return;
    }

    const requestAuPath = auPath;
    setSavingExtraction(true);
    try {
      for (const candidate of extractedCandidates) {
        await addFact(requestAuPath, candidate.chapter || 1, {
          content_raw: candidate.content_raw || candidate.content_clean,
          content_clean: candidate.content_clean,
          type: candidate.fact_type || candidate.type || 'plot_event',
          narrative_weight: candidate.narrative_weight || 'medium',
          status: candidate.status || 'active',
          characters: candidate.characters || [],
          ...(candidate.timeline ? { timeline: candidate.timeline } : {}),
        });
        if (activeAuPathRef.current !== requestAuPath) return;
      }

      showSuccess(t('facts.extractSaved', { count: extractedCandidates.length }));
      setExtractModalOpen(false);
      setExtractedCandidates([]);
      await onSaved();
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setSavingExtraction(false);
      }
    }
  };

  return {
    extracting,
    setExtracting,
    extractModalOpen,
    setExtractModalOpen,
    extractedCandidates,
    setExtractedCandidates,
    extractRangeOpen,
    setExtractRangeOpen,
    extractRange,
    setExtractRange,
    extractProgress,
    savingExtraction,
    handleExtractClick,
    handleExtractConfirm,
    handleSaveExtracted,
  };
}
