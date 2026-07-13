// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import React, { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "./utils";

export type InputTone = "neutral" | "error";

const baseFieldStyles =
  "w-full font-sans rounded-md border bg-background px-3 py-2 text-base md:text-sm placeholder:text-text/50 focus:outline-hidden focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors";

const toneStyles: Record<InputTone, string> = {
  neutral: "border-black/20 dark:border-white/20 focus:ring-accent",
  error: "border-error focus:ring-error",
};

interface FieldShellProps {
  label?: string;
  htmlFor?: string;
  errorText?: string;
  children: React.ReactNode;
}

function FieldShell({ label, htmlFor, errorText, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && (
        <label htmlFor={htmlFor} className="text-sm font-sans font-medium text-text">
          {label}
        </label>
      )}
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
  ({ className, label, error, tone, type, style, id, ...props }, ref) => {
    // Android WebView 的 type="password" 禁止粘贴。
    // 改用 type="text" + CSS -webkit-text-security 遮蔽，保留粘贴能力。
    // Firefox 不支持 -webkit-text-security，回退为原生 type="password"。
    const isPassword = type === "password";
    const isFirefox = typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent);
    const useTextSecurity = isPassword && !isFirefox;
    const resolvedType = useTextSecurity ? "text" : type;
    const resolvedStyle = useTextSecurity ? { ...style, WebkitTextSecurity: "disc" as const } : style;
    const effectiveTone: InputTone = tone ?? (error ? "error" : "neutral");
    // 内置 label prop 时需要 id 关联；调用方已传 id 则复用，否则 useId() 兜底防跨实例撞 id。
    const generatedId = useId();
    const inputId = id ?? generatedId;

    return (
      <FieldShell label={label} htmlFor={inputId} errorText={error}>
        <input
          className={cn("flex h-11 md:h-10", baseFieldStyles, toneStyles[effectiveTone], className)}
          ref={ref}
          id={inputId}
          type={resolvedType}
          style={resolvedStyle}
          autoComplete={isPassword ? "off" : undefined}
          {...props}
        />
      </FieldShell>
    );
  },
);
Input.displayName = "Input";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  tone?: InputTone;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, tone, id, ...props }, ref) => {
    const effectiveTone: InputTone = tone ?? (error ? "error" : "neutral");
    // 内置 label prop 时需要 id 关联；调用方已传 id 则复用，否则 useId() 兜底防跨实例撞 id。
    const generatedId = useId();
    const textareaId = id ?? generatedId;
    return (
      <FieldShell label={label} htmlFor={textareaId} errorText={error}>
        <textarea
          className={cn("flex min-h-[96px]", baseFieldStyles, toneStyles[effectiveTone], className)}
          ref={ref}
          id={textareaId}
          {...props}
        />
      </FieldShell>
    );
  },
);
Textarea.displayName = "Textarea";
