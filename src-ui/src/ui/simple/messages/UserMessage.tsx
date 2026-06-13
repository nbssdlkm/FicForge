// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { memo } from "react";
import { useTranslation } from "../../../i18n/useAppTranslation";
import type { SimpleUserMessage } from "../types";

interface UserMessageProps {
  message: SimpleUserMessage;
}

export const UserMessage = memo(function UserMessage({ message }: UserMessageProps) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-sm border border-accent/40 bg-accent/8 px-4 py-3">
        <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-accent/80">
          {t("simple.user.eyebrow", { defaultValue: "§ You" })}
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
