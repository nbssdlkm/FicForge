// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import React, { ButtonHTMLAttributes } from "react";
import { cn } from "./utils";

export type Tone = "accent" | "neutral" | "destructive";
export type Fill = "solid" | "outline" | "plain";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  fill?: Fill;
  size?: "sm" | "md" | "lg";
}

// Ex Libris signature: hairline rule borders, green-tinted soft-fill hovers,
// gold focus ring, crisp 3px corners. Colors flow through CSS vars so both
// light (olive on parchment) and dark (dark-olive on charcoal) share one rule set.
const toneFillStyles: Record<`${Tone}-${Fill}`, string> = {
  "accent-solid": "bg-accent text-inv-text hover:brightness-110",
  "accent-outline": "text-accent border border-accent hover:bg-rule-soft",
  "accent-plain": "text-accent hover:bg-rule-soft",
  "neutral-solid": "bg-surface text-text border border-rule hover:bg-rule-soft",
  "neutral-outline": "text-text/80 border border-rule hover:text-accent hover:border-accent",
  "neutral-plain": "text-text/80 hover:text-accent hover:bg-rule-soft",
  "destructive-solid": "bg-error text-inv-text hover:brightness-110",
  "destructive-outline": "text-error border border-error/60 hover:bg-error/10",
  "destructive-plain": "text-error hover:bg-error/10",
};

const sizes = {
  sm: "h-11 md:h-8 px-3 text-sm md:text-xs",
  md: "h-11 md:h-10 px-4 py-2",
  lg: "h-12 px-5 text-base",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, tone = "accent", fill = "solid", size = "md", ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center gap-1.5 rounded-[3px] font-sans text-base md:text-sm font-medium tracking-[0.02em] transition-all duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50";

    return (
      <button
        ref={ref}
        className={cn(baseStyles, toneFillStyles[`${tone}-${fill}`], sizes[size], className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
