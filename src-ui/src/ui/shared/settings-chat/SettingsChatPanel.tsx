// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect } from "react";
import { Sparkles } from "lucide-react";
import type { SettingsChatSessionLlm } from "../../../api/engine-client";
import { useTranslation } from "../../../i18n/useAppTranslation";
import { SettingsChatHistory } from "./SettingsChatHistory";
import { SettingsChatInput } from "./SettingsChatInput";
import { useSettingsChatConversation } from "./useSettingsChatConversation";
import { useSettingsChatSupportData } from "./useSettingsChatSupportData";
import { useSettingsChatToolActions } from "./useSettingsChatToolActions";
import type { SettingsMode } from "./types";

interface SettingsChatPanelProps {
  mode: SettingsMode;
  basePath?: string;
  fandomPath?: string;
  placeholder: string;
  title?: string;
  compact?: boolean;
  currentChapter?: number;
  className?: string;
  sessionLlm?: SettingsChatSessionLlm | null;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onAfterMutation?: () => void | Promise<void>;
}

/**
 * SettingsChatPanel — 设定对话面板的编排层（长期债②第三块状态下沉后）。
 *
 * 状态住三个 hook：supportData（project / lore 支撑数据 + freshness 缓存）、
 * conversation（消息流 / 输入 / busy 全景）、toolActions（工具卡确认/跳过/
 * 撤销/批量）；工具执行 I/O 在 execute-settings-tool 纯模块。
 * 本组件只做 props 接线 + JSX。
 */
export function SettingsChatPanel({
  mode,
  basePath,
  fandomPath,
  placeholder,
  title,
  compact = false,
  currentChapter = 1,
  className = "",
  sessionLlm = null,
  disabled = false,
  onBusyChange,
  onAfterMutation,
}: SettingsChatPanelProps) {
  const { t } = useTranslation();

  const supportData = useSettingsChatSupportData(mode, basePath);
  const conversation = useSettingsChatConversation({ mode, basePath, fandomPath, sessionLlm, disabled });
  const toolActions = useSettingsChatToolActions({
    mode,
    basePath,
    currentChapter,
    disabled,
    onAfterMutation,
    conversation,
    supportData,
  });

  const { mutationBusy } = conversation;
  useEffect(() => {
    onBusyChange?.(mutationBusy);
  }, [mutationBusy, onBusyChange]);

  return (
    <div className={`flex h-full min-h-0 flex-col ${className}`}>
      {title ? (
        <div className="flex items-center gap-2 border-b border-black/10 px-4 py-3 text-sm font-semibold text-text dark:border-white/10">
          <Sparkles size={16} className="text-accent" />
          <span>{title}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        <SettingsChatHistory
          messages={conversation.messages}
          mode={mode}
          t={t}
          compact={compact}
          availableCharacterNames={supportData.availableCharacterNames}
          existingCharacterFileNames={supportData.existingCharacterFileNames}
          existingWorldbuildingFileNames={supportData.existingWorldbuildingFileNames}
          existingPinnedTexts={supportData.existingPinnedTexts}
          disabled={disabled || mutationBusy}
          availableCharacterNameSet={supportData.availableCharacterNameSet}
          onConfirmTool={toolActions.confirmTool}
          onSkipTool={toolActions.skipTool}
          onUndoTool={toolActions.undoTool}
          onConfirmAll={toolActions.confirmAllTools}
          onSkipAll={toolActions.skipAllTools}
        />
      </div>

      <SettingsChatInput
        value={conversation.inputText}
        onChange={conversation.setInputText}
        onSend={() => void conversation.sendMessage("instruction")}
        onLargeTextAction={(intent) => void conversation.sendMessage(intent)}
        placeholder={placeholder}
        sending={conversation.sending}
        compact={compact}
        disableSend={!basePath || disabled || mutationBusy}
        busyHint={conversation.hasLoadingCards ? t("settingsMode.toolActionBusy") : null}
        t={t}
      />
    </div>
  );
}
