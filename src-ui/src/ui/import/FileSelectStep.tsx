// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { useState, useRef, DragEvent } from "react";
import { Button } from "../shared/Button";
import { Upload, FileText, X, ChevronUp, ChevronDown } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useFeedback } from "../../hooks/useFeedback";

// .docx 需要 mammoth.js 依赖，安装后取消注释
const ACCEPTED_EXTENSIONS = [".txt", ".md", ".html", ".htm", /* ".docx", */ ".json", ".jsonl"];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function FileSelectStep({
  onNext,
  disabled,
}: {
  onNext: (files: File[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    const valid: File[] = [];
    for (const f of arr) {
      const ext = "." + (f.name.split(".").pop()?.toLowerCase() ?? "");
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        showError(t("import.formatError", { ext }));
        continue;
      }
      // 去重（按文件名）
      if (files.some((existing) => existing.name === f.name && existing.size === f.size)) continue;
      valid.push(f);
    }
    if (valid.length > 0) {
      setFiles((prev) => [...prev, ...valid]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const moveFile = (index: number, direction: -1 | 1) => {
    setFiles((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-text/60">{t("import.supportedFormats")}</p>

      <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
        <span className="shrink-0">⚠️</span>
        <span>{t("ethics.importWarning")}</span>
      </div>

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragOver ? "border-accent bg-accent/5" : "border-black/15 dark:border-white/15 hover:border-accent/50"}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <Upload size={28} className="mx-auto mb-2 text-text/30" />
        <p className="text-sm text-text/50">{t("import.dropzone")}</p>
        <p className="mt-1 text-xs text-text/30">{t("import.dropzoneMulti")}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-text/40">
            {isMobile ? t("import.step1HintMobile") : t("import.step1Hint")}
          </p>
          <div className="space-y-1.5">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${file.size}`}
                className="flex items-center gap-2 rounded-lg border border-black/10 bg-surface/50 px-3 py-2.5 dark:border-white/10"
              >
                {/* Drag handle / reorder buttons */}
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => moveFile(index, -1)}
                    disabled={index === 0}
                    aria-label={t("import.moveUp")}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-text/30 hover:text-text/60 disabled:opacity-20"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveFile(index, 1)}
                    disabled={index === files.length - 1}
                    aria-label={t("import.moveDown")}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-text/30 hover:text-text/60 disabled:opacity-20"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>

                <FileText size={16} className="shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text">{file.name}</p>
                  <p className="text-xs text-text/40">{formatSize(file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  aria-label={t("import.removeFile")}
                  className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-text/30 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={() => onNext(files)}
          disabled={files.length === 0 || disabled}
        >
          {t("onboarding.common.next")}
        </Button>
      </div>
    </div>
  );
}
