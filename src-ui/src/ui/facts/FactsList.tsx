// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Search, BookOpenText } from "lucide-react";
import { Spinner } from "../shared/Spinner";
import { Button } from "../shared/Button";
import { EmptyState } from "../shared/EmptyState";
import { FactCard } from "./FactCard";
import { useTranslation } from "../../i18n/useAppTranslation";
import type { useFactsFilter } from "./useFactsFilter";
import type { useBatchFacts } from "./useBatchFacts";
import type { useFactEditor } from "./useFactEditor";
import type { useFactsExtraction } from "./useFactsExtraction";

/**
 * FactsList — 事实笔记列表主体（拆自 FactsLayout 的移动/桌面两段列表）。
 *
 * loading spinner / 空态（无笔记 / 无搜索结果）/ 按章分组的卡片 + 分页「加载更多」。
 * 移动端与桌面端类名差异只在容器 padding、章节吸顶位置与 checkbox 上边距，用 variant
 * 内部分支逐字保留（原两段 JSX 直接搬入，零行为变化）。
 */
export interface FactsListProps {
  variant: "mobile" | "desktop";
  loading: boolean;
  showEmptyNotes: boolean;
  showNoSearchResult: boolean;
  factsFilter: ReturnType<typeof useFactsFilter>;
  batch: ReturnType<typeof useBatchFacts>;
  editor: ReturnType<typeof useFactEditor>;
  extraction: ReturnType<typeof useFactsExtraction>;
}

export function FactsList({
  variant,
  loading,
  showEmptyNotes,
  showNoSearchResult,
  factsFilter,
  batch,
  editor,
  extraction,
}: FactsListProps) {
  const { t } = useTranslation();

  if (variant === "mobile") {
    return (
      <div className="space-y-4 px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner size="lg" className="text-accent" />
          </div>
        ) : showEmptyNotes ? (
          <EmptyState
            compact
            icon={<BookOpenText size={28} />}
            title={t("emptyState.facts.title")}
            description={t("emptyState.facts.description")}
            actions={[
              {
                key: "add-fact",
                element: (
                  <Button tone="accent" fill="solid" size="sm" onClick={() => editor.openAddModal()}>
                    {t("common.actions.manualFact")}
                  </Button>
                ),
              },
              {
                key: "extract-facts",
                element: (
                  <Button
                    tone="neutral"
                    fill="outline"
                    size="sm"
                    onClick={extraction.handleExtractClick}
                    disabled={extraction.extracting}
                  >
                    {t("common.actions.extractFacts")}
                  </Button>
                ),
              },
            ]}
          />
        ) : showNoSearchResult ? (
          <EmptyState
            compact
            icon={<Search size={28} />}
            title={t("facts.noSearchResultTitle")}
            description={t("facts.noSearchResultDescription")}
            actions={[
              {
                key: "add-first-fact",
                element: (
                  <Button tone="accent" fill="solid" size="sm" onClick={() => editor.openAddModal()}>
                    {t("common.actions.newNote")}
                  </Button>
                ),
              },
            ]}
          />
        ) : (
          factsFilter.groupedFacts.map(([chapterNum, chapterFacts]) => (
            <div key={chapterNum} className="space-y-3">
              <div className="sticky top-[148px] z-10 rounded-xl border border-black/5 bg-background/92 px-3 py-2 text-xs font-medium text-text/50 backdrop-blur-sm dark:border-white/5">
                {t("facts.chapterGroup", { num: chapterNum })} ({chapterFacts.length})
              </div>
              {chapterFacts.map((fact) => (
                <div key={fact.id} className="flex items-start gap-2">
                  {batch.batchMode ? (
                    <input
                      type="checkbox"
                      className="mt-4 accent-accent shrink-0"
                      checked={batch.selectedIds.has(fact.id)}
                      onChange={() => batch.toggleSelect(fact.id)}
                    />
                  ) : null}
                  <button
                    type="button"
                    className="flex-1 cursor-pointer text-left"
                    onClick={() => editor.startEditFact(fact)}
                  >
                    <FactCard
                      fact={{ ...fact, weight: fact.narrative_weight || "medium", chapter: fact.chapter || 1 }}
                    />
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
        {factsFilter.hasMoreFacts && (
          <div className="flex justify-center py-4">
            <Button tone="neutral" fill="plain" size="sm" onClick={() => factsFilter.showMoreFacts()}>
              {t("facts.loadMore", { remaining: factsFilter.filteredFacts.length - factsFilter.visibleCount })}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner size="lg" className="text-accent" />
        </div>
      ) : showEmptyNotes ? (
        <EmptyState
          compact
          icon={<BookOpenText size={28} />}
          title={t("emptyState.facts.title")}
          description={t("emptyState.facts.description")}
          actions={[
            {
              key: "add-fact",
              element: (
                <Button tone="accent" fill="solid" size="sm" onClick={() => editor.openAddModal()}>
                  {t("common.actions.manualFact")}
                </Button>
              ),
            },
            {
              key: "extract-facts",
              element: (
                <Button
                  tone="neutral"
                  fill="outline"
                  size="sm"
                  onClick={extraction.handleExtractClick}
                  disabled={extraction.extracting}
                >
                  {t("common.actions.extractFacts")}
                </Button>
              ),
            },
          ]}
        />
      ) : showNoSearchResult ? (
        <EmptyState
          compact
          icon={<Search size={28} />}
          title={t("facts.noSearchResultTitle")}
          description={t("facts.noSearchResultDescription")}
          actions={[
            {
              key: "add-first-fact",
              element: (
                <Button tone="accent" fill="solid" size="sm" onClick={() => editor.openAddModal()}>
                  {t("common.actions.newNote")}
                </Button>
              ),
            },
          ]}
        />
      ) : (
        factsFilter.groupedFacts.map(([chapterNum, chapterFacts]) => (
          <div key={chapterNum}>
            <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-xs px-1 py-1.5 text-xs font-medium text-text/50 border-b border-black/5 dark:border-white/5">
              {t("facts.chapterGroup", { num: chapterNum })} ({chapterFacts.length})
            </div>
            <div className="space-y-3 pt-2">
              {chapterFacts.map((fact) => (
                <div key={fact.id} className="flex items-start gap-2">
                  {batch.batchMode && (
                    <input
                      type="checkbox"
                      className="mt-3 accent-accent shrink-0"
                      checked={batch.selectedIds.has(fact.id)}
                      onChange={() => batch.toggleSelect(fact.id)}
                    />
                  )}
                  <button
                    type="button"
                    className="flex-1 cursor-pointer text-left"
                    onClick={() => editor.startEditFact(fact)}
                  >
                    <FactCard
                      fact={{ ...fact, weight: fact.narrative_weight || "medium", chapter: fact.chapter || 1 }}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      {factsFilter.hasMoreFacts && (
        <div className="flex justify-center py-4">
          <Button tone="neutral" fill="plain" size="sm" onClick={() => factsFilter.showMoreFacts()}>
            {t("facts.loadMore", { remaining: factsFilter.filteredFacts.length - factsFilter.visibleCount })}
          </Button>
        </div>
      )}
    </div>
  );
}
