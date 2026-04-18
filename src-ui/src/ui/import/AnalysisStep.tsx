// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { Button } from "../shared/Button";
import { Input } from "../shared/Input";
import { CheckCircle2, Loader2, Clock, XCircle } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import type { FileAnalysis } from "../../api/engine-client";

interface AnalysisStepProps {
  files: File[];
  analyses: FileAnalysis[];
  analysisStatus: Map<string, "waiting" | "analyzing" | "done" | "error">;
  useAiAssist: boolean;
  chapterThreshold: number;
  skipThreshold: number;
  onChangeAiAssist: (v: boolean) => void;
  onChangeChapterThreshold: (v: number) => void;
  onChangeSkipThreshold: (v: number) => void;
  onStartAnalysis: () => void;
  onBack: () => void;
  analyzing: boolean;
}

export function AnalysisStep({
  files,
  analyses,
  analysisStatus,
  useAiAssist,
  chapterThreshold,
  skipThreshold,
  onChangeAiAssist,
  onChangeChapterThreshold,
  onChangeSkipThreshold,
  onStartAnalysis,
  onBack,
  analyzing,
}: AnalysisStepProps) {
  const { t } = useTranslation();
  const allDone = analyses.length === files.length && !analyzing;

  return (
    <div className="space-y-5">
      {/* File analysis status */}
      <div className="space-y-3">
        {files.map((file) => {
          const status = analysisStatus.get(file.name) ?? "waiting";
          const analysis = analyses.find((a) => a.filename === file.name);

          return (
            <div key={file.name} className="rounded-xl border border-black/10 bg-surface/30 p-4 dark:border-white/10">
              <div className="flex items-center gap-2">
                {status === "done" && <CheckCircle2 size={16} className="text-green-500" />}
                {status === "error" && <XCircle size={16} className="text-error" />}
                {status === "analyzing" && <Loader2 size={16} className="animate-spin text-accent" />}
                {status === "waiting" && <Clock size={16} className="text-text/30" />}
                <span className="text-sm font-medium text-text">{file.name}</span>
              </div>

              {analysis && (
                <div className="mt-2 space-y-1 pl-6 text-xs text-text/60">
                  {analysis.mode === "chat" ? (
                    <>
                      <p>{t("import.chatDetected", { format: analysis.chatFormat ?? "" })}</p>
                      <p>{t("import.estimatedChapters", { n: analysis.stats.estimatedChapters })}</p>
                    </>
                  ) : (
                    <>
                      <p>{t("import.textDetected")}</p>
                      <p>{t("import.estimatedChapters", { n: analysis.stats.estimatedChapters })}</p>
                    </>
                  )}
                </div>
              )}

              {status === "waiting" && (
                <p className="mt-1 pl-6 text-xs text-text/30">{t("import.waiting")}</p>
              )}
              {status === "analyzing" && (
                <p className="mt-1 pl-6 text-xs text-accent">{t("import.analyzing")}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Options (only before analysis starts) */}
      {!analyzing && analyses.length === 0 && (
        <div className="space-y-4 rounded-xl border border-black/10 bg-surface/20 p-4 dark:border-white/10">
          {/* AI assist */}
          <label className="flex min-h-[44px] items-center gap-3 cursor-pointer text-sm text-text/80">
            <input
              type="checkbox"
              checked={useAiAssist}
              onChange={(e) => onChangeAiAssist(e.target.checked)}
              className="accent-accent"
            />
            <div>
              <span className="font-medium">{t("import.step2AiAssist")}</span>
              <p className="text-xs text-text/50 mt-0.5">{t("import.step2AiAssistHint")}</p>
              <p className="text-xs text-text/40">{t("import.step2AiAssistCost")}</p>
            </div>
          </label>

          {/* Thresholds */}
          <div className="space-y-3 border-t border-black/5 pt-3 dark:border-white/5">
            <p className="text-xs font-medium text-text/60">{t("import.step2Thresholds")}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
              <div className="flex-1">
                <label className="text-xs text-text/50">{t("import.step2ChapterThreshold", { n: chapterThreshold })}</label>
                <Input
                  type="number"
                  value={chapterThreshold}
                  onChange={(e) => onChangeChapterThreshold(Math.max(100, parseInt(e.target.value, 10) || 1500))}
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-text/50">{t("import.step2SkipThreshold", { n: skipThreshold })}</label>
                <Input
                  type="number"
                  value={skipThreshold}
                  onChange={(e) => onChangeSkipThreshold(Math.max(10, parseInt(e.target.value, 10) || 300))}
                />
              </div>
            </div>
            <p className="text-xs text-text/40">{t("import.step2ThresholdHint")}</p>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button tone="neutral" fill="plain" onClick={onBack} disabled={analyzing}>
          {t("onboarding.common.prev")}
        </Button>
        {!allDone ? (
          <Button tone="accent" fill="solid" onClick={onStartAnalysis} disabled={analyzing}>
            {analyzing ? <><Loader2 size={14} className="mr-2 animate-spin" />{t("import.analyzing")}</> : t("onboarding.common.next")}
          </Button>
        ) : (
          <Button tone="accent" fill="solid" onClick={onStartAnalysis}>
            {t("onboarding.common.next")}
          </Button>
        )}
      </div>
    </div>
  );
}
