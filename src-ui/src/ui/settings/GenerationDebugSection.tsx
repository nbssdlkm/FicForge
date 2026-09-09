// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 生成调试面板（开发者模式观测面，spec 2026-09-08）。
 *
 * 展示引擎捕获的最近 10 次生成调试包：完整 prompt 消息序列（start/final 分组）、
 * 分层 token 预算、RAG 命中明细、结果统计或错误。数据只驻内存（引擎环形缓冲），
 * 不落盘；「复制全部」把整包 JSON 进剪贴板。
 *
 * 仅 developer_mode 开时由 GlobalSettingsModal 挂载渲染。
 */

import { useCallback, useState } from "react";
import { ChevronDown, ChevronRight, Copy, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "../shared/Button";
import { useTranslation } from "../../i18n/useAppTranslation";
import { useFeedback } from "../../hooks/useFeedback";
import {
  clearDebugBundles,
  getDebugBundle,
  listDebugBundles,
  type DebugBundleMeta,
  type GenerationDebugBundle,
} from "../../api/engine-client";
import { RagChunkItem } from "../writer/ContextSummaryBar";

function statusLabel(meta: DebugBundleMeta, t: (k: string) => string): string {
  if (meta.status === "ok") return t("settings.genDebug.statusOk");
  if (meta.status === "error") return t("settings.genDebug.statusError");
  return t("settings.genDebug.statusUnknown");
}

function BudgetTable({
  bundle,
  t,
}: {
  bundle: GenerationDebugBundle;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  const b = bundle.budget_report;
  if (!b) return <p className="text-xs text-text/50">{t("settings.genDebug.noBudget")}</p>;
  const rows: Array<[string, number]> = [
    [t("settings.genDebug.budgetContextWindow"), b.context_window],
    [t("settings.genDebug.budgetSystem"), b.system_tokens],
    ["P1", b.p1_tokens],
    ["P2", b.p2_tokens],
    ["P3", b.p3_tokens],
    [t("settings.genDebug.budgetThread"), b.thread_tokens],
    ["P4 RAG", b.p4_tokens],
    ["P5", b.p5_tokens],
    [t("settings.genDebug.budgetTotalInput"), b.total_input_tokens],
    [t("settings.genDebug.budgetMaxOutput"), b.max_output_tokens],
    [t("settings.genDebug.budgetRemaining"), b.budget_remaining],
  ];
  return (
    <div className="space-y-1">
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-black/5 dark:border-white/5">
              <td className="py-0.5 text-text/60">{label}</td>
              <td className="py-0.5 text-right font-mono text-text/80">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {b.truncated_layers.length > 0 && (
        <p className="text-xs text-warning">
          {t("settings.genDebug.budgetTruncated", { layers: b.truncated_layers.join(", ") })}
        </p>
      )}
      {b.is_fallback_estimate && <p className="text-xs text-text/50">{t("settings.genDebug.budgetFallback")}</p>}
    </div>
  );
}

function MessageGroup({
  title,
  messages,
  copyLabel,
  copiedLabel,
  copyFailedLabel,
}: {
  title: string;
  messages: GenerationDebugBundle["start_messages"];
  copyLabel: string;
  copiedLabel: string;
  copyFailedLabel: string;
}) {
  // 每条消息的复制反馈（1.5s 后复位）；-1 = 复制失败瞬态。
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopyOne = (index: number, content: unknown) => {
    const text = typeof content === "string" ? content : JSON.stringify(content);
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 1500);
      })
      .catch(() => setCopiedIndex(-1));
  };

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-text/70">{title}</p>
      {messages.length === 0 ? (
        <p className="text-xs text-text/40">—</p>
      ) : (
        messages.map((m, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 追加型消息序列、不重排不编辑、无稳定 id（同 DebugLogsSection 日志行口径）
          <div key={i} className="rounded-md bg-black/5 p-2 dark:bg-white/5">
            <div className="mb-1 flex items-center justify-between">
              <p className="font-mono text-[10px] font-bold uppercase text-accent/70">{m.role}</p>
              <button
                type="button"
                className="flex items-center gap-1 text-[10px] text-text/50 hover:text-text/80"
                onClick={() => handleCopyOne(i, m.content)}
              >
                <Copy size={10} />
                {copiedIndex === i ? copiedLabel : copiedIndex === -1 ? copyFailedLabel : copyLabel}
              </button>
            </div>
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-text/80">
              {typeof m.content === "string" ? m.content : JSON.stringify(m.content)}
            </pre>
          </div>
        ))
      )}
    </div>
  );
}

export function GenerationDebugSection() {
  const { t } = useTranslation();
  const { showToast } = useFeedback();
  const [expanded, setExpanded] = useState(false);
  const [metas, setMetas] = useState<DebugBundleMeta[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openBundle, setOpenBundle] = useState<GenerationDebugBundle | null>(null);

  const loadList = useCallback(() => {
    setMetas(listDebugBundles());
  }, []);

  const handleExpand = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadList();
  }, [expanded, loadList]);

  const handleToggleItem = useCallback(
    (id: string) => {
      if (openId === id) {
        setOpenId(null);
        setOpenBundle(null);
        return;
      }
      setOpenId(id);
      setOpenBundle(getDebugBundle(id));
    },
    [openId],
  );

  const handleCopy = useCallback(async () => {
    if (!openBundle) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(openBundle, null, 2));
      showToast(t("settings.genDebug.copied"), "success");
    } catch {
      showToast(t("settings.genDebug.copyFailed"), "error");
    }
  }, [openBundle, showToast, t]);

  const handleClear = useCallback(() => {
    clearDebugBundles();
    setOpenId(null);
    setOpenBundle(null);
    loadList();
    showToast(t("settings.genDebug.cleared"), "success");
  }, [loadList, showToast, t]);

  return (
    <div className="border-t border-black/10 pt-5 dark:border-white/10">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-sm font-bold text-text/90"
        onClick={handleExpand}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {t("settings.genDebug.title")}
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button tone="neutral" fill="plain" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={loadList}>
              <RefreshCw size={12} /> {t("settings.genDebug.refresh")}
            </Button>
            <Button tone="neutral" fill="plain" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={handleClear}>
              <Trash2 size={12} /> {t("settings.genDebug.clearAll")}
            </Button>
            <span className="text-xs text-text/50">{t("settings.genDebug.count", { count: metas.length })}</span>
          </div>

          {metas.length === 0 ? (
            <p className="py-4 text-center text-xs text-text/50">{t("settings.genDebug.empty")}</p>
          ) : (
            <div className="space-y-1">
              {metas.map((meta) => (
                <div key={meta.id} className="rounded-md border border-black/10 dark:border-white/10">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-2 px-2 py-1.5 text-left text-xs"
                    onClick={() => handleToggleItem(meta.id)}
                  >
                    {openId === meta.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span className="text-text/40">{meta.ts.slice(11, 19)}</span>
                    <span className="font-semibold">
                      {meta.path === "write" ? t("settings.genDebug.pathWrite") : t("settings.genDebug.pathChat")}
                    </span>
                    <span className="max-w-[12rem] truncate text-text/60" title={meta.au_id}>
                      {meta.au_id} · ch.{meta.chapter_num}
                    </span>
                    <span className="text-text/50">{meta.model}</span>
                    <span
                      className={
                        meta.status === "error"
                          ? "font-semibold text-error"
                          : meta.status === "ok"
                            ? "text-success"
                            : "text-text/50"
                      }
                    >
                      {statusLabel(meta, t)}
                    </span>
                    {meta.output_tokens !== null && (
                      <span className="font-mono text-text/40">
                        {meta.input_tokens ?? "?"}→{meta.output_tokens} tok
                      </span>
                    )}
                    {meta.iterations > 1 && (
                      <span className="text-text/40">
                        {t("settings.genDebug.iterations", { count: meta.iterations })}
                      </span>
                    )}
                  </button>

                  {openId === meta.id && openBundle && (
                    <div className="space-y-3 border-t border-black/10 p-2 dark:border-white/10">
                      <div className="flex items-center gap-2">
                        <Button
                          tone="neutral"
                          fill="plain"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => void handleCopy()}
                        >
                          <Copy size={12} /> {t("settings.genDebug.copyAll")}
                        </Button>
                        {openBundle.result && (
                          <span className="font-mono text-xs text-text/50">
                            {openBundle.result.duration_ms} ms
                            {openBundle.result.draft_label ? ` · ${openBundle.result.draft_label}` : ""}
                          </span>
                        )}
                      </div>

                      {openBundle.error && (
                        <div className="rounded-md bg-error/10 p-2 text-xs">
                          <span className="font-bold text-error">{openBundle.error.code}</span>{" "}
                          <span className="text-text/80">{openBundle.error.message}</span>
                        </div>
                      )}

                      <div>
                        <p className="mb-1 text-xs font-semibold text-text/70">{t("settings.genDebug.budgetTitle")}</p>
                        <BudgetTable bundle={openBundle} t={t} />
                      </div>

                      {openBundle.context_summary && openBundle.context_summary.rag_chunks.length > 0 && (
                        <div>
                          <p className="mb-1 text-xs font-semibold text-text/70">{t("settings.genDebug.ragTitle")}</p>
                          <div className="space-y-2">
                            {openBundle.context_summary.rag_chunks.map((chunk, i) => (
                              // biome-ignore lint/suspicious/noArrayIndexKey: RAG chunks 为只读快照列表、无稳定 id
                              <RagChunkItem key={i} chunk={chunk} t={t} hasWarning={false} />
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <p className="mb-1 text-xs font-semibold text-text/70">
                          {t("settings.genDebug.messagesTitle")}
                        </p>
                        <div className="space-y-2">
                          <MessageGroup
                            title={t("settings.genDebug.messagesStart")}
                            messages={openBundle.start_messages}
                            copyLabel={t("settings.genDebug.copyOne")}
                            copiedLabel={t("settings.genDebug.copied")}
                            copyFailedLabel={t("settings.genDebug.copyFailed")}
                          />
                          {openBundle.final_messages !== openBundle.start_messages &&
                            openBundle.final_messages.length !== openBundle.start_messages.length && (
                              <MessageGroup
                                title={t("settings.genDebug.messagesFinal")}
                                messages={openBundle.final_messages}
                                copyLabel={t("settings.genDebug.copyOne")}
                                copiedLabel={t("settings.genDebug.copied")}
                                copyFailedLabel={t("settings.genDebug.copyFailed")}
                              />
                            )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
