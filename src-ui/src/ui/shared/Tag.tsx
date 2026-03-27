import React, { HTMLAttributes } from 'react';
import { cn } from './utils';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
}

export const Tag = React.forwardRef<HTMLSpanElement, TagProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const variants = {
      default: 'bg-black/5 dark:bg-white/10 text-text',
      success: 'bg-success/20 text-success dark:bg-success/30',
      warning: 'bg-warning/20 text-warning dark:bg-warning/30',
      error: 'bg-error/20 text-error dark:bg-error/30',
      info: 'bg-info/20 text-info dark:bg-info/30',
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
