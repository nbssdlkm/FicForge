// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { memo } from "react";
import type { SimpleSystemMessage } from "../types";
import { CardStatusBanner } from "./CardChrome";

interface SystemMessageProps {
  message: SimpleSystemMessage;
}

export const SystemMessage = memo(function SystemMessage({ message }: SystemMessageProps) {
  return (
    <div className="flex justify-center">
      <CardStatusBanner tone={message.tone} className="leading-relaxed">
        {message.content}
      </CardStatusBanner>
    </div>
  );
});
