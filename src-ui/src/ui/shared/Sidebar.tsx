// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import React, { HTMLAttributes } from 'react';
import { cn } from './utils';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { Button } from './Button';
import { useTranslation } from '../../i18n/useAppTranslation';

export interface SidebarProps extends HTMLAttributes<HTMLDivElement> {
  width?: string;
  isCollapsed?: boolean;
  onToggle?: () => void;
  position?: 'left' | 'right';
}

export const Sidebar = React.forwardRef<HTMLDivElement, SidebarProps>(
  ({ className, width = '280px', isCollapsed = false, onToggle, position = 'left', children, ...props }, ref) => {
    const { t } = useTranslation();

    return (
      <div
        ref={ref}
        style={{ width: isCollapsed ? '0px' : width }}
        className={cn(
          "relative h-full flex flex-col bg-surface border-black/10 dark:border-white/10 transition-all duration-300 overflow-visible z-10",
          position === 'left' ? "border-r" : "border-l",
          className
        )}
        {...props}
      >
        <div className={cn("flex-1 overflow-y-auto overflow-x-hidden transition-opacity duration-300 min-w-[200px]", isCollapsed ? "opacity-0 invisible pointer-events-none" : "opacity-100")}>
          {children}
        </div>

        {onToggle && (
           <Button
             tone="neutral" fill="outline"
             className={cn(
               "absolute top-6 flex h-8 w-8 items-center justify-center p-0 rounded-full shadow-strong !bg-background !border-black/10 dark:!border-white/10 pointer-events-auto visible opacity-100 z-20 text-text/60 hover:text-text",
               position === 'left' ? "-right-4" : "-left-4"
             )}
             onClick={onToggle}
             title={isCollapsed ? t("shared.sidebar.expand") : t("shared.sidebar.collapse")}
           >
             {position === 'left' ? (isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />) : (isCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />)}
           </Button>
        )}
      </div>
    );
  }
);
Sidebar.displayName = 'Sidebar';
