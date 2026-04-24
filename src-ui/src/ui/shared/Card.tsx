// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import React, { HTMLAttributes } from 'react';
import { cn } from './utils';

// Ex Libris card — gold "book spine" on the left edge, parchment body, hairline frame.
// Radius is asymmetric (0 on the spine side) so the gold stripe reads as a continuous
// vertical rule, not a rounded pill. See `design-system-exlibris-v2.html` §06 `.card`.
export const Card = React.forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'relative bg-surface text-text px-4 py-4 border border-rule border-l-2 border-l-gold rounded-r-sm',
          className
        )}
        {...props}
      />
    );
  }
);
Card.displayName = 'Card';
