// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * ChatSessionList — 对话页左侧会话列表（chat-sessions 底座）。
 *
 * 纯展示组件：状态与回调全经 props 注入（宿主 = SimpleChatPanel + useChatSessions）。
 * 组件内只持有纯 UI 瞬时态（重命名输入框、删除确认弹窗的开关），不碰业务状态。
 * 桌面侧栏（md 以下隐藏，移动端本次不适配）。
 */

import { useState } from "react";
import { Check, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import type { ChatSessionMeta } from "../../api/engine-client";
import { useTranslation } from "../../i18n/useAppTranslation";
import { ConfirmDialog } from "../shared/ConfirmDialog";

interface ChatSessionListProps {
  /** 会话列表加载失败标记（非空显示警告行） */
  loadError?: string | null;
  sessions: ChatSessionMeta[];
  activeId: string | null;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
  /** 根容器样式覆盖：默认桌面侧栏（md 以下隐藏）；移动端底栏弹层传全宽常显类。 */
  className?: string;
  /** 触屏没有 hover——移动端弹层里重命名/删除按钮常显。 */
  alwaysShowActions?: boolean;
}

export function ChatSessionList({
  sessions,
  activeId,
  loadError = null,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  className,
  alwaysShowActions = false,
}: ChatSessionListProps) {
  const { t } = useTranslation();
  /** 重命名内联编辑态：目标会话 id + 输入值（组件内瞬时 UI 态）。 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  /** 删除确认目标（ConfirmDialog 的开关态）。 */
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const commitRename = () => {
    if (editingId && editingValue.trim()) {
      onRename(editingId, editingValue);
    }
    setEditingId(null);
    setEditingValue("");
  };

  const pendingDelete = sessions.find((s) => s.id === pendingDeleteId);

  return (
    <aside className={className ?? "hidden w-52 shrink-0 flex-col border-r border-rule bg-surface md:flex"}>
      <div className="flex shrink-0 items-center justify-between border-b border-rule-soft px-3 py-2.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
          {t("chatSessions.listTitle", { defaultValue: "对话" })}
        </span>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex h-6 items-center gap-1 rounded-sm border border-gold px-1.5 text-[11px] text-accent transition-colors hover:bg-gold-soft focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-gold-bright"
          aria-label={t("chatSessions.new", { defaultValue: "新对话" })}
        >
          <Plus size={12} />
          <span className="font-serif">{t("chatSessions.new", { defaultValue: "新对话" })}</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {/* 加载失败警告（kimi R8 major）：此期间设定助手会话不持久化，必须让用户看见 */}
        {loadError ? (
          <p className="mx-1 mb-1 rounded-sm border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] leading-snug text-warning">
            {t("chatSessions.loadFailed", { defaultValue: "会话列表加载失败，当前对话不会被保存" })}
          </p>
        ) : null}
        {sessions.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-ink-faint">
            {t("chatSessions.empty", { defaultValue: "还没有对话" })}
          </p>
        ) : (
          sessions.map((s) => {
            const isActive = s.id === activeId;
            const isEditing = editingId === s.id;
            return (
              <div
                key={s.id}
                className={`group relative mb-0.5 rounded-sm border px-2.5 py-2 transition-colors ${
                  isActive ? "border-gold bg-gold-soft" : "border-transparent hover:bg-rule-soft"
                }`}
              >
                {isEditing ? (
                  <div className="flex items-center gap-1">
                    <input
                      // 内联重命名：Enter/blur 提交、Esc 取消
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        // IME 组词期间的 Enter 是选词不是提交（kimi R8 major，中文写手核心交互）
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) commitRename();
                        if (e.key === "Escape") {
                          setEditingId(null);
                          setEditingValue("");
                        }
                      }}
                      onBlur={commitRename}
                      placeholder={t("chatSessions.renamePlaceholder", { defaultValue: "对话名称" })}
                      className="min-w-0 flex-1 rounded-sm border border-gold bg-background px-1.5 py-0.5 text-[12.5px] text-text focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={commitRename}
                      aria-label={t("chatSessions.rename", { defaultValue: "重命名" })}
                      className="shrink-0 rounded-sm p-0.5 text-accent hover:bg-gold-soft"
                    >
                      <Check size={13} />
                    </button>
                  </div>
                ) : (
                  <>
                    <button type="button" onClick={() => onSelect(s.id)} className="block w-full text-left">
                      <span className="flex items-center gap-1.5">
                        <MessageSquare
                          size={12}
                          className={`shrink-0 ${isActive ? "text-accent" : "text-ink-faint"}`}
                        />
                        <span
                          className={`truncate text-[12.5px] ${isActive ? "font-semibold text-text" : "text-text/80"}`}
                        >
                          {/* title_auto 占位标题按界面语言显示（kimi R8 minor：仓储英文占位不外露） */}
                          {s.title_auto ? t("chatSessions.untitled") : s.title}
                        </span>
                      </span>
                      <span className="mt-0.5 block pl-[18px] font-mono text-[10px] text-ink-faint">
                        {t("chatSessions.messageCount", { count: s.message_count, defaultValue: "{{count}} 条" })}
                      </span>
                    </button>
                    {/* 行内操作：hover 浮现（桌面侧栏，无触屏常显诉求——REQ-140 的教训是
                        「唯一入口」须常显；这里重命名/删除在全局会话管理页也有入口） */}
                    <span
                      className={`absolute right-1.5 top-1.5 gap-0.5 ${alwaysShowActions ? "flex" : "hidden group-hover:flex"}`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(s.id);
                          // title_auto 会话预填空（placeholder 显示本地化 untitled）——
                          // 预填英文占位的话，用户未改一字就提交会把 "Session" 固化成显式标题（kimi R10）
                          setEditingValue(s.title_auto ? "" : s.title);
                        }}
                        aria-label={t("chatSessions.rename", { defaultValue: "重命名" })}
                        title={t("chatSessions.rename", { defaultValue: "重命名" })}
                        className="rounded-sm p-0.5 text-ink-muted transition-colors hover:bg-rule-soft hover:text-text"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteId(s.id)}
                        aria-label={t("chatSessions.delete", { defaultValue: "删除对话" })}
                        title={t("chatSessions.delete", { defaultValue: "删除对话" })}
                        className="rounded-sm p-0.5 text-ink-muted transition-colors hover:bg-rule-soft hover:text-error"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      <ConfirmDialog
        isOpen={pendingDeleteId !== null}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId) onDelete(pendingDeleteId);
          setPendingDeleteId(null);
        }}
        title={t("chatSessions.deleteTitle", { defaultValue: "删除对话" })}
        message={t("chatSessions.deleteConfirm", {
          title: pendingDelete?.title ?? "",
          defaultValue: "删除「{{title}}」？该对话的所有消息将一并删除，不可撤销。",
        })}
        destructive
      />
    </aside>
  );
}
