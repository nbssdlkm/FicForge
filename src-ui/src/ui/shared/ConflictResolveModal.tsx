// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { AlertTriangle } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { Button } from "./Button";
import { Modal } from "./Modal";

export interface ConflictItem {
  path: string;
  localModified?: string;
  remoteModified?: string;
}

interface ConflictResolveModalProps {
  isOpen: boolean;
  onClose: () => void;
  conflicts: ConflictItem[];
  onResolve: (path: string, choice: "local" | "remote") => void;
  onResolveAll: (choice: "local" | "remote") => void;
}

export function ConflictResolveModal({ isOpen, onClose, conflicts, onResolve, onResolveAll }: ConflictResolveModalProps) {
  const { t } = useTranslation();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("sync.conflict.title")}>
      <div className="space-y-4">
        <p className="text-sm text-text/70">{t("sync.conflict.description")}</p>

        <div className="max-h-[50vh] space-y-3 overflow-y-auto">
          {conflicts.map((c) => (
            <div key={c.path} className="rounded-xl border border-warning/30 bg-warning/5 p-4">
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle size={14} className="text-warning" />
                <span className="text-sm font-medium text-text">{c.path}</span>
              </div>
              {c.localModified && (
                <p className="text-xs text-text/50">{t("sync.conflict.localModified")}: {new Date(c.localModified).toLocaleString()}</p>
              )}
              {c.remoteModified && (
                <p className="text-xs text-text/50">{t("sync.conflict.remoteModified")}: {new Date(c.remoteModified).toLocaleString()}</p>
              )}
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => onResolve(c.path, "local")}>
                  {t("sync.conflict.keepLocal")}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onResolve(c.path, "remote")}>
                  {t("sync.conflict.keepRemote")}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 border-t border-black/10 pt-4 dark:border-white/10">
          <Button variant="ghost" onClick={onClose}>{t("common.actions.cancel")}</Button>
          <Button variant="primary" onClick={() => onResolveAll("local")}>
            {t("sync.conflict.keepAllLocal")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
