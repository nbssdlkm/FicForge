// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { ReactNode } from 'react';
import { cn } from './utils';

export type InlineBannerVariant = 'info' | 'warning';
export type InlineBannerLayout = 'card' | 'bar';

export interface InlineBannerProps {
  variant?: InlineBannerVariant;
  layout?: InlineBannerLayout;
  message: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
}

const variantStyles: Record<InlineBannerVariant, string> = {
  info: 'border-info/30 bg-info/10 text-info',
  warning: 'border-warning/30 bg-warning/10 text-warning',
};

const layoutStyles: Record<InlineBannerLayout, string> = {
  card: 'rounded-xl border px-4 py-3',
  bar: 'border-b px-4 py-2 md:px-6',
};

export function InlineBanner({
  variant = 'info',
  layout = 'card',
  message,
  actions,
  compact = false,
  className,
}: InlineBannerProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 md:flex-row md:items-center md:justify-between',
        variantStyles[variant],
        layoutStyles[layout],
        compact ? 'text-xs' : 'text-sm',
        className,
      )}
    >
      <span>{message}</span>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
