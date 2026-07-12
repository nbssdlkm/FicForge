// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Modal } from "../shared/Modal";
import { Button } from "../shared/Button";
import { Spinner } from "../shared/Spinner";
import { useTranslation } from "../../i18n/useAppTranslation";
import { useFeedback } from "../../hooks/useFeedback";
import { scanChapterMemory, backfillChapterMemory, type ChapterMemoryScan } from "../../api/engine-client";

type Phase = "scanning" | "confirm" | "running" | "done";

interface Result {
  summaries: number;
  facts: number;
  skipped: number;
  failed: number;
  aborted: boolean;
  overCap: number; // L16：因每章 8 条软上限被丢弃的笔记数
}

/**
 * 补全旧章记忆（plan 3.1）：给「缺记忆的旧章」逐章补 摘要 + 剧情笔记（+剧情线）+ 向量。
 * 摘要/向量自动补缺；笔记只对用户勾选的章提取（自动落库），默认勾「零笔记」的章。
 * 自管状态（hook 规则：state 住在用它的地方）。流程：扫描 → 确认（清单 + 笔记章选择器）→
 * 跑（进度 + 可停）→ 完成。运行中禁止背景关闭（须先「停止」），卸载即中止。
 */
export function BackfillMemoryModal({
  auPath,
  isOpen,
  onClose,
}: {
  auPath: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { showError } = useFeedback();

  const [phase, setPhase] = useState<Phase>("scanning");
  const [scan, setScan] = useState<ChapterMemoryScan | null>(null);
  const [selectedFacts, setSelectedFacts] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<Result | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 打开时扫描缺记忆的章。cancelled 守卫避免关闭/换 AU 后写过期状态。默认勾选零笔记章。
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setPhase("scanning");
    setScan(null);
    setSelectedFacts(new Set());
    setProgress({ done: 0, total: 0 });
    setResult(null);
    scanChapterMemory(auPath)
      .then((s) => {
        if (cancelled) return;
        setScan(s);
        setSelectedFacts(new Set(s.chaptersZeroFacts));
        setPhase("confirm");
      })
      .catch((e) => {
        if (!cancelled) {
          showError(e, t("error_messages.unknown"));
          onClose();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, auPath]);

  // 所有定稿章号（升序）—— 笔记选择器逐章列出。
  const allChapters = useMemo(
    () =>
      scan
        ? Object.keys(scan.factCountByChapter)
            .map(Number)
            .sort((a, b) => a - b)
        : [],
    [scan],
  );
  // in-scope = 缺摘要 ∪ 勾选提笔记（决定进度总数 + 是否有事可做）。
  const inScopeCount = useMemo(() => {
    if (!scan) return 0;
    return new Set([...scan.chaptersMissingSummary, ...selectedFacts]).size;
  }, [scan, selectedFacts]);

  const toggleFact = useCallback((num: number) => {
    setSelectedFacts((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  }, []);

  const handleStart = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ done: 0, total: inScopeCount });
    setPhase("running");
    try {
      const res = await backfillChapterMemory(
        auPath,
        { factsChapters: [...selectedFacts] },
        (done, total) => setProgress({ done, total }),
        controller.signal,
      );
      setResult({
        summaries: res.summariesGenerated,
        facts: res.factsAdded,
        skipped: res.skipped,
        failed: res.failed,
        aborted: res.aborted,
        overCap: res.factsOverCapCount,
      });
      setPhase("done");
    } catch (e) {
      showError(e, t("error_messages.unknown"));
      setResult({ summaries: 0, facts: 0, skipped: 0, failed: 0, aborted: true, overCap: 0 });
      setPhase("done");
    } finally {
      abortRef.current = null;
    }
  }, [auPath, selectedFacts, inScopeCount, showError, t]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // 卸载即中止：父层关闭/换 AU/离开设置页导致卸载时，停掉还在跑的批量任务（codex 审 P2 同款）。
  useEffect(() => () => abortRef.current?.abort(), []);

  // 运行中点叉/背景 = no-op（防悬空任务）；其它阶段正常关闭。
  const handleRequestClose = phase === "running" ? () => {} : onClose;

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const ready = !!scan && scan.embeddingConfigured && scan.llmConfigured && scan.totalConfirmed > 0;

  return (
    <Modal isOpen={isOpen} onClose={handleRequestClose} title={t("backfillMemory.title")}>
      <div className="space-y-5">
        {phase === "scanning" && (
          <div className="flex items-center gap-3 py-4 text-sm text-text/70">
            <Spinner size="md" /> {t("backfillMemory.scanning")}
          </div>
        )}

        {phase === "confirm" &&
          scan &&
          (() => {
            if (!scan.embeddingConfigured || !scan.llmConfigured)
              return <p className="text-sm text-text/70">{t("backfillMemory.needConfig")}</p>;
            if (scan.totalConfirmed === 0)
              return <p className="text-sm text-text/70">{t("backfillMemory.noChapters")}</p>;
            return (
              <div className="space-y-4">
                <p className="text-sm text-text/80">
                  {scan.chaptersMissingSummary.length > 0
                    ? t("backfillMemory.summaryMissing", { count: scan.chaptersMissingSummary.length })
                    : t("backfillMemory.summaryAllPresent")}
                </p>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text/80">{t("backfillMemory.factsHeader")}</span>
                    <div className="flex gap-2">
                      <Button
                        tone="neutral"
                        fill="plain"
                        size="sm"
                        onClick={() => setSelectedFacts(new Set(allChapters))}
                      >
                        {t("backfillMemory.selectAll")}
                      </Button>
                      <Button tone="neutral" fill="plain" size="sm" onClick={() => setSelectedFacts(new Set())}>
                        {t("backfillMemory.selectNone")}
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-text/50">{t("backfillMemory.factsHint")}</p>
                  <div className="max-h-[40vh] space-y-1 overflow-y-auto rounded-lg border border-black/10 p-2 dark:border-white/10">
                    {allChapters.map((num) => {
                      const count = scan.factCountByChapter[num] ?? 0;
                      return (
                        <label
                          key={num}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <input
                            type="checkbox"
                            className="accent-accent"
                            checked={selectedFacts.has(num)}
                            onChange={() => toggleFact(num)}
                          />
                          <span className="text-text/90">{t("backfillMemory.chapterRow", { num })}</span>
                          <span className="text-xs text-text/40">
                            {count > 0
                              ? t("backfillMemory.chapterFactCount", { count })
                              : t("backfillMemory.chapterNoFacts")}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 勾了已有笔记的章 → 透明告知会追加提取(可能重复);不阻止(用户可能确要重提)。 */}
                {[...selectedFacts].some((n) => (scan.factCountByChapter[n] ?? 0) > 0) && (
                  <p className="text-xs text-warning">{t("backfillMemory.factsDupWarning")}</p>
                )}

                <p className="text-xs text-text/50">
                  {t("backfillMemory.costHint", {
                    summaries: scan.chaptersMissingSummary.length,
                    facts: selectedFacts.size,
                  })}
                </p>

                {inScopeCount === 0 && <p className="text-sm text-text/70">{t("backfillMemory.nothingToDo")}</p>}
              </div>
            );
          })()}

        {phase === "running" && (
          <div className="space-y-2">
            <p className="text-sm text-text/80">
              {t("backfillMemory.running", { done: progress.done, total: progress.total })}
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {phase === "done" && result && (
          <>
            <p className="text-sm text-text/80">
              {result.aborted
                ? t("backfillMemory.aborted", { summaries: result.summaries, facts: result.facts })
                : result.failed > 0
                  ? t("backfillMemory.doneWithFailures", {
                      summaries: result.summaries,
                      facts: result.facts,
                      failed: result.failed,
                    })
                  : t("backfillMemory.doneSuccess", { summaries: result.summaries, facts: result.facts })}
            </p>
            {result.overCap > 0 && (
              <p className="text-xs text-text/50">{t("backfillMemory.overCapNote", { count: result.overCap })}</p>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
          {phase === "confirm" && ready ? (
            <>
              <Button tone="neutral" fill="plain" onClick={onClose}>
                {t("common.actions.cancel")}
              </Button>
              <Button tone="accent" fill="solid" onClick={handleStart} disabled={inScopeCount === 0}>
                {t("backfillMemory.start")}
              </Button>
            </>
          ) : phase === "running" ? (
            <Button tone="neutral" fill="outline" onClick={handleStop}>
              {t("backfillMemory.stop")}
            </Button>
          ) : phase !== "scanning" ? (
            <Button tone="neutral" fill="plain" onClick={onClose}>
              {t("common.actions.close")}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
