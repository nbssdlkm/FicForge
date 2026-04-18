// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import React, { ButtonHTMLAttributes } from 'react';
import { cn } from './utils';

export type Tone = 'accent' | 'neutral' | 'destructive';
export type Fill = 'solid' | 'outline' | 'plain';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  fill?: Fill;
  size?: 'sm' | 'md' | 'lg';
}

const toneFillStyles: Record<`${Tone}-${Fill}`, string> = {
  'accent-solid': 'bg-accent text-white hover:opacity-90',
  'accent-outline': 'text-accent border border-accent hover:bg-accent/10',
  'accent-plain': 'text-accent hover:bg-accent/10',
  'neutral-solid': 'bg-surface text-text hover:bg-surface/80 border border-black/10 dark:border-white/10',
  'neutral-outline': 'text-text hover:bg-surface border border-black/10 dark:border-white/10',
  'neutral-plain': 'hover:bg-surface hover:text-accent text-text',
  'destructive-solid': 'bg-error text-white hover:opacity-90',
  'destructive-outline': 'text-error border border-error/40 hover:bg-error/10',
  'destructive-plain': 'text-error hover:bg-error/10',
};

const sizes = {
  sm: 'h-11 md:h-8 px-3 text-sm md:text-xs',
  md: 'h-11 md:h-10 px-4 py-2',
  lg: 'h-12 px-8 text-base',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, tone = 'accent', fill = 'solid', size = 'md', ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center rounded-md font-sans text-base md:text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50';

    return (
      <button
        ref={ref}
        className={cn(baseStyles, toneFillStyles[`${tone}-${fill}`], sizes[size], className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
