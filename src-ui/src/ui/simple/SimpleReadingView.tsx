// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — SimpleReadingView
 *
 * Plan §六.D1 要求"Writer 改造为只读阅读视图（章节列表 + 章节正文 + 修改入口），
 * 生成功能下放对话面板"。完整版 WriterLayout 含续写、续写参数、模型选择、改设定
 * 模式等大量生成 UI，违反简版定位。这个 component 是简版下"写文"tab 的精简实现：
 *
 * - 章节列表（侧边）
 * - 章节正文（EB Garamond serif，可调字号 / 行间距）
 * - 章节修改入口（textarea inline 编辑 + 保存）
 * - 切换到对话面板按钮
 *
 * 完整模式仍走原 WriterLayout；AuWorkspaceLayout / MobileLayout 在 simple flag
 * 下渲染本组件。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BookOpen, ChevronLeft, ChevronRight, Pencil, Save, Type, X } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { useFeedback } from "../../hooks/useFeedback";
import { useKV } from "../../hooks/useKV";
import {
  getChapterContent,
  listChapters,
  updateChapterContent,
  type ChapterInfo,
} from "../../api/engine-client";
import { Button } from "../shared/Button";
import { Spinner } from "../shared/Spinner";

interface SimpleReadingViewProps {
  auPath: string;
  className?: string;
  /**
   * 外部指定的初始/同步选中章节号。mobile 端从章节列表 tab 进入时由 MobileLayout
   * 透传 selectedChapter；desktop 章节列表在本组件内自管，通常传 undefined。
   * 不传或 null 时本组件 fallback 到最新章（问题 4 修复：mobile 从章节列表跳第 N
   * 章不应被 fallback 覆盖）。
   */
  viewChapter?: number | null;
}

export function SimpleReadingView({ auPath, className = "", viewChapter }: SimpleReadingViewProps) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useFeedback();
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedNum, setSelectedNum] = useState<number | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [typePanelOpen, setTypePanelOpen] = useState(false);
  const [fontSizeStr, setFontSizeKV] = useKV("ficforge.fontSize", "18");
  const [lineHeightStr, setLineHeightKV] = useKV("ficforge.lineHeight", "1.8");
  const fontSize = parseInt(fontSizeStr, 10) || 18;
  const lineHeight = parseFloat(lineHeightStr) || 1.8;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // 章节列表加载
  useEffect(() => {
    setLoadingList(true);
    setSelectedNum(null);
    setContent(null);
    setEditing(false);
    setTypePanelOpen(false);
    listChapters(auPath)
      .then((rows) => {
        if (!mountedRef.current) return;
        const sorted = [...rows].sort((a, b) => a.chapter_num - b.chapter_num);
        setChapters(sorted);
        setLoadingList(false);
        if (sorted.length === 0) return;
        // 外部传入 viewChapter 且存在于章节集合 → 用它；否则 fallback 最新章。
        // 避免 mobile 从章节列表选第 N 章后被默认跳最新章覆盖（问题 4）。
        const wantedNum = viewChapter && sorted.some((c) => c.chapter_num === viewChapter)
          ? viewChapter
          : sorted[sorted.length - 1].chapter_num;
        setSelectedNum(wantedNum);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        showError(err, t("error_messages.unknown"));
        setLoadingList(false);
      });
  }, [auPath, viewChapter, showError, t]);

  // viewChapter 在 mounted 后变化（mobile 从章节列表再选另一章时，组件已挂载、
  // chapters 已加载，不会重跑列表 useEffect）→ 单独同步 selectedNum。
  useEffect(() => {
    if (viewChapter == null) return;
    if (chapters.length === 0) return;
    if (!chapters.some((c) => c.chapter_num === viewChapter)) return;
    setSelectedNum((prev) => (prev === viewChapter ? prev : viewChapter));
  }, [viewChapter, chapters]);

  // 选中章节内容加载
  useEffect(() => {
    if (selectedNum === null) return;
    setLoadingContent(true);
    setContentError(null);
    setEditing(false);
    getChapterContent(auPath, selectedNum)
      .then((text) => {
        if (!mountedRef.current) return;
        setContent(text);
        setLoadingContent(false);
      })
      .catch((err: Error) => {
        if (!mountedRef.current) return;
        setContentError(err.message);
        setLoadingContent(false);
      });
  }, [auPath, selectedNum]);

  const selectedChapter = useMemo(
    () => chapters.find((c) => c.chapter_num === selectedNum) ?? null,
    [chapters, selectedNum],
  );

  const sortedChapterNums = useMemo(
    () => chapters.map((c) => c.chapter_num).sort((a, b) => a - b),
    [chapters],
  );
  const currentChapterIdx = selectedNum !== null ? sortedChapterNums.indexOf(selectedNum) : -1;
  const prevChapterNum = currentChapterIdx > 0 ? sortedChapterNums[currentChapterIdx - 1] : null;
  const nextChapterNum = currentChapterIdx >= 0 && currentChapterIdx < sortedChapterNums.length - 1 ? sortedChapterNums[currentChapterIdx + 1] : null;

  const beginEdit = useCallback(() => {
    if (content === null) return;
    setDraft(content);
    setEditing(true);
  }, [content]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft("");
  }, []);

  const saveEdit = useCallback(async () => {
    if (selectedNum === null) return;
    setSaving(true);
    try {
      await updateChapterContent(auPath, selectedNum, draft);
      setContent(draft);
      setEditing(false);
      showSuccess(t("simple.reader.savedToast", { defaultValue: "章节已保存" }));
    } catch (err) {
      showError(err, t("error_messages.unknown"));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [auPath, draft, selectedNum, showError, showSuccess, t]);

  return (
    <div className={`flex h-full min-h-0 w-full bg-background ${className}`}>
      {/* 章节列表侧栏（desktop only；mobile 走 BottomNavBar 章节 tab） */}
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-rule bg-surface/40 md:flex">
        <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
          <BookOpen size={12} className="text-gold-bright" />
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright">
            {t("simple.reader.chaptersEyebrow", { defaultValue: "Chapters" })}
          </span>
          <span className="ml-auto font-display text-[12px] font-semibold not-italic text-accent">
            {chapters.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {loadingList ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : chapters.length === 0 ? (
            <p className="px-4 py-6 text-center font-serif text-xs italic text-ink-faint">
              {t("simple.reader.emptyChapters", { defaultValue: "尚无章节，去对话面板写第一章。" })}
            </p>
          ) : (
            chapters.map((ch) => {
              const isActive = ch.chapter_num === selectedNum;
              return (
                <button
                  key={ch.chapter_num}
                  type="button"
                  onClick={() => setSelectedNum(ch.chapter_num)}
                  className={`relative w-full px-4 py-2.5 text-left transition-colors ${
                    isActive ? "bg-accent/8 text-accent" : "text-text/75 hover:bg-rule-soft hover:text-text"
                  }`}
                >
                  {isActive && (
                    <span aria-hidden="true" className="pointer-events-none absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-gold" />
                  )}
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright/80">
                    {t("simple.reader.chapterSlug", { defaultValue: "Ch.{{num}}", num: ch.chapter_num })}
                  </div>
                  <div className="font-display text-[13px] font-semibold not-italic tracking-normal">
                    {ch.title || t("simple.reader.untitled", { defaultValue: "未命名" })}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* 主区：标题 + 正文 + 编辑 */}
      <main className="flex min-h-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-rule bg-surface px-4 py-3">
          {selectedChapter ? (
            <>
              <span className="font-display text-[13px] font-semibold not-italic text-text">
                {t("simple.reader.chapterFull", { defaultValue: "第 {{num}} 章", num: selectedChapter.chapter_num })}
              </span>
              {selectedChapter.title && (
                <span className="font-serif text-[13px] italic text-ink-muted">
                  {selectedChapter.title}
                </span>
              )}
              {content !== null && (
                <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-faint">
                  {t("simple.reader.charCount", { defaultValue: "{{n}} chars", n: content.length })}
                </span>
              )}
            </>
          ) : null}
          {selectedNum !== null && chapters.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { if (prevChapterNum !== null) setSelectedNum(prevChapterNum); }}
                disabled={prevChapterNum === null}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-rule-soft hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold-bright disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-ink-muted"
                aria-label={t("simple.reader.prevChapter", { defaultValue: "上一章" })}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => { if (nextChapterNum !== null) setSelectedNum(nextChapterNum); }}
                disabled={nextChapterNum === null}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-rule-soft hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold-bright disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-ink-muted"
                aria-label={t("simple.reader.nextChapter", { defaultValue: "下一章" })}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setTypePanelOpen((v) => !v)}
            className={`ml-auto inline-flex h-8 w-8 items-center justify-center rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold-bright ${
              typePanelOpen
                ? "bg-accent/8 text-accent"
                : "text-ink-muted hover:bg-rule-soft hover:text-text"
            }`}
            aria-label={t("simple.reader.toggleTypePanel", { defaultValue: "调节字号与行距" })}
            aria-pressed={typePanelOpen}
          >
            <Type size={14} />
          </button>
        </header>
        {typePanelOpen && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-rule bg-surface/40 px-4 py-3">
            <label className="flex flex-1 min-w-[180px] flex-col gap-1.5">
              <span className="flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright">
                <span>{t("simple.reader.fontSize", { defaultValue: "Font Size" })}</span>
                <span className="font-display text-[12px] font-semibold not-italic tracking-normal text-accent">
                  {fontSize}px
                </span>
              </span>
              <input
                type="range" min={14} max={28} step={1}
                value={fontSize}
                onChange={(e) => setFontSizeKV(e.target.value)}
                className="w-full accent-accent h-1.5"
              />
            </label>
            <label className="flex flex-1 min-w-[180px] flex-col gap-1.5">
              <span className="flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright">
                <span>{t("simple.reader.lineHeight", { defaultValue: "Line Height" })}</span>
                <span className="font-display text-[12px] font-semibold not-italic tracking-normal text-accent">
                  {lineHeight.toFixed(1)}
                </span>
              </span>
              <input
                type="range" min={1.4} max={2.4} step={0.1}
                value={lineHeight}
                onChange={(e) => setLineHeightKV(e.target.value)}
                className="w-full accent-accent h-1.5"
              />
            </label>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[680px] px-6 py-8 md:px-10 md:py-12">
            {selectedNum === null ? (
              <div className="flex h-full items-center justify-center py-20 text-center">
                <p className="font-serif text-sm italic text-ink-faint">
                  {chapters.length === 0
                    ? t("simple.reader.noChapters", { defaultValue: "还没有章节。去对话面板写第一章。" })
                    : t("simple.reader.pickOne", { defaultValue: "从左侧章节列表选一章开始阅读。" })}
                </p>
              </div>
            ) : loadingContent ? (
              <div className="flex justify-center py-12"><Spinner /></div>
            ) : contentError ? (
              <div className="flex items-start gap-2 rounded-sm border border-error/40 bg-error/8 px-3 py-2 font-serif text-sm text-error">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{t("simple.reader.loadFailed", { defaultValue: "加载失败：{{message}}", message: contentError })}</span>
              </div>
            ) : editing ? (
              <div className="flex flex-col gap-3">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={20}
                  style={{ fontSize: `${fontSize}px`, lineHeight }}
                  className="w-full resize-none rounded-sm border border-gold-bright/60 bg-background px-4 py-3 font-serif text-text placeholder:text-ink-faint outline-none focus:ring-1 focus:ring-gold-bright/40"
                />
                <div className="flex justify-end gap-2 border-t border-rule pt-3">
                  <Button
                    tone="neutral"
                    fill="outline"
                    size="sm"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="font-sans text-[11px] uppercase tracking-[0.08em]"
                  >
                    <X size={12} className="mr-1" />
                    {t("simple.reader.cancelEdit", { defaultValue: "取消" })}
                  </Button>
                  <Button
                    tone="accent"
                    size="sm"
                    onClick={() => void saveEdit()}
                    disabled={saving || draft === content}
                    className="font-sans text-[11px] uppercase tracking-[0.08em]"
                  >
                    <Save size={12} className="mr-1" />
                    {saving
                      ? t("simple.reader.saving", { defaultValue: "保存中…" })
                      : t("simple.reader.save", { defaultValue: "保存" })}
                  </Button>
                </div>
              </div>
            ) : content !== null ? (
              <div className="flex flex-col gap-4">
                <article
                  className="whitespace-pre-wrap break-words font-serif text-text/90"
                  style={{ fontSize: `${fontSize}px`, lineHeight }}
                >
                  {content || (
                    <span className="font-serif text-sm italic text-ink-faint">
                      {t("simple.reader.emptyChapter", { defaultValue: "本章正文为空。" })}
                    </span>
                  )}
                </article>
                <div className="flex justify-end border-t border-rule pt-3">
                  <Button
                    tone="neutral"
                    fill="outline"
                    size="sm"
                    onClick={beginEdit}
                    className="font-sans text-[11px] uppercase tracking-[0.08em]"
                  >
                    <Pencil size={12} className="mr-1" />
                    {t("simple.reader.edit", { defaultValue: "修改本章" })}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

      </main>
    </div>
  );
}
