// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import React, { HTMLAttributes } from 'react';
import { cn } from './utils';
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export interface ToastProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'success' | 'error' | 'info' | 'warning';
  onClose?: () => void;
  message: string;
}

export const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  ({ className, variant = 'info', message, onClose, ...props }, ref) => {
    
    const iconMap = {
      success: <CheckCircle size={18} className="text-success" />,
      error: <AlertCircle size={18} className="text-error" />,
      info: <Info size={18} className="text-info" />,
      warning: <AlertTriangle size={18} className="text-warning" />,
    };

    const bgMap = {
      success: 'bg-success/10 border-success/20',
      error: 'bg-error/10 border-error/20',
      info: 'bg-info/10 border-info/20',
      warning: 'bg-warning/10 border-warning/20',
    };

    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center gap-3 w-full max-w-md rounded-lg border p-4 shadow-medium font-sans text-sm text-text bg-surface pointer-events-auto",
          bgMap[variant],
          className
        )}
        {...props}
      >
        {iconMap[variant]}
        <div className="flex-1">{message}</div>
        {onClose && (
          <button onClick={onClose} className="text-text hover:opacity-70 transition-opacity">
            <X size={16} />
          </button>
        )}
      </div>
    );
  }
);
Toast.displayName = 'Toast';
