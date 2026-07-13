// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Spinner } from "../shared/Spinner";
import { Button } from "../shared/Button";
import { Textarea } from "../shared/Input";
import { ChapterMarkdown } from "../shared/ChapterMarkdown";
import { useTranslation } from "../../i18n/useAppTranslation";

export interface ChapterContentAreaProps {
  loading: boolean;
  streamText: string;
  isGenerating: boolean;
  isViewingHistory: boolean;
  viewingHistoryContent: string | null;
  viewingHistoryNum: number | null;
  editingConfirmed: boolean;
  editingContent: string;
  editingOriginalContent: string;
  savingEdit: boolean;
  onEditingContentChange: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  currentDraft: { content: string } | null;
  onDraftChange: (v: string) => void;
  displayContent: string;
  generationErrorDisplay: { message: string; actions: string[] } | null;
  onDismissError: () => void;
  onNavigate: (page: string) => void;
  fontSize: number;
  lineHeight: number;
  /** Chapter number currently being shown (from displayedChapter). */
  displayedChapter: number;
  /** Optional confirmed chapter title. Falls back to roman-only heading when absent. */
  displayedChapterTitle?: string;
  /** Draft label shown in the eyebrow while a draft is active, e.g. "Draft 03". */
  draftLabel?: string;
}

// Uppercase roman numeral for the decorative heading. Caps at MMMCMXCIX (3999),
// which is well beyond any plausible chapter count — no need to handle larger.
function toRoman(n: number): string {
  if (n <= 0) return "—";
  const pairs: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let value = n;
  let out = "";
  for (const [weight, symbol] of pairs) {
    while (value >= weight) {
      out += symbol;
      value -= weight;
    }
  }
  return out;
}

// Ex Libris chapter heading — catalog eyebrow + roman call no. + optional CN
// title on the next line + gold ornament. Decorative only; no interactions.
function ChapterHeading({
  chapterNum,
  chapterTitle,
  draftLabel,
}: {
  chapterNum: number;
  chapterTitle?: string;
  draftLabel?: string;
}) {
  const roman = toRoman(chapterNum);
  return (
    <header className="mb-8 md:mb-10">
      <div className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-gold">
        {draftLabel ? `Chapter · ${roman} · ${draftLabel}` : `Chapter · ${roman}`}
      </div>
      <h1 className="font-display text-3xl font-medium leading-[1.2] text-text md:text-4xl">
        {chapterTitle ? (
          <>
            <span className="italic tracking-[0.1em] text-gold text-[0.78em]">{roman}.</span>
            <span className="mt-1 block font-serif text-[0.7em] font-normal text-text">{chapterTitle}</span>
          </>
        ) : (
          <span className="italic tracking-[0.08em] text-gold">{roman}</span>
        )}
      </h1>
      <div
        aria-hidden="true"
        className="mt-5 select-none font-mono text-xs text-gold"
        style={{ letterSpacing: "1.2em", paddingLeft: "1.2em" }}
      >
        · · ·
      </div>
    </header>
  );
}

export const ChapterContentArea = ({
  loading,
  streamText,
  isGenerating,
  isViewingHistory,
  viewingHistoryContent,
  viewingHistoryNum: _viewingHistoryNum,
  editingConfirmed,
  editingContent,
  editingOriginalContent,
  savingEdit,
  onEditingContentChange,
  onSaveEdit,
  onCancelEdit,
  currentDraft,
  onDraftChange,
  displayContent,
  generationErrorDisplay,
  onDismissError,
  onNavigate,
  fontSize,
  lineHeight,
  displayedChapter,
  displayedChapterTitle,
  draftLabel,
}: ChapterContentAreaProps) => {
  const { t } = useTranslation();

  // Show the heading whenever there's content (stream / history / draft / confirmed).
  // Suppress while loading, on empty state, and on error.
  const showHeading =
    !loading &&
    (streamText.length > 0 ||
      (isViewingHistory && Boolean(viewingHistoryContent)) ||
      Boolean(currentDraft) ||
      displayContent.length > 0);

  return (
    <div style={{ fontSize: `${fontSize}px`, lineHeight }}>
      {showHeading && (
        <ChapterHeading chapterNum={displayedChapter} chapterTitle={displayedChapterTitle} draftLabel={draftLabel} />
      )}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size="lg" className="text-accent" />
        </div>
      ) : streamText ? (
        <div className="font-serif text-text/90 animate-in fade-in duration-200 pb-8 opacity-90">
          {/* 流式期绕过 react-markdown（审计 M11）：Markdown 组件对累积全文做整棵
              remark AST 重解析，每帧一次 = 低端机流式 3000 字肉眼卡顿；且流式中途
              的半个 **标记 会解析抖动。流式中用 whitespace-pre-wrap 轻量渲染（与
              简版 WritingDraftCard 流式同款），isGenerating 落 false 的终态帧再上
              Markdown 排版（单次解析，随后 resetStream 交还 draft 视图）。 */}
          {isGenerating ? (
            <div className="whitespace-pre-wrap break-words">
              {streamText}
              <span className="inline-block h-5 w-0.5 bg-accent align-middle animate-pulse" />
            </div>
          ) : (
            <ChapterMarkdown content={streamText} />
          )}
        </div>
      ) : isViewingHistory && viewingHistoryContent ? (
        <div className="font-serif text-text/90 pb-8">
          {editingConfirmed ? (
            <>
              <Textarea
                value={editingContent}
                onChange={(e) => onEditingContentChange(e.target.value)}
                className="min-h-[440px] border-0 bg-transparent px-0 py-0 font-serif shadow-none focus:ring-0"
                style={{ fontSize: "inherit", lineHeight: "inherit" }}
              />
              <div className="mt-4 flex items-center gap-2 border-t border-rule pt-4">
                <Button
                  tone="accent"
                  fill="solid"
                  size="sm"
                  onClick={onSaveEdit}
                  disabled={savingEdit || editingContent === editingOriginalContent}
                >
                  {savingEdit ? <Spinner size="sm" className="mr-1" /> : null}
                  {t("writer.saveEdit")}
                </Button>
                <Button tone="neutral" fill="plain" size="sm" onClick={onCancelEdit} disabled={savingEdit}>
                  {t("writer.cancelEdit")}
                </Button>
              </div>
            </>
          ) : (
            <ChapterMarkdown content={viewingHistoryContent} />
          )}
        </div>
      ) : currentDraft ? (
        <div className="space-y-4 pb-8">
          <Textarea
            value={currentDraft.content}
            onChange={(event) => onDraftChange(event.target.value)}
            className="min-h-[440px] border-0 bg-transparent px-0 py-0 font-serif shadow-none focus:ring-0"
            style={{ fontSize: "inherit", lineHeight: "inherit" }}
          />
        </div>
      ) : displayContent ? (
        <div className="font-serif text-text/90 pb-8">
          <ChapterMarkdown content={displayContent} />
        </div>
      ) : generationErrorDisplay ? (
        <div className="flex flex-col items-center gap-4 py-12">
          <div className="flex max-w-lg items-center gap-2 rounded-sm border border-error/40 bg-error/10 px-5 py-4 text-error">
            {/* 装饰性错误图标，语义已由紧邻的错误文案承担 → aria-hidden（守则 6） */}
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span className="font-serif text-sm">{generationErrorDisplay.message}</span>
          </div>
          {generationErrorDisplay.actions.includes("check_settings") && (
            <Button tone="neutral" fill="outline" size="sm" onClick={() => onNavigate("settings")}>
              {t("writer.checkSettings")}
            </Button>
          )}
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center px-4 font-mono text-[10px] uppercase tracking-[0.14em] text-text/50 hover:text-text/70"
            onClick={onDismissError}
          >
            {t("common.actions.dismiss")}
          </button>
        </div>
      ) : (
        <p className="py-24 text-center font-serif text-text/40">{t("writer.emptyContent")}</p>
      )}
    </div>
  );
};
