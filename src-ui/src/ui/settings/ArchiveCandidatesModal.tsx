// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { useState, useEffect, useCallback } from "react";
import { Modal } from "../shared/Modal";
import { Button } from "../shared/Button";
import { Spinner } from "../shared/Spinner";
import { Tag } from "../shared/Tag";
import { EmptyState } from "../shared/EmptyState";
import { Archive } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { getEnumLabel } from "../../i18n/labels";
import { useFeedback } from "../../hooks/useFeedback";
import { findArchivalCandidates, archiveFacts, type FactInfo } from "../../api/engine-client";

type Phase = "scanning" | "confirm" | "archiving" | "done";

/**
 * M10-B 冷热分层的「整理旧剧情笔记」用户确认流（spec Q4：固化必须用户确认、非静默）。
 * 扫出冷候选 → 列表勾选（默认全选）→ 确认 → 归档勾选子集。归档后旧笔记仍在剧情笔记里可见、可恢复，
 * 只是不再进 AI 续写的事实表。自管状态（hook 规则）。
 */
export function ArchiveCandidatesModal({
  auPath,
  isOpen,
  onClose,
}: {
  auPath: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { showError } = useFeedback();

  const [phase, setPhase] = useState<Phase>("scanning");
  const [candidates, setCandidates] = useState<FactInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [archivedCount, setArchivedCount] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setPhase("scanning");
    setCandidates([]);
    setSelected(new Set());
    setArchivedCount(0);
    findArchivalCandidates(auPath)
      .then((list) => {
        if (cancelled) return;
        setCandidates(list);
        setSelected(new Set(list.map((f) => f.id))); // 默认全选
        setPhase("confirm");
      })
      .catch((e) => {
        if (!cancelled) {
          showError(e, t("error_messages.unknown"));
          onClose();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, auPath]);

  const toggle = useCallback((id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleArchive = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) {
      onClose();
      return;
    }
    setPhase("archiving");
    try {
      const archived = await archiveFacts(auPath, ids);
      setArchivedCount(archived.length);
      setPhase("done");
    } catch (e) {
      showError(e, t("error_messages.unknown"));
      setPhase("confirm");
    }
  }, [auPath, selected, showError, t, onClose]);

  const busy = phase === "archiving";
  const requestClose = busy ? () => {} : onClose;

  return (
    <Modal isOpen={isOpen} onClose={requestClose} title={t("archive.title")}>
      <div className="space-y-4">
        {phase === "scanning" && (
          <div className="flex items-center gap-3 py-4 text-sm text-text/70">
            <Spinner size="md" /> {t("archive.scanning")}
          </div>
        )}

        {(phase === "confirm" || phase === "archiving") &&
          (candidates.length === 0 ? (
            <EmptyState
              compact
              icon={<Archive size={28} />}
              title={t("archive.noneTitle")}
              description={t("archive.none")}
            />
          ) : (
            <>
              <p className="text-sm text-text/80">{t("archive.intro")}</p>
              <div className="max-h-[44vh] space-y-2 overflow-y-auto pr-1">
                {candidates.map((f) => {
                  const checked = selected.has(f.id);
                  return (
                    <label
                      key={f.id}
                      className={`flex cursor-pointer gap-3 rounded-lg border p-3 dark:border-white/10 ${checked ? "border-accent/40 bg-accent/5" : "border-black/10 bg-surface/40"}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 accent-accent"
                        checked={checked}
                        disabled={busy}
                        onChange={() => toggle(f.id)}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-sm text-text/90">{f.content_clean}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Tag tone="default">
                            {getEnumLabel("narrative_weight", f.narrative_weight, f.narrative_weight)}
                          </Tag>
                          <span className="text-xs text-text/50">
                            {t("facts.extractSourceChapter", { chapter: f.chapter })}
                          </span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          ))}

        {phase === "done" && <p className="text-sm text-text/80">{t("archive.done", { count: archivedCount })}</p>}

        <div className="flex justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
          {phase === "confirm" && candidates.length > 0 ? (
            <>
              <Button tone="neutral" fill="plain" onClick={onClose}>
                {t("common.actions.cancel")}
              </Button>
              <Button tone="accent" fill="solid" onClick={handleArchive} disabled={selected.size === 0}>
                {t("archive.archiveSelected", { count: selected.size })}
              </Button>
            </>
          ) : phase === "archiving" ? (
            <Button tone="accent" fill="solid" disabled>
              <Spinner size="md" />
            </Button>
          ) : phase !== "scanning" ? (
            <Button tone="neutral" fill="plain" onClick={onClose}>
              {t("common.actions.close")}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
