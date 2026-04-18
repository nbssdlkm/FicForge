// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { useState } from "react";
import { Button } from "../shared/Button";
import { Input } from "../shared/Input";
import { useTranslation } from "../../i18n/useAppTranslation";
import type { ImportConflictOptions } from "../../api/engine-client";

interface ConflictStepProps {
  existingChapterNums: number[];
  importChapterCount: number;
  importSettingsCount: number;
  onNext: (options: ImportConflictOptions) => void;
  onBack: () => void;
}

export function ConflictStep({
  existingChapterNums,
  importChapterCount,
  importSettingsCount,
  onNext,
  onBack,
}: ConflictStepProps) {
  const { t } = useTranslation();
  const maxExisting = existingChapterNums.length > 0 ? Math.max(...existingChapterNums) : 0;
  const appendStart = maxExisting + 1;

  const [mode, setMode] = useState<"append" | "overwrite" | "custom">("append");
  const [customStart, setCustomStart] = useState(1);
  const [settingsMode, setSettingsMode] = useState<"merge" | "separate">("merge");

  const handleNext = () => {
    const startChapter = mode === "append" ? appendStart : mode === "overwrite" ? 1 : customStart;
    onNext({ mode, startChapter, settingsMode });
  };

  return (
    <div className="space-y-5">
      {/* Context */}
      <div className="rounded-xl border border-info/20 bg-info/5 p-4 text-sm text-text/80 space-y-1">
        <p>{t("import.step4ExistingChapters", { count: existingChapterNums.length, max: maxExisting })}</p>
        <p>{t("import.step4ImportCount", { chapters: importChapterCount, settings: importSettingsCount })}</p>
      </div>

      {/* Chapter conflict mode */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-text/80">{t("import.step4ChapterMode")}</p>

        <label className="flex items-start gap-3 rounded-xl border border-black/10 bg-surface/30 p-4 cursor-pointer dark:border-white/10">
          <input type="radio" name="mode" checked={mode === "append"} onChange={() => setMode("append")} className="mt-1 accent-accent" />
          <div>
            <p className="text-sm font-medium text-text">{t("import.step4Append")}</p>
            <p className="text-xs text-text/50 mt-0.5">{t("import.step4AppendHint", { n: appendStart })}</p>
          </div>
        </label>

        <label className="flex items-start gap-3 rounded-xl border border-black/10 bg-surface/30 p-4 cursor-pointer dark:border-white/10">
          <input type="radio" name="mode" checked={mode === "overwrite"} onChange={() => setMode("overwrite")} className="mt-1 accent-accent" />
          <div>
            <p className="text-sm font-medium text-text">{t("import.step4Overwrite", { n: 1 })}</p>
            <p className="text-xs text-text/50 mt-0.5">{t("import.step4OverwriteHint")}</p>
          </div>
        </label>

        <label className="flex items-start gap-3 rounded-xl border border-black/10 bg-surface/30 p-4 cursor-pointer dark:border-white/10">
          <input type="radio" name="mode" checked={mode === "custom"} onChange={() => setMode("custom")} className="mt-1 accent-accent" />
          <div className="flex-1">
            <p className="text-sm font-medium text-text">{t("import.step4Custom")}</p>
            {mode === "custom" && (
              <div className="mt-2">
                <Input
                  type="number"
                  value={customStart}
                  onChange={(e) => setCustomStart(Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
              </div>
            )}
          </div>
        </label>
      </div>

      {/* Settings mode */}
      {importSettingsCount > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-text/80">{t("import.step4SettingsMode")}</p>

          <label className="flex items-start gap-3 rounded-xl border border-black/10 bg-surface/30 p-4 cursor-pointer dark:border-white/10">
            <input type="radio" name="settingsMode" checked={settingsMode === "merge"} onChange={() => setSettingsMode("merge")} className="mt-1 accent-accent" />
            <div>
              <p className="text-sm font-medium text-text">{t("import.step4SettingsMerge")}</p>
              <p className="text-xs text-text/50 mt-0.5">{t("import.step4SettingsMergeHint")}</p>
            </div>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-black/10 bg-surface/30 p-4 cursor-pointer dark:border-white/10">
            <input type="radio" name="settingsMode" checked={settingsMode === "separate"} onChange={() => setSettingsMode("separate")} className="mt-1 accent-accent" />
            <div>
              <p className="text-sm font-medium text-text">{t("import.step4SettingsSeparate")}</p>
            </div>
          </label>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button tone="neutral" fill="plain" onClick={onBack}>{t("onboarding.common.prev")}</Button>
        <Button tone="accent" fill="solid" onClick={handleNext}>{t("onboarding.common.next")}</Button>
      </div>
    </div>
  );
}
