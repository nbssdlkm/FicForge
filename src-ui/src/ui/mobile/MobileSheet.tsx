// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { HTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { Button } from "../shared/Button";
import { cn } from "../shared/utils";

interface MobileSheetProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  contentClassName?: string;
}

export function MobileSheet({
  className,
  isOpen,
  onClose,
  title,
  children,
  contentClassName,
  ...props
}: MobileSheetProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        onClick={onClose}
        aria-label={t("common.actions.close")}
      />
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[calc(var(--app-height)-1rem)] min-h-[70vh] flex-col overflow-hidden rounded-t-[28px] border border-black/10 bg-background shadow-strong animate-slide-up dark:border-white/10",
          className
        )}
        {...props}
      >
        <div className="flex items-center justify-between border-b border-black/10 bg-background/95 px-4 py-3 backdrop-blur dark:border-white/10 safe-area-top">
          <div className="min-w-0">
            {title ? <h2 className="truncate text-base font-semibold text-text">{title}</h2> : null}
          </div>
          <Button
            tone="neutral" fill="plain"
            size="sm"
            onClick={onClose}
            className="ml-3 h-11 w-11 shrink-0 rounded-full p-0"
            aria-label={t("common.actions.close")}
          >
            <X size={18} />
          </Button>
        </div>
        <div className={cn("flex-1 overflow-y-auto px-4 py-4 safe-area-bottom", contentClassName)}>
          {children}
        </div>
      </div>
    </div>
  );
}
