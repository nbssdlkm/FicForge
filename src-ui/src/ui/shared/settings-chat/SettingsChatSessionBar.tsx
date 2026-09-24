// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * SettingsChatSessionBar — 设定助手面板的会话切换条。
 *
 * 设定助手面板普遍很窄（fandom 页右侧 320px、移动端全宽但寸土寸金），
 * 放不下常驻侧栏，所以是「当前会话条 + 点击展开内联列表」的折叠形态。
 * 列表复用 ChatSessionList（全宽覆盖样式 + 触屏操作按钮常显）。
 *
 * 组件本地只持有「展开与否」纯 UI 态；宿主经 key={contextPath} 强制重挂载，
 * 切上下文自然收起，无需 reset effect。
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, MessageSquare, Plus } from "lucide-react";
import type { ChatSessionMeta } from "../../../api/engine-client";
import { useTranslation } from "../../../i18n/useAppTranslation";
import { ChatSessionList } from "../../simple/ChatSessionList";

interface SettingsChatSessionBarProps {
  sessions: ChatSessionMeta[];
  activeId: string | null;
  /** 会话列表加载失败标记（非空显示警告——此期间对话不持久化） */
  loadError?: string | null;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
}

export function SettingsChatSessionBar({
  sessions,
  loadError = null,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: SettingsChatSessionBarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const active = sessions.find((s) => s.id === activeId);
  // title_auto 占位标题按界面语言显示（kimi R8 minor）
  const activeTitle =
    (active ? (active.title_auto ? t("chatSessions.untitled") : active.title) : null) ??
    t("chatSessions.listTitle", { defaultValue: "对话" });

  return (
    <div className="shrink-0 border-b border-black/10 dark:border-white/10">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-[12px] text-text/80 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        >
          <MessageSquare size={12} className="shrink-0 text-accent" />
          <span className="truncate">{activeTitle}</span>
          {open ? (
            <ChevronUp size={12} className="shrink-0 text-text/50" />
          ) : (
            <ChevronDown size={12} className="shrink-0 text-text/50" />
          )}
        </button>
        <button
          type="button"
          onClick={onCreate}
          aria-label={t("chatSessions.new", { defaultValue: "新对话" })}
          title={t("chatSessions.new", { defaultValue: "新对话" })}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-accent transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        >
          <Plus size={14} />
        </button>
      </div>
      {/* 加载失败警告（kimi R8 major）：此期间对话不持久化，常显（不随展开状态隐藏） */}
      {loadError ? (
        <p className="mx-2 mb-1.5 rounded-sm border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] leading-snug text-warning">
          {t("chatSessions.loadFailed", { defaultValue: "会话列表加载失败，当前对话不会被保存" })}
        </p>
      ) : null}
      {open ? (
        <ChatSessionList
          sessions={sessions}
          activeId={activeId}
          loadError={loadError}
          onSelect={(id) => {
            onSelect(id);
            setOpen(false);
          }}
          onCreate={onCreate}
          onRename={onRename}
          onDelete={onDelete}
          className="flex max-h-64 w-full flex-col border-t border-black/10 bg-surface dark:border-white/10"
          alwaysShowActions
        />
      ) : null}
    </div>
  );
}
