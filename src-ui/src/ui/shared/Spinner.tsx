// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Loading primitives — consolidates the ~45 scattered
 * `<Spinner size="sm" />` usages into two consistent shapes.
 */

import { Loader2 } from 'lucide-react';
import { cn } from './utils';

export type SpinnerSize = 'sm' | 'md' | 'lg';

const sizePx: Record<SpinnerSize, number> = { sm: 14, md: 18, lg: 24 };

export interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
  'aria-label'?: string;
}

/** Inline spinner icon. Pair with text via flex/gap. */
export function Spinner({ size = 'md', className, 'aria-label': ariaLabel }: SpinnerProps) {
  return (
    <Loader2
      size={sizePx[size]}
      className={cn('animate-spin', className)}
      aria-label={ariaLabel}
      role={ariaLabel ? 'status' : undefined}
    />
  );
}

export interface LoadingStateProps {
  /** Optional text shown to the right of the spinner. */
  message?: string;
  /** Tighter vertical padding, smaller spinner. Default false. */
  compact?: boolean;
  className?: string;
}

/** Centered loading area (spinner + optional message). Use in list/panel empty-while-loading. */
export function LoadingState({ message, compact = false, className }: LoadingStateProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-3 text-text/50',
        compact ? 'py-4' : 'py-16',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Spinner size={compact ? 'sm' : 'md'} />
      {message ? <span className="text-sm">{message}</span> : null}
    </div>
  );
}
