// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

// Shared chrome for simple-chat message cards (ChapterPreview / SettingPreview /
// WritingDraft / ToolCall) and SystemMessage. These four primitives are the
// single source of truth for the card eyebrow, the icon+tinted status banner,
// the expand/collapse toggle, and the rule-topped action footer. Before this
// file the same Tailwind class strings (e.g. the gold-bright eyebrow signature
// and `border-t border-rule`) were hand-maintained across five files.
//
// NOTE: distinct visual variants elsewhere in ui/simple/ (SimpleSettingsDrawer
// section labels `div … mb-2`, SimpleReadingView `text-sm` banners / footers)
// are intentionally NOT routed through here yet — they differ in element, size,
// and spacing. Generalizing later is a follow-up, not part of this card pass.

import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, ChevronDown, ChevronUp, Info, type LucideIcon } from "lucide-react";
import { Button } from "../../shared/Button";
import { cn } from "../../shared/utils";

// ── CardEyebrow ───────────────────────────────────────────────────
// The gold-bright mono caption that opens every card header: icon + short label.

export function CardEyebrow({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright">
      <Icon size={11} />
      {children}
    </span>
  );
}

// ── CardStatusBanner ──────────────────────────────────────────────
// Icon + tinted message line. info/warning/error tones each carry a default
// lucide icon (overridable). Editorial serif voice, compact. This is the chat
// card / SystemMessage banner — distinct from ui/shared/InlineBanner, which is
// the responsive message+actions chrome used at the top of Library / Writer.
//
// Base intentionally omits line-height so it is byte-identical to the inline
// error divs it replaced in the preview cards. SystemMessage opts into
// `leading-relaxed` via className (its original markup had it).

export type CardStatusTone = "info" | "warning" | "error";

export const CARD_STATUS_TONE_CLASSES: Record<CardStatusTone, string> = {
  info: "border-info/30 bg-info/8 text-info",
  warning: "border-warning/40 bg-warning/8 text-warning",
  error: "border-error/40 bg-error/8 text-error",
};

const TONE_ICONS: Record<CardStatusTone, LucideIcon> = {
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
};

export function CardStatusBanner({
  tone,
  icon,
  children,
  className,
}: {
  tone: CardStatusTone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  const Icon = icon ?? TONE_ICONS[tone];
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-sm border px-3 py-2 font-serif text-xs",
        CARD_STATUS_TONE_CLASSES[tone],
        className,
      )}
    >
      <Icon size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

// ── ExpandToggle ──────────────────────────────────────────────────
// Chevron-led plain button toggling collapsed/expanded content. `expandLabel`
// shows when collapsed, `collapseLabel` when expanded.

export function ExpandToggle({
  expanded,
  onToggle,
  expandLabel,
  collapseLabel,
  disabled,
  className,
}: {
  expanded: boolean;
  onToggle: () => void;
  expandLabel: ReactNode;
  collapseLabel: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      tone="neutral"
      fill="plain"
      size="sm"
      disabled={disabled}
      onClick={onToggle}
      className={cn("font-mono text-[10px] uppercase tracking-[0.08em]", className)}
    >
      {expanded ? <ChevronUp size={12} className="mr-1" /> : <ChevronDown size={12} className="mr-1" />}
      {expanded ? collapseLabel : expandLabel}
    </Button>
  );
}

// ── ActionFooter ──────────────────────────────────────────────────
// Rule-topped flex row holding a card's action buttons. Base is `flex border-t
// border-rule pt-3`; pass className to adjust padding (twMerge wins) or layout
// (justify-end, flex-wrap, gap-2).

export function ActionFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex border-t border-rule pt-3", className)}>{children}</div>;
}
