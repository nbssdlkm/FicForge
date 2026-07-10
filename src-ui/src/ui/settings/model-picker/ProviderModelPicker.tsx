// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useMemo, useState } from "react";
import { DownloadCloud, PencilLine, Settings2 } from "lucide-react";
import { Input } from "../../shared/Input";
import { useTranslation } from "../../../i18n/useAppTranslation";
import { useFeedback } from "../../../hooks/useFeedback";
import { catchAndLog } from "../../../utils/ui-logger";
import {
  getCustomProviderApiKey,
  getModelCatalog,
  saveEnabledModels,
  type CustomModelEntry,
  type CustomProviderInfo,
  type ModelCatalog,
} from "../../../api/engine-client";
import { FetchModelsSheet } from "./FetchModelsSheet";
import { CustomProviderModal } from "./CustomProviderModal";
import {
  buildPickerProviders,
  ctxInfoForModel,
  formatCtx,
  matchProviderByBaseUrl,
  modelOptionsForProvider,
  sameBaseUrl,
  type PickerModelOption,
  type PickerProvider,
} from "./model-picker-utils";

const ADD_CUSTOM_VALUE = "__add_custom_provider__";
const UNMATCHED_VALUE = "";

export interface ProviderModelPickerProps {
  /** chat = 续写主力槽位（含 ctx 行）；embedding = 向量槽位（只显示 embedding 类型模型，无 ctx 行）。 */
  kind: "chat" | "embedding";
  model: string;
  /** 受控绑定：模型下拉 / 手填输入。 */
  onModelChange: (model: string) => void;
  apiBase: string;
  /** 供应商切换 / 自定义供应商保存后自动填 baseUrl。 */
  onApiBaseAutoFill: (apiBase: string) => void;
  /**
   * 供应商切换 / 保存后随 baseUrl 带出该供应商的非标 chatPath（缺则传空串清旧值）。
   * 只有携带 chatPath 的供应商需要此接线；不传则调用方不参与 chat_path 持久化（如 embedding 槽）。
   */
  onChatPathAutoFill?: (chatPath: string) => void;
  /** 表单态真实 key（拉取列表复用 testConnection 同路径）。 */
  apiKey: string;
  /** 自定义供应商存有 key 时选中自动带出。 */
  onApiKeyAutoFill?: (apiKey: string) => void;
  /**
   * 受控绑定（仅 kind=chat）：ctx 表单态 —— 字符串，"" = 窗口未知（审计鲜眼 R2-3）。
   * 权威/估算值自动带出、用户可手改；未知模型清空而不是塞 0/默认值哨兵。
   */
  contextWindow?: string;
  onContextWindowChange?: (contextWindow: string) => void;
  disabled?: boolean;
}

/**
 * 供应商主导模型选择器（方案 B，全局 + AU 覆盖共用；Kelivo 交互骨架）：
 * 供应商下拉（内置清单序 + 自定义 + 添加入口）→ 选中自动填 baseUrl
 * → 模型下拉（推荐带 ctx/标签 + 已启用 + 自定义 + 拉取 + 手填）
 * → ctx 三态（权威只读 / 估算可改显式提示 / 未知警示），禁静默 fallback。
 */
export function ProviderModelPicker({
  kind,
  model,
  onModelChange,
  apiBase,
  onApiBaseAutoFill,
  onChatPathAutoFill,
  apiKey,
  onApiKeyAutoFill,
  contextWindow,
  onContextWindowChange,
  disabled,
}: ProviderModelPickerProps) {
  const { t, i18n } = useTranslation();
  const { showError, showSuccess } = useFeedback();
  const lang: "zh" | "en" = i18n.resolvedLanguage === "en" ? "en" : "zh";

  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(UNMATCHED_VALUE);
  const [manualModel, setManualModel] = useState(false);
  const [fetchSheetOpen, setFetchSheetOpen] = useState(false);
  const [savingEnabled, setSavingEnabled] = useState(false);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<CustomProviderInfo | null>(null);

  useEffect(() => {
    let stale = false;
    getModelCatalog()
      .then((res) => { if (!stale) setCatalog(res); })
      .catch(catchAndLog("modelPicker", "getModelCatalog failed"));
    return () => { stale = true; };
  }, []);

  const providers = useMemo(() => buildPickerProviders(catalog, lang), [catalog, lang]);

  // 供应商选择与 apiBase 保持同步：外部 hydration / 手改 base 时重新匹配。
  // 用户在下拉里选供应商 → onApiBaseAutoFill 更新 apiBase → 本效应确认匹配，收敛稳定。
  // F-3：当前选中供应商的 baseUrl 仍与表单一致时保持不动 —— 多个供应商共用同一 baseUrl
  // （如内置 + 自定义镜像）时不按「首个命中」弹回；只有不一致（外部 hydrate / 清空 / 手改）才重匹配。
  useEffect(() => {
    const current = providers.find((p) => p.id === selectedProviderId);
    if (current && sameBaseUrl(current.baseUrl, apiBase)) return;
    const matched = matchProviderByBaseUrl(providers, apiBase);
    setSelectedProviderId(matched?.id ?? UNMATCHED_VALUE);
  }, [apiBase, providers, selectedProviderId]);

  const selectedProvider: PickerProvider | undefined = providers.find((p) => p.id === selectedProviderId);
  const options: PickerModelOption[] = useMemo(
    () => (selectedProvider ? modelOptionsForProvider(selectedProvider, kind) : []),
    [selectedProvider, kind],
  );
  const modelInOptions = options.some((o) => o.id === model);
  const selectedOption = options.find((o) => o.id === model);
  const ctxInfo = useMemo(() => ctxInfoForModel(options, model), [options, model]);

  // 权威模型：仅当 ctx 表单为空（未选/初次进无保存值）时自动带出官方值。
  // 不再强制覆盖非空表单值 —— 允许 per-model 覆盖上下文窗口（get_context_window 会优先认保存的
  // context_window，故覆盖真生效）；用户显式改小/改大的值得以保留，官方值仅作默认与「恢复默认」目标。
  useEffect(() => {
    if (kind !== "chat" || !onContextWindowChange) return;
    if (ctxInfo.source === "authoritative" && ctxInfo.value !== undefined && (contextWindow ?? "").trim() === "") {
      onContextWindowChange(String(ctxInfo.value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxInfo.source, ctxInfo.value, contextWindow, kind]);

  const applyCatalogUpdate = (updater: (prev: ModelCatalog) => ModelCatalog) => {
    setCatalog((prev) => updater(prev ?? { custom_providers: [], enabled_models: {} }));
  };

  const handleProviderSelect = async (value: string) => {
    if (value === ADD_CUSTOM_VALUE) {
      setEditingProvider(null);
      setProviderModalOpen(true);
      return;
    }
    const provider = providers.find((p) => p.id === value);
    if (!provider) return;
    setSelectedProviderId(provider.id);
    onApiBaseAutoFill(provider.baseUrl);
    // chatPath 随 baseUrl 同源带出：新供应商无 chatPath 时传空串清掉旧供应商残留的路径。
    onChatPathAutoFill?.(provider.chatPath ?? "");
    if (provider.isCustom && onApiKeyAutoFill) {
      try {
        const storedKey = await getCustomProviderApiKey(provider.id);
        if (storedKey) onApiKeyAutoFill(storedKey);
      } catch (error) {
        catchAndLog("modelPicker", "getCustomProviderApiKey failed")(error);
      }
    }
  };

  const handleModelSelect = (id: string) => {
    onModelChange(id);
    if (kind !== "chat" || !onContextWindowChange) return;
    // 权威 / 手填 / 估算值自动带出（估算态在 ctx 行显式提示「按 XXk 估算」）；
    // 未知模型清空 ctx 为 ""（F-5 + R2-3：不沿用上一模型残留的大数，也不再发 0 哨兵
    // 被下游 || 默认吞掉），警示文案照旧、交由用户在可编辑输入框里确认。
    const info = ctxInfoForModel(options, id);
    onContextWindowChange(info.value !== undefined ? String(info.value) : "");
  };

  // F-4：打开拉取 sheet 前新读目录 —— 另一槽位（chat / embedding）的选择器实例可能已改
  // 同供应商的 enabled_models，本实例挂载时的 catalog 快照 stale 会让 sheet 初始勾选缺失、
  // 确认覆写时把别槽启用的模型清掉。
  // R2-4：新读失败**阻断打开**（终审证实「stale 快照照常打开」的保护是假的 —— 确认时
  // 会以 stale 勾选覆写），报错让用户重点（重试 = 再点一次拉取按钮）。
  const handleOpenFetchSheet = async () => {
    try {
      const fresh = await getModelCatalog();
      setCatalog(fresh);
    } catch (error) {
      // 细节进日志；toast 给上下文文案（showError 对 Error 会优先取 error.message，
      // 那样用户只看到裸底层报错、不知道发生了什么 —— 故传 null 让 fallback 生效）。
      catchAndLog("modelPicker", "getModelCatalog refresh failed")(error);
      showError(null, t("modelPicker.fetchSheet.catalogRefreshFailed"));
      return;
    }
    setFetchSheetOpen(true);
  };

  const handleFetchConfirm = async (models: CustomModelEntry[], sheetUniverseIds: Set<string>) => {
    if (!selectedProvider) return;
    setSavingEnabled(true);
    try {
      // F-4：确认前再新读一次 —— fresh enabled 里存在但不在本次 sheet 可见宇宙
      // （拉取返回 ids ∪ 打开时已启用 ids）的条目从未在本 sheet 展示过，其去留不该由
      // 本次确认决定，原样保留；可见宇宙内的条目以用户勾选为准。新读失败退回本实例
      // catalog（打开时已刷新过，仍优于覆写）。
      let freshEnabled = catalog?.enabled_models[selectedProvider.id] ?? [];
      try {
        const fresh = await getModelCatalog();
        freshEnabled = fresh.enabled_models[selectedProvider.id] ?? [];
      } catch (error) {
        catchAndLog("modelPicker", "getModelCatalog refresh failed")(error);
      }
      const selectedIds = new Set(models.map((m) => m.id));
      const preserved = freshEnabled.filter((m) => !sheetUniverseIds.has(m.id) && !selectedIds.has(m.id));
      const merged = [...models, ...preserved];
      await saveEnabledModels(selectedProvider.id, merged);
      applyCatalogUpdate((prev) => ({
        ...prev,
        enabled_models: { ...prev.enabled_models, [selectedProvider.id]: merged },
      }));
      setFetchSheetOpen(false);
      // 计数 = 用户本次勾选数（宇宙外保留合并的条目不算「本次启用」，计进去会虚高）。
      showSuccess(t("modelPicker.fetchSheet.savedToast", { num: models.length }));
    } catch (error) {
      showError(error, t("error_messages.unknown"));
    } finally {
      setSavingEnabled(false);
    }
  };

  const handleProviderSaved = (saved: CustomProviderInfo, apiKeyEntered: string | undefined) => {
    applyCatalogUpdate((prev) => {
      const exists = prev.custom_providers.some((p) => p.id === saved.id);
      return {
        ...prev,
        custom_providers: exists
          ? prev.custom_providers.map((p) => (p.id === saved.id ? saved : p))
          : [...prev.custom_providers, saved],
      };
    });
    // 新建/编辑后即选中该供应商（Kelivo：新加供应商直进使用态）
    setSelectedProviderId(saved.id);
    onApiBaseAutoFill(saved.baseUrl);
    // 保存的自定义供应商 chatPath 随之带出（编辑清空 chatPath 时 saved.chatPath 为 undefined → 传空串清旧值）。
    onChatPathAutoFill?.(saved.chatPath ?? "");
    if (apiKeyEntered && onApiKeyAutoFill) onApiKeyAutoFill(apiKeyEntered);
  };

  const handleProviderDeleted = (providerId: string) => {
    applyCatalogUpdate((prev) => {
      const nextEnabled = { ...prev.enabled_models };
      delete nextEnabled[providerId];
      return {
        custom_providers: prev.custom_providers.filter((p) => p.id !== providerId),
        enabled_models: nextEnabled,
      };
    });
    if (selectedProviderId === providerId) setSelectedProviderId(UNMATCHED_VALUE);
  };

  // ctx 现在对所有模型可编辑（含权威——允许 per-model 覆盖，见上方自动校正 effect 说明）。
  // 「已覆盖官方默认」判据：权威模型 + 表单值非空 + 与官方值不等 → 提供「恢复默认」还原。
  const ctxOverridesAuthoritative =
    kind === "chat" &&
    ctxInfo.source === "authoritative" &&
    ctxInfo.value !== undefined &&
    (contextWindow ?? "").trim() !== "" &&
    contextWindow !== String(ctxInfo.value);
  const selectClass = "h-11 w-full rounded-md border border-black/20 bg-background px-3 text-base text-text outline-hidden focus:ring-1 focus:ring-accent dark:border-white/20 md:h-9 md:text-sm";

  const optionLabel = (o: PickerModelOption) =>
    o.ctx.value !== undefined ? `${o.displayName} · ${formatCtx(o.ctx.value)}` : o.displayName;

  const groupedOptions = (["recommended", "enabled", "custom"] as const)
    .map((origin) => ({ origin, items: options.filter((o) => o.origin === origin) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-3">
      {/* 供应商行 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-bold text-text/70">{t("modelPicker.providerLabel")}</label>
        <div className="flex gap-2">
          <select
            value={selectedProviderId}
            onChange={(e) => void handleProviderSelect(e.target.value)}
            disabled={disabled}
            className={selectClass}
            aria-label={t("modelPicker.providerLabel")}
          >
            {selectedProviderId === UNMATCHED_VALUE && (
              <option value={UNMATCHED_VALUE}>{t("modelPicker.providerUnmatched")}</option>
            )}
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
            <option value={ADD_CUSTOM_VALUE}>{t("modelPicker.addCustomProvider")}</option>
          </select>
          {selectedProvider?.isCustom && (
            <button
              type="button"
              onClick={() => {
                const info = catalog?.custom_providers.find((p) => p.id === selectedProvider.id) ?? null;
                setEditingProvider(info);
                setProviderModalOpen(true);
              }}
              disabled={disabled}
              title={t("modelPicker.editCustomProvider")}
              aria-label={t("modelPicker.editCustomProvider")}
              className="shrink-0 rounded-md border border-black/20 bg-background px-3 text-text/70 hover:text-text dark:border-white/20"
            >
              <Settings2 size={15} />
            </button>
          )}
        </div>
      </div>

      {/* 模型行 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-bold text-text/70">{t("common.labels.model")}</label>
        {manualModel ? (
          <div className="flex gap-2">
            <Input
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              placeholder={t("modelPicker.manualModelPlaceholder")}
              disabled={disabled}
              className="h-11 flex-1 text-base md:h-9 md:text-sm"
            />
            <button
              type="button"
              onClick={() => setManualModel(false)}
              disabled={disabled}
              className="shrink-0 rounded-md border border-black/20 bg-background px-3 text-xs text-text/70 hover:text-text dark:border-white/20"
            >
              {t("modelPicker.backToList")}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <select
              value={modelInOptions ? model : ""}
              onChange={(e) => handleModelSelect(e.target.value)}
              disabled={disabled}
              className={selectClass}
              aria-label={t("common.labels.model")}
            >
              {!modelInOptions && (
                <option value="" disabled>
                  {model ? model : t("modelPicker.selectModelHint")}
                </option>
              )}
              {groupedOptions.map((group) => (
                <optgroup key={group.origin} label={t(`modelPicker.originGroup.${group.origin}`)}>
                  {group.items.map((o) => (
                    <option key={o.id} value={o.id}>{optionLabel(o)}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleOpenFetchSheet()}
              disabled={disabled || !selectedProvider || !apiBase.trim()}
              title={t("modelPicker.fetchModels")}
              aria-label={t("modelPicker.fetchModels")}
              className="shrink-0 rounded-md border border-black/20 bg-background px-3 text-text/70 hover:text-text disabled:opacity-40 dark:border-white/20"
            >
              <DownloadCloud size={15} />
            </button>
            <button
              type="button"
              onClick={() => setManualModel(true)}
              disabled={disabled}
              title={t("modelPicker.manualInput")}
              aria-label={t("modelPicker.manualInput")}
              className="shrink-0 rounded-md border border-black/20 bg-background px-3 text-text/70 hover:text-text dark:border-white/20"
            >
              <PencilLine size={15} />
            </button>
          </div>
        )}
        {/* 标签胶囊（选中推荐模型时） */}
        {selectedOption?.tags && selectedOption.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selectedOption.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
                {t(`modelPicker.tag.${tag}`)}
              </span>
            ))}
          </div>
        )}
        {/* embedding 槽位空清单空态：该服务商没有向量模型可选时提示走手填（R2-6） */}
        {kind === "embedding" && !manualModel && selectedProvider && options.length === 0 && (
          <p className="text-xs text-text/50">{t("modelPicker.embeddingEmpty")}</p>
        )}
      </div>

      {/* ctx 行（仅 chat 槽位） */}
      {kind === "chat" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-text/70">{t("common.labels.contextWindow")}</label>
          <Input
            type="number"
            value={contextWindow ?? ""}
            onChange={(e) => onContextWindowChange?.(e.target.value)}
            disabled={disabled}
            aria-label={t("common.labels.contextWindow")}
            className="h-11 text-base md:h-9 md:text-sm"
          />
          {ctxInfo.source === "authoritative" && (
            ctxOverridesAuthoritative ? (
              // 已覆盖官方默认 → 提示 + 一键恢复官方值
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-warning">
                {t("modelPicker.ctxOverride", { ctx: formatCtx(ctxInfo.value ?? 0) })}
                <button
                  type="button"
                  className="underline hover:text-text/80 disabled:opacity-50"
                  onClick={() => onContextWindowChange?.(String(ctxInfo.value))}
                  disabled={disabled}
                >
                  {t("modelPicker.ctxResetDefault")}
                </button>
              </p>
            ) : (
              <p className="text-xs text-text/50">{t("modelPicker.ctxAuthoritativeEditable", { ctx: formatCtx(ctxInfo.value ?? 0) })}</p>
            )
          )}
          {ctxInfo.source === "estimated" && (
            <p className="text-xs text-warning">
              {t("modelPicker.ctxEstimated", { ctx: formatCtx(ctxInfo.value ?? 0) })}
            </p>
          )}
          {ctxInfo.source === "manual" && (contextWindow ?? "").trim() !== "" && (
            <p className="text-xs text-text/50">{t("modelPicker.ctxManual")}</p>
          )}
          {/* 空值恒配「窗口未知」警示（含手清空场景），不静默显示空框（R2-3 显示层） */}
          {(ctxInfo.source === "unknown" || (ctxInfo.source === "manual" && (contextWindow ?? "").trim() === "")) && (
            <p className="text-xs text-warning">{t("modelPicker.ctxUnknown")}</p>
          )}
        </div>
      )}

      <FetchModelsSheet
        isOpen={fetchSheetOpen}
        onClose={() => setFetchSheetOpen(false)}
        apiBase={apiBase}
        apiKey={apiKey}
        existingEntries={selectedProvider ? (catalog?.enabled_models[selectedProvider.id] ?? []) : []}
        onConfirm={handleFetchConfirm}
        confirming={savingEnabled}
      />
      <CustomProviderModal
        isOpen={providerModalOpen}
        onClose={() => setProviderModalOpen(false)}
        provider={editingProvider}
        deleteInUse={Boolean(editingProvider && sameBaseUrl(apiBase, editingProvider.baseUrl))}
        onSaved={handleProviderSaved}
        onDeleted={handleProviderDeleted}
      />
    </div>
  );
}
