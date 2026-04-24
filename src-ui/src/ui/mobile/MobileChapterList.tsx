// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useRef, useState } from "react";
import { BookOpen, ChevronRight, Pencil } from "lucide-react";
import { Spinner } from "../shared/Spinner";
import type { ChapterInfo } from "../../api/engine-client";
import { updateChapterTitle } from "../../api/engine-client";
import { useTranslation } from "../../i18n/useAppTranslation";
import { useFeedback } from "../../hooks/useFeedback";
import { Button } from "../shared/Button";
import { EmptyState } from "../shared/EmptyState";
import { cn } from "../shared/utils";

interface MobileChapterListProps {
  auPath: string;
  auName: string;
  chapters: ChapterInfo[];
  loading: boolean;
  selectedChapter: number | null;
  onSelectChapter: (chapterNum: number) => void;
  onStartWriting: () => void;
  onChaptersChanged?: () => void;
}

function callNo(n: number): string {
  return String(n).padStart(2, "0");
}

export function MobileChapterList({
  auPath,
  auName,
  chapters,
  loading,
  selectedChapter,
  onSelectChapter,
  onStartWriting,
  onChaptersChanged,
}: MobileChapterListProps) {
  const { t } = useTranslation();
  const { showError } = useFeedback();

  const [editingNum, setEditingNum] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const originalRef = useRef("");
  const committingRef = useRef(false); // 防止 Enter+blur 双重提交

  const startEditing = (ch: ChapterInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    originalRef.current = ch.title || "";
    setEditingNum(ch.chapter_num);
    setEditingValue(ch.title || "");
    committingRef.current = false;
  };

  const commitEdit = async () => {
    if (editingNum === null || committingRef.current) return;
    committingRef.current = true;
    const trimmed = editingValue.trim();
    if (trimmed !== originalRef.current) {
      try {
        await updateChapterTitle(auPath, editingNum, trimmed);
        onChaptersChanged?.();
      } catch (err) {
        showError(err, t("error_messages.unknown"));
      }
    }
    setEditingNum(null);
  };

  const cancelEdit = () => { committingRef.current = true; setEditingNum(null); };

  return (
    <section className="flex h-full flex-col bg-background md:hidden">
      <header className="safe-area-top border-b border-rule bg-surface/85 px-4 py-4 backdrop-blur">
        <h1 className="truncate font-display text-2xl font-semibold text-text">{auName}</h1>
        <p className="mt-1 font-serif text-sm text-text/60">{t("mobile.chapters.hint")}</p>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-text/50">
            <Spinner size="md" />
          </div>
        ) : chapters.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={42} />}
            title={t("mobile.chapters.emptyTitle")}
            description={t("mobile.chapters.emptyDesc")}
            actions={[
              {
                key: "start-writing",
                element: <Button onClick={onStartWriting}>{t("mobile.chapters.startWriting")}</Button>,
              },
            ]}
          />
        ) : (
          chapters.map((chapter) => {
            const isActive = selectedChapter === chapter.chapter_num;
            return (
              <button
                key={chapter.chapter_num}
                type="button"
                onClick={() => {
                  if (editingNum === chapter.chapter_num) return;
                  onSelectChapter(chapter.chapter_num);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-r-sm border border-rule border-l-2 px-4 py-3.5 text-left transition-colors",
                  isActive
                    ? "border-l-gold-bright bg-accent/10 text-accent"
                    : "border-l-gold bg-surface text-text hover:bg-rule-soft"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    "font-mono text-[9px] uppercase tracking-[0.1em]",
                    isActive ? "text-gold-bright" : "text-gold"
                  )}>
                    № {callNo(chapter.chapter_num)}
                  </p>
                  {editingNum === chapter.chapter_num ? (
                    <input
                      autoFocus
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); void commitEdit(); }
                        else if (e.key === "Escape") cancelEdit();
                      }}
                      onBlur={() => void commitEdit()}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 w-full border-b border-accent/50 bg-transparent font-display text-base font-medium text-text outline-none"
                    />
                  ) : (
                    <p className="mt-0.5 truncate font-display text-base font-medium text-current">
                      {chapter.title?.trim() || t("mobile.chapters.untitled")}
                    </p>
                  )}
                </div>
                {editingNum !== chapter.chapter_num && (
                  <div className="flex shrink-0 items-center gap-1">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => startEditing(chapter, e)}
                      className="rounded-full p-1.5 text-text/30 transition-colors active:bg-rule-soft"
                    >
                      <Pencil size={14} />
                    </span>
                    <ChevronRight size={18} className="text-text/40" />
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
