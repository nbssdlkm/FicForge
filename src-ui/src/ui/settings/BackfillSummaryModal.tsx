// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { useState, useEffect, useRef, useCallback } from 'react';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import {
  countChaptersMissingSummary,
  backfillChapterSummaries,
  type BackfillSummaryAvailability,
} from '../../api/engine-client';

type Phase = 'scanning' | 'confirm' | 'running' | 'done';

interface Result { generated: number; failed: number; aborted: boolean; }

/**
 * 批量补摘要：给「配 embedding 之前确认、永久没摘要」的旧章手动补 standard 摘要。
 * 自管状态（hook 规则：state 住在用它的地方）。流程：扫描 → 确认（显示数量+前置条件）→ 跑（进度+可停）→ 完成。
 * 运行中禁止背景关闭（须先「停止」），避免点叉后悬空的批量任务。
 */
export function BackfillSummaryModal({ auPath, isOpen, onClose }: { auPath: string; isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { showError } = useFeedback();

  const [phase, setPhase] = useState<Phase>('scanning');
  const [avail, setAvail] = useState<BackfillSummaryAvailability | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<Result | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 打开时扫描缺摘要的章 + 读前置条件。cancelled 守卫避免关闭/换 AU 后写过期状态。
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setPhase('scanning');
    setAvail(null);
    setProgress({ done: 0, total: 0 });
    setResult(null);
    countChaptersMissingSummary(auPath)
      .then((a) => { if (!cancelled) { setAvail(a); setPhase('confirm'); } })
      .catch((e) => { if (!cancelled) { showError(e, t('error_messages.unknown')); onClose(); } });
    return () => { cancelled = true; };
  }, [isOpen, auPath]);

  const handleStart = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ done: 0, total: avail?.missingChapters.length ?? 0 });
    setPhase('running');
    try {
      const res = await backfillChapterSummaries(
        auPath,
        (done, total) => setProgress({ done, total }),
        controller.signal,
      );
      setResult({ generated: res.generated, failed: res.failed, aborted: res.aborted });
      setPhase('done');
    } catch (e) {
      showError(e, t('error_messages.unknown'));
      setPhase('done');
      setResult({ generated: progress.done, failed: 0, aborted: true });
    } finally {
      abortRef.current = null;
    }
  }, [auPath, avail, progress.done, showError, t]);

  const handleStop = useCallback(() => { abortRef.current?.abort(); }, []);

  // 卸载即中止：父层关闭/换 AU/离开设置页导致本组件卸载时，停掉还在跑的批量任务，
  // 避免「点叉防住了，但导航走人后批量仍在后台无人能停」（codex 审 P2）。
  useEffect(() => () => abortRef.current?.abort(), []);

  // 运行中点叉/背景 = no-op（防悬空任务）；其它阶段正常关闭。
  const handleRequestClose = phase === 'running' ? () => {} : onClose;

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Modal isOpen={isOpen} onClose={handleRequestClose} title={t('backfill.title')}>
      <div className="space-y-5">
        {phase === 'scanning' && (
          <div className="flex items-center gap-3 py-4 text-sm text-text/70">
            <Spinner size="md" /> {t('backfill.scanning')}
          </div>
        )}

        {phase === 'confirm' && avail && (() => {
          if (avail.summaryDisabled) return <p className="text-sm text-text/70">{t('backfill.disabledMode')}</p>;
          if (!avail.embeddingConfigured || !avail.llmConfigured) return <p className="text-sm text-text/70">{t('backfill.needConfig')}</p>;
          if (avail.missingChapters.length === 0) return <p className="text-sm text-text/70">{t('backfill.noneMissing')}</p>;
          return (
            <>
              <p className="text-sm text-text/80">{t('backfill.confirmPrompt', { count: avail.missingChapters.length })}</p>
              <p className="text-xs text-text/50">{t('backfill.costHint')}</p>
            </>
          );
        })()}

        {phase === 'running' && (
          <div className="space-y-2">
            <p className="text-sm text-text/80">{t('backfill.running', { done: progress.done, total: progress.total })}</p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {phase === 'done' && result && (
          <p className="text-sm text-text/80">
            {result.aborted
              ? t('backfill.aborted', { generated: result.generated })
              : result.failed > 0
                ? t('backfill.doneWithFailures', { generated: result.generated, failed: result.failed })
                : t('backfill.doneSuccess', { generated: result.generated })}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
          {phase === 'confirm' && avail && !avail.summaryDisabled && avail.embeddingConfigured && avail.llmConfigured && avail.missingChapters.length > 0 ? (
            <>
              <Button tone="neutral" fill="plain" onClick={onClose}>{t('common.actions.cancel')}</Button>
              <Button tone="accent" fill="solid" onClick={handleStart}>{t('backfill.start')}</Button>
            </>
          ) : phase === 'running' ? (
            <Button tone="neutral" fill="outline" onClick={handleStop}>{t('backfill.stop')}</Button>
          ) : phase !== 'scanning' ? (
            <Button tone="neutral" fill="plain" onClick={onClose}>{t('common.actions.close')}</Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
