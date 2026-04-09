// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/engine-client";
import {
  listTrash,
  permanentDeleteTrash,
  purgeTrash,
  restoreTrash,
  type TrashEntry,
  type TrashScope,
} from "../../api/engine-client";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { Modal } from "./Modal";
import { ChevronDown, ChevronRight, FileText, FolderOpen, Loader2, Trash2 } from "lucide-react";

type TrashPanelProps = {
  scope: TrashScope;
  path?: string;
  onRestore?: (entry: TrashEntry) => Promise<void> | void;
  refreshToken?: number;
  disabled?: boolean;
};

function sortEntries(entries: TrashEntry[]): TrashEntry[] {
  return [...entries].sort(
    (left, right) =>
      new Date(right.deleted_at).getTime() - new Date(left.deleted_at).getTime()
  );
}

function formatRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;

  const diffMs = timestamp - Date.now();
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });

  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, "hour");

  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, "day");
}

function formatAbsoluteTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
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
  return Boolean(entry.metadata?.is_directory)
    || entry.entity_type === "fandom"
    || entry.entity_type === "au"
    || entry.entity_type.endsWith("_dir");
}

function getEntryLabel(entry: TrashEntry): string {
  return entry.entity_name || entry.original_path.split("/").pop() || entry.original_path;
}

export function TrashPanel({ scope, path, onRestore, refreshToken = 0, disabled = false }: TrashPanelProps) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useFeedback();
  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TrashEntry | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [restoreConflictOpen, setRestoreConflictOpen] = useState(false);
  const contextVersionRef = useRef(0);
  const loadRequestIdRef = useRef(0);

  useEffect(() => {
    contextVersionRef.current += 1;
    loadRequestIdRef.current += 1;
    setEntries([]);
    setLoading(false);
    setPendingId(null);
    setIsClearingAll(false);
    setDeleteTarget(null);
    setClearAllOpen(false);
    setRestoreConflictOpen(false);
  }, [path, scope]);

  const loadEntries = async () => {
    if (!path) {
      setEntries([]);
      setLoading(false);
      return;
    }
    const requestId = ++loadRequestIdRef.current;
    const contextVersion = contextVersionRef.current;
    setLoading(true);
    try {
      const data = await listTrash(scope, path);
      if (requestId !== loadRequestIdRef.current || contextVersion !== contextVersionRef.current) {
        return;
      }
      setEntries(sortEntries(data));
    } catch (error) {
      if (requestId !== loadRequestIdRef.current || contextVersion !== contextVersionRef.current) {
        return;
      }
      showError(error, t("error_messages.unknown"));
    } finally {
      if (requestId === loadRequestIdRef.current && contextVersion === contextVersionRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadEntries();
  }, [path, refreshToken, scope]);

  useEffect(() => {
    if (!isExpanded) return;
    void loadEntries();
  }, [isExpanded]);

  const handleRestore = async (entry: TrashEntry) => {
    if (!path || disabled) return;
    const contextVersion = contextVersionRef.current;
    setPendingId(entry.trash_id);
    try {
      await restoreTrash(scope, path, entry.trash_id);
      if (contextVersion !== contextVersionRef.current) {
        return;
      }
      setEntries((current) => current.filter((item) => item.trash_id !== entry.trash_id));
      try {
        await onRestore?.(entry);
      } catch {
        // Restore already succeeded; avoid surfacing a conflicting generic error toast.
      }
      showSuccess(t("trash.restoreSuccess", { name: getEntryLabel(entry) }));
    } catch (error) {
      if (contextVersion !== contextVersionRef.current) {
        return;
      }
      if (error instanceof ApiError && error.errorCode.toLowerCase() === "restore_conflict") {
        setRestoreConflictOpen(true);
        return;
      }
      showError(error, t("error_messages.unknown"));
    } finally {
      if (contextVersion === contextVersionRef.current) {
        setPendingId(null);
      }
    }
  };

  const handlePermanentDelete = async () => {
    if (!path || !deleteTarget || disabled) return;
    const contextVersion = contextVersionRef.current;
    setPendingId(deleteTarget.trash_id);
    try {
      await permanentDeleteTrash(scope, path, deleteTarget.trash_id);
      if (contextVersion !== contextVersionRef.current) {
        return;
      }
      setEntries((current) => current.filter((item) => item.trash_id !== deleteTarget.trash_id));
      showSuccess(t("trash.deleteSuccess"));
      setDeleteTarget(null);
    } catch (error) {
      if (contextVersion !== contextVersionRef.current) {
        return;
      }
      showError(error, t("error_messages.unknown"));
      await loadEntries();
    } finally {
      if (contextVersion === contextVersionRef.current) {
        setPendingId(null);
      }
    }
  };

  const handleClearAll = async () => {
    if (!path || entries.length === 0 || disabled) return;
    const contextVersion = contextVersionRef.current;
    setIsClearingAll(true);
    try {
      await purgeTrash(scope, path, 0);
      if (contextVersion !== contextVersionRef.current) {
        return;
      }
      setEntries([]);
      showSuccess(t("trash.clearSuccess"));
      setClearAllOpen(false);
    } catch (error) {
      if (contextVersion !== contextVersionRef.current) {
        return;
      }
      showError(error, t("error_messages.unknown"));
      await loadEntries();
    } finally {
      if (contextVersion === contextVersionRef.current) {
        setIsClearingAll(false);
      }
    }
  };

  return (
    <>
      <div className="shrink-0 border-t border-black/10 bg-surface/80 dark:border-white/10">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-text/80 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          onClick={() => setIsExpanded((current) => !current)}
          disabled={disabled}
        >
          <span className="flex items-center gap-2">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Trash2 size={14} className="text-text/50" />
            <span>{t("trash.title")}</span>
            <span className="text-text/45">{t("trash.count", { count: entries.length })}</span>
          </span>
          {loading && <Loader2 size={14} className="animate-spin text-accent" />}
        </button>

        {isExpanded && (
          <div className="space-y-3 border-t border-black/10 px-4 py-4 dark:border-white/10">
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 size={20} className="animate-spin text-accent" />
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
                        <div className="mt-0.5 text-text/45">
                          {isDirectoryEntry(entry) ? <FolderOpen size={16} /> : <FileText size={16} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-text">
                            {getEntryLabel(entry)}
                          </div>
                          <div
                            className="mt-1 text-xs text-text/55"
                            title={formatAbsoluteTime(entry.deleted_at)}
                          >
                            {t("trash.deletedAt", { time: formatRelativeTime(entry.deleted_at) })}
                          </div>
                          <div
                            className="text-xs text-text/45"
                            title={formatAbsoluteTime(entry.expires_at)}
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
                          variant="secondary"
                          size="sm"
                          onClick={() => { void handleRestore(entry); }}
                          disabled={isBusy || disabled}
                        >
                          {pendingId === entry.trash_id ? <Loader2 size={14} className="animate-spin" /> : t("trash.restore")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
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
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                    onClick={() => setClearAllOpen(true)}
                    disabled={isClearingAll || disabled}
                  >
                    {isClearingAll ? <Loader2 size={14} className="animate-spin" /> : t("trash.clearAll")}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t("trash.permanentDelete")}
      >
        <div className="space-y-4">
          <p className="text-sm text-text/80">
            {t("trash.confirmDelete", { name: deleteTarget ? getEntryLabel(deleteTarget) : "" })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              variant="primary"
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => { void handlePermanentDelete(); }}
              disabled={pendingId !== null || disabled}
            >
              {pendingId && deleteTarget ? <Loader2 size={14} className="animate-spin" /> : t("common.actions.confirmDelete")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={clearAllOpen}
        onClose={() => setClearAllOpen(false)}
        title={t("trash.clearAll")}
      >
        <div className="space-y-4">
          <p className="text-sm text-text/80">
            {t("trash.confirmClearAll", { count: entries.length })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setClearAllOpen(false)}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              variant="primary"
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => { void handleClearAll(); }}
              disabled={isClearingAll || disabled}
            >
              {isClearingAll ? <Loader2 size={14} className="animate-spin" /> : t("trash.clearAll")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={restoreConflictOpen}
        onClose={() => setRestoreConflictOpen(false)}
        title={t("trash.restore")}
      >
        <div className="space-y-4">
          <p className="text-sm text-text/80">{t("trash.restoreConflict")}</p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setRestoreConflictOpen(false)}>
              {t("shared.feedback.acknowledge")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
