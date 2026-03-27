import React, { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from './utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && <label className="text-sm font-sans font-medium text-text">{label}</label>}
        <input
          className={cn(
            "flex h-10 w-full font-sans rounded-md border border-black/20 dark:border-white/20 bg-background px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-subtle",
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
            "flex min-h-[80px] w-full font-sans rounded-md border border-black/20 dark:border-white/20 bg-background px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-subtle",
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
