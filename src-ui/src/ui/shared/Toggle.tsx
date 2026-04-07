// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import React from 'react';
import { cn } from './utils';

export interface ToggleProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Toggle = React.forwardRef<HTMLInputElement, ToggleProps>(
  ({ className, label, ...props }, ref) => {
    return (
      <label className="flex items-center cursor-pointer gap-2">
        <div className="relative">
          <input type="checkbox" className="sr-only" ref={ref} {...props} />
          <div className={cn("block w-10 h-6 rounded-full transition-colors", props.checked ? "bg-accent" : "bg-black/20 dark:bg-white/20", className)}></div>
          <div className={cn("dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform", props.checked ? "transform translate-x-4" : "")}></div>
        </div>
        {label && <span className="font-sans text-sm text-text">{label}</span>}
      </label>
    );
  }
);
Toggle.displayName = 'Toggle';
