// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { ReactNode } from 'react';
import { cn } from './utils';

export type InlineBannerTone = 'info' | 'warning';
export type InlineBannerLayout = 'card' | 'bar';

export interface InlineBannerProps {
  tone?: InlineBannerTone;
  layout?: InlineBannerLayout;
  message: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
}

// Ex Libris banner — serif voice (this is editorial text, not UI chrome).
// `card` = rounded frame with tone-tinted bg; `bar` = bottom-rule only, sits
// edge-to-edge above content (used at top of Library / Writer for sync notices).
const toneStyles: Record<InlineBannerTone, string> = {
  info: 'border-info/30 bg-info/8 text-info',
  warning: 'border-warning/40 bg-warning/8 text-warning',
};

const layoutStyles: Record<InlineBannerLayout, string> = {
  card: 'rounded-sm border',
  bar: 'border-b',
};

export function InlineBanner({
  tone = 'info',
  layout = 'card',
  message,
  actions,
  compact = false,
  className,
}: InlineBannerProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 font-serif md:flex-row md:items-center md:justify-between',
        layout === 'bar' ? 'px-4 py-2.5 md:px-6' : 'px-4 py-3',
        toneStyles[tone],
        layoutStyles[layout],
        compact ? 'text-xs' : 'text-sm',
        className,
      )}
    >
      <span className="leading-relaxed">{message}</span>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
