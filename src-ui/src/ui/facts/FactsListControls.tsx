// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { X } from "lucide-react";
import { Spinner } from "../shared/Spinner";
import { Button } from "../shared/Button";
import { ProgressBar } from "../shared/ProgressBar";
import { useTranslation } from "../../i18n/useAppTranslation";
import type { useFactsFilter } from "./useFactsFilter";
import type { useBatchFacts } from "./useBatchFacts";
import type { useFactsExtraction } from "./useFactsExtraction";

/**
 * FactsListControls — 列表上方的操作条（拆自 FactsLayout）：提取进度 / 过期提醒 / 批量操作。
 *
 * 三块都是条件渲染，夹在 header 与列表之间。移动端与桌面端类名/图标尺寸/菜单展开形态
 *（移动内联块、桌面绝对下拉）不同，用 variant 内部分支逐字保留（原 JSX 直接搬入，零行为变化）。
 */
export interface FactsListControlsProps {
  variant: "mobile" | "desktop";
  extraction: ReturnType<typeof useFactsExtraction>;
  staleCount: number;
  factsFilter: ReturnType<typeof useFactsFilter>;
  batch: ReturnType<typeof useBatchFacts>;
}

export function FactsListControls({ variant, extraction, staleCount, factsFilter, batch }: FactsListControlsProps) {
  const { t } = useTranslation();

  if (variant === "mobile") {
    return (
      <>
        {extraction.extracting && (
          <div className="mx-4 mt-3 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <Spinner size="sm" className="shrink-0 text-accent" />
                <span className="truncate text-text/70">{t("common.status.extracting")}</span>
                <span className="shrink-0 font-medium text-accent">{extraction.extractProgress}%</span>
              </div>
              <button
                type="button"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0 rounded-md text-text/50 hover:text-error hover:bg-error/10 transition-colors"
                onClick={extraction.handleCancelExtraction}
              >
                <X size={16} />
              </button>
            </div>
            <ProgressBar percent={extraction.extractProgress} className="mt-1.5" />
          </div>
        )}

        {staleCount > 0 && !factsFilter.statusFilter ? (
          <div className="mx-4 mt-3 flex items-center justify-between rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">
            <span>💡 {t("facts.staleHint", { count: staleCount })}</span>
            <Button
              tone="neutral"
              fill="plain"
              size="sm"
              className="h-11 px-3 text-sm"
              onClick={() => factsFilter.setStatusFilter("stale")}
            >
              {t("facts.staleView")}
            </Button>
          </div>
        ) : null}

        {factsFilter.filteredFacts.length > 0 ? (
          <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 text-xs text-text/70">
            <button
              type="button"
              className={`min-h-[44px] font-medium ${batch.batchMode ? "text-accent" : "text-text/50 hover:text-text/70"}`}
              onClick={() => {
                batch.setBatchMode(!batch.batchMode);
                if (batch.batchMode) {
                  batch.setSelectedIds(new Set());
                  batch.setBatchMenuOpen(false);
                }
              }}
            >
              {batch.batchMode ? t("facts.batchExit") : t("facts.batchEnter")}
            </button>
            {batch.batchMode ? (
              <label className="flex min-h-[44px] items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={batch.selectedIds.size > 0 && batch.selectedIds.size === factsFilter.filteredFacts.length}
                  onChange={batch.toggleSelectAll}
                  className="accent-accent"
                />
                {t("facts.batchSelect")}
              </label>
            ) : null}
            {batch.selectedIds.size > 0 ? (
              <>
                <span className="font-medium text-accent">
                  {t("facts.batchSelected", { count: batch.selectedIds.size })}
                </span>
                <Button
                  tone="neutral"
                  fill="outline"
                  size="sm"
                  className="h-11 px-3 text-sm"
                  onClick={() => batch.setBatchMenuOpen(!batch.batchMenuOpen)}
                  disabled={batch.batchProcessing}
                >
                  {t("facts.batchAction")} ▾
                </Button>
                {batch.batchMenuOpen ? (
                  <div className="w-full rounded-lg border border-black/10 bg-surface p-1 dark:border-white/10">
                    {(["deprecated", "resolved", "active", "unresolved"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="flex min-h-[44px] w-full items-center rounded-md px-3 py-2 text-left text-sm hover:bg-accent/10"
                        onClick={() => {
                          batch.setBatchMenuOpen(false);
                          batch.setBatchConfirm(s);
                        }}
                      >
                        {t(`facts.batchTo.${s}`)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      {/* 提取进度 */}
      {extraction.extracting && (
        <div className="mx-4 mt-3 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <Spinner size="sm" className="shrink-0 text-accent" />
              <span className="truncate text-text/70">{t("common.status.extracting")}</span>
              <span className="shrink-0 font-medium text-accent">{extraction.extractProgress}%</span>
            </div>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-text/50 hover:text-error hover:bg-error/10 transition-colors"
              onClick={extraction.handleCancelExtraction}
              title={t("common.actions.cancel")}
            >
              <X size={14} />
            </button>
          </div>
          <ProgressBar percent={extraction.extractProgress} className="mt-1.5" />
        </div>
      )}

      {/* 过期提醒 */}
      {staleCount > 0 && !factsFilter.statusFilter && (
        <div className="mx-4 mt-3 flex items-center justify-between rounded-lg bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning">
          <span>💡 {t("facts.staleHint", { count: staleCount })}</span>
          <Button
            tone="neutral"
            fill="plain"
            size="sm"
            className="text-xs h-6 px-2"
            onClick={() => factsFilter.setStatusFilter("stale")}
          >
            {t("facts.staleView")}
          </Button>
        </div>
      )}

      {/* 批量操作栏 */}
      {factsFilter.filteredFacts.length > 0 && (
        <div className="mx-4 mt-2 flex items-center gap-3 text-xs text-text/70">
          <button
            type="button"
            className={`font-medium ${batch.batchMode ? "text-accent" : "text-text/50 hover:text-text/70"}`}
            onClick={() => {
              batch.setBatchMode(!batch.batchMode);
              if (batch.batchMode) {
                batch.setSelectedIds(new Set());
                batch.setBatchMenuOpen(false);
              }
            }}
          >
            {batch.batchMode ? t("facts.batchExit") : t("facts.batchEnter")}
          </button>
          {batch.batchMode && (
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={batch.selectedIds.size > 0 && batch.selectedIds.size === factsFilter.filteredFacts.length}
                onChange={batch.toggleSelectAll}
                className="accent-accent"
              />
              {t("facts.batchSelect")}
            </label>
          )}
          {batch.selectedIds.size > 0 && (
            <>
              <span className="text-accent font-medium">
                {t("facts.batchSelected", { count: batch.selectedIds.size })}
              </span>
              <div className="relative">
                <Button
                  tone="neutral"
                  fill="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => batch.setBatchMenuOpen(!batch.batchMenuOpen)}
                  disabled={batch.batchProcessing}
                >
                  {t("facts.batchAction")} ▾
                </Button>
                {batch.batchMenuOpen && (
                  <div className="absolute top-7 left-0 z-20 bg-surface border border-black/10 dark:border-white/10 rounded-lg shadow-lg py-1 min-w-[160px]">
                    {(["deprecated", "resolved", "active", "unresolved"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/10 transition-colors"
                        onClick={() => {
                          batch.setBatchMenuOpen(false);
                          batch.setBatchConfirm(s);
                        }}
                      >
                        {t(`facts.batchTo.${s}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
