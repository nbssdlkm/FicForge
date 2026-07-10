// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { HTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { goldLine } from "../shared/tokens";
import { cn } from "../shared/utils";

interface MobileSheetProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  contentClassName?: string;
}

// Same drawer-banner header as Modal.tsx — gold top/bottom inset lines on a
// sage background, display italic title in cream. Keeps the desktop Modal and
// the mobile bottom-sheet visually consistent.
const sheetHeaderGoldLines = {
  boxShadow: `inset 0 ${goldLine.topThick} 0 var(--color-gold-bright), inset 0 ${goldLine.bottomThick} 0 var(--color-gold-bright)`,
};

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
        className="absolute inset-0 bg-black/50 backdrop-blur-xs"
        onClick={onClose}
        aria-label={t("common.actions.close")}
      />
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[calc(var(--app-height)-1rem)] min-h-[70vh] flex-col overflow-hidden rounded-t-sm border border-rule bg-surface shadow-strong animate-slide-up",
          className
        )}
        {...props}
      >
        <div
          className="safe-area-top flex items-center justify-between bg-drawer px-4 py-3 text-inv-text"
          style={sheetHeaderGoldLines}
        >
          <div className="min-w-0 flex-1">
            {title ? (
              <h2 className="truncate font-display text-lg font-semibold text-inv-text">
                {title}
              </h2>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.actions.close")}
            className="ml-3 flex h-11 w-11 shrink-0 items-center justify-center text-inv-text/70 transition-colors hover:text-inv-text"
          >
            <X size={18} />
          </button>
        </div>
        <div className={cn("flex-1 overflow-y-auto px-4 py-4 safe-area-bottom", contentClassName)}>
          {children}
        </div>
      </div>
    </div>
  );
}
