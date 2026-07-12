// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import React, { type HTMLAttributes } from "react";
import { cn } from "./utils";
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from "lucide-react";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastProps extends HTMLAttributes<HTMLDivElement> {
  tone?: ToastTone;
  onClose?: () => void;
  message: string;
}

// Ex Libris toast — parchment body, tone carried only in the 3px left bar and the
// icon, not the background. Serif body text, hairline border on the other 3 edges.
const iconMap: Record<ToastTone, React.ReactNode> = {
  success: <CheckCircle size={18} className="text-success" />,
  error: <AlertCircle size={18} className="text-error" />,
  info: <Info size={18} className="text-info" />,
  warning: <AlertTriangle size={18} className="text-warning" />,
};

const borderLeftMap: Record<ToastTone, string> = {
  success: "border-l-success",
  error: "border-l-error",
  info: "border-l-info",
  warning: "border-l-warning",
};

export const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  ({ className, tone = "info", message, onClose, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center gap-3 w-full max-w-md rounded-sm border border-rule border-l-[3px] bg-surface px-3.5 py-3 shadow-medium pointer-events-auto font-serif text-sm text-text",
          borderLeftMap[tone],
          className,
        )}
        {...props}
      >
        {iconMap[tone]}
        <div className="flex-1 leading-snug">{message}</div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-text/50 hover:text-text transition-colors"
            aria-label="close"
          >
            <X size={15} />
          </button>
        )}
      </div>
    );
  },
);
Toast.displayName = "Toast";
