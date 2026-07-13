// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { ApiError } from "../../api/engine-client";
import {
  listTrash,
  permanentDeleteTrash,
  purgeTrash,
  restoreTrash,
  type TrashEntry,
  type TrashScope,
} from "../../api/engine-client";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { Modal } from "./Modal";
import { ChevronDown, ChevronRight, FileText, FolderOpen, Trash2 } from "lucide-react";

type TrashPanelProps = {
  scope: TrashScope;
  path?: string;
  onRestore?: (entry: TrashEntry) => Promise<void> | void;
  refreshToken?: number;
  disabled?: boolean;
};

function sortEntries(entries: TrashEntry[]): TrashEntry[] {
  return [...entries].sort((left, right) => new Date(right.deleted_at).getTime() - new Date(left.deleted_at).getTime());
}

function formatRelativeTime(value: string, locale: string): string {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;

  const diffMs = timestamp - Date.now();
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, "hour");

  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, "day");
}

function formatAbsoluteTime(value: string, locale: string): string {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function getDaysUntilExpiry(value: string): number | null {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  const diffMs = timestamp - Date.now();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function isDirectoryEntry(entry: TrashEntry): boolean {
  return (
    Boolean(entry.metadata?.is_directory) ||
    entry.entity_type === "fandom" ||
    entry.entity_type === "au" ||
    entry.entity_type.endsWith("_dir")
  );
}

function getEntryLabel(entry: TrashEntry): string {
  return entry.entity_name || entry.original_path.split("/").pop() || entry.original_path;
}

export function TrashPanel({ scope, path, onRestore, refreshToken = 0, disabled = false }: TrashPanelProps) {
  const { t, i18n } = useTranslation();
  const { showError, showSuccess, showToast } = useFeedback();
  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TrashEntry | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  // F5：冲突时记住是哪个条目，供「以回收站版本恢复（覆盖当前）」按钮走 overwrite 路径。
  const [restoreConflictEntry, setRestoreConflictEntry] = useState<TrashEntry | null>(null);
  const requestGuard = useActiveRequestGuard(`${scope}:${path ?? ""}`);
  const timeLocale = i18n.resolvedLanguage === "en" ? "en-US" : "zh-CN";

  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——体内全是 setter（非依赖），仅应随 path/scope 变化复位；biome 判 path/scope 多余，删掉会导致切换回收站上下文不再复位（残留上一处的条目）
  useEffect(() => {
    setEntries([]);
    setLoading(false);
    setPendingId(null);
    setIsClearingAll(false);
    setDeleteTarget(null);
    setClearAllOpen(false);
    setRestoreConflictEntry(null);
  }, [path, scope]);

  const loadEntries = async () => {
    if (!path) {
      setEntries([]);
      setLoading(false);
      return;
    }
    const token = requestGuard.start();
    setLoading(true);
    try {
      const data = await listTrash(scope, path);
      if (requestGuard.isStale(token)) return;
      setEntries(sortEntries(data));
    } catch (error) {
      if (requestGuard.isStale(token)) return;
      showError(error, t("error_messages.unknown"));
    } finally {
      if (!requestGuard.isStale(token)) {
        setLoading(false);
      }
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——仅应随 path/refreshToken/scope 变化重拉；loadEntries 每渲染重建（读最新 path/scope 闭包），故意不入依赖，否则每次渲染都重拉；biome 同时误判 path/refreshToken/scope 多余，不可删
  useEffect(() => {
    void loadEntries();
  }, [path, refreshToken, scope]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——仅应随 isExpanded 变化（展开时首拉）；loadEntries 每渲染重建，入依赖会每次渲染重拉
  useEffect(() => {
    if (!isExpanded) return;
    void loadEntries();
  }, [isExpanded]);

  const handleRestore = async (entry: TrashEntry, onConflict: "abort" | "overwrite" = "abort") => {
    if (!path || disabled) return;
    const contextKey = `${scope}:${path}`;
    setPendingId(entry.trash_id);
    try {
      await restoreTrash(scope, path, entry.trash_id, onConflict);
      if (requestGuard.isKeyStale(contextKey)) return;
      setEntries((current) => current.filter((item) => item.trash_id !== entry.trash_id));
      setRestoreConflictEntry(null);
      try {
        await onRestore?.(entry);
      } catch {
        // Restore already succeeded; avoid surfacing a conflicting generic error toast.
      }
      showSuccess(
        onConflict === "overwrite"
          ? t("trash.restoreOverwriteSuccess", { name: getEntryLabel(entry) })
          : t("trash.restoreSuccess", { name: getEntryLabel(entry) }),
      );
    } catch (error) {
      if (requestGuard.isKeyStale(contextKey)) return;
      // F5：仅 abort 路径撞冲突时弹「以回收站版本覆盖」出路；overwrite 已备份仍失败则照常报错。
      if (onConflict === "abort" && error instanceof ApiError && error.errorCode.toLowerCase() === "restore_conflict") {
        setRestoreConflictEntry(entry);
        return;
      }
      showError(error, t("error_messages.unknown"));
    } finally {
      if (!requestGuard.isKeyStale(contextKey)) {
        setPendingId(null);
      }
    }
  };

  const handlePermanentDelete = async () => {
    if (!path || !deleteTarget || disabled) return;
    const contextKey = `${scope}:${path}`;
    setPendingId(deleteTarget.trash_id);
    try {
      await permanentDeleteTrash(scope, path, deleteTarget.trash_id);
      if (requestGuard.isKeyStale(contextKey)) return;
      setEntries((current) => current.filter((item) => item.trash_id !== deleteTarget.trash_id));
      showSuccess(t("trash.deleteSuccess"));
      setDeleteTarget(null);
    } catch (error) {
      if (requestGuard.isKeyStale(contextKey)) return;
      // F5：半恢复态拒绝删除 → 展示 friendly 指引（先完成恢复 / 覆盖），而非裸引擎 message。
      // ApiError.userMessage 里是带 marker 的引擎原文，getMessage 会优先它、忽略 fallback，
      // 故这里直接 showToast 友好文案，不走 showError。
      if (error instanceof ApiError && error.errorCode.toLowerCase() === "trash_half_restored") {
        showToast(t("trash.halfRestored"), "error");
        setDeleteTarget(null);
      } else {
        showError(error, t("error_messages.unknown"));
      }
      await loadEntries();
    } finally {
      if (!requestGuard.isKeyStale(contextKey)) {
        setPendingId(null);
      }
    }
  };

  const handleClearAll = async () => {
    if (!path || entries.length === 0 || disabled) return;
    const contextKey = `${scope}:${path}`;
    setIsClearingAll(true);
    try {
      await purgeTrash(scope, path, 0);
      if (requestGuard.isKeyStale(contextKey)) return;
      setEntries([]);
      showSuccess(t("trash.clearSuccess"));
      setClearAllOpen(false);
    } catch (error) {
      if (requestGuard.isKeyStale(contextKey)) return;
      showError(error, t("error_messages.unknown"));
      await loadEntries();
    } finally {
      if (!requestGuard.isKeyStale(contextKey)) {
        setIsClearingAll(false);
      }
    }
  };

  return (
    <>
      <div className="shrink-0 border-t border-black/10 bg-surface/80 dark:border-white/10">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-text/90 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          onClick={() => setIsExpanded((current) => !current)}
          disabled={disabled}
        >
          <span className="flex items-center gap-2">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Trash2 size={14} className="text-text/50" />
            <span>{t("trash.title")}</span>
            <span className="text-text/50">{t("trash.count", { count: entries.length })}</span>
          </span>
          {loading && <Spinner size="sm" className="text-accent" />}
        </button>

        {isExpanded && (
          <div className="space-y-3 border-t border-black/10 px-4 py-4 dark:border-white/10">
            {loading ? (
              <div className="flex justify-center py-6">
                <Spinner size="md" className="text-accent" />
              </div>
            ) : entries.length === 0 ? (
              <EmptyState
                compact
                icon={<Trash2 size={28} />}
                title={t("emptyState.trash.title")}
                description={t("emptyState.trash.description")}
              />
            ) : (
              <>
                {entries.map((entry) => {
                  const expiresInDays = getDaysUntilExpiry(entry.expires_at);
                  const isBusy = pendingId === entry.trash_id || isClearingAll;
                  return (
                    <div
                      key={entry.trash_id}
                      className="rounded-lg border border-black/10 bg-background/60 p-3 shadow-subtle dark:border-white/10"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 text-text/50">
                          {isDirectoryEntry(entry) ? <FolderOpen size={16} /> : <FileText size={16} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-text">{getEntryLabel(entry)}</div>
                          <div
                            className="mt-1 text-xs text-text/50"
                            title={formatAbsoluteTime(entry.deleted_at, timeLocale)}
                          >
                            {t("trash.deletedAt", { time: formatRelativeTime(entry.deleted_at, timeLocale) })}
                          </div>
                          <div
                            className="text-xs text-text/50"
                            title={formatAbsoluteTime(entry.expires_at, timeLocale)}
                          >
                            {expiresInDays === null
                              ? t("trash.expired")
                              : expiresInDays > 0
                                ? t("trash.expiresIn", { days: expiresInDays })
                                : t("trash.expired")}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex justify-end gap-2">
                        <Button
                          tone="neutral"
                          fill="outline"
                          size="sm"
                          onClick={() => {
                            void handleRestore(entry);
                          }}
                          disabled={isBusy || disabled}
                        >
                          {pendingId === entry.trash_id ? <Spinner size="sm" /> : t("trash.restore")}
                        </Button>
                        <Button
                          tone="destructive"
                          fill="plain"
                          size="sm"
                          onClick={() => setDeleteTarget(entry)}
                          disabled={isBusy || disabled}
                        >
                          {t("trash.permanentDelete")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
                <div className="flex justify-end pt-1">
                  <Button
                    tone="destructive"
                    fill="plain"
                    size="sm"
                    onClick={() => setClearAllOpen(true)}
                    disabled={isClearingAll || disabled}
                  >
                    {isClearingAll ? <Spinner size="sm" /> : t("trash.clearAll")}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <Modal isOpen={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title={t("trash.permanentDelete")}>
        <div className="space-y-4">
          <p className="text-sm text-text/90">
            {t("trash.confirmDelete", { name: deleteTarget ? getEntryLabel(deleteTarget) : "" })}
          </p>
          <div className="flex justify-end gap-2">
            <Button tone="neutral" fill="plain" onClick={() => setDeleteTarget(null)}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              tone="destructive"
              fill="solid"
              onClick={() => {
                void handlePermanentDelete();
              }}
              disabled={pendingId !== null || disabled}
            >
              {pendingId && deleteTarget ? <Spinner size="sm" /> : t("common.actions.confirmDelete")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={clearAllOpen} onClose={() => setClearAllOpen(false)} title={t("trash.clearAll")}>
        <div className="space-y-4">
          <p className="text-sm text-text/90">{t("trash.confirmClearAll", { count: entries.length })}</p>
          <div className="flex justify-end gap-2">
            <Button tone="neutral" fill="plain" onClick={() => setClearAllOpen(false)}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              tone="destructive"
              fill="solid"
              onClick={() => {
                void handleClearAll();
              }}
              disabled={isClearingAll || disabled}
            >
              {isClearingAll ? <Spinner size="sm" /> : t("trash.clearAll")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={restoreConflictEntry !== null}
        onClose={() => setRestoreConflictEntry(null)}
        title={t("trash.restore")}
      >
        <div className="space-y-4">
          <p className="text-sm text-text/90">{t("trash.restoreConflict")}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button tone="neutral" fill="plain" onClick={() => setRestoreConflictEntry(null)}>
              {t("common.actions.cancel")}
            </Button>
            {/* F5：以回收站版本覆盖当前（引擎覆盖前会先备份当前文件进回收站）。 */}
            <Button
              tone="accent"
              fill="solid"
              disabled={pendingId !== null || disabled}
              onClick={() => {
                const entry = restoreConflictEntry;
                if (!entry) return;
                setRestoreConflictEntry(null);
                void handleRestore(entry, "overwrite");
              }}
            >
              {t("trash.restoreConflictOverwrite")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
