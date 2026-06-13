// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { memo } from "react";
import { AlertCircle, AlertTriangle, Info, type LucideIcon } from "lucide-react";
import type { SimpleSystemMessage } from "../types";

interface SystemMessageProps {
  message: SimpleSystemMessage;
}

const TONE_CLASSES: Record<SimpleSystemMessage["tone"], string> = {
  info: "border-info/30 bg-info/8 text-info",
  warning: "border-warning/40 bg-warning/8 text-warning",
  error: "border-error/40 bg-error/8 text-error",
};

const TONE_ICONS: Record<SimpleSystemMessage["tone"], LucideIcon> = {
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
};

export const SystemMessage = memo(function SystemMessage({ message }: SystemMessageProps) {
  const Icon = TONE_ICONS[message.tone];
  return (
    <div className="flex justify-center">
      <div
        className={`flex items-start gap-2 rounded-sm border px-3 py-2 font-serif text-xs leading-relaxed ${TONE_CLASSES[message.tone]}`}
      >
        <Icon size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{message.content}</span>
      </div>
    </div>
  );
});
