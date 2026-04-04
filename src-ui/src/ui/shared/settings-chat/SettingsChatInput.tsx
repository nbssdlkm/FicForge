import { useState } from "react";
import { Loader2, ChevronsDown, ChevronsUp } from "lucide-react";
import { Button } from "../Button";
import { Textarea } from "../Input";
import type { LargeTextIntent } from "./types";

interface SettingsChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onLargeTextAction: (intent: LargeTextIntent) => void;
  placeholder: string;
  sending: boolean;
  compact?: boolean;
  disableSend?: boolean;
  busyHint?: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}

const LARGE_TEXT_THRESHOLD = 500;

export function SettingsChatInput({
  value,
  onChange,
  onSend,
  onLargeTextAction,
  placeholder,
  sending,
  compact = false,
  disableSend = false,
  busyHint = null,
  t,
}: SettingsChatInputProps) {
  const [collapsed, setCollapsed] = useState(false);
  const trimmed = value.trim();
  const showLargeTextPrompt = trimmed.length > LARGE_TEXT_THRESHOLD;
  const canSendNormally = !disableSend && !sending && trimmed.length > 0 && !showLargeTextPrompt;

  return (
    <div className="border-t border-black/10 bg-surface/45 dark:border-white/10 flex flex-col">
      <button
        className="mx-auto flex items-center gap-1 px-4 py-1 text-[10px] text-text/40 hover:text-text/60 transition-colors"
        onClick={() => setCollapsed(prev => !prev)}
      >
        {collapsed ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
        {collapsed ? t("writer.expandToolbar") : t("writer.collapseToolbar")}
      </button>

      {collapsed ? (
        <div className="flex items-center justify-center gap-3 pb-2">
          <Button variant="primary" size="sm" onClick={() => setCollapsed(false)} className="min-w-[112px]">
            {t("settingsMode.send")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3 p-4 pt-0">
          {showLargeTextPrompt ? (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              <p className="mb-3 font-medium">{t("settingsMode.largeTextDetected")}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => onLargeTextAction("character")} disabled={sending || disableSend}>
                  {t("settingsMode.importAsCharacter")}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onLargeTextAction("worldbuilding")} disabled={sending || disableSend}>
                  {t("settingsMode.importAsWorldbuilding")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onLargeTextAction("instruction")} disabled={sending || disableSend}>
                  {t("settingsMode.sendAsInstruction")}
                </Button>
              </div>
            </div>
          ) : null}

          <div className={`flex ${compact ? "flex-col" : "flex-col"} gap-3`}>
            <Textarea
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={placeholder}
              disabled={sending || disableSend}
              className={`resize-none ${compact ? "min-h-[110px]" : "min-h-[128px]"} bg-background/80`}
            />
            <div className="flex items-center justify-end">
              <Button variant="primary" onClick={onSend} disabled={!canSendNormally} className={compact ? "w-full" : "min-w-[112px]"}>
                {sending ? <Loader2 size={16} className="animate-spin" /> : t("settingsMode.send")}
              </Button>
            </div>
            {busyHint ? (
              <p className="text-xs text-text/50">{busyHint}</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
