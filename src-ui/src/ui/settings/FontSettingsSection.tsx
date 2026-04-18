// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FontSettingsSection — GlobalSettingsModal 里的字体偏好 section。
 *
 * 界面字体 → Tailwind font-sans（菜单、按钮、表单等 UI）
 * 阅读字体 → Tailwind font-serif（章节内容、设定卡编辑）
 *
 * 背后通过 CSS 变量 --font-ui / --font-reading 驱动，切换即时生效、零组件改动。
 * 可选字体列表 Phase 4 阶段仅含「跟随系统」+ 两个内置字体；Phase 5 会扩展为含已下载字体。
 */

import { useTranslation } from "../../i18n/useAppTranslation";
import { listFontOptions, useFontSelection } from "../../hooks/useFontSelection";

export const FontSettingsSection = () => {
  const { t, i18n } = useTranslation();
  const { uiFontId, readingFontId, setUiFontId, setReadingFontId } = useFontSelection();
  const options = listFontOptions();
  const isZh = i18n.resolvedLanguage !== "en";

  return (
    <div className="space-y-4 border-t border-black/10 pt-5 dark:border-white/10">
      <h3 className="text-sm font-bold text-text/90">{t("settings.fonts.title")}</h3>

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

      <p className="text-xs text-text/40 leading-relaxed">{t("settings.fonts.hint")}</p>
    </div>
  );
};
