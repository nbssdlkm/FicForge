// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FontSettingsSection — GlobalSettingsModal 里的字体偏好 + 字体管理 section。
 *
 * 三块区域：
 * 1. 字体选择：「界面字体」「阅读字体」两组，每组内部各有西文 / 中文两个下拉 —— 共 4 个下拉。
 *    CSS 层把同组的两个字体 family 合成 stack，浏览器按 unicode-range 自动分派。
 * 2. 字体列表：manifest 全部字体；每行展示状态 + 操作按钮（下载 / 取消 / 卸载 / 重试）
 * 3. 存储统计：已用总字节 + 「清理未用」按钮（保留当前 4 个选中字体，删除其他已下载）
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

interface ScriptSelectProps {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: { id: string; label: { zh: string; en: string } }[];
  isZh: boolean;
}

const ScriptSelect = ({ label, value, onChange, options, isZh }: ScriptSelectProps) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs text-text/70">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full rounded-md border border-black/20 bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent dark:border-white/20 md:h-10 md:text-sm"
    >
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {isZh ? opt.label.zh : opt.label.en}
        </option>
      ))}
    </select>
  </div>
);

export const FontSettingsSection = () => {
  const { t, i18n } = useTranslation();
  const { showSuccess } = useFeedback();
  const isZh = i18n.resolvedLanguage !== "en";

  const {
    uiLatinFontId,
    uiCjkFontId,
    readingLatinFontId,
    readingCjkFontId,
    setUiLatinFontId,
    setUiCjkFontId,
    setReadingLatinFontId,
    setReadingCjkFontId,
  } = useFontSelection();
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

  // 按 script 分别列出候选项；alwaysIncludeIds 传各自当前值以保证下拉能渲染。
  const latinOptions = listFontOptions("latin", installedDownloadableIds, [uiLatinFontId, readingLatinFontId]);
  const cjkOptions = listFontOptions("cjk", installedDownloadableIds, [uiCjkFontId, readingCjkFontId]);

  const handleClean = async () => {
    const keep = new Set<string>([uiLatinFontId, uiCjkFontId, readingLatinFontId, readingCjkFontId]);
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

      {/* 界面字体：西文 + 中文 */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-text/90">{t("settings.fonts.uiLabel")}</label>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <ScriptSelect
            label={t("settings.fonts.latinLabel")}
            value={uiLatinFontId}
            onChange={setUiLatinFontId}
            options={latinOptions}
            isZh={isZh}
          />
          <ScriptSelect
            label={t("settings.fonts.cjkLabel")}
            value={uiCjkFontId}
            onChange={setUiCjkFontId}
            options={cjkOptions}
            isZh={isZh}
          />
        </div>
        <p className="text-xs text-text/50">{t("settings.fonts.uiDescription")}</p>
      </div>

      {/* 阅读字体：西文 + 中文 */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-text/90">{t("settings.fonts.readingLabel")}</label>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <ScriptSelect
            label={t("settings.fonts.latinLabel")}
            value={readingLatinFontId}
            onChange={setReadingLatinFontId}
            options={latinOptions}
            isZh={isZh}
          />
          <ScriptSelect
            label={t("settings.fonts.cjkLabel")}
            value={readingCjkFontId}
            onChange={setReadingCjkFontId}
            options={cjkOptions}
            isZh={isZh}
          />
        </div>
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
