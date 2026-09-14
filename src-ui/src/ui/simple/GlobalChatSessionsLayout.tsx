// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * GlobalChatSessionsLayout — 全局会话管理页（chat-sessions 底座）。
 *
 * 跨 fandom / AU 枚举所有对话会话：分组列表 + 标题搜索 + 改名 / 删除 +
 * 点击跳回所属 AU 的对话页。会话只读面按「fandom → AU → sessions」三级铺开，
 * 数据链：listFandoms（含 aus）→ listChatSessions(auPath)。
 *
 * 状态与 reset 同文件（useGlobalChatSessions 住本文件）；布局组件只做 JSX 编排。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, MessageSquare, Pencil, Search, Trash2 } from "lucide-react";
import {
  deleteChatSession,
  getDataDir,
  listChatSessions,
  listFandoms,
  renameChatSession,
  type ChatSessionMeta,
} from "../../api/engine-client";
import { useTranslation } from "../../i18n/useAppTranslation";
import { FeedbackProvider, useFeedback } from "../../hooks/useFeedback";
import { logUiError } from "../../utils/ui-logger";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { Spinner } from "../shared/Spinner";

/** 一行 = 一个会话，携带跳转所需的上下文。 */
export interface GlobalSessionRow {
  fandomName: string;
  auName: string;
  auPath: string;
  session: ChatSessionMeta;
}

interface GlobalChatSessionsLayoutProps {
  onNavigate: (page: string, contextPath?: string) => void;
}

function useGlobalChatSessions() {
  const [rows, setRows] = useState<GlobalSessionRow[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoaded(false);
    setLoadError(null);
    try {
      const dataDir = getDataDir();
      const fandoms = await listFandoms();
      const next: GlobalSessionRow[] = [];
      // fandom 间串行、AU 间串行：会话枚举是页级一次性扫描，量小（每 AU 一次
      // 索引文件读），串行换取三端文件系统行为一致、零并发坑。
      for (const fandom of fandoms) {
        for (const au of fandom.aus) {
          const auPath = `${dataDir}/fandoms/${fandom.dir_name}/aus/${au.dir_name}`;
          try {
            const sessions = await listChatSessions(auPath);
            for (const session of sessions) {
              next.push({ fandomName: fandom.name, auName: au.name, auPath, session });
            }
          } catch (err) {
            // 单 AU 索引损坏不拖垮整页：跳过该 AU，其余照列
            logUiError("globalChatSessions", `list sessions failed for ${auPath}`, err);
          }
        }
      }
      setRows(next);
      setIsLoaded(true);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const removeRow = useCallback(async (row: GlobalSessionRow) => {
    await deleteChatSession(row.auPath, row.session.id);
    setRows((prev) => prev.filter((r) => !(r.auPath === row.auPath && r.session.id === row.session.id)));
  }, []);

  const renameRow = useCallback(async (row: GlobalSessionRow, title: string) => {
    await renameChatSession(row.auPath, row.session.id, title);
    const trimmed = title.trim();
    setRows((prev) =>
      prev.map((r) => (r.auPath === row.auPath && r.session.id === row.session.id ? { ...r, session: { ...r.session, title: trimmed } } : r)),
    );
  }, []);

  return { rows, isLoaded, loadError, reload: load, removeRow, renameRow };
}

/** useFeedback 必须挂在 Provider 下（App 直接挂载本页，与 Library 同款包法）。 */
export function GlobalChatSessionsLayout(props: GlobalChatSessionsLayoutProps) {
  return (
    <FeedbackProvider>
      <GlobalChatSessionsInner {...props} />
    </FeedbackProvider>
  );
}

function GlobalChatSessionsInner({ onNavigate }: GlobalChatSessionsLayoutProps) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const { rows, isLoaded, loadError, removeRow, renameRow } = useGlobalChatSessions();
  const [query, setQuery] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<GlobalSessionRow | null>(null);

  const rowKey = (r: GlobalSessionRow) => `${r.auPath}::${r.session.id}`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.session.title.toLowerCase().includes(q) ||
        r.auName.toLowerCase().includes(q) ||
        r.fandomName.toLowerCase().includes(q),
    );
  }, [rows, query]);

  /** fandom → AU 分组（保持 filtered 内首次出现顺序 = 数据加载顺序）。 */
  const groups = useMemo(() => {
    const out: { label: string; rows: GlobalSessionRow[] }[] = [];
    for (const r of filtered) {
      const label = `${r.fandomName} / ${r.auName}`;
      const g = out[out.length - 1];
      if (g && g.label === label) g.rows.push(r);
      else out.push({ label, rows: [r] });
    }
    return out;
  }, [filtered]);

  const commitRename = (row: GlobalSessionRow) => {
    if (editingValue.trim()) {
      void renameRow(row, editingValue).catch((err) => showError(err instanceof Error ? err.message : String(err)));
    }
    setEditingKey(null);
    setEditingValue("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-rule bg-surface px-4 py-3 md:px-6">
        <button
          type="button"
          onClick={() => onNavigate("library")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-rule-soft hover:text-text"
          aria-label={t("common.actions.back", { defaultValue: "返回" })}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0">
          <h1 className="font-display text-lg font-medium tracking-[0.04em] text-accent">
            {t("chatSessions.globalTitle", { defaultValue: "会话管理" })}
          </h1>
          <p className="truncate font-serif text-[11.5px] text-ink-muted">
            {t("chatSessions.globalSubtitle", { defaultValue: "所有作品与 fandom 的 AI 对话都在这里。" })}
          </p>
        </div>
        <div className="relative ml-auto w-44 md:w-64">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("chatSessions.searchPlaceholder", { defaultValue: "搜索对话标题…" })}
            className="w-full rounded-sm border border-rule bg-background py-1.5 pl-8 pr-2 text-[12.5px] text-text placeholder:text-ink-faint focus:border-gold focus:outline-hidden"
          />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
        {!isLoaded ? (
          <div className="flex items-center justify-center py-20 text-ink-muted">
            <Spinner size="lg" className="text-accent" />
          </div>
        ) : loadError ? (
          <p className="py-20 text-center text-[13px] text-error">{loadError}</p>
        ) : groups.length === 0 ? (
          <p className="py-20 text-center text-[13px] text-ink-faint">
            {t("chatSessions.empty", { defaultValue: "还没有对话" })}
          </p>
        ) : (
          <div className="mx-auto w-full max-w-3xl">
            {groups.map((g) => (
              <section key={g.label} className="mb-5">
                <h2 className="mb-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
                  <span>{g.label}</span>
                  <span className="text-ink-faint">
                    {t("chatSessions.groupCount", { count: g.rows.length, defaultValue: "{{count}} 个会话" })}
                  </span>
                  <span className="flex-1 border-t border-rule-soft" aria-hidden="true" />
                </h2>
                {g.rows.map((r) => {
                  const key = rowKey(r);
                  const isEditing = editingKey === key;
                  return (
                    <div
                      key={key}
                      className="group mb-1 flex items-center gap-2 rounded-sm border border-rule bg-surface px-3 py-2.5 transition-colors hover:border-gold"
                    >
                      {isEditing ? (
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <input
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename(r);
                              if (e.key === "Escape") {
                                setEditingKey(null);
                                setEditingValue("");
                              }
                            }}
                            onBlur={() => commitRename(r)}
                            placeholder={t("chatSessions.renamePlaceholder", { defaultValue: "对话名称" })}
                            className="min-w-0 flex-1 rounded-sm border border-gold bg-background px-1.5 py-0.5 text-[12.5px] text-text focus:outline-hidden"
                          />
                          <button
                            type="button"
                            onClick={() => commitRename(r)}
                            aria-label={t("chatSessions.rename", { defaultValue: "重命名" })}
                            className="shrink-0 rounded-sm p-0.5 text-accent hover:bg-gold-soft"
                          >
                            <Check size={13} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onNavigate("chat", r.auPath)}
                            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                          >
                            <MessageSquare size={14} className="shrink-0 text-ink-faint" />
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-semibold text-text">{r.session.title}</span>
                              <span className="block font-mono text-[10px] text-ink-faint">
                                {t("chatSessions.messageCount", {
                                  count: r.session.message_count,
                                  defaultValue: "{{count}} 条",
                                })}
                                {" · "}
                                {r.session.updated_at.slice(0, 10)}
                              </span>
                            </span>
                          </button>
                          <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingKey(key);
                                setEditingValue(r.session.title);
                              }}
                              aria-label={t("chatSessions.rename", { defaultValue: "重命名" })}
                              className="rounded-sm p-1 text-ink-muted transition-colors hover:bg-rule-soft hover:text-text"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDelete(r)}
                              aria-label={t("chatSessions.delete", { defaultValue: "删除对话" })}
                              className="rounded-sm p-1 text-ink-muted transition-colors hover:bg-rule-soft hover:text-error"
                            >
                              <Trash2 size={13} />
                            </button>
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </main>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            void removeRow(pendingDelete).catch((err) => showError(err instanceof Error ? err.message : String(err)));
          }
          setPendingDelete(null);
        }}
        title={t("chatSessions.deleteTitle", { defaultValue: "删除对话" })}
        message={t("chatSessions.deleteConfirm", {
          title: pendingDelete?.session.title ?? "",
          defaultValue: "删除「{{title}}」？该对话的所有消息将一并删除，不可撤销。",
        })}
        destructive
      />
    </div>
  );
}
