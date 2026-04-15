// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useRef, useState } from "react";
import { BookOpen, ChevronRight, Loader2, Pencil } from "lucide-react";
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
      <header className="safe-area-top border-b border-black/10 bg-surface/80 px-4 py-4 backdrop-blur dark:border-white/10">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-text/40">{t("navigation.chapters")}</p>
        <h1 className="mt-1 truncate font-serif text-2xl font-bold text-text">{auName}</h1>
        <p className="mt-1 text-sm text-text/55">{t("mobile.chapters.hint")}</p>
      </header>

      <div className="flex-1 overflow-y-auto space-y-3 px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-text/50">
            <Loader2 size={22} className="animate-spin" />
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
          chapters.map((chapter) => (
            <button
              key={chapter.chapter_num}
              type="button"
              onClick={() => {
                if (editingNum === chapter.chapter_num) return;
                onSelectChapter(chapter.chapter_num);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition-colors",
                selectedChapter === chapter.chapter_num
                  ? "border-accent/40 bg-accent/8 text-accent"
                  : "border-black/10 bg-surface/35 text-text hover:border-accent/20 hover:bg-surface/70 dark:border-white/10"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text/45">
                  {t("import.chapterPreview", { num: chapter.chapter_num })}
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
                    className="mt-1 w-full border-b border-accent/50 bg-transparent text-base font-medium text-text outline-none"
                  />
                ) : (
                  <p className="mt-1 truncate text-base font-medium text-current">
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
                    className="rounded-full p-1.5 text-text/30 active:bg-black/5 dark:active:bg-white/10"
                  >
                    <Pencil size={14} />
                  </span>
                  <ChevronRight size={18} className="opacity-55" />
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </section>
  );
}
