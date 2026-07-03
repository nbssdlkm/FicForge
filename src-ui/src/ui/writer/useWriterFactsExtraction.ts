// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useCallback, useEffect } from 'react';
import { extractFacts, addFact, extractedEnrichment, type ExtractedFactCandidate } from '../../api/engine-client';
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import {
  getSkipFactsPromptDefault,
  setSkipFactsPromptPersisted,
} from '../../utils/writerStorage';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import { useExtractedSelection, getCandidateKey } from '../../hooks/useExtractedSelection';

// Phase 5b-2: lastConfirmedChapter 改为 method 调用时传入（而不是 hook 构造 arg），
// 破解与 useWriterChapterActions 的循环依赖，消除 factsExtractionBridgeRef。
export function useWriterFactsExtraction(auPath: string) {
  const { t } = useTranslation();
  const { showError, showSuccess, showToast } = useFeedback();
  const guard = useActiveRequestGuard(auPath);

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

  const handleOpenExtractReview = useCallback(async (lastConfirmedChapter: number | null) => {
    if (!lastConfirmedChapter) return;
    const requestAuPath = auPath;

    setExtractingFacts(true);
    try {
      const result = await extractFacts(auPath, lastConfirmedChapter);
      if (guard.isKeyStale(requestAuPath)) return;
      // 归属规范化（审计⑧）：本次提取是对单章 lastConfirmedChapter 跑的，所有候选都归该章。
      // 把 candidate.chapter 统一钉到该章 —— 既保证落库归属正确，也让 ExtractReviewModal
      // 展示的来源章与实际存储一致，不再显示 LLM 可能幻觉的章号（展示/存储不一致，对抗审 MEDIUM）。
      const candidates = (result.facts || []).map((c) => ({ ...c, chapter: lastConfirmedChapter }));
      setExtractedCandidates(candidates);
      selectAll(candidates);
      setFactsPromptOpen(false);
      setExtractReviewOpen(true);
      if (candidates.length === 0) {
        showToast(t('facts.extractNoResult'), 'info');
      }
    } catch (error) {
      if (guard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!guard.isKeyStale(requestAuPath)) {
        setExtractingFacts(false);
      }
    }
  }, [auPath, guard, showError, showToast, t, selectAll]);

  const handleSaveExtracted = useCallback(async (lastConfirmedChapter: number | null) => {
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
        // 归属用「本次提取所处理的确定章号」lastConfirmedChapter，而非 LLM 候选里可能幻觉的
        // candidate.chapter —— 对齐 backfill persistChapter「不信任 LLM chapter 字段」的口径（审计⑧）。
        // 提取是对单章 lastConfirmedChapter 跑的，所有候选都归该章；仅在极端缺失时才回退。
        await addFact(auPath, lastConfirmedChapter ?? candidate.chapter ?? 1, {
          content_raw: candidate.content_raw || candidate.content_clean,
          content_clean: candidate.content_clean,
          type: candidate.fact_type || candidate.type || 'plot_event',
          narrative_weight: candidate.narrative_weight || 'medium',
          status: candidate.status || 'active',
          characters: candidate.characters || [],
          ...(candidate.timeline ? { timeline: candidate.timeline } : {}),
          ...extractedEnrichment(candidate),  // caused_by + M8-A 富化（此前在此丢）
        });
      }
      if (guard.isKeyStale(requestAuPath)) return;

      showSuccess(t('facts.extractSaved', { count: selectedCandidates.length }));
      setExtractReviewOpen(false);
      setExtractedCandidates([]);
      clearSelection();
      focusInstructionInput();
    } catch (error) {
      if (guard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!guard.isKeyStale(requestAuPath)) {
        setSavingExtracted(false);
      }
    }
  }, [auPath, guard, extractedCandidates, filterSelected, focusInstructionInput, clearSelection, showError, showSuccess, t]);

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
    // closeFactsPrompt: 内部 handleSkipFactsPrompt 已使用，外部无消费者 → 不导出
    handleSkipFactsPrompt,
    handleOpenExtractReview,
    handleSaveExtracted,
    toggleExtractedCandidate,

    // helper
    getCandidateKey,
  };
}
