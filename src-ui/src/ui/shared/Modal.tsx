// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import React, { HTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { cn } from './utils';
import { Button } from './Button';

export interface ModalProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
}

export const Modal = React.forwardRef<HTMLDivElement, ModalProps>(
  ({ className, isOpen, onClose, title, children, ...props }, ref) => {
    if (!isOpen) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
        <div 
          ref={ref}
          className={cn("bg-surface text-text w-full max-w-lg rounded-xl shadow-strong overflow-hidden flex flex-col max-h-[90vh]", className)}
          {...props}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 dark:border-white/10">
            {title && <h2 className="text-lg font-sans font-semibold">{title}</h2>}
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0 rounded-full ml-auto">
              <X size={18} />
            </Button>
          </div>
          <div className="p-6 overflow-y-auto font-sans">
             {children}
          </div>
        </div>
      </div>
    );
  }
);
Modal.displayName = 'Modal';
