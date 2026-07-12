// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { useState } from "react";
import { BookOpen, CornerDownRight, Globe, Ban, ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
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

const PREVIEW_LEN = 140; // TD-013：从 60 扩到 ~140，让用户不展开也能判断该轮内容

export function TurnCard({ turn, currentChapterNum, hasPreviousChapter, onChangeType }: TurnCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const roleLabel = turn.role === "user" ? t("import.roleUser") : t("import.roleAssistant");
  const preview = turn.content.length > PREVIEW_LEN ? turn.content.slice(0, PREVIEW_LEN) + "…" : turn.content;
  const reasonText = formatReason(turn.reason, t);
  const isUncertain = turn.classification === "uncertain";

  const chNum = currentChapterNum ?? 1;
  // TD-013：4 个类型 pill 取代下拉。chapter_continue 在"前面没有章"时**禁用而非隐藏**，
  // 保持 UI 稳定（不会因为切换导致按钮数量跳动）。
  const pills: { value: AssignedType; label: string; Icon: LucideIcon; tone: PillTone; disabled?: boolean }[] = [
    { value: "chapter", label: t("import.assignChapter", { n: chNum }), Icon: BookOpen, tone: "accent" },
    {
      value: "chapter_continue",
      label: t("import.assignContinue", { n: currentChapterNum ?? chNum }),
      Icon: CornerDownRight,
      tone: "accent",
      disabled: !hasPreviousChapter,
    },
    { value: "setting", label: t("import.assignSetting"), Icon: Globe, tone: "info" },
    { value: "skip", label: t("import.assignSkip"), Icon: Ban, tone: "muted" },
  ];

  const cardBg =
    isUncertain && turn.assignedType !== "chapter" && turn.assignedType !== "chapter_continue"
      ? "border-warning/40 bg-warning/5"
      : turn.assignedType === "skip"
        ? "border-text/10 bg-surface/30 opacity-70"
        : "border-black/10 bg-surface/50 dark:border-white/10";

  return (
    <div className={`rounded-xl border p-3 transition-colors ${cardBg}`}>
      {/* 第一行：主信息 —— role + 轮次 + 字数（主），reason 退次淡 */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[11px] text-text/40">#{turn.index + 1}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-semibold ${turn.role === "user" ? "bg-black/5 text-text/70 dark:bg-white/5" : "bg-accent/10 text-accent"}`}
            >
              {roleLabel}
            </span>
            <span className="text-xs text-text/45">{t("import.charCount", { count: turn.charCount })}</span>
            {isUncertain && (
              <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                {t("import.uncertainBadge")}
              </span>
            )}
          </div>
          {reasonText && <p className="mt-1 text-[11px] text-text/35">{reasonText}</p>}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? t("import.collapse") : t("import.expand")}
          className="inline-flex h-7 min-h-[44px] w-7 min-w-[44px] shrink-0 items-center justify-center rounded-md text-text/50 hover:bg-black/5 dark:hover:bg-white/5 md:min-h-0 md:min-w-0"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* 预览（次淡，~140 字） */}
      {!expanded && preview && <p className="mt-1.5 text-xs leading-relaxed text-text/55 line-clamp-2">{preview}</p>}
      {expanded && (
        <div className="mt-2 max-h-[300px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-background/80 p-3 text-xs leading-relaxed text-text/70">
          {turn.content}
        </div>
      )}

      {/* 类型 pill 组（主交互） */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {pills.map(({ value, label, Icon, tone, disabled }) => (
          <button
            key={value}
            type="button"
            disabled={disabled}
            onClick={() => onChangeType(turn.index, value)}
            aria-pressed={turn.assignedType === value}
            title={disabled ? t("import.continueNeedsPrev") : undefined}
            className={pillClass(turn.assignedType === value, tone, !!disabled)}
          >
            <Icon size={13} className="shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

type PillTone = "accent" | "info" | "muted";

function pillClass(active: boolean, tone: PillTone, disabled: boolean): string {
  const base =
    "inline-flex min-h-[36px] items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors md:min-h-0";
  if (disabled) return `${base} cursor-not-allowed border-transparent text-text/25`;
  if (!active)
    return `${base} border-black/10 bg-transparent text-text/55 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5`;
  const activeByTone: Record<PillTone, string> = {
    accent: "border-accent bg-accent/15 text-accent",
    info: "border-info bg-info/15 text-info",
    muted: "border-text/30 bg-text/10 text-text/70",
  };
  return `${base} ${activeByTone[tone]}`;
}

function formatReason(
  reason: ClassificationReason,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
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
