// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { memo } from "react";
import { Bot } from "lucide-react";
import { useTranslation } from "../../../i18n/useAppTranslation";
import type { SimpleAssistantMessage } from "../types";

interface AssistantMessageProps {
  message: SimpleAssistantMessage;
}

export const AssistantMessage = memo(function AssistantMessage({ message }: AssistantMessageProps) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-sm border border-rule bg-surface px-4 py-3">
        <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright">
          <Bot size={10} />
          <span>{t("simple.assistant.eyebrow", { defaultValue: "§ AI" })}</span>
        </div>
        <div
          className="whitespace-pre-wrap break-words font-serif text-text"
          style={{ fontSize: "var(--ff-body-fs, 14px)", lineHeight: "var(--ff-body-lh, 1.6)" }}
        >
          {message.content}
        </div>
      </div>
    </div>
  );
});
