// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import React, { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from './utils';

export type InputTone = 'neutral' | 'error';

const baseFieldStyles =
  'w-full font-sans rounded-md border bg-background px-3 py-2 text-base md:text-sm placeholder:text-text/40 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors';

const toneStyles: Record<InputTone, string> = {
  neutral: 'border-black/20 dark:border-white/20 focus:ring-accent',
  error: 'border-error focus:ring-error',
};

interface FieldShellProps {
  label?: string;
  errorText?: string;
  children: React.ReactNode;
}

function FieldShell({ label, errorText, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && <label className="text-sm font-sans font-medium text-text">{label}</label>}
      {children}
      {errorText && <span className="text-xs font-sans text-error">{errorText}</span>}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Error message displayed below. Presence also flips tone to 'error' if tone not set. */
  error?: string;
  tone?: InputTone;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, tone, type, style, ...props }, ref) => {
    // Android WebView 的 type="password" 禁止粘贴。
    // 改用 type="text" + CSS -webkit-text-security 遮蔽，保留粘贴能力。
    // Firefox 不支持 -webkit-text-security，回退为原生 type="password"。
    const isPassword = type === 'password';
    const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
    const useTextSecurity = isPassword && !isFirefox;
    const resolvedType = useTextSecurity ? 'text' : type;
    const resolvedStyle = useTextSecurity
      ? { ...style, WebkitTextSecurity: 'disc' as const }
      : style;
    const effectiveTone: InputTone = tone ?? (error ? 'error' : 'neutral');

    return (
      <FieldShell label={label} errorText={error}>
        <input
          className={cn('flex h-11 md:h-10', baseFieldStyles, toneStyles[effectiveTone], className)}
          ref={ref}
          type={resolvedType}
          style={resolvedStyle}
          autoComplete={isPassword ? 'off' : undefined}
          {...props}
        />
      </FieldShell>
    );
  }
);
Input.displayName = 'Input';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  tone?: InputTone;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, tone, ...props }, ref) => {
    const effectiveTone: InputTone = tone ?? (error ? 'error' : 'neutral');
    return (
      <FieldShell label={label} errorText={error}>
        <textarea
          className={cn('flex min-h-[96px]', baseFieldStyles, toneStyles[effectiveTone], className)}
          ref={ref}
          {...props}
        />
      </FieldShell>
    );
  }
);
Textarea.displayName = 'Textarea';
