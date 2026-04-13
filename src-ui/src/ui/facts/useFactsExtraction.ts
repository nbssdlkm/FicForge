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

  // 订阅事件的复用逻辑（submit 和 reconnect 共用）
  // 用 ref 持有，避免 identity 变化触发 reconnect effect 重跑
  const subscribeToTask = useCallback((taskId: string, requestAuPath: string) => {
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
  }, [showError, showToast, t]);
  const subscribeRef = useRef(subscribeToTask);
  subscribeRef.current = subscribeToTask;

  // 挂载 / auPath 切换时：接续运行中任务 or 恢复已完成结果 or 重置
  useEffect(() => {
    const runner = getEngine().taskRunner;
    taskIdRef.current = null;

    // 1. 查找 active（pending/running）的 facts_extraction 任务
    const active = runner.getActiveTasks().find(
      (h) => h.type === 'facts_extraction' && (h.params as { auPath?: string })?.auPath === auPath
    );
    if (active) {
      taskIdRef.current = active.id;
      setExtracting(true);
      const pct = active.progress.total > 0
        ? Math.round((active.progress.current / active.progress.total) * 100)
        : 0;
      setExtractProgress(pct);
      subscribeRef.current(active.id, auPath);
      return () => { unsubRef.current?.(); };
    }

    // 当前 auPath 无活跃任务 → 不在提取中
    setExtracting(false);
    setExtractProgress(0);

    // 2. 查找刚完成的（用户切走期间完成了）
    const completed = runner.getCompletedTasks().find(
      (h) => h.type === 'facts_extraction'
        && h.status === 'completed'
        && (h.params as { auPath?: string })?.auPath === auPath
    );
    if (completed?.result) {
      const result = completed.result as { facts: ExtractedFactCandidate[] } | undefined;
      const facts = result?.facts ?? [];
      if (facts.length > 0) {
        setExtractedCandidates(facts);
        setExtractModalOpen(true);
      }
      // 消费后移除，避免反复挂载时重复弹窗
      runner.removeCompleted(completed.id);
    } else {
      // 无活跃也无已完成 → 完全重置（处理 AU 切换时的陈旧状态）
      setExtractModalOpen(false);
      setExtractedCandidates([]);
    }

    return () => { unsubRef.current?.(); };
  }, [auPath]); // 仅 auPath 变化触发，subscribeToTask 通过 ref 引用

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
      subscribeToTask(taskId, requestAuPath);
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
      setExtracting(false);
    }
  }, [auPath, extractRange, showError, t, subscribeToTask]);

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
