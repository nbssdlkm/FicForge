// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import React, { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from './utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, type, style, ...props }, ref) => {
    // Android WebView 的 type="password" 禁止粘贴。
    // 改用 type="text" + CSS -webkit-text-security 遮蔽，保留粘贴能力。
    const isPassword = type === "password";
    const resolvedType = isPassword ? "text" : type;
    const resolvedStyle = isPassword
      ? { ...style, WebkitTextSecurity: "disc" as const }
      : style;

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && <label className="text-sm font-sans font-medium text-text">{label}</label>}
        <input
          className={cn(
            "flex h-11 md:h-10 w-full font-sans rounded-md border border-black/20 dark:border-white/20 bg-background px-3 py-2 text-base md:text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-subtle",
            error && "border-error focus:ring-error",
            className
          )}
          ref={ref}
          type={resolvedType}
          style={resolvedStyle}
          autoComplete={isPassword ? "off" : undefined}
          {...props}
        />
        {error && <span className="text-xs font-sans text-error">{error}</span>}
      </div>
    );
  }
);
Input.displayName = 'Input';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && <label className="text-sm font-sans font-medium text-text">{label}</label>}
        <textarea
          className={cn(
            "flex min-h-[96px] w-full font-sans rounded-md border border-black/20 dark:border-white/20 bg-background px-3 py-2 text-base md:text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-subtle",
            error && "border-error focus:ring-error",
            className
          )}
          ref={ref}
          {...props}
        />
        {error && <span className="text-xs font-sans text-error">{error}</span>}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';
