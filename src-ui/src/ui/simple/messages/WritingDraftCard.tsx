// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { memo, useState } from "react";
import { AlertCircle, Check, Clock, RotateCcw, Sparkles, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SimpleWritingDraftMessage } from "../types";
import { Card } from "../../shared/Card";
import { Button } from "../../shared/Button";
import { Spinner } from "../../shared/Spinner";
import { useTranslation } from "../../../i18n/useAppTranslation";
import { ActionFooter, CardEyebrow, ExpandToggle } from "./CardChrome";

interface WritingDraftCardProps {
  message: SimpleWritingDraftMessage;
  isStreaming: boolean;
  onAccept: (messageId: string) => void;
  onRegenerate: (messageId: string) => void;
  onDiscard: (messageId: string) => void;
}

const PREVIEW_MAX = 600;

interface StatusVisual {
  Icon: LucideIcon | null;
  className: string;
  showSpinner?: boolean;
}

function statusVisual(status: SimpleWritingDraftMessage["status"]): StatusVisual {
  switch (status) {
    case "streaming":
      return { Icon: null, className: "text-info", showSpinner: true };
    case "pending":
      return { Icon: Clock, className: "text-ink-muted" };
    case "accepted":
      return { Icon: Check, className: "text-success" };
    case "rejected":
    case "discarded":
      return { Icon: X, className: "text-ink-faint" };
    case "error":
      return { Icon: AlertCircle, className: "text-error" };
  }
}

function StatusBadge({
  message,
  t,
}: {
  message: SimpleWritingDraftMessage;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const v = statusVisual(message.status);
  const label = (() => {
    switch (message.status) {
      case "streaming":
        return t("simple.draftCard.statusStreaming", { defaultValue: "正在生成…" });
      case "pending":
        return t("simple.draftCard.statusPending", { defaultValue: "待确认" });
      case "accepted":
        // revision 未知（标记恢复场景，对抗审 A-7）时不显示 rev，避免恒显 rev 1 的错值
        return message.acceptedRevision != null
          ? t("simple.draftCard.statusAccepted", {
              defaultValue: "已接受为第 {{num}} 章 · rev {{rev}}",
              num: message.chapterNum,
              rev: message.acceptedRevision,
            })
          : t("simple.draftCard.statusAcceptedNoRev", {
              defaultValue: "已接受为第 {{num}} 章",
              num: message.chapterNum,
            });
      case "rejected":
      case "discarded":
        return t("simple.draftCard.statusDiscarded", { defaultValue: "已丢弃" });
      case "error":
        return message.errorMessage || t("simple.draftCard.statusError", { defaultValue: "生成失败" });
    }
  })();
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] ${v.className}`}>
      {v.showSpinner ? <Spinner size="sm" /> : v.Icon ? <v.Icon size={12} /> : null}
      <span className="font-serif text-[12px] tracking-normal normal-case">{label}</span>
    </span>
  );
}

function WritingDraftCardImpl({ message, isStreaming, onAccept, onRegenerate, onDiscard }: WritingDraftCardProps) {
  const { t } = useTranslation();
  const wordCount = message.content.length;
  const isLong = wordCount > PREVIEW_MAX;
  const [expanded, setExpanded] = useState(false);
  const showFull = isStreaming || !isLong || expanded;
  const displayContent =
    isStreaming && wordCount === 0
      ? t("simple.draftCard.thinking", { defaultValue: "AI 正在思考…" })
      : showFull
        ? message.content
        : message.content.slice(0, PREVIEW_MAX);
  const showActions = message.status === "streaming" || message.status === "pending" || message.status === "error";

  return (
    <Card className="my-3 space-y-3 px-4 py-3">
      {/* Eyebrow row: AI label + chapter slug + word count + status badge */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <CardEyebrow icon={Sparkles}>{t("simple.draftCard.eyebrow", { defaultValue: "AI Draft" })}</CardEyebrow>
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-muted">
          {t("simple.draftCard.chapterSlug", {
            defaultValue: "Ch.{{num}} · Draft {{label}} · {{count}} chars",
            num: message.chapterNum,
            label: message.draftLabel,
            count: wordCount,
          })}
        </span>
        <span className="ml-auto">
          <StatusBadge message={message} t={t} />
        </span>
      </div>

      {/* Manuscript body — EB Garamond serif, generous leading */}
      <div
        className="whitespace-pre-wrap break-words font-serif text-text/90"
        style={{ fontSize: "var(--ff-body-fs, 14px)", lineHeight: "var(--ff-body-lh, 1.75)" }}
      >
        {displayContent}
      </div>

      {!isStreaming && isLong && (
        <div className="flex">
          <ExpandToggle
            expanded={expanded}
            onToggle={() => setExpanded((prev) => !prev)}
            expandLabel={t("simple.draftCard.expand", { defaultValue: "展开全文" })}
            collapseLabel={t("simple.draftCard.collapse", { defaultValue: "折叠" })}
          />
        </div>
      )}

      {showActions && (
        <ActionFooter className="flex-wrap gap-2">
          {(message.status === "pending" || message.status === "error") && (
            <Button
              tone="accent"
              size="sm"
              disabled={isStreaming}
              onClick={() => onAccept(message.id)}
              className="font-sans text-[11px] uppercase tracking-[0.08em]"
            >
              {message.status === "error" ? (
                <RotateCcw size={12} className="mr-1" />
              ) : (
                <Check size={12} className="mr-1" />
              )}
              {message.status === "error"
                ? t("simple.draftCard.retryAccept", {
                    defaultValue: "重试接受为第 {{num}} 章",
                    num: message.chapterNum,
                  })
                : t("simple.draftCard.accept", { defaultValue: "接受为第 {{num}} 章", num: message.chapterNum })}
            </Button>
          )}
          <Button
            tone="neutral"
            fill="outline"
            size="sm"
            disabled={isStreaming}
            onClick={() => onRegenerate(message.id)}
            className="font-sans text-[11px] uppercase tracking-[0.08em]"
          >
            <RotateCcw size={12} className="mr-1" />
            {t("simple.draftCard.regenerate", { defaultValue: "再生成" })}
          </Button>
          <Button
            tone="destructive"
            fill="outline"
            size="sm"
            disabled={isStreaming}
            onClick={() => onDiscard(message.id)}
            className="font-sans text-[11px] uppercase tracking-[0.08em]"
          >
            <X size={12} className="mr-1" />
            {t("simple.draftCard.discard", { defaultValue: "丢弃" })}
          </Button>
        </ActionFooter>
      )}
    </Card>
  );
}

export const WritingDraftCard = memo(WritingDraftCardImpl);
