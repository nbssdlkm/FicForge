// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { useCallback, useRef, useState } from "react";
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
  type FileAnalysis,
  type ImportConflictOptions,
  type NewImportResult,
  type ImportProgress,
} from "../../api/engine-client";
import { useTranslation } from "../../i18n/useAppTranslation";
import { useFeedback } from "../../hooks/useFeedback";

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
  onComplete: () => void;
}) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const flowRequestIdRef = useRef(0);

  // Step state
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [analyses, setAnalyses] = useState<FileAnalysis[]>([]);
  const [analysisStatus, setAnalysisStatus] = useState<Map<string, "waiting" | "analyzing" | "done">>(new Map());
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
    flowRequestIdRef.current += 1;
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
    const status = new Map<string, "waiting" | "analyzing" | "done">();
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

    const requestId = ++flowRequestIdRef.current;
    setAnalyzing(true);
    const results: FileAnalysis[] = [];

    for (const file of files) {
      if (requestId !== flowRequestIdRef.current) return;

      setAnalysisStatus((prev) => {
        const next = new Map(prev);
        next.set(file.name, "analyzing");
        return next;
      });

      try {
        const text = await readFileAsText(file);
        if (requestId !== flowRequestIdRef.current) return;

        const analysis = await analyzeImportFile(text, file.name, {
          useAiAssist,
          thresholds: { chapterMinChars: chapterThreshold, skipMaxChars: skipThreshold },
        });
        if (requestId !== flowRequestIdRef.current) return;

        results.push(analysis);
        setAnalyses([...results]);
      } catch (error) {
        if (requestId !== flowRequestIdRef.current) return;
        showError(error, t("error_messages.unknown"));
      }

      setAnalysisStatus((prev) => {
        const next = new Map(prev);
        next.set(file.name, "done");
        return next;
      });
    }

    if (requestId !== flowRequestIdRef.current) return;
    setAnalyzing(false);

    // 至少要有一个文件成功分析才能继续
    if (results.length === 0) return;

    // Check existing chapters
    try {
      const existing = await getExistingChapterNums(auPath);
      setExistingChapterNums(existing);
    } catch { /* empty AU */ }

    setStep(2);
  }, [analyses.length, auPath, chapterThreshold, files, showError, skipThreshold, t, useAiAssist]);

  // ── Step 3: Chapter arrangement ──

  // ── Step 4: Conflict resolution → Execute ──

  const handleExecuteImport = useCallback(async (conflictOptions: ImportConflictOptions) => {
    setStep(4);
    setImporting(true);
    setImportProgress(null);

    try {
      const plan = buildImportPlanFromAnalyses(analyses, conflictOptions);
      const result = await executeImportPlan(plan, auPath, (progress) => {
        setImportProgress(progress);
      });
      setImportResult(result);
      setImporting(false);
    } catch (error) {
      setImporting(false);
      showError(error, t("error_messages.unknown"));
      // 导入失败，回退到章节编排步骤
      setStep(2);
    }
  }, [analyses, auPath, showError, t]);

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
    onComplete();
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
          onGoToLore={handleStartWriting}
          onGoToFacts={handleStartWriting}
          onStartWriting={handleStartWriting}
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
