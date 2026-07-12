// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { useCallback, useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { BookOpen, FileText, Info, Pencil, PenSquare } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import type { SimpleChatMessage } from "./types";
import { UserMessage } from "./messages/UserMessage";
import { AssistantMessage } from "./messages/AssistantMessage";
import { SystemMessage } from "./messages/SystemMessage";
import { WritingDraftCard } from "./messages/WritingDraftCard";
import { ToolCallCard } from "./messages/ToolCallCard";
import { ChapterPreviewCard } from "./messages/ChapterPreviewCard";
import { SettingPreviewCard } from "./messages/SettingPreviewCard";

interface SimpleChatHistoryProps {
  messages: SimpleChatMessage[];
  auPath: string;
  fandomPath?: string;
  isStreaming: boolean;
  /** 全局 busy（streaming + tool 执行中），统一禁用工具卡片按钮。 */
  globalBusy: boolean;
  /**
   * Transient "AI 思考中…" 占位是否显示。**不**进 chat.messages（避免 persist
   * 到 chat.yaml 后切 tab / 重启时残留卡死，问题 #切 tab thinking 卡死）。
   */
  thinkingActive: boolean;
  /** 面板常驻挂载后，display:none 期间 scrollTop 赋值无效；重新可见时若用户
   * 原本贴底，需要主动重新贴底（对抗审 A-3）。 */
  isActiveTab?: boolean;
  onAcceptDraft: (messageId: string) => void;
  onRegenerateDraft: (messageId: string) => void;
  onDiscardDraft: (messageId: string) => void;
  onConfirmTool: (messageId: string) => void;
  onSkipTool: (messageId: string) => void;
  onUndoTool: (messageId: string) => void;
  onTogglePreview: (messageId: string) => void;
}

function ExampleHint({ icon: Icon, kind, label }: { icon: LucideIcon; kind: string; label: string }) {
  return (
    <div className="flex items-start gap-3 rounded-sm border border-rule bg-surface px-4 py-3 transition-colors hover:border-gold-bright/60">
      <Icon size={14} className="mt-0.5 shrink-0 text-accent" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright">{kind}</span>
        <span className="font-serif text-[13px] leading-relaxed text-text/85">{label}</span>
      </div>
    </div>
  );
}

export function SimpleChatHistory({
  messages,
  auPath,
  fandomPath,
  isStreaming,
  globalBusy,
  thinkingActive,
  isActiveTab,
  onAcceptDraft,
  onRegenerateDraft,
  onDiscardDraft,
  onConfirmTool,
  onSkipTool,
  onUndoTool,
  onTogglePreview,
}: SimpleChatHistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSignatureRef = useRef("");
  // 用户是否"贴底"：true 时新内容自动滚到底；false 表示用户已向上翻看历史，
  // 流式新 chunk 不强行拉回底部（解决 V1 真机：流式期间向上滑想看历史被 smooth
  // scroll 抢回底部 → 屏幕"上下卡"）。初始 true（首次进入或 AU 切换默认贴底）。
  const isPinnedRef = useRef(true);
  // 程序触发 scroll 的"静默窗口"末时刻 (performance.now())。窗口内的 onScroll
  // 视为程序触发不更新 isPinned。用 timestamp 替代 boolean flag 防两类 race（V1
  // Review V1-A P0-2）：(a) scrollTop 赋值在已贴底时浏览器**不发 scroll event**
  // → boolean flag 永远停 true → 后续用户真滚动被吞；(b) 浏览器异步多发 scroll
  // event → boolean flag 只 swallow 第一次 → 后续被错认为用户滚动。300ms 窗口
  // 远大于浏览器 scroll event 同帧 latency 但远小于人手指反应（200ms+）。
  // 扩大至 300ms 是因为低端 Android WebView 主线程 busy 时 scroll event 延迟可达
  // 150-300ms，100ms 窗口会错判为用户操作 → isPinned 被误设 false → 流式不再贴底。
  const programmaticUntilRef = useRef(0);
  const PROGRAMMATIC_WINDOW_MS = 300;
  // 动态行高：移动端大字号（24px+）下 50px 仅 ~2 行，用户稍滑就被判离开底部。
  // mount + AU 切换时从 scroll 容器的 computed style 读取真实行高，2 行以内算贴底。
  const lineHeightRef = useRef(50);

  const handleScroll = useCallback(() => {
    if (performance.now() < programmaticUntilRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    isPinnedRef.current = dist < Math.max(50, lineHeightRef.current * 2);
  }, []);

  // AU 切换 reset：滚动状态绑组件实例（refs 跨 AU 不会自动 reset），新 AU 默认
  // 贴底让首次 chat history load 完成自动滚到底（Review V1-A/B 共识 P0-1：
  // AU A 滑到上面后切 AU B，新 AU 加载完不 auto-scroll → broken）。
  useEffect(() => {
    isPinnedRef.current = true;
    lastSignatureRef.current = "";
    programmaticUntilRef.current = 0;
    lineHeightRef.current = 50;
  }, [auPath]);

  // 读取 scroll 容器的真实行高，用于 isPinned 动态阈值（移动端大字号适配）。
  // parseFloat 对 "normal" / 百分比 / em 等非 px 值返回 NaN → fallback 50。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const lh = getComputedStyle(el).lineHeight;
    const px = parseFloat(lh);
    lineHeightRef.current = Number.isFinite(px) && px > 0 ? px : 50;
  }, [auPath]);

  // 流式期 / 新消息进入时滚到底；用户手动滚到上方时不强行回拉。
  // 策略：last message 的 id+content 长度变化（或 thinking 切换）作为 signature；
  // signature 变 + 用户仍贴底 → instant scrollTop 赋值（不用 smooth animation
  // 避免跟用户手势抢同一 scrollTop）。
  useEffect(() => {
    const last = messages[messages.length - 1];
    const signature = last
      ? `${last.id}:${"content" in last ? last.content.length : 0}:${thinkingActive ? "T" : ""}`
      : `EMPTY:${thinkingActive ? "T" : ""}`;
    if (signature === lastSignatureRef.current) return;
    lastSignatureRef.current = signature;
    if (!isPinnedRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    programmaticUntilRef.current = performance.now() + PROGRAMMATIC_WINDOW_MS;
    el.scrollTop = el.scrollHeight;
  }, [messages, thinkingActive]);

  // 从隐藏 tab 切回时重新贴底（对抗审 A-3）：display:none 期间 scrollHeight=0、
  // 上面 effect 的贴底动作全部无效；若用户离开前贴底（isPinned），回来应回到底部
  // 而不是停在历史顶部。用户离开前主动滚上去看历史的（isPinned=false）不打扰。
  useEffect(() => {
    if (isActiveTab !== true) return;
    if (!isPinnedRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    programmaticUntilRef.current = performance.now() + PROGRAMMATIC_WINDOW_MS;
    el.scrollTop = el.scrollHeight;
  }, [isActiveTab]);

  const { t } = useTranslation();

  if (messages.length === 0) {
    return (
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex h-full items-center justify-center overflow-y-auto px-4 py-12"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-8 text-center">
          <div className="flex flex-col items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold-bright">
              {t("simple.history.eyebrow", { defaultValue: "§ Dialogue · Quill" })}
            </span>
            <h2 className="font-display text-3xl font-medium uppercase leading-[1.1] tracking-[0.04em] text-accent [.theme-night_&]:text-inv-text md:text-[36px]">
              {t("simple.history.emptyTitle", { defaultValue: "Quill at the ready" })}
            </h2>
            <p className="font-serif text-[13px] font-normal tracking-[0.04em] text-ink-muted">
              {t("simple.history.emptySubtitle", { defaultValue: "跟 AI 对话开始写文" })}
            </p>
          </div>
          <div className="grid w-full max-w-md grid-cols-1 gap-2 text-left">
            <ExampleHint
              icon={PenSquare}
              kind={t("simple.history.exampleKind.write", { defaultValue: "Compose" })}
              label={t("simple.history.example1", { defaultValue: "写第一章 主角进酒馆，遇到神秘的剑客" })}
            />
            <ExampleHint
              icon={BookOpen}
              kind={t("simple.history.exampleKind.read", { defaultValue: "Inspect" })}
              label={t("simple.history.example2", { defaultValue: "看一下第 2 章" })}
            />
            <ExampleHint
              icon={FileText}
              kind={t("simple.history.exampleKind.lore", { defaultValue: "Lore" })}
              label={t("simple.history.example3", { defaultValue: "看 characters/Alice.md" })}
            />
            <ExampleHint
              icon={Pencil}
              kind={t("simple.history.exampleKind.amend", { defaultValue: "Amend" })}
              label={t("simple.history.example4", { defaultValue: "把 Alice 的发色改成银色" })}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto px-4 py-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {messages.map((message) => {
          switch (message.kind) {
            case "user":
              return <UserMessage key={message.id} message={message} />;
            case "assistant":
              return <AssistantMessage key={message.id} message={message} />;
            case "system":
              return <SystemMessage key={message.id} message={message} />;
            case "writing-draft":
              return (
                <WritingDraftCard
                  key={message.id}
                  message={message}
                  isStreaming={isStreaming}
                  onAccept={onAcceptDraft}
                  onRegenerate={onRegenerateDraft}
                  onDiscard={onDiscardDraft}
                />
              );
            case "tool-call":
              return (
                <ToolCallCard
                  key={message.id}
                  message={message}
                  globalBusy={globalBusy}
                  onConfirm={onConfirmTool}
                  onSkip={onSkipTool}
                  onUndo={onUndoTool}
                />
              );
            case "chapter-preview":
              return (
                <ChapterPreviewCard
                  key={message.id}
                  message={message}
                  auPath={auPath}
                  onToggleExpanded={onTogglePreview}
                />
              );
            case "setting-preview":
              return (
                <SettingPreviewCard
                  key={message.id}
                  message={message}
                  auPath={auPath}
                  fandomPath={fandomPath}
                  onToggleExpanded={onTogglePreview}
                />
              );
            case "tool-result":
              // agent loop 自动 fetch 的 tool 结果不直接渲染：read-only tool 的内容
              // 已在对应 chapter-preview / setting-preview card 里展示，避免重复噪音。
              // 仍留在 messages 数组里供 chat-to-llm 转换把 tool result 喂回 LLM。
              return null;
            default: {
              // 类型 exhaustive 检查（编译期保证全分支覆盖）
              const _exhaustive: never = message;
              void _exhaustive;
              return null;
            }
          }
        })}
        {thinkingActive && (
          <div className="flex justify-center">
            <div className="flex items-start gap-2 rounded-sm border border-info/30 bg-info/8 px-3 py-2 font-serif text-xs leading-relaxed text-info">
              <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{t("simple.thinking.label", { defaultValue: "AI 思考中…" })}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
