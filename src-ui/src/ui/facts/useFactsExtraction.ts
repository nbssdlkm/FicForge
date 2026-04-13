// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useRef, useEffect, useCallback } from 'react';
import { addFact, submitFactsExtraction, type StateInfo } from '../../api/engine-client';
import { getEngine } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import type { TaskEvent } from '@ficforge/engine';

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

  // 当前运行中的 taskId
  const taskIdRef = useRef<string | null>(null);

  // 清理：组件卸载时取消订阅
  const unsubRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => { unsubRef.current?.(); };
  }, []);

  const handleExtractClick = () => {
    const totalConfirmed = (state?.current_chapter || 1) - 1;
    if (totalConfirmed <= 0) {
      showToast(t('facts.extractNoChapter'), 'info');
      return;
    }
    setExtractRange([1, totalConfirmed]);
    setExtractRangeOpen(true);
  };

  const handleExtractConfirm = useCallback(async () => {
    setExtractRangeOpen(false);
    const [from, to] = extractRange;
    const requestAuPath = auPath;

    setExtracting(true);
    setExtractProgress(0);

    try {
      const taskId = await submitFactsExtraction(requestAuPath, from, to);
      taskIdRef.current = taskId;

      // 订阅任务事件
      unsubRef.current?.();
      const unsub = getEngine().taskRunner.onEvent((id: string, event: TaskEvent) => {
        if (id !== taskId) return;
        if (activeAuPathRef.current !== requestAuPath) return;

        if (event.type === 'progress') {
          const pct = event.total > 0 ? Math.round((event.current / event.total) * 100) : 0;
          setExtractProgress(pct);
        } else if (event.type === 'completed') {
          const result = event.result as { facts: ExtractedFactCandidate[] } | undefined;
          const facts = result?.facts ?? [];
          setExtractedCandidates(facts);
          setExtractModalOpen(true);
          setExtracting(false);
          if (facts.length === 0) {
            showToast(t('facts.extractNoResult'), 'info');
          }
          taskIdRef.current = null;
          unsubRef.current?.();
        } else if (event.type === 'failed') {
          showError(new Error(event.error), t('error_messages.unknown'));
          setExtracting(false);
          taskIdRef.current = null;
          unsubRef.current?.();
        } else if (event.type === 'cancelled') {
          setExtracting(false);
          taskIdRef.current = null;
          unsubRef.current?.();
        }
      });
      unsubRef.current = unsub;
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
      setExtracting(false);
    }
  }, [auPath, extractRange, showError, showToast, t]);

  const handleCancelExtraction = useCallback(() => {
    if (taskIdRef.current) {
      getEngine().taskRunner.cancel(taskIdRef.current);
    }
  }, []);

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
    handleCancelExtraction,
  };
}
