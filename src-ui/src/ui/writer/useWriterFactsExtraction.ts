// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useCallback, useEffect, useRef } from 'react';
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
  // 本轮提取的目标章号，随提取一起住在 hook 内 —— 调用方（对话面板/写文 modal）
  // 不必再各自维护一份「提取给哪章」的影子状态（审计 H2 状态上移的一部分）。
  const [extractTargetChapter, setExtractTargetChapter] = useState<number | null>(null);
  // 在飞提取的取消句柄。提取是多秒 LLM 调用：AU 切换 / 宿主卸载时 abort，
  // 避免结果无宿主可落还继续烧 token（审计 H2）。
  const extractAbortRef = useRef<AbortController | null>(null);
  // M25：半成功去重。逐条 addFact 中途抛错（网络/磁盘）时，已入库的前半条要记下来，
  // 重试只补余下 —— 否则整批候选原封不动，重试把前半再存一遍产生重复 fact。
  // 用对象引用集合（candidate 引用在一轮 review 内稳定，不受索引 key 位移影响）。
  const savedCandidatesRef = useRef<Set<ExtractedFactCandidate>>(new Set());

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

    // 连续触发（连着接受两章）时旧一轮结果已无意义，先取消再起新一轮
    extractAbortRef.current?.abort();
    const controller = new AbortController();
    extractAbortRef.current = controller;

    setExtractTargetChapter(lastConfirmedChapter);
    setExtractingFacts(true);
    try {
      const result = await extractFacts(auPath, lastConfirmedChapter, { signal: controller.signal });
      if (controller.signal.aborted || guard.isKeyStale(requestAuPath)) return;
      // 归属规范化（审计⑧）：本次提取是对单章 lastConfirmedChapter 跑的，所有候选都归该章。
      // 把 candidate.chapter 统一钉到该章 —— 既保证落库归属正确，也让 ExtractReviewModal
      // 展示的来源章与实际存储一致，不再显示 LLM 可能幻觉的章号（展示/存储不一致，对抗审 MEDIUM）。
      const candidates = (result.facts || []).map((c) => ({ ...c, chapter: lastConfirmedChapter }));
      // 新一轮候选 → 清空上一轮的「已保存」登记（M25），避免跨轮误跳过。
      savedCandidatesRef.current = new Set();
      setExtractedCandidates(candidates);
      selectAll(candidates);
      setFactsPromptOpen(false);
      // 零候选不开空 modal（对抗审 A-8）：只 toast——否则「提取完成回对话查看」的
      // 异地提示会把用户叫回来看一个空列表。
      if (candidates.length === 0) {
        showToast(t('facts.extractNoResult'), 'info');
      } else {
        setExtractReviewOpen(true);
      }
    } catch (error) {
      // 主动取消（AU 切换 / 宿主卸载 / 新一轮顶替）不是错误，静默收尾
      if (controller.signal.aborted || guard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!controller.signal.aborted && !guard.isKeyStale(requestAuPath)) {
        setExtractingFacts(false);
      }
    }
  }, [auPath, guard, showError, showToast, t, selectAll]);

  const handleSaveExtracted = useCallback(async (lastConfirmedChapter: number | null) => {
    if (selectedExtractedKeys.length === 0) {
      setExtractReviewOpen(false);
      setExtractTargetChapter(null);
      focusInstructionInput();
      return;
    }

    setSavingExtracted(true);
    const requestAuPath = auPath;
    // hook 内部记录的提取目标章优先（handleOpenExtractReview 设置），参数仅作
    // 旧调用方（写文 modal 链）兼容回退 —— 两者本应同值，内部值消除影子状态漂移。
    const targetChapter = extractTargetChapter ?? lastConfirmedChapter;
    let savedThisRun = 0;
    try {
      const selectedCandidates = filterSelected(extractedCandidates);

      for (const candidate of selectedCandidates) {
        // M25：跳过本轮已成功入库的候选（上一次半成功遗留），只补余下。
        if (savedCandidatesRef.current.has(candidate)) continue;
        // 归属用「本次提取所处理的确定章号」targetChapter，而非 LLM 候选里可能幻觉的
        // candidate.chapter —— 对齐 backfill persistChapter「不信任 LLM chapter 字段」的口径（审计⑧）。
        // 提取是对单章跑的，所有候选都归该章；仅在极端缺失时才回退。
        await addFact(auPath, targetChapter ?? candidate.chapter ?? 1, {
          content_raw: candidate.content_raw || candidate.content_clean,
          content_clean: candidate.content_clean,
          type: candidate.fact_type || candidate.type || 'plot_event',
          narrative_weight: candidate.narrative_weight || 'medium',
          status: candidate.status || 'active',
          characters: candidate.characters || [],
          ...(candidate.timeline ? { timeline: candidate.timeline } : {}),
          ...extractedEnrichment(candidate),  // caused_by + M8-A 富化（此前在此丢）
        });
        // 每条成功后立即登记：即便下一条抛错，这条也不会在重试时重存。
        savedCandidatesRef.current.add(candidate);
        savedThisRun += 1;
      }
      if (guard.isKeyStale(requestAuPath)) return;

      showSuccess(t('facts.extractSaved', { count: savedThisRun }));
      setExtractReviewOpen(false);
      setExtractedCandidates([]);
      setExtractTargetChapter(null);
      savedCandidatesRef.current = new Set();
      clearSelection();
      focusInstructionInput();
    } catch (error) {
      if (guard.isKeyStale(requestAuPath)) return;
      // 半成功：已入库的候选已登记进 savedCandidatesRef，modal 保持打开、候选/勾选原封不动，
      // 用户点重试时只补未存的余下部分。
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!guard.isKeyStale(requestAuPath)) {
        setSavingExtracted(false);
      }
    }
  }, [auPath, guard, extractedCandidates, extractTargetChapter, filterSelected, focusInstructionInput, clearSelection, showError, showSuccess, t]);

  /** 关闭提取预览（不落库）。动词方法，取代调用方直接摸 setExtractReviewOpen。 */
  const closeExtractReview = useCallback(() => {
    setExtractReviewOpen(false);
    setExtractTargetChapter(null);
  }, []);

  /** 用户主动取消在飞提取（R1-7）：abort 请求 + 复位 extracting 指示。
   * handleOpenExtractReview 的 catch/finally 对 aborted signal 静默收尾（不 toast 报错），
   * 这里直接复位 extractingFacts —— 其 finally 在 aborted 时不会碰它。 */
  const cancelExtraction = useCallback(() => {
    extractAbortRef.current?.abort();
    extractAbortRef.current = null;
    setExtractingFacts(false);
    setExtractTargetChapter(null);
  }, []);

  const resetExtractionState = useCallback(() => {
    setExtractingFacts(false);
    setSavingExtracted(false);
    setExtractedCandidates([]);
    setExtractTargetChapter(null);
    savedCandidatesRef.current = new Set();
    clearSelection();
    setFactsPromptOpen(false);
    setExtractReviewOpen(false);
  }, [clearSelection]);

  useEffect(() => {
    resetExtractionState();
  }, [auPath]);

  // AU 切换 / 宿主卸载：取消在飞提取。提取结果只有 review modal 一个出口，
  // 宿主没了结果无处可落，继续跑纯属白烧 token（审计 H2）。
  useEffect(() => {
    return () => {
      extractAbortRef.current?.abort();
      extractAbortRef.current = null;
    };
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
    closeExtractReview,
    cancelExtraction,
    toggleExtractedCandidate,

    // helper
    getCandidateKey,
  };
}
