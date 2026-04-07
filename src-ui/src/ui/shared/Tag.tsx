// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { HTMLAttributes, forwardRef } from 'react';
import { cn } from './utils';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'resolved' | 'deprecated' | 'unresolved' | 'active';
}

export const Tag = forwardRef<HTMLSpanElement, TagProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const variants = {
      default: 'bg-black/5 dark:bg-white/10 text-text',
      success: 'bg-success/10 text-success border border-success/20',
      warning: 'bg-warning/10 text-warning border border-warning/20',
      error: 'bg-error/10 text-error border border-error/20',
      info: 'bg-info/10 text-info border border-info/20',
      unresolved: 'bg-accent/10 text-accent border border-accent/20 font-bold',
      active: 'bg-info/10 text-info border border-info/20',
      resolved: 'bg-black/5 dark:bg-white/10 text-text/50 border border-black/10 dark:border-white/10',
      deprecated: 'bg-black/5 dark:bg-white/10 text-text/40 line-through border border-transparent',
    };

    return (
      <span
        ref={ref}
        className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-sans font-medium", variants[variant], className)}
        {...props}
      />
    );
  }
);
Tag.displayName = 'Tag';
