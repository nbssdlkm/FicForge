// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { memo, useState } from "react";
import { AlertCircle, Check, ChevronDown, ChevronUp, Clock, RotateCcw, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SimpleToolCallMessage } from "../types";
import { Card } from "../../shared/Card";
import { Button } from "../../shared/Button";
import { useTranslation } from "../../../i18n/useAppTranslation";

interface ToolCallCardProps {
  message: SimpleToolCallMessage;
  globalBusy: boolean;
  onConfirm: (messageId: string) => void;
  onSkip: (messageId: string) => void;
  onUndo: (messageId: string) => void;
}
const COLLAPSE_THRESHOLD = 500;

interface StatusVisual {
  Icon: LucideIcon;
  className: string;
}

function statusVisual(status: SimpleToolCallMessage["status"]): StatusVisual {
  switch (status) {
    case "pending":
      return { Icon: Clock, className: "border-info/40 bg-info/8 text-info" };
    case "confirmed":
      return { Icon: Check, className: "border-success/40 bg-success/8 text-success" };
    case "skipped":
    case "undone":
      return { Icon: X, className: "border-rule bg-surface text-ink-faint" };
    case "error":
      return { Icon: AlertCircle, className: "border-error/40 bg-error/8 text-error" };
  }
}

function ToolCallCardImpl({
  message,
  globalBusy,
  onConfirm,
  onSkip,
  onUndo,
}: ToolCallCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const argsJson = JSON.stringify(message.toolArgs, null, 2);
  const isLong = argsJson.length > COLLAPSE_THRESHOLD;
  const displayArgs = isLong && !expanded ? argsJson.slice(0, COLLAPSE_THRESHOLD) + "..." : argsJson;

  const statusLabel: Record<SimpleToolCallMessage["status"], string> = {
    pending: t("simple.toolCard.pending", { defaultValue: "待确认" }),
    confirmed:
      t("simple.toolCard.confirmed", { defaultValue: "已执行" }) +
      (message.resultNote ? ` · ${message.resultNote}` : ""),
    skipped: t("simple.toolCard.skipped", { defaultValue: "已跳过" }),
    undone: t("simple.toolCard.undone", { defaultValue: "已撤销" }),
    error: message.errorMessage || t("simple.toolCard.error", { defaultValue: "执行失败" }),
  };

  const v = statusVisual(message.status);

  return (
    <Card className="space-y-3 px-4 py-3">
      {/* Eyebrow row: TOOL CALL · toolName · status badge */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright">
          <Wrench size={11} />
          {t("simple.toolCard.eyebrow", { defaultValue: "Tool Call" })}
        </span>
        <span className="font-display text-[13px] font-semibold not-italic tracking-normal text-text">
          {message.toolName}
        </span>
        <span className={`ml-auto inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 ${v.className}`}>
          <v.Icon size={11} />
          <span className="font-serif text-[11px] tracking-normal">{statusLabel[message.status]}</span>
        </span>
      </div>

      <pre className="overflow-auto rounded-sm border border-rule bg-surface/70 p-2 font-mono text-[11px] leading-relaxed text-text/85 whitespace-pre-wrap break-all max-h-60">
        {displayArgs}
      </pre>

      {isLong && (
        <Button
          tone="neutral"
          fill="plain"
          size="sm"
          onClick={() => setExpanded((p) => !p)}
          className="font-mono text-[10px] uppercase tracking-[0.08em]"
        >
          {expanded ? <ChevronUp size={12} className="mr-1" /> : <ChevronDown size={12} className="mr-1" />}
          {expanded
            ? t("simple.toolCard.collapse", { defaultValue: "折叠" })
            : t("simple.toolCard.expand", { defaultValue: "展开" })}
        </Button>
      )}

      {message.status === "pending" && (
        <div className="flex gap-2 border-t border-rule pt-3">
          <Button
            tone="accent"
            size="sm"
            disabled={globalBusy}
            onClick={() => onConfirm(message.id)}
            className="font-sans text-[11px] uppercase tracking-[0.08em]"
          >
            <Check size={12} className="mr-1" />
            {t("simple.toolCard.confirm", { defaultValue: "确认" })}
          </Button>
          <Button
            tone="neutral"
            fill="outline"
            size="sm"
            disabled={globalBusy}
            onClick={() => onSkip(message.id)}
            className="font-sans text-[11px] uppercase tracking-[0.08em]"
          >
            <X size={12} className="mr-1" />
            {t("simple.toolCard.skip", { defaultValue: "跳过" })}
          </Button>
        </div>
      )}

      {message.status === "confirmed" && (
        <div className="flex gap-2 border-t border-rule pt-3">
          <Button
            tone="neutral"
            fill="outline"
            size="sm"
            disabled={globalBusy}
            onClick={() => onUndo(message.id)}
            className="font-sans text-[11px] uppercase tracking-[0.08em]"
          >
            <RotateCcw size={12} className="mr-1" />
            {t("simple.toolCard.undo", { defaultValue: "撤销" })}
          </Button>
        </div>
      )}
    </Card>
  );
}

export const ToolCallCard = memo(ToolCallCardImpl);
