// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import type { ClassifiedTurn, ClassificationReason } from "../../api/engine-client";

type AssignedType = ClassifiedTurn["assignedType"];

interface TurnCardProps {
  turn: ClassifiedTurn;
  /** 当前章节号（用于显示"第 N 章"/"第 N 章（续）"） */
  currentChapterNum: number | null;
  /** 前一个 turn 是否是 chapter（决定能否选"续"） */
  hasPreviousChapter: boolean;
  onChangeType: (index: number, newType: AssignedType) => void;
}

export function TurnCard({ turn, currentChapterNum, hasPreviousChapter, onChangeType }: TurnCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const roleLabel = turn.role === "user" ? t("import.roleUser") : t("import.roleAssistant");
  const preview = turn.content.length > 60 ? turn.content.slice(0, 60) + "..." : turn.content;

  const reasonText = formatReason(turn.reason, t);

  const bgClass = turn.assignedType === "chapter" || turn.assignedType === "chapter_continue"
    ? "border-accent/30 bg-accent/5"
    : turn.assignedType === "setting"
      ? "border-info/30 bg-info/5"
      : turn.classification === "uncertain"
        ? "border-warning/30 bg-warning/5"
        : "border-black/10 dark:border-white/10";

  // 构建下拉选项
  const chNum = currentChapterNum ?? 1;
  const options: { value: AssignedType; label: string }[] = [
    { value: "chapter", label: t("import.assignChapter", { n: chNum }) },
    { value: "skip", label: t("import.assignSkip") },
    { value: "setting", label: t("import.assignSetting") },
  ];
  if (hasPreviousChapter && currentChapterNum !== null) {
    options.splice(1, 0, { value: "chapter_continue", label: t("import.assignContinue", { n: currentChapterNum }) });
  }

  return (
    <div className={`rounded-xl border p-3 transition-colors ${bgClass}`}>
      <div className="flex items-center gap-2">
        {/* Turn info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-text/50">#{turn.index + 1}</span>
            <span className={`rounded px-1.5 py-0.5 font-medium ${turn.role === "user" ? "bg-black/5 dark:bg-white/5 text-text/70" : "bg-accent/10 text-accent"}`}>
              {roleLabel}
            </span>
            <span className="text-text/50">{t("import.charCount", { count: turn.charCount })}</span>
            {reasonText && <span className="text-text/30">— {reasonText}</span>}
          </div>
          {!expanded && (
            <p className="mt-1 text-xs text-text/50 line-clamp-1">"{preview}"</p>
          )}
        </div>

        {/* Type selector */}
        <select
          value={turn.assignedType}
          onChange={(e) => onChangeType(turn.index, e.target.value as AssignedType)}
          className="min-h-[44px] rounded-md border border-black/10 bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-accent dark:border-white/15 md:h-7 md:min-h-0"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? t("import.collapse") : t("import.expand")}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-text/50 hover:bg-black/5 dark:hover:bg-white/5 md:h-7 md:w-7 md:min-h-0 md:min-w-0"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-2 max-h-[300px] overflow-y-auto rounded-lg bg-background/80 p-3 text-xs leading-relaxed text-text/70 whitespace-pre-wrap">
          {turn.content}
        </div>
      )}
    </div>
  );
}

function formatReason(reason: ClassificationReason, t: (key: string, opts?: Record<string, unknown>) => string): string | null {
  switch (reason.type) {
    case "user_message":
      return t("import.reasonUserMessage");
    case "long_reply":
      return t("import.reasonLongReply", { n: reason.charCount, threshold: reason.threshold });
    case "short_reply":
      return t("import.reasonShortReply", { n: reason.charCount, threshold: reason.threshold });
    case "uncertain":
      return t("import.reasonUncertain", { n: reason.charCount });
    default:
      return null;
  }
}
