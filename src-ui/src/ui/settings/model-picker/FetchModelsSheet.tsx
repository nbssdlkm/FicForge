// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { Modal } from "../../shared/Modal";
import { Button } from "../../shared/Button";
import { Input } from "../../shared/Input";
import { Spinner } from "../../shared/Spinner";
import { useTranslation } from "../../../i18n/useAppTranslation";
import { useActiveRequestGuard } from "../../../hooks/useActiveRequestGuard";
import { fetchProviderModels, FetchModelsError, type CustomModelEntry } from "../../../api/engine-client";
import { MODEL_GROUP_ORDER, isLikelyEmbeddingId, modelGroupKey } from "./model-picker-utils";

export interface FetchModelsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** 拉取端点（与 chat 同一 api_base 口径，`{base}/models`）。 */
  apiBase: string;
  /** 表单态里的真实 key（与 testConnection 同路径：secure 还原后的值）。 */
  apiKey: string;
  /** 该供应商当前已启用的模型（勾选初值 + 保留手填 ctx 等元数据）。 */
  existingEntries: CustomModelEntry[];
  /**
   * 确认勾选。sheetUniverseIds = 本次 sheet 可见宇宙（拉取返回 ids ∪ 打开时已启用 ids）——
   * 调用方据此只覆写宇宙内条目、原样保留宇宙外的 fresh enabled（F-4 跨槽位 stale 快照防误清）。
   */
  onConfirm: (models: CustomModelEntry[], sheetUniverseIds: Set<string>) => void | Promise<void>;
  confirming?: boolean;
}

/**
 * 「从 API 获取列表」sheet（Kelivo 蓝图：搜索 + 系列分组折叠 + 过滤内全选）。
 *
 * 已启用但本次 /models 未返回的旧模型不静默丢弃 —— 单列「未返回」分组，
 * 保持勾选、由用户显式决定去留（防止换 key/换镜像后误清用户手配的清单）。
 */
export function FetchModelsSheet({
  isOpen,
  onClose,
  apiBase,
  apiKey,
  existingEntries,
  onConfirm,
  confirming,
}: FetchModelsSheetProps) {
  const { t } = useTranslation();
  const guard = useActiveRequestGuard(isOpen ? "fetch-models-open" : "fetch-models-closed");

  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [fetchedIds, setFetchedIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  /** 错误分类 → 用户可懂文案（R2-4）：401/403 指向密钥；超时/网络复用 connection_failed 口径；其余带状态码简述。 */
  const describeFetchError = useCallback(
    (error: unknown): string => {
      if (error instanceof FetchModelsError) {
        if (error.code === "auth") return t("modelPicker.fetchSheet.errorAuth");
        if (error.code === "network") return t("error_messages.connection_failed");
        return t("modelPicker.fetchSheet.errorHttp", { status: error.status ?? "?" });
      }
      return t("modelPicker.fetchSheet.error", { message: error instanceof Error ? error.message : String(error) });
    },
    [t],
  );

  /** 拉取（打开时自动跑一次；error 态「重试」按钮复用）。 */
  const runFetch = useCallback(() => {
    const token = guard.start();
    setStatus("loading");
    setErrorMessage("");
    setFetchedIds([]);
    fetchProviderModels({ api_base: apiBase, api_key: apiKey })
      .then((res) => {
        if (guard.isStale(token)) return;
        setFetchedIds(res.ids);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (guard.isStale(token)) return;
        setErrorMessage(describeFetchError(error));
        setStatus("error");
      });
  }, [apiBase, apiKey, describeFetchError, guard]);

  useEffect(() => {
    if (!isOpen) return;
    setSearch("");
    setCollapsed(new Set());
    setSelected(new Set(existingEntries.map((m) => m.id)));
    runFetch();
    // existingEntries 是打开瞬间的快照语义，刻意不进依赖（打开期间父层不变）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const existingById = useMemo(() => new Map(existingEntries.map((m) => [m.id, m])), [existingEntries]);

  /** 已启用但本次未返回的旧模型（单列分组，显式管理）。 */
  const missingIds = useMemo(() => {
    const fetched = new Set(fetchedIds);
    return existingEntries.map((m) => m.id).filter((id) => !fetched.has(id));
  }, [fetchedIds, existingEntries]);

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const byGroup = new Map<string, string[]>();
    const push = (key: string, id: string) => {
      if (query && !id.toLowerCase().includes(query)) return;
      const list = byGroup.get(key) ?? [];
      list.push(id);
      byGroup.set(key, list);
    };
    for (const id of missingIds) push("missing", id);
    for (const id of fetchedIds) push(modelGroupKey(id), id);
    const order = ["missing", ...MODEL_GROUP_ORDER];
    return order.filter((key) => byGroup.has(key)).map((key) => ({ key, ids: byGroup.get(key)! }));
  }, [fetchedIds, missingIds, search]);

  const visibleIds = useMemo(() => groups.flatMap((g) => g.ids), [groups]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  const toggleModel = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 过滤内全选 / 取消全选（Kelivo 蓝图必抄交互）。 */
  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const toggleGroupCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleConfirm = () => {
    // 勾选 id → 条目：已有条目原样保留（手填 ctx / type 修订不丢），新 id 按启发式预标 type
    const models: CustomModelEntry[] = [...selected].map(
      (id) =>
        existingById.get(id) ?? {
          id,
          displayName: id,
          type: isLikelyEmbeddingId(id) ? "embedding" : "chat",
        },
    );
    // F-4：可见宇宙 = 拉取返回 ∪ 打开时已启用（含「未返回」分组）—— 注意不是搜索过滤后的
    // visibleIds；不在宇宙里的条目本 sheet 从未展示，去留交由调用方保留合并。
    const sheetUniverseIds = new Set<string>([...fetchedIds, ...existingEntries.map((m) => m.id)]);
    void onConfirm(models, sheetUniverseIds);
  };

  const groupLabel = (key: string) => t(`modelPicker.fetchSheet.group.${key}`, { defaultValue: key });

  return (
    <Modal isOpen={isOpen} onClose={confirming ? () => {} : onClose} title={t("modelPicker.fetchSheet.title")}>
      <div className="space-y-3">
        {status === "loading" && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-text/60">
            <Spinner size="sm" /> {t("modelPicker.fetchSheet.loading")}
          </div>
        )}

        {status === "error" && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 rounded-sm border border-error/30 bg-error/10 p-3 text-sm text-error">
              <XCircle size={16} className="mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <Button tone="neutral" fill="outline" size="sm" onClick={runFetch}>
              {t("modelPicker.fetchSheet.retry")}
            </Button>
          </div>
        )}

        {status === "ready" && (
          <>
            <div className="flex items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("modelPicker.fetchSheet.searchPlaceholder")}
                className="h-9 flex-1 text-sm"
              />
              <Button
                tone="neutral"
                fill="outline"
                size="sm"
                onClick={toggleAllVisible}
                disabled={visibleIds.length === 0 || confirming}
              >
                {allVisibleSelected
                  ? t("modelPicker.fetchSheet.clearFiltered")
                  : t("modelPicker.fetchSheet.selectAllFiltered")}
              </Button>
            </div>

            {fetchedIds.length === 0 && missingIds.length === 0 ? (
              <p className="py-8 text-center text-sm text-text/50">{t("modelPicker.fetchSheet.empty")}</p>
            ) : (
              <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
                {groups.map((group) => (
                  <div key={group.key} className="rounded-sm border border-rule">
                    <button
                      type="button"
                      onClick={() => toggleGroupCollapsed(group.key)}
                      className="flex w-full items-center gap-1.5 bg-rule-soft px-3 py-1.5 text-left text-xs font-bold text-text/70"
                    >
                      {collapsed.has(group.key) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      {groupLabel(group.key)}
                      <span className="ml-auto font-normal text-text/40">{group.ids.length}</span>
                    </button>
                    {!collapsed.has(group.key) && (
                      <div className="divide-y divide-rule">
                        {group.ids.map((id) => (
                          <label
                            key={id}
                            className="flex min-h-[38px] cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-rule-soft"
                          >
                            <input
                              type="checkbox"
                              className="accent-accent"
                              checked={selected.has(id)}
                              onChange={() => toggleModel(id)}
                              disabled={confirming}
                            />
                            <span className="min-w-0 flex-1 break-all font-mono text-xs">{id}</span>
                            {isLikelyEmbeddingId(id) && (
                              <span className="shrink-0 rounded-full bg-info/15 px-2 py-0.5 text-[10px] text-info">
                                {t("modelPicker.typeEmbedding")}
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="flex items-center justify-between border-t border-rule pt-3">
          <span className="text-xs text-text/50">
            {status === "ready" ? t("modelPicker.fetchSheet.selectedCount", { num: selected.size }) : ""}
          </span>
          <div className="flex gap-2">
            <Button tone="neutral" fill="plain" size="sm" onClick={onClose} disabled={confirming}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              tone="accent"
              fill="solid"
              size="sm"
              onClick={handleConfirm}
              disabled={status !== "ready" || confirming}
            >
              {confirming ? <Spinner size="sm" className="mr-1" /> : null}
              {t("modelPicker.fetchSheet.confirm")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
