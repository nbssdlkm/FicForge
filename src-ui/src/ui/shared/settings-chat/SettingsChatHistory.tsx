// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useRef } from "react";
import { Bot, MessageSquareText, User2 } from "lucide-react";
import { Button } from "../Button";
import { EmptyState } from "../EmptyState";
import { ToolCallCard } from "./ToolCallCard";
import {
  getToolDuplicateWarning,
  getToolMissingTargetError,
  getToolOverwriteWarning,
  getToolValidationError,
  isToolCallResolved,
  type SettingsChatMessage,
  type SettingsMode,
} from "./types";

interface SettingsChatHistoryProps {
  messages: SettingsChatMessage[];
  mode: SettingsMode;
  t: (key: string, options?: Record<string, unknown>) => string;
  compact?: boolean;
  disabled?: boolean;
  availableCharacterNames: string[];
  availableCharacterNameSet: Set<string>;
  existingCharacterFileNames: Set<string>;
  existingWorldbuildingFileNames: Set<string>;
  existingPinnedTexts: string[];
  onConfirmTool: (messageId: string, cardId: string, nextArgs?: Record<string, unknown>) => Promise<void>;
  onSkipTool: (messageId: string, cardId: string) => void;
  onUndoTool: (messageId: string, cardId: string) => Promise<void>;
  onConfirmAll: (messageId: string) => Promise<void>;
  onSkipAll: (messageId: string) => void;
}

export function SettingsChatHistory({
  messages,
  mode,
  t,
  compact = false,
  disabled = false,
  availableCharacterNames,
  availableCharacterNameSet,
  existingCharacterFileNames,
  existingWorldbuildingFileNames,
  existingPinnedTexts,
  onConfirmTool,
  onSkipTool,
  onUndoTool,
  onConfirmAll,
  onSkipAll,
}: SettingsChatHistoryProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const hasAnyLoadingToolCall = disabled || messages.some((message) =>
    (message.toolCalls || []).some((card) => card.isLoading)
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-[24px] border border-black/10 bg-surface/35 p-6 shadow-subtle dark:border-white/10">
        <EmptyState
          compact={compact}
          icon={<MessageSquareText size={compact ? 28 : 40} />}
          title={t(mode === "au" ? "settingsMode.emptyTitle" : "settingsMode.fandomEmptyTitle")}
          description={t(mode === "au" ? "settingsMode.emptyDescription" : "settingsMode.fandomEmptyDescription")}
        />
      </div>
    );
  }

  return (
      <div className={`space-y-4 overflow-y-auto ${compact ? "max-h-[360px] pr-1" : "h-full px-4 py-4 md:px-8 md:py-10"}`}>
      {messages.map((message) => {
        const pendingToolCalls = (message.toolCalls || []).filter((card) => !isToolCallResolved(card.status));
        const confirmableToolCalls = pendingToolCalls.filter(
          (card) =>
            !card.isLoading
            && !card.parseError
            && !getToolValidationError(card, card.parsedArgs, t, availableCharacterNameSet)
            && !getToolDuplicateWarning(card, card.parsedArgs, existingPinnedTexts, t)
            && !getToolMissingTargetError(
              card,
              card.parsedArgs,
              existingCharacterFileNames,
              existingWorldbuildingFileNames,
              t
            )
            && !getToolOverwriteWarning(
              card,
              card.parsedArgs,
              existingCharacterFileNames,
              existingWorldbuildingFileNames,
              t
            )
        );
        return (
          <div key={message.id} className="space-y-3">
            <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-full md:max-w-[90%] rounded-2xl px-4 py-3 shadow-subtle ${message.role === "user" ? "bg-accent/10 text-text" : "bg-surface/60 text-text"}`}>
                <div className="mb-2 flex items-center gap-2 text-xs text-text/45">
                  {message.role === "user" ? <User2 size={14} /> : <Bot size={14} />}
                  <span>{message.role === "user" ? t("settingsMode.userLabel") : t("settingsMode.assistantLabel")}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-text/85">{message.content}</p>
              </div>
            </div>

            {message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0 ? (
              <div className="space-y-3">
                {pendingToolCalls.length > 1 ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full sm:w-auto"
                      onClick={() => void onConfirmAll(message.id)}
                      disabled={confirmableToolCalls.length === 0 || hasAnyLoadingToolCall}
                    >
                      {t("settingsMode.confirmAll")}
                    </Button>
                    <Button variant="ghost" size="sm" className="w-full sm:w-auto" onClick={() => onSkipAll(message.id)} disabled={hasAnyLoadingToolCall}>
                      {t("settingsMode.skipAll")}
                    </Button>
                  </div>
                ) : null}

                {message.toolCalls.map((card) => (
                  <ToolCallCard
                    key={card.id}
                    card={card}
                    mode={mode}
                    t={t}
                    availableCharacterNames={availableCharacterNames}
                    existingCharacterFileNames={existingCharacterFileNames}
                    existingWorldbuildingFileNames={existingWorldbuildingFileNames}
                    existingPinnedTexts={existingPinnedTexts}
                    globalBusy={hasAnyLoadingToolCall}
                    onConfirm={(cardId, nextArgs) => onConfirmTool(message.id, cardId, nextArgs)}
                    onSkip={(cardId) => onSkipTool(message.id, cardId)}
                    onUndo={(cardId) => onUndoTool(message.id, cardId)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
