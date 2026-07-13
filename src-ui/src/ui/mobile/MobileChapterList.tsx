// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useRef, useState } from "react";
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
  const editInputRef = useRef<HTMLInputElement>(null);

  // 非 Modal 内联改名——不用 autoFocus 属性（noAutofocus），改走 ref + effect
  // 达到点「铅笔」即聚焦同等行为（同一时刻只有一个 chapter 处于编辑态，单 ref 够用）。
  useEffect(() => {
    if (editingNum !== null) editInputRef.current?.focus();
  }, [editingNum]);

  const startEditing = (ch: ChapterInfo, e: React.SyntheticEvent) => {
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

  const cancelEdit = () => {
    committingRef.current = true;
    setEditingNum(null);
  };

  return (
    <section className="flex h-full flex-col bg-background md:hidden">
      <header className="safe-area-top border-b border-rule bg-surface/85 px-4 py-4 backdrop-blur-sm">
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
            const numberBadge = (
              <p
                className={cn(
                  "font-mono text-[9px] uppercase tracking-[0.1em]",
                  isActive ? "text-gold-bright" : "text-gold",
                )}
              >
                № {callNo(chapter.chapter_num)}
              </p>
            );
            // 行容器是无语义 div，打开/编辑是两个并列真 <button>（F3 对抗审：原先
            // 外层整行是 button、铅笔是 span role=button 嵌其内——交互控件非法嵌套，
            // AT 可能压平或漏报其一；编辑态 <input> 也一并移出按钮）。
            return (
              <div
                key={chapter.chapter_num}
                className={cn(
                  "flex w-full items-center justify-between rounded-r-sm border border-rule border-l-2 px-4 py-3.5 transition-colors",
                  isActive
                    ? "border-l-gold-bright bg-accent/10 text-accent"
                    : "border-l-gold bg-surface text-text hover:bg-rule-soft",
                )}
                aria-current={isActive ? "page" : undefined}
              >
                {editingNum === chapter.chapter_num ? (
                  <div className="min-w-0 flex-1">
                    {numberBadge}
                    <input
                      ref={editInputRef}
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitEdit();
                        } else if (e.key === "Escape") cancelEdit();
                      }}
                      onBlur={() => void commitEdit()}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 w-full border-b border-accent/50 bg-transparent font-display text-base font-medium text-text outline-hidden"
                    />
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onSelectChapter(chapter.chapter_num)}
                      className="min-w-0 flex-1 text-left"
                    >
                      {numberBadge}
                      <p className="mt-0.5 truncate font-display text-base font-medium text-current">
                        {chapter.title?.trim() || t("mobile.chapters.untitled")}
                      </p>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={t("mobile.chapters.editTitle")}
                        onClick={(e) => startEditing(chapter, e)}
                        className="rounded-full p-1.5 text-text/30 transition-colors active:bg-rule-soft"
                      >
                        <Pencil size={14} />
                      </button>
                      <ChevronRight size={18} className="text-text/40" />
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
