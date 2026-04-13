// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { Button } from "../shared/Button";
import { ProgressBar } from "../shared/ProgressBar";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import type { NewImportResult, ImportProgress } from "../../api/engine-client";

interface ImportProgressStepProps {
  importing: boolean;
  progress: ImportProgress | null;
  result: NewImportResult | null;
  nextChapterNum: number;
  onStartWriting: () => void;
  onGoToLore: () => void;
  onGoToFacts: () => void;
}

export function ImportProgressStep({
  importing,
  progress,
  result,
  nextChapterNum,
  onStartWriting,
  onGoToLore,
  onGoToFacts,
}: ImportProgressStepProps) {
  const { t } = useTranslation();

  if (importing) {
    const pct = progress && progress.chaptersTotal > 0
      ? Math.round((progress.chaptersDone / progress.chaptersTotal) * 100)
      : 0;

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Loader2 size={24} className="animate-spin text-accent" />
          <h3 className="text-lg font-bold text-text">{t("import.step5Title")}</h3>
        </div>

        {/* Progress bar */}
        <ProgressBar percent={pct} />

        <div className="space-y-1 text-sm text-text/70">
          {progress ? (
            <>
              <p>{t("import.step5Progress", { done: progress.chaptersDone, total: progress.chaptersTotal })}</p>
              {progress.settingsTotal > 0 && (
                <p>{t("import.step5SettingsProgress", { done: progress.settingsDone, total: progress.settingsTotal })}</p>
              )}
              {progress.currentFile && (
                <p className="text-xs text-text/40">{progress.currentFile}</p>
              )}
            </>
          ) : (
            <p className="text-text/40">{t("import.importing")}</p>
          )}
        </div>
      </div>
    );
  }

  if (result) {
    const nextChapter = nextChapterNum;

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <CheckCircle2 size={24} className="text-green-500" />
          <h3 className="text-lg font-bold text-text">{t("import.step5Done")}</h3>
        </div>

        <div className="rounded-xl border border-black/5 bg-surface/50 p-5 space-y-2 text-sm dark:border-white/5">
          <p>{t("import.step5ChaptersImported", { n: result.chaptersImported })}</p>
          {result.settingsImported > 0 && (
            <p>{t("import.step5SettingsImported", { n: result.settingsImported })}</p>
          )}
          {result.trashedChapters.length > 0 && (
            <p className="text-text/50">{t("import.step5TrashedChapters", { n: result.trashedChapters.length })}</p>
          )}
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Button variant="primary" className="w-full" onClick={onStartWriting}>
            {t("import.step5Next3", { n: nextChapter })}
          </Button>
          {result.settingsImported > 0 && (
            <Button variant="secondary" className="w-full" onClick={onGoToLore}>
              {t("import.step5Next1")}
            </Button>
          )}
          <Button variant="secondary" className="w-full" onClick={onGoToFacts}>
            {t("import.step5Next2")}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
