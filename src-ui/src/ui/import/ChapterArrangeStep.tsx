// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { useCallback, useMemo, useState } from "react";
import { Button } from "../shared/Button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { TurnCard } from "./TurnCard";
import type { FileAnalysis } from "@ficforge/engine";
import type { ClassifiedTurn } from "@ficforge/engine";
import { classifyTurns, type ClassificationThresholds } from "@ficforge/engine";

interface ChapterArrangeStepProps {
  analyses: FileAnalysis[];
  thresholds: ClassificationThresholds;
  onUpdateAnalyses: (updated: FileAnalysis[]) => void;
  onNext: () => void;
  onBack: () => void;
}

export function ChapterArrangeStep({ analyses, thresholds, onUpdateAnalyses, onNext, onBack }: ChapterArrangeStepProps) {
  const { t } = useTranslation();
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [visibleCounts, setVisibleCounts] = useState<Map<string, number>>(new Map());
  const PAGE_SIZE = 30;

  // 计算全局统计
  const globalStats = useMemo(() => {
    let chapters = 0;
    let settings = 0;
    let skipped = 0;
    for (const a of analyses) {
      if (a.mode === "chat" && a.turns) {
        for (const turn of a.turns) {
          switch (turn.assignedType) {
            case "chapter": chapters++; break;
            case "chapter_continue": break; // 合并到前一章，不单独计数
            case "setting": settings++; break;
            case "skip": skipped++; break;
          }
        }
      } else if (a.mode === "text" && a.chapters) {
        chapters += a.chapters.length;
      }
    }
    return { chapters, settings, skipped };
  }, [analyses]);

  const toggleFile = (filename: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const handleReapplyThresholds = useCallback((fileIndex: number) => {
    const updated = [...analyses];
    const analysis = { ...updated[fileIndex] };
    if (!analysis.turns) return;

    // Extract original ChatTurn data from classified turns, then re-classify
    const reclassified = classifyTurns(
      analysis.turns.map(t => ({ index: t.index, role: t.role, content: t.content, charCount: t.charCount })),
      thresholds,
    );

    // 计算前面文件的最后章节号，作为全局起始章节号
    let startChapter = 1;
    for (let fi = 0; fi < fileIndex; fi++) {
      const prevTurns = updated[fi].turns;
      if (!prevTurns) continue;
      for (const t of prevTurns) {
        if (t.assignedType === "chapter" && t.assignedChapter !== null) {
          startChapter = t.assignedChapter + 1;
        }
      }
    }
    reassignChapterNumbersFrom(reclassified, startChapter);

    analysis.turns = reclassified;
    analysis.stats = computeStats(reclassified);
    updated[fileIndex] = analysis;
    onUpdateAnalyses(updated);
  }, [analyses, thresholds, onUpdateAnalyses]);

  const handleChangeTurnType = useCallback((
    fileIndex: number,
    turnIndex: number,
    newType: ClassifiedTurn["assignedType"],
  ) => {
    const updated = [...analyses];
    const analysis = { ...updated[fileIndex] };
    if (!analysis.turns) return;

    const turns = analysis.turns.map((t) => ({ ...t }));
    turns[turnIndex].assignedType = newType;

    // 计算前面文件的最后章节号，作为全局起始章节号
    let startChapter = 1;
    for (let fi = 0; fi < fileIndex; fi++) {
      const prevTurns = updated[fi].turns;
      if (!prevTurns) continue;
      for (const t of prevTurns) {
        if (t.assignedType === "chapter" && t.assignedChapter !== null) {
          startChapter = t.assignedChapter + 1;
        }
      }
    }
    reassignChapterNumbersFrom(turns, startChapter);

    analysis.turns = turns;
    analysis.stats = computeStats(turns);
    updated[fileIndex] = analysis;
    onUpdateAnalyses(updated);
  }, [analyses, onUpdateAnalyses]);

  // 计算每个文件的统计
  const fileSummary = (analysis: FileAnalysis) => {
    if (analysis.mode === "text") {
      return t("import.fileSummary", {
        chapters: analysis.chapters?.length ?? 0,
        settings: 0,
        skipped: 0,
      });
    }
    return t("import.fileSummary", {
      chapters: analysis.stats.estimatedChapters,
      settings: analysis.stats.settingsCount,
      skipped: analysis.stats.skippedCount,
    });
  };

  return (
    <div className="space-y-4">
      {/* Global summary */}
      <div className="rounded-xl border border-accent/20 bg-accent/5 p-4">
        <p className="text-sm font-medium text-text">
          {t("import.step3Summary", { chapters: globalStats.chapters, settings: globalStats.settings })}
        </p>
        <p className="text-xs text-text/50 mt-1">
          {t("import.step3Skipped", { count: globalStats.skipped })}
        </p>
      </div>

      {/* Per-file sections */}
      {analyses.map((analysis, fileIndex) => {
        const isExpanded = expandedFiles.has(analysis.filename);

        return (
          <div key={analysis.filename} className="rounded-xl border border-black/10 bg-surface/30 dark:border-white/10">
            {/* File header */}
            <button
              type="button"
              className="flex w-full items-center justify-between p-4 text-left"
              onClick={() => toggleFile(analysis.filename)}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text truncate">{analysis.filename}</p>
                <p className="text-xs text-text/50 mt-0.5">
                  {analysis.mode === "chat"
                    ? `${t("import.chatDetected", { format: analysis.chatFormat ?? "" })} — `
                    : `${t("import.textDetected")} — `}
                  {fileSummary(analysis)}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-accent">
                <span>{isExpanded ? t("import.step3Collapse") : t("import.step3Expand")}</span>
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>

            {/* Expanded turns list */}
            {isExpanded && analysis.mode === "chat" && analysis.turns && (
              <div className="border-t border-black/5 px-4 pb-4 pt-3 dark:border-white/5">
                {/* Batch actions */}
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => batchAction(analyses, fileIndex, "skipAllUser", onUpdateAnalyses)}
                  >
                    {t("import.step3BatchSkipUser")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => batchAction(analyses, fileIndex, "allAiChapter", onUpdateAnalyses)}
                  >
                    {t("import.step3BatchAllChapter")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => handleReapplyThresholds(fileIndex)}
                  >
                    {t("import.step3BatchReapply")}
                  </Button>
                </div>

                {/* Turn cards (paginated) */}
                {(() => {
                  const visibleCount = visibleCounts.get(analysis.filename) ?? PAGE_SIZE;
                  const visibleTurns = analysis.turns.slice(0, visibleCount);
                  const hasMore = analysis.turns.length > visibleCount;
                  return (
                    <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                      {visibleTurns.map((turn, turnIdx) => {
                        const chapterContext = getChapterContextGlobal(analyses, fileIndex, turnIdx);
                        return (
                          <TurnCard
                            key={turn.index}
                            turn={turn}
                            currentChapterNum={chapterContext.currentChapterNum}
                            hasPreviousChapter={chapterContext.hasPreviousChapter}
                            onChangeType={(_idx, newType) => handleChangeTurnType(fileIndex, turnIdx, newType)}
                          />
                        );
                      })}
                      {hasMore && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full text-xs text-accent"
                          onClick={() => setVisibleCounts((prev) => {
                            const next = new Map(prev);
                            next.set(analysis.filename, visibleCount + PAGE_SIZE);
                            return next;
                          })}
                        >
                          {t("import.loadMore", { count: analysis.turns.length - visibleCount })}
                        </Button>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Expanded text chapters list */}
            {isExpanded && analysis.mode === "text" && analysis.chapters && (
              <div className="border-t border-black/5 px-4 pb-4 pt-3 dark:border-white/5 space-y-2 max-h-[50vh] overflow-y-auto">
                {analysis.chapters.map((ch) => (
                  <div key={ch.chapter_num} className="rounded-lg border border-black/10 bg-background/50 p-3 dark:border-white/10">
                    <p className="text-sm font-medium text-text">{ch.title}</p>
                    <p className="mt-1 text-xs text-text/50 line-clamp-2">{ch.content.slice(0, 100)}...</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>{t("onboarding.common.prev")}</Button>
        <Button variant="primary" onClick={onNext} disabled={globalStats.chapters === 0}>
          {t("onboarding.common.next")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reassignChapterNumbersFrom(turns: ClassifiedTurn[], startChapter: number = 1) {
  let chapterNum = startChapter;
  for (const turn of turns) {
    if (turn.assignedType === "chapter") {
      turn.assignedChapter = chapterNum++;
    } else if (turn.assignedType === "chapter_continue") {
      // continue uses the same chapter number as the previous chapter
      turn.assignedChapter = Math.max(1, chapterNum - 1);
    } else {
      turn.assignedChapter = null;
    }
  }
}

function computeStats(turns: ClassifiedTurn[]): FileAnalysis["stats"] {
  return {
    totalChars: turns.reduce((sum, t) => sum + t.charCount, 0),
    estimatedChapters: turns.filter((t) => t.assignedType === "chapter").length,
    settingsCount: turns.filter((t) => t.assignedType === "setting").length,
    skippedCount: turns.filter((t) => t.assignedType === "skip").length,
  };
}

/**
 * 全局计算章节上下文——跨文件查找前面最近的 chapter turn，
 * 使得后续文件首条 turn 也能选"续"。
 */
function getChapterContextGlobal(
  analyses: FileAnalysis[],
  fileIndex: number,
  turnIndex: number,
): { currentChapterNum: number | null; hasPreviousChapter: boolean } {
  let lastChapterNum: number | null = null;
  let hasPreviousChapter = false;

  // 遍历前面所有文件的所有 turns
  for (let fi = 0; fi < fileIndex; fi++) {
    const turns = analyses[fi].turns;
    if (!turns) continue;
    for (const t of turns) {
      if (t.assignedType === "chapter") {
        lastChapterNum = t.assignedChapter;
        hasPreviousChapter = true;
      }
    }
  }

  // 遍历当前文件到 turnIndex
  const currentFileTurns = analyses[fileIndex].turns;
  if (currentFileTurns) {
    for (let i = 0; i <= turnIndex; i++) {
      if (currentFileTurns[i].assignedType === "chapter") {
        lastChapterNum = currentFileTurns[i].assignedChapter;
        if (i < turnIndex) hasPreviousChapter = true;
      }
    }
  }

  const current = currentFileTurns?.[turnIndex];
  if (!current) {
    return { currentChapterNum: lastChapterNum ?? 1, hasPreviousChapter };
  }

  // 当前 turn 如果本身就是 chapter，显示自己的章节号
  if (current.assignedType === "chapter") {
    return { currentChapterNum: current.assignedChapter, hasPreviousChapter: false };
  }

  const nextChapterNum = lastChapterNum !== null ? lastChapterNum + 1 : 1;

  return {
    currentChapterNum: current.assignedType === "chapter_continue" ? lastChapterNum : nextChapterNum,
    hasPreviousChapter,
  };
}

function batchAction(
  analyses: FileAnalysis[],
  fileIndex: number,
  action: "skipAllUser" | "allAiChapter",
  onUpdate: (updated: FileAnalysis[]) => void,
) {
  const updated = [...analyses];
  const analysis = { ...updated[fileIndex] };
  if (!analysis.turns) return;

  const turns = analysis.turns.map((t) => ({ ...t }));

  if (action === "skipAllUser") {
    for (const turn of turns) {
      if (turn.role === "user") {
        turn.assignedType = "skip";
        turn.assignedChapter = null;
      }
    }
  } else if (action === "allAiChapter") {
    for (const turn of turns) {
      if (turn.role === "assistant" && turn.charCount > 0) {
        turn.assignedType = "chapter";
      }
    }
  }

  // 计算前面文件的最后章节号，作为全局起始章节号
  let startChapter = 1;
  for (let fi = 0; fi < fileIndex; fi++) {
    const prevTurns = updated[fi].turns;
    if (!prevTurns) continue;
    for (const t of prevTurns) {
      if (t.assignedType === "chapter" && t.assignedChapter !== null) {
        startChapter = t.assignedChapter + 1;
      }
    }
  }
  reassignChapterNumbersFrom(turns, startChapter);
  analysis.turns = turns;
  analysis.stats = computeStats(turns);
  updated[fileIndex] = analysis;
  onUpdate(updated);
}
