// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { useCallback, useState } from "react";
import { Modal } from "../shared/Modal";
import { FileSelectStep } from "./FileSelectStep";
import { AnalysisStep } from "./AnalysisStep";
import { ChapterArrangeStep } from "./ChapterArrangeStep";
import { ConflictStep } from "./ConflictStep";
import { ImportProgressStep } from "./ImportProgressStep";
import {
  analyzeImportFile,
  buildImportPlanFromAnalyses,
  executeImportPlan,
  getExistingChapterNums,
  isAiAssistAvailable,
  type FileAnalysis,
  type ImportConflictOptions,
  type NewImportResult,
  type ImportProgress,
} from "../../api/engine-import";
import { useTranslation } from "../../i18n/useAppTranslation";
import { useFeedback } from "../../hooks/useFeedback";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";

const TOTAL_STEPS = 5;

export function ImportFlow({
  isOpen,
  onClose,
  auPath,
  onComplete,
}: {
  isOpen: boolean;
  onClose: () => void;
  auPath: string;
  onComplete: (target?: "writer" | "au_lore" | "facts") => void;
}) {
  const { t, i18n } = useTranslation();
  const { showError, showToast } = useFeedback();
  const requestGuard = useActiveRequestGuard(`${auPath}:${isOpen}`);

  // Step state
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [analyses, setAnalyses] = useState<FileAnalysis[]>([]);
  const [analysisStatus, setAnalysisStatus] = useState<Map<string, "waiting" | "analyzing" | "llm-detecting-chat" | "done" | "error">>(new Map());
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [importResult, setImportResult] = useState<NewImportResult | null>(null);
  const [existingChapterNums, setExistingChapterNums] = useState<number[]>([]);

  // Analysis options
  const [useAiAssist, setUseAiAssist] = useState(false);
  const [chapterThreshold, setChapterThreshold] = useState(1500);
  const [skipThreshold, setSkipThreshold] = useState(300);

  const resetFlowState = () => {
    requestGuard.start();
    setStep(0);
    setFiles([]);
    setAnalyses([]);
    setAnalysisStatus(new Map());
    setAnalyzing(false);
    setImporting(false);
    setImportProgress(null);
    setImportResult(null);
    setExistingChapterNums([]);
    setUseAiAssist(false);
    setChapterThreshold(1500);
    setSkipThreshold(300);
  };

  const handleClose = () => {
    if (analyzing || importing) return;
    resetFlowState();
    onClose();
  };

  // ── Step 1: File selection ──

  const handleFilesSelected = (selectedFiles: File[]) => {
    setFiles(selectedFiles);
    // Initialize analysis status
    const status = new Map<string, "waiting" | "analyzing" | "llm-detecting-chat" | "done" | "error">();
    for (const f of selectedFiles) status.set(f.name, "waiting");
    setAnalysisStatus(status);
    setAnalyses([]);
    setStep(1);
  };

  // ── Step 2: Analysis ──

  const handleStartAnalysis = useCallback(async () => {
    // If already analyzed, just advance
    if (analyses.length === files.length) {
      // Check for existing chapters (for conflict step)
      try {
        const existing = await getExistingChapterNums(auPath);
        setExistingChapterNums(existing);
      } catch { /* empty AU */ }
      setStep(2);
      return;
    }

    const token = requestGuard.start();
    setAnalyzing(true);
    const results: FileAnalysis[] = [];

    // LLM 预检测：用户开了 AI 辅助但配置不可用时，提示并本地禁用
    let effectiveAiAssist = useAiAssist;
    if (useAiAssist) {
      const check = await isAiAssistAvailable();
      if (requestGuard.isStale(token)) return;
      if (!check.available) {
        effectiveAiAssist = false;
        setUseAiAssist(false);
        showToast(t("import.aiAssistUnavailable"), "warning");
      }
    }

    for (const file of files) {
      if (requestGuard.isStale(token)) return;

      setAnalysisStatus((prev) => {
        const next = new Map(prev);
        next.set(file.name, "analyzing");
        return next;
      });

      try {
        const text = await readFileAsText(file);
        if (requestGuard.isStale(token)) return;

        const analysis = await analyzeImportFile(text, file.name, {
          useAiAssist: effectiveAiAssist,
          thresholds: { chapterMinChars: chapterThreshold, skipMaxChars: skipThreshold },
          onStage: (stage) => {
            if (requestGuard.isStale(token)) return;
            if (stage === "llm-chat-detect") {
              setAnalysisStatus((prev) => {
                const next = new Map(prev);
                next.set(file.name, "llm-detecting-chat");
                return next;
              });
            } else if (stage === "llm-chat-failed") {
              // LLM 出错或幻觉：回到普通"分析中"文案 + toast 告知用户 AI 未能工作
              setAnalysisStatus((prev) => {
                const next = new Map(prev);
                next.set(file.name, "analyzing");
                return next;
              });
              showToast(t("import.llmChatDetectFailed"), "warning");
            }
          },
        });
        if (requestGuard.isStale(token)) return;

        results.push(analysis);
        setAnalyses([...results]);
      } catch (error) {
        if (requestGuard.isStale(token)) return;
        showError(error, t("error_messages.unknown"));
        setAnalysisStatus((prev) => {
          const next = new Map(prev);
          next.set(file.name, "error");
          return next;
        });
        continue; // 不设 done，跳到下一个文件
      }

      setAnalysisStatus((prev) => {
        const next = new Map(prev);
        next.set(file.name, "done");
        return next;
      });
    }

    if (requestGuard.isStale(token)) return;
    setAnalyzing(false);

    // 至少要有一个文件成功分析才能继续
    if (results.length === 0) return;

    // Check existing chapters
    try {
      const existing = await getExistingChapterNums(auPath);
      setExistingChapterNums(existing);
    } catch { /* empty AU */ }

    setStep(2);
  }, [analyses.length, auPath, chapterThreshold, files, requestGuard, showError, skipThreshold, t, useAiAssist]);

  // ── Step 3: Chapter arrangement ──

  // ── Step 4: Conflict resolution → Execute ──

  const handleExecuteImport = useCallback(async (conflictOptions: ImportConflictOptions) => {
    const token = requestGuard.start();
    setStep(4);
    setImporting(true);
    setImportProgress(null);

    try {
      const plan = await buildImportPlanFromAnalyses(analyses, conflictOptions);
      const locale = (i18n.resolvedLanguage === "en" ? "en" : "zh") as "zh" | "en";
      const result = await executeImportPlan(plan, auPath, (progress) => {
        if (requestGuard.isStale(token)) return;
        setImportProgress(progress);
      }, locale);
      if (requestGuard.isStale(token)) return;
      setImportResult(result);
      setImporting(false);
    } catch (error) {
      if (requestGuard.isStale(token)) return;
      setImporting(false);
      showError(error, t("error_messages.unknown"));
      // 导入失败，回退到章节编排步骤
      setStep(2);
    }
  }, [analyses, auPath, i18n, requestGuard, showError, t]);

  // ── Step 3: Chapter arrangement ──

  const handleArrangeNext = useCallback(() => {
    // 如果有已有章节，显示冲突处理步骤
    if (existingChapterNums.length > 0) {
      setStep(3);
    } else {
      // 空 AU：直接执行导入，默认 append from 1
      handleExecuteImport({ mode: "append", startChapter: 1, settingsMode: "merge" });
    }
  }, [existingChapterNums.length, handleExecuteImport]);

  // ── Step 5: Completion actions ──

  const handleStartWriting = () => {
    resetFlowState();
    onClose();
    onComplete("writer");
  };

  const handleGoToLore = () => {
    resetFlowState();
    onClose();
    onComplete("au_lore");
  };

  const handleGoToFacts = () => {
    resetFlowState();
    onClose();
    onComplete("facts");
  };

  // ── Step titles ──

  const stepTitles = [
    t("import.step1Title"),
    t("import.step2Title"),
    t("import.step3Title"),
    t("import.step4Title"),
    importing ? t("import.step5Title") : t("import.step5Done"),
  ];

  // Determine displayed step number (conflict step is skipped for empty AU)
  const hasConflict = existingChapterNums.length > 0;
  const displayTotal = hasConflict ? TOTAL_STEPS : TOTAL_STEPS - 1;
  // 空 AU 时 step 3（冲突）被跳过，step 4（执行）应显示为第 4 步
  const displayStep = (!hasConflict && step === 4) ? 4 : step + 1;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`${stepTitles[step] ?? t("import.title")}  ${displayStep}/${displayTotal}`}
    >
      {step === 0 && (
        <FileSelectStep
          onNext={handleFilesSelected}
          disabled={analyzing}
        />
      )}

      {step === 1 && (
        <AnalysisStep
          files={files}
          analyses={analyses}
          analysisStatus={analysisStatus}
          useAiAssist={useAiAssist}
          chapterThreshold={chapterThreshold}
          skipThreshold={skipThreshold}
          onChangeAiAssist={(v) => { setUseAiAssist(v); setAnalyses([]); }}
          onChangeChapterThreshold={(v) => { setChapterThreshold(v); setAnalyses([]); }}
          onChangeSkipThreshold={(v) => { setSkipThreshold(v); setAnalyses([]); }}
          onStartAnalysis={handleStartAnalysis}
          onBack={() => setStep(0)}
          analyzing={analyzing}
        />
      )}

      {step === 2 && (
        <ChapterArrangeStep
          analyses={analyses}
          thresholds={{ chapterMinChars: chapterThreshold, skipMaxChars: skipThreshold }}
          onUpdateAnalyses={setAnalyses}
          onNext={handleArrangeNext}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && (
        <ConflictStep
          existingChapterNums={existingChapterNums}
          importChapterCount={analyses.reduce((sum, a) => sum + (a.stats?.estimatedChapters ?? 0), 0)}
          importSettingsCount={analyses.reduce((sum, a) => sum + (a.stats?.settingsCount ?? 0), 0)}
          onNext={handleExecuteImport}
          onBack={() => setStep(2)}
        />
      )}

      {step === 4 && (
        <ImportProgressStep
          importing={importing}
          progress={importProgress}
          result={importResult}
          nextChapterNum={importResult?.nextChapterNum ?? 1}
          onStartWriting={handleStartWriting}
          onGoToLore={handleGoToLore}
          onGoToFacts={handleGoToFacts}
        />
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readFileAsText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "html" || ext === "htm") {
    const rawText = await file.text();
    const { parse_html } = await import("@ficforge/engine");
    return parse_html(rawText);
  }

  if (ext === "docx") {
    // mammoth.js 未安装，DOCX 暂不支持
    throw new Error("DOCX import requires mammoth.js (not yet installed)");
  }

  return file.text();
}
