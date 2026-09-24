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
  deleteSettingsChatSession,
  getDataDir,
  listChatSessions,
  listFandoms,
  listSettingsChatSessions,
  renameChatSession,
  renameSettingsChatSession,
  type ChatSessionMeta,
} from "../../api/engine-client";
import { useTranslation } from "../../i18n/useAppTranslation";
import { FeedbackProvider, useFeedback } from "../../hooks/useFeedback";
import { logUiError } from "../../utils/ui-logger";
import { markPendingSessionSelection } from "./pendingSessionSelection";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { Spinner } from "../shared/Spinner";

/** 会话归属：chat = AU 对话 tab；au_settings = AU 设定助手；fandom_settings = fandom 助手。 */
export type GlobalSessionKind = "chat" | "au_settings" | "fandom_settings";

/** 一行 = 一个会话，携带跳转所需的上下文。 */
export interface GlobalSessionRow {
  kind: GlobalSessionKind;
  fandomName: string;
  /** fandom 级会话（fandom_settings）为空串。 */
  auName: string;
  /** chat / au_settings = auPath；fandom_settings = fandomPath。 */
  contextPath: string;
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
      // fandom 间串行、AU 间串行：会话枚举是页级一次性扫描，量小（每上下文一次
      // 索引文件读），串行换取三端文件系统行为一致、零并发坑。
      for (const fandom of fandoms) {
        const fandomPath = `${dataDir}/fandoms/${fandom.dir_name}`;
        // fandom 助手会话（fandom 级）
        try {
          const fandomSessions = await listSettingsChatSessions(fandomPath);
          for (const session of fandomSessions) {
            next.push({
              kind: "fandom_settings",
              fandomName: fandom.name,
              auName: "",
              contextPath: fandomPath,
              session,
            });
          }
        } catch (err) {
          logUiError("globalChatSessions", `list settings sessions failed for ${fandomPath}`, err);
        }
        for (const au of fandom.aus) {
          const auPath = `${fandomPath}/aus/${au.dir_name}`;
          // 对话 tab 会话
          try {
            const sessions = await listChatSessions(auPath);
            for (const session of sessions) {
              next.push({ kind: "chat", fandomName: fandom.name, auName: au.name, contextPath: auPath, session });
            }
          } catch (err) {
            // 单 AU 索引损坏不拖垮整页：跳过该 AU，其余照列
            logUiError("globalChatSessions", `list sessions failed for ${auPath}`, err);
          }
          // AU 设定助手会话
          try {
            const settingsSessions = await listSettingsChatSessions(auPath);
            for (const session of settingsSessions) {
              next.push({
                kind: "au_settings",
                fandomName: fandom.name,
                auName: au.name,
                contextPath: auPath,
                session,
              });
            }
          } catch (err) {
            logUiError("globalChatSessions", `list settings sessions failed for ${auPath}`, err);
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
    if (row.kind === "chat") {
      await deleteChatSession(row.contextPath, row.session.id);
    } else {
      await deleteSettingsChatSession(row.contextPath, row.session.id);
    }
    setRows((prev) =>
      prev.filter(
        (r) => !(r.kind === row.kind && r.contextPath === row.contextPath && r.session.id === row.session.id),
      ),
    );
  }, []);

  const renameRow = useCallback(async (row: GlobalSessionRow, title: string) => {
    if (row.kind === "chat") {
      await renameChatSession(row.contextPath, row.session.id, title);
    } else {
      await renameSettingsChatSession(row.contextPath, row.session.id, title);
    }
    const trimmed = title.trim();
    setRows((prev) =>
      prev.map((r) =>
        r.kind === row.kind && r.contextPath === row.contextPath && r.session.id === row.session.id
          ? // 显式改名后清 title_auto（kimi R11 minor：不清则该行仍显示「新对话」占位直至重载）
            { ...r, session: { ...r.session, title: trimmed, title_auto: undefined } }
          : r,
      ),
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

  const rowKey = (r: GlobalSessionRow) => `${r.kind}::${r.contextPath}::${r.session.id}`;

  /** 点击跳转落点：对话 tab / AU 设定页 / fandom 资料页。 */
  const navigateTarget = (r: GlobalSessionRow): string =>
    r.kind === "chat" ? "chat" : r.kind === "au_settings" ? "settings" : "fandom_lore";

  const kindLabel = (r: GlobalSessionRow): string =>
    r.kind === "chat"
      ? t("chatSessions.kind.chat", { defaultValue: "对话" })
      : r.kind === "au_settings"
        ? t("chatSessions.kind.settings", { defaultValue: "设定助手" })
        : t("chatSessions.kind.fandom", { defaultValue: "Fandom 助手" });

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
      const label = r.auName ? `${r.fandomName} / ${r.auName}` : r.fandomName;
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
                              // IME 组词期间的 Enter 是选词不是提交（kimi R8/R9 major）
                              if (e.key === "Enter" && !e.nativeEvent.isComposing) commitRename(r);
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
                            onClick={() => {
                              // 登记「打开指定会话」接力（kimi R8 major）：目标页默认选最新会话，
                              // 不登记会落到别的对话里
                              markPendingSessionSelection(
                                r.kind === "chat" ? "chat" : "settings",
                                r.contextPath,
                                r.session.id,
                              );
                              onNavigate(navigateTarget(r), r.contextPath);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                          >
                            <MessageSquare size={14} className="shrink-0 text-ink-faint" />
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[13px] font-semibold text-text">
                                  {r.session.title_auto ? t("chatSessions.untitled") : r.session.title}
                                </span>
                                <span className="shrink-0 rounded-sm border border-rule-soft px-1 py-px font-mono text-[9px] uppercase tracking-[0.06em] text-ink-muted">
                                  {kindLabel(r)}
                                </span>
                              </span>
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
                                // title_auto 会话预填空（kimi R10：防英文占位被固化成显式标题）
                                setEditingValue(r.session.title_auto ? "" : r.session.title);
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
