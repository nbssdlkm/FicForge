// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import React, { HTMLAttributes } from 'react';
import { cn } from './utils';

export const Card = React.forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("rounded-lg border border-black/10 dark:border-white/10 bg-surface text-text p-4", className)}
        {...props}
      />
    );
  }
);
Card.displayName = 'Card';
