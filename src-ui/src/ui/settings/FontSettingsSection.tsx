// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FontSettingsSection — GlobalSettingsModal 里的字体偏好 + 字体管理 section。
 *
 * 三块区域：
 * 1. 字体选择：两个下拉 —— 界面字体 / 阅读字体；下拉选项 = 系统 + 内置 + 已下载
 * 2. 字体列表：manifest 全部字体；每行展示状态 + 操作按钮（下载 / 取消 / 卸载 / 重试）
 * 3. 存储统计：已用总字节 + 「清理未用」按钮（保留当前选中字体，删除其他已下载）
 */

import { FONT_MANIFEST } from "@ficforge/engine";
import { useTranslation } from "../../i18n/useAppTranslation";
import { listFontOptions, useFontSelection } from "../../hooks/useFontSelection";
import { useFontManager } from "../../hooks/useFontManager";
import { useFeedback } from "../../hooks/useFeedback";
import { FontListItem } from "./FontListItem";
import { Button } from "../shared/Button";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const FontSettingsSection = () => {
  const { t, i18n } = useTranslation();
  const { showSuccess } = useFeedback();
  const isZh = i18n.resolvedLanguage !== "en";

  const { uiFontId, readingFontId, setUiFontId, setReadingFontId } = useFontSelection();
  const {
    statuses,
    progresses,
    errors,
    totalSize,
    installedDownloadableIds,
    download,
    cancel,
    uninstall,
    cleanUnused,
  } = useFontManager();

  // 不必 useMemo：listFontOptions 计算极轻，installedDownloadableIds 已在 hook 内 memo。
  const options = listFontOptions(installedDownloadableIds);

  const handleClean = async () => {
    const keep = new Set<string>([uiFontId, readingFontId]);
    const n = await cleanUnused(keep);
    if (n > 0) {
      showSuccess(t("settings.fonts.cleanedToast", { count: n }));
    } else {
      showSuccess(t("settings.fonts.noneToClean"));
    }
  };

  return (
    <div className="space-y-4 border-t border-black/10 pt-5 dark:border-white/10">
      <h3 className="text-sm font-bold text-text/90">{t("settings.fonts.title")}</h3>

      {/* 字体选择下拉 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-bold text-text/90">{t("settings.fonts.uiLabel")}</label>
        <select
          value={uiFontId}
          onChange={(e) => setUiFontId(e.target.value)}
          className="h-11 w-full rounded-md border border-black/20 bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent dark:border-white/20 md:h-10 md:w-64 md:text-sm"
        >
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {isZh ? opt.label.zh : opt.label.en}
            </option>
          ))}
        </select>
        <p className="text-xs text-text/50">{t("settings.fonts.uiDescription")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-bold text-text/90">{t("settings.fonts.readingLabel")}</label>
        <select
          value={readingFontId}
          onChange={(e) => setReadingFontId(e.target.value)}
          className="h-11 w-full rounded-md border border-black/20 bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent dark:border-white/20 md:h-10 md:w-64 md:text-sm"
        >
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {isZh ? opt.label.zh : opt.label.en}
            </option>
          ))}
        </select>
        <p className="text-xs text-text/50">{t("settings.fonts.readingDescription")}</p>
      </div>

      {/* 字体列表（全部 manifest 条目） */}
      <div className="flex flex-col gap-0.5 pt-2">
        <h4 className="text-sm font-bold text-text/90 mb-1">{t("settings.fonts.listTitle")}</h4>
        <div className="rounded-md border border-black/10 bg-background px-3 dark:border-white/10">
          {FONT_MANIFEST.map((entry) => (
            <FontListItem
              key={entry.id}
              entry={entry}
              status={statuses[entry.id] ?? "not-installed"}
              progress={progresses[entry.id]}
              error={errors[entry.id]}
              isZh={isZh}
              onDownload={() => { void download(entry.id); }}
              onCancel={() => cancel(entry.id)}
              onUninstall={() => { void uninstall(entry.id); }}
            />
          ))}
        </div>
      </div>

      {/* 存储统计 + 清理 */}
      <div className="flex items-center justify-between text-xs text-text/60 pt-1">
        <span>{t("settings.fonts.storageUsed", { size: formatBytes(totalSize) })}</span>
        <Button
          tone="neutral"
          fill="plain"
          size="sm"
          onClick={() => { void handleClean(); }}
          disabled={totalSize === 0}
        >
          {t("settings.fonts.cleanUnused")}
        </Button>
      </div>

      <p className="text-xs text-text/40 leading-relaxed">{t("settings.fonts.hint")}</p>
    </div>
  );
};
