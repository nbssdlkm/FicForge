// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { BookOpen, ChevronRight, Loader2 } from "lucide-react";
import type { ChapterInfo } from "../../api/engine-client";
import { useTranslation } from "../../i18n/useAppTranslation";
import { Button } from "../shared/Button";
import { EmptyState } from "../shared/EmptyState";
import { cn } from "../shared/utils";

interface MobileChapterListProps {
  auName: string;
  chapters: ChapterInfo[];
  loading: boolean;
  selectedChapter: number | null;
  onSelectChapter: (chapterNum: number) => void;
  onStartWriting: () => void;
}

export function MobileChapterList({
  auName,
  chapters,
  loading,
  selectedChapter,
  onSelectChapter,
  onStartWriting,
}: MobileChapterListProps) {
  const { t } = useTranslation();

  return (
    <section className="flex min-h-full flex-col bg-background md:hidden">
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
              onClick={() => onSelectChapter(chapter.chapter_num)}
              className={cn(
                "flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition-colors",
                selectedChapter === chapter.chapter_num
                  ? "border-accent/40 bg-accent/8 text-accent"
                  : "border-black/10 bg-surface/35 text-text hover:border-accent/20 hover:bg-surface/70 dark:border-white/10"
              )}
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text/45">
                  {t("import.chapterPreview", { num: chapter.chapter_num })}
                </p>
                <p className="mt-1 truncate text-base font-medium text-current">
                  {chapter.title?.trim() || t("mobile.chapters.untitled")}
                </p>
              </div>
              <ChevronRight size={18} className="shrink-0 opacity-55" />
            </button>
          ))
        )}
      </div>
    </section>
  );
}
