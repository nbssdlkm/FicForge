import React, { HTMLAttributes } from 'react';
import { cn } from './utils';

export const Card = React.forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("rounded-lg border border-black/10 dark:border-white/10 bg-surface text-text shadow-subtle p-4", className)}
        {...props}
      />
    );
  }
);
Card.displayName = 'Card';
