// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { useCallback, useRef } from "react";
import { Send, X } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { Button } from "../shared/Button";

interface SimpleChatInputProps {
  /** textarea 受控值。受控绑定。 */
  value: string;
  /** textarea 的 onChange 用 setter；为受控组件双向绑定，符合 hook 铁律例外。 */
  onChange: (value: string) => void;
  /** 发送（Enter / 按钮）。父级负责清空 value。 */
  onSend: () => void;
  /** 正在生成 / 取消按钮（生成中可中断）。 */
  isStreaming: boolean;
  onCancelStreaming: () => void;
  /** 全局 busy（流式 + 工具执行）禁用 send 按钮，但允许编辑文本。 */
  busy: boolean;
  placeholder?: string;
}

export function SimpleChatInput({
  value,
  onChange,
  onSend,
  isStreaming,
  onCancelStreaming,
  busy,
  placeholder,
}: SimpleChatInputProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (value.trim() && !busy) {
          onSend();
        }
      }
    },
    [value, busy, onSend],
  );

  const sendDisabled = !value.trim() || busy;
  const inputPlaceholder =
    placeholder ??
    t("simple.input.placeholder", { defaultValue: "写续集 / 改设定 / 看历史章节…按 Enter 发送，Shift+Enter 换行" });

  return (
    <div className="border-t border-rule bg-surface/50 px-4 py-3 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={inputPlaceholder}
          rows={2}
          className="min-h-[3rem] flex-1 resize-none rounded-sm border border-rule bg-background px-3 py-2 font-serif text-[13px] leading-relaxed text-text placeholder:text-ink-faint outline-hidden transition-colors focus:border-gold-bright/60 focus:ring-1 focus:ring-gold-bright/40"
          disabled={busy && !isStreaming}
        />
        {isStreaming ? (
          <Button
            tone="destructive"
            fill="solid"
            size="sm"
            onClick={onCancelStreaming}
            className="font-sans text-[11px] uppercase tracking-[0.08em]"
          >
            <X size={12} className="mr-1" />
            {t("simple.input.cancel", { defaultValue: "取消" })}
          </Button>
        ) : (
          <Button
            tone="accent"
            fill="solid"
            size="sm"
            onClick={onSend}
            disabled={sendDisabled}
            className="font-sans text-[11px] uppercase tracking-[0.08em]"
          >
            <Send size={12} className="mr-1" />
            {t("simple.input.send", { defaultValue: "发送" })}
          </Button>
        )}
      </div>
    </div>
  );
}
