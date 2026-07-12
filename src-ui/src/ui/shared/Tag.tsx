// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { HTMLAttributes, forwardRef } from "react";
import { cn } from "./utils";

export type TagTone =
  | "default"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "gold"
  | "resolved"
  | "deprecated"
  | "unresolved"
  | "active";

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: TagTone;
}

// Ex Libris tag — an old card-catalog metadata stamp: mono caps with wide tracking,
// 2px crisp corners, thin border in the tone color, tinted fill. `unresolved` gets
// extra weight so it actually reads as a "needs review" beacon.
const toneStyles: Record<TagTone, string> = {
  default: "text-text/70 border-rule bg-transparent",
  success: "text-success border-success/40 bg-success/10",
  warning: "text-warning border-warning/40 bg-warning/10",
  error: "text-error border-error/40 bg-error/10",
  info: "text-info border-info/40 bg-info/10",
  gold: "text-gold border-gold/50 bg-gold/10",
  unresolved: "text-accent border-accent bg-accent/10 font-semibold",
  active: "text-info border-info/40 bg-info/10",
  resolved: "text-text/50 border-rule bg-transparent",
  deprecated: "text-text/50 border-transparent bg-rule-soft line-through",
};

export const Tag = forwardRef<HTMLSpanElement, TagProps>(({ className, tone = "default", ...props }, ref) => {
  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-[2px] border px-2 py-[3px] font-mono text-[9px] uppercase tracking-[0.14em]",
        toneStyles[tone],
        className,
      )}
      {...props}
    />
  );
});
Tag.displayName = "Tag";
