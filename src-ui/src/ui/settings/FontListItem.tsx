// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FontListItem — 字体管理列表中的一行。
 *
 * 状态机：
 * - builtin 字体：显示「内置」标签，无操作按钮（不可卸载）
 * - downloadable + not-installed：显示大小 + 「下载」按钮
 * - downloadable + downloading：显示进度条 + 「取消」按钮
 * - downloadable + installed：显示「已安装」+ 「卸载」按钮
 * - downloadable + error：显示错误信息 + 「重试」按钮
 */

import React from "react";
import type { FontEntry } from "@ficforge/engine";
import { Button } from "../shared/Button";
import { useTranslation } from "../../i18n/useAppTranslation";
import type { ProgressInfo, RuntimeStatus } from "../../hooks/useFontManager";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  entry: FontEntry;
  status: RuntimeStatus;
  progress?: ProgressInfo;
  error?: string;
  isZh: boolean;
  onDownload: () => void;
  onCancel: () => void;
  onUninstall: () => void;
}

export const FontListItem: React.FC<Props> = ({
  entry, status, progress, error, isZh,
  onDownload, onCancel, onUninstall,
}) => {
  const { t } = useTranslation();
  const label = isZh ? entry.displayName.zh : entry.displayName.en;

  const metaParts: string[] = [];
  if (entry.type === "builtin") {
    metaParts.push(t("settings.fonts.builtinTag"));
  } else {
    metaParts.push(formatBytes(entry.sizeBytes));
    metaParts.push(entry.license);
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-black/5 last:border-0 dark:border-white/5">
      <div className="min-w-0 flex-1">
        <div
          className="text-sm font-medium text-text/90 truncate"
          style={{ fontFamily: `"${entry.family}", var(--font-reading)` }}
        >
          {label}
        </div>
        <div className="text-xs text-text/50 mt-0.5">
          {metaParts.join(" · ")}
          {error && <span className="text-error ml-2">· {error}</span>}
        </div>
        {status === "downloading" && progress && (
          <div className="mt-1.5">
            <div className="h-1 bg-black/10 rounded overflow-hidden dark:bg-white/10">
              <div
                className="h-full bg-accent transition-[width] duration-150"
                style={{
                  width:
                    progress.total > 0
                      ? `${Math.min(100, Math.floor((progress.loaded / progress.total) * 100))}%`
                      : "30%",
                }}
              />
            </div>
            <div className="text-xs text-text/40 mt-0.5">
              {formatBytes(progress.loaded)}
              {progress.total > 0 ? ` / ${formatBytes(progress.total)}` : ""}
            </div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0">
        {entry.type === "builtin" && (
          <span className="text-xs text-success">{t("settings.fonts.installedTag")}</span>
        )}
        {entry.type === "downloadable" && status === "not-installed" && (
          <Button tone="accent" fill="outline" size="sm" onClick={onDownload}>
            {t("settings.fonts.downloadButton")}
          </Button>
        )}
        {entry.type === "downloadable" && status === "downloading" && (
          <Button tone="neutral" fill="outline" size="sm" onClick={onCancel}>
            {t("common.actions.cancel")}
          </Button>
        )}
        {entry.type === "downloadable" && status === "installed" && (
          <Button tone="neutral" fill="plain" size="sm" onClick={onUninstall}>
            {t("settings.fonts.uninstallButton")}
          </Button>
        )}
        {entry.type === "downloadable" && status === "error" && (
          <Button tone="accent" fill="outline" size="sm" onClick={onDownload}>
            {t("settings.fonts.retryButton")}
          </Button>
        )}
      </div>
    </div>
  );
};
