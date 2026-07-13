// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Search, Filter, Sparkles } from "lucide-react";
import { Spinner } from "../shared/Spinner";
import { Button } from "../shared/Button";
import { Input } from "../shared/Input";
import { useTranslation } from "../../i18n/useAppTranslation";
import { getEnumLabel } from "../../i18n/labels";
import type { useFactsFilter } from "./useFactsFilter";
import type { useFactEditor } from "./useFactEditor";
import type { useFactsExtraction } from "./useFactsExtraction";

/** tab 计数（全量事实按状态分桶）。 */
export interface FactsCounts {
  total: number;
  active: number;
  unresolved: number;
  resolved: number;
  deprecated: number;
}

/**
 * FactsFilterBar — 事实笔记页头（拆自 FactsLayout 的移动/桌面两段 header）。
 *
 * 标题 + 提取/新建按钮 + 搜索框 + 筛选面板（章节/角色）+ 状态 tab（全部/未决/生效/已解决/废弃）。
 * 移动端用 <button> tab、桌面用 <span> tab，且类名/尺寸不同，用 variant 内部分支逐字保留
 *（原两段 JSX 直接搬入，零行为变化）。
 */
export interface FactsFilterBarProps {
  variant: "mobile" | "desktop";
  factsFilter: ReturnType<typeof useFactsFilter>;
  extraction: ReturnType<typeof useFactsExtraction>;
  editor: ReturnType<typeof useFactEditor>;
  counts: FactsCounts;
}

export function FactsFilterBar({ variant, factsFilter, extraction, editor, counts }: FactsFilterBarProps) {
  const { t } = useTranslation();
  const {
    total: totalCount,
    active: activeCount,
    unresolved: unresolvedCount,
    resolved: resolvedCount,
    deprecated: deprecatedCount,
  } = counts;

  if (variant === "mobile") {
    return (
      <header className="safe-area-top sticky top-0 z-20 border-b border-black/10 bg-surface/90 px-4 py-4 backdrop-blur-sm dark:border-white/10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl font-bold">{t("facts.title")}</h1>
            <p className="text-sm text-text/50">{t("facts.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              tone="neutral"
              fill="outline"
              size="sm"
              className="px-3"
              onClick={extraction.handleExtractClick}
              disabled={extraction.extracting}
            >
              {extraction.extracting ? <Spinner size="md" /> : <Sparkles size={16} />}
            </Button>
            <Button
              tone="accent"
              fill="solid"
              size="sm"
              className="px-3 shadow-md"
              onClick={() => editor.openAddModal()}
            >
              {t("facts.createButton")}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 text-text/50" size={16} />
            <Input
              className="pl-10"
              placeholder={t("common.search.facts")}
              value={factsFilter.filter}
              onChange={(e) => factsFilter.setFilter(e.target.value)}
            />
          </div>
          <Button
            tone={
              factsFilter.filterOpen || factsFilter.chapterFilter !== null || factsFilter.characterFilter
                ? "accent"
                : "neutral"
            }
            fill={
              factsFilter.filterOpen || factsFilter.chapterFilter !== null || factsFilter.characterFilter
                ? "solid"
                : "outline"
            }
            className="w-11 px-0"
            title={t("facts.filterTitle")}
            onClick={() => factsFilter.toggleFilterPanel()}
          >
            <Filter size={16} />
          </Button>
        </div>

        {factsFilter.filterOpen ? (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              value={factsFilter.chapterFilter ?? ""}
              onChange={(e) => factsFilter.setChapterFilter(e.target.value ? Number(e.target.value) : null)}
              className="h-11 rounded-md border border-black/10 bg-background px-3 text-base outline-hidden focus:ring-1 focus:ring-accent dark:border-white/15 md:text-sm"
            >
              <option value="">{t("facts.filterAllChapters")}</option>
              {factsFilter.uniqueChapters.map((ch) => (
                <option key={ch} value={ch}>
                  {t("facts.chapterGroup", { num: ch })}
                </option>
              ))}
            </select>
            <select
              value={factsFilter.characterFilter}
              onChange={(e) => factsFilter.setCharacterFilter(e.target.value)}
              className="h-11 rounded-md border border-black/10 bg-background px-3 text-base outline-hidden focus:ring-1 focus:ring-accent dark:border-white/15 md:text-sm"
            >
              <option value="">{t("facts.filterAllCharacters")}</option>
              {factsFilter.uniqueCharacters.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 text-sm whitespace-nowrap">
          <button
            type="button"
            className={`min-h-[44px] border-b-2 px-1 pb-1 font-medium ${!factsFilter.statusFilter ? "border-accent text-accent" : "border-transparent text-text/70"}`}
            onClick={() => factsFilter.setStatusFilter("")}
          >
            {t("facts.allTab")} ({totalCount})
          </button>
          <button
            type="button"
            className={`min-h-[44px] border-b-2 px-1 pb-1 font-medium ${factsFilter.statusFilter === "unresolved" ? "border-accent text-accent" : "border-transparent text-text/70"}`}
            onClick={() => factsFilter.setStatusFilter("unresolved")}
          >
            {getEnumLabel("fact_status", "unresolved", "unresolved")} ({unresolvedCount})
          </button>
          <button
            type="button"
            className={`min-h-[44px] border-b-2 px-1 pb-1 font-medium ${factsFilter.statusFilter === "active" ? "border-accent text-accent" : "border-transparent text-text/70"}`}
            onClick={() => factsFilter.setStatusFilter("active")}
          >
            {getEnumLabel("fact_status", "active", "active")} ({activeCount})
          </button>
          <button
            type="button"
            className={`min-h-[44px] border-b-2 px-1 pb-1 font-medium ${factsFilter.statusFilter === "resolved" ? "border-accent text-accent" : "border-transparent text-text/70"}`}
            onClick={() => factsFilter.setStatusFilter("resolved")}
          >
            {getEnumLabel("fact_status", "resolved", "resolved")} ({resolvedCount})
          </button>
          <button
            type="button"
            className={`min-h-[44px] border-b-2 px-1 pb-1 font-medium ${factsFilter.statusFilter === "deprecated" ? "border-accent text-accent" : "border-transparent text-text/70"}`}
            onClick={() => factsFilter.setStatusFilter("deprecated")}
          >
            {getEnumLabel("fact_status", "deprecated", "deprecated")} ({deprecatedCount})
          </button>
        </div>
      </header>
    );
  }

  return (
    <header className="p-5 border-b border-black/10 dark:border-white/10 flex flex-col gap-4 shrink-0 bg-surface">
      <div className="flex justify-between items-center gap-3">
        <h1 className="font-serif text-xl font-bold">{t("facts.title")}</h1>
        <div className="flex items-center gap-2">
          <Button
            tone="neutral"
            fill="outline"
            size="sm"
            className="px-3 gap-1"
            onClick={extraction.handleExtractClick}
            disabled={extraction.extracting}
          >
            {extraction.extracting ? <Spinner size="md" /> : <Sparkles size={16} />}
            {extraction.extracting ? `${extraction.extractProgress}%` : t("common.actions.extractFacts")}
          </Button>
          <Button tone="accent" fill="solid" size="sm" className="px-3 shadow-md" onClick={() => editor.openAddModal()}>
            {t("facts.createButton")}
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2 text-text/50" size={16} />
          <Input
            className="pl-9 h-8 text-xs placeholder:text-xs"
            placeholder={t("common.search.facts")}
            value={factsFilter.filter}
            onChange={(e) => factsFilter.setFilter(e.target.value)}
          />
        </div>
        <Button
          tone={
            factsFilter.filterOpen || factsFilter.chapterFilter !== null || factsFilter.characterFilter
              ? "accent"
              : "neutral"
          }
          fill={
            factsFilter.filterOpen || factsFilter.chapterFilter !== null || factsFilter.characterFilter
              ? "solid"
              : "outline"
          }
          className="px-2.5 h-8 shrink-0"
          title={t("facts.filterTitle")}
          onClick={() => factsFilter.toggleFilterPanel()}
        >
          <Filter size={14} />
        </Button>
      </div>

      {factsFilter.filterOpen && (
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={factsFilter.chapterFilter ?? ""}
            onChange={(e) => factsFilter.setChapterFilter(e.target.value ? Number(e.target.value) : null)}
            className="h-7 rounded-md border border-black/10 dark:border-white/15 bg-background px-2 text-xs focus:ring-1 focus:ring-accent outline-hidden"
          >
            <option value="">{t("facts.filterAllChapters")}</option>
            {factsFilter.uniqueChapters.map((ch) => (
              <option key={ch} value={ch}>
                {t("facts.chapterGroup", { num: ch })}
              </option>
            ))}
          </select>
          <select
            value={factsFilter.characterFilter}
            onChange={(e) => factsFilter.setCharacterFilter(e.target.value)}
            className="h-7 rounded-md border border-black/10 dark:border-white/15 bg-background px-2 text-xs focus:ring-1 focus:ring-accent outline-hidden"
          >
            <option value="">{t("facts.filterAllCharacters")}</option>
            {factsFilter.uniqueCharacters.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {(factsFilter.chapterFilter !== null || factsFilter.characterFilter) && (
            <button
              type="button"
              className="text-xs text-accent hover:underline"
              onClick={() => {
                factsFilter.setChapterFilter(null);
                factsFilter.setCharacterFilter("");
              }}
            >
              {t("facts.filterClear")}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex gap-3 overflow-x-auto pb-1 text-xs font-sans whitespace-nowrap">
          <button
            type="button"
            className={`cursor-pointer font-medium border-b-2 pb-1 ${!factsFilter.statusFilter ? "font-bold text-accent border-accent" : "text-text/70 hover:text-text border-transparent"}`}
            onClick={() => factsFilter.setStatusFilter("")}
          >
            {t("facts.allTab")} ({totalCount})
          </button>
          <button
            type="button"
            className={`cursor-pointer font-medium border-b-2 pb-1 ${factsFilter.statusFilter === "unresolved" ? "font-bold text-accent border-accent" : "text-text/70 hover:text-text border-transparent"}`}
            onClick={() => factsFilter.setStatusFilter("unresolved")}
          >
            {getEnumLabel("fact_status", "unresolved", "unresolved")} ({unresolvedCount})
          </button>
          <button
            type="button"
            className={`cursor-pointer font-medium border-b-2 pb-1 ${factsFilter.statusFilter === "active" ? "font-bold text-accent border-accent" : "text-text/70 hover:text-text border-transparent"}`}
            onClick={() => factsFilter.setStatusFilter("active")}
          >
            {getEnumLabel("fact_status", "active", "active")} ({activeCount})
          </button>
          <button
            type="button"
            className={`cursor-pointer font-medium border-b-2 pb-1 ${factsFilter.statusFilter === "resolved" ? "font-bold text-accent border-accent" : "text-text/70 hover:text-text border-transparent"}`}
            onClick={() => factsFilter.setStatusFilter("resolved")}
          >
            {getEnumLabel("fact_status", "resolved", "resolved")} ({resolvedCount})
          </button>
          <button
            type="button"
            className={`cursor-pointer font-medium border-b-2 pb-1 ${factsFilter.statusFilter === "deprecated" ? "font-bold text-accent border-accent" : "text-text/70 hover:text-text border-transparent"}`}
            onClick={() => factsFilter.setStatusFilter("deprecated")}
          >
            {getEnumLabel("fact_status", "deprecated", "deprecated")} ({deprecatedCount})
          </button>
        </div>
        {factsFilter.statusFilter && (
          <p className="text-xs text-text/50 font-sans">{t(`facts.statusHint.${factsFilter.statusFilter}`)}</p>
        )}
      </div>
    </header>
  );
}
