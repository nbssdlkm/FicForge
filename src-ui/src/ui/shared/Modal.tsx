// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import React, { type HTMLAttributes } from "react";
import { X } from "lucide-react";
import { cn } from "./utils";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useTranslation } from "../../i18n/useAppTranslation";
import { MobileSheet } from "../mobile/MobileSheet";
import { goldLine } from "./tokens";

export interface ModalProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
}

// Ex Libris modal — header is a "drawer banner" (sage bg + gold top/bottom inset lines),
// title in display italic. Body stays parchment. See `design-system-exlibris-v2.html` §06.
const headerGoldLines = {
  boxShadow: `inset 0 ${goldLine.topThick} 0 var(--color-gold-bright), inset 0 ${goldLine.bottomThick} 0 var(--color-gold-bright)`,
};

export const Modal = React.forwardRef<HTMLDivElement, ModalProps>(
  ({ className, isOpen, onClose, title, children, ...props }, ref) => {
    const isMobile = useMediaQuery("(max-width: 768px)");
    const { t } = useTranslation();
    if (!isOpen) return null;

    if (isMobile) {
      return (
        <MobileSheet isOpen={isOpen} onClose={onClose} title={title} className={className} {...props}>
          {children}
        </MobileSheet>
      );
    }

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
        <div
          ref={ref}
          className={cn(
            "bg-surface text-text w-full max-w-lg rounded-sm shadow-strong overflow-hidden flex flex-col max-h-[90vh] border border-rule",
            className,
          )}
          {...props}
        >
          <div
            className="flex items-center justify-between px-5 py-3.5 bg-drawer text-inv-text relative"
            style={headerGoldLines}
          >
            {title && <h2 className="font-display text-lg font-semibold text-inv-text tracking-[0.01em]">{title}</h2>}
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.actions.close")}
              className="ml-auto flex h-8 w-8 items-center justify-center text-inv-text/70 transition-colors hover:text-inv-text focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-gold-bright"
            >
              <X size={16} />
            </button>
          </div>
          <div className="px-6 py-5 overflow-y-auto font-serif text-[15px] leading-relaxed">{children}</div>
        </div>
      </div>
    );
  },
);
Modal.displayName = "Modal";
