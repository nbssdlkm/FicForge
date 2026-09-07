// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { DownloadCloud, PencilLine, Settings2 } from "lucide-react";
import { Input } from "../../shared/Input";
import { useTranslation } from "../../../i18n/useAppTranslation";
import { useFeedback } from "../../../hooks/useFeedback";
import { catchAndLog } from "../../../utils/ui-logger";
import {
  getCustomProviderApiKey,
  getModelCatalog,
  enableModel,
  fetchProviderModels,
  replaceEnabledModelsInUniverse,
  type CustomModelEntry,
  type CustomProviderInfo,
  type ModelCatalog,
} from "../../../api/engine-client";
import { createCustomModelEntry } from "@ficforge/engine";
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

/**
 * 云端模型列表自动拉取的会话级缓存（2026-09-04 卡拉拍板：模型 id 自动更新）。
 * key = providerId|apiBase|kind|凭证散列（djb2Hex(apiKey)，不放原始 key）；value = 该商 /models 返回的 id 列表。
 * 会话内只拉一次——设置页反复开关不打服务商；拉新模型重启应用或手动「从 API 获取列表」。
 * 空结果不缓存（避免错误 key 的空 200 挡住换对 key 后的重试）。
 */
const autoFetchedModelsCache = new Map<string, string[]>();

/** 测试钩子：清空自动拉取缓存（生产代码不调用）。 */
export function clearAutoFetchedModelsCache(): void {
  autoFetchedModelsCache.clear();
}

/**
 * 模块级 catalog mutation 版本号（终审 v2 P1）：设置页同挂 chat/embedding 两个 picker 实例，
 * 实例级 flag 感知不到兄弟实例的 mutation。任何实例的 catalog mutation（自动启用/供应商增删改）
 * 都 bump 全局版本；所有实例的在途 getModelCatalog 响应落地时按版本判废——落后即丢弃重拉。
 */
let catalogMutationVersion = 0;

/**
 * catalog 读取的总尝试上界（首发 + 3 次重试）。达到上限版本仍在变（罕见高频 mutation）
 * → 返回 null，调用方**禁止落地过期快照**（终审 v3 P2：界限明确、不 setCatalog stale 响应）。
 */
const CATALOG_READ_MAX_ATTEMPTS = 4;

/** 测试钩子：模拟兄弟实例 mutation（bump 全局版本）。生产代码不调用。 */
export function bumpCatalogMutationVersionForTest(): void {
  catalogMutationVersion++;
}

/** 自动拉取防抖（毫秒）——apiKey 逐字符变化不应每键一次 /models 请求（对抗审 W1）。 */
const AUTOFETCH_DEBOUNCE_MS = 600;

/** djb2 散列（hex）——缓存 key 的凭证标签：区分不同 key 又不把原始 key 留在内存 Map key 里。 */
function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

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
  const providerSelectId = useId();
  const modelFieldId = useId();
  const contextWindowId = useId();

  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(UNMATCHED_VALUE);
  const [manualModel, setManualModel] = useState(false);
  const [fetchSheetOpen, setFetchSheetOpen] = useState(false);
  const [savingEnabled, setSavingEnabled] = useState(false);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<CustomProviderInfo | null>(null);

  // 统一版本化 catalog 读取（终审 v3 P1）：组件内所有 getModelCatalog 调用（mount / 拉取 sheet
  // 打开 / sheet 确认前 fresh-read）都走这一个——请求发起记全局版本 v0，响应落地时版本已变
  // （本实例或兄弟实例 mutation 过）即丢弃重拉；达到上限仍不一致 → null（调用方禁落地）。
  // useCallback 固定引用：只读模块级版本号，无组件状态依赖（终审 v7：正规化替代 suppression）。
  const readCatalogVersioned = useCallback(async (): Promise<ModelCatalog | null> => {
    for (let attempt = 0; attempt < CATALOG_READ_MAX_ATTEMPTS; attempt++) {
      const v0 = catalogMutationVersion;
      const res = await getModelCatalog();
      if (catalogMutationVersion === v0) return res;
    }
    return null;
  }, []);

  useEffect(() => {
    let stale = false;
    readCatalogVersioned()
      .then((res) => {
        if (!stale && res) setCatalog(res);
      })
      .catch(catchAndLog("modelPicker", "getModelCatalog failed"));
    return () => {
      stale = true;
    };
  }, [readCatalogVersioned]);

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

  // 云端模型 id 自动更新：选中供应商 + 有 baseUrl 时后台静默拉一次 /models（会话级缓存），
  // 新 id 进「云端新发现」分组。失败静默——手动「从 API 获取列表」流程不受影响。
  const [autoFetchedIds, setAutoFetchedIds] = useState<string[]>([]);
  useEffect(() => {
    // 对抗审 W2：provider/base/key/kind 一变立即清旧列表——上一个供应商的云端模型
    // 绝不能显示在新供应商下（选中了会被自动写进错的供应商并生成必败请求）。
    setAutoFetchedIds([]);
    if (!selectedProvider || !apiBase.trim()) return;
    // 对抗审 W1：apiKey 逐字符变化会放大请求 → 600ms 防抖（fetchProviderModels 无 signal 参数，
    // 不硬 abort，15s 自超时托底）；缓存 key 带凭证散列（djb2，不放原始 key）防换 key 后吃到旧列表；
    // 空结果不缓存（key 错了拿到 200 空列表不该挡住换对 key 后的重试）。
    const credTag = djb2Hex(apiKey);
    const cacheKey = `${selectedProvider.id}|${apiBase}|${kind}|${credTag}`;
    const cached = autoFetchedModelsCache.get(cacheKey);
    if (cached) {
      setAutoFetchedIds(cached);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      fetchProviderModels({ api_base: apiBase, api_key: apiKey })
        .then((listing) => {
          if (listing.ids.length > 0) autoFetchedModelsCache.set(cacheKey, listing.ids);
          if (!stale) setAutoFetchedIds(listing.ids);
        })
        .catch(() => {
          // 静默：离线 / key 未配 / 商不支持 /models 都不打扰用户，下拉保持现有三组。
        });
    }, AUTOFETCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [selectedProvider, apiBase, apiKey, kind]);

  const options: PickerModelOption[] = useMemo(
    () => (selectedProvider ? modelOptionsForProvider(selectedProvider, kind, autoFetchedIds) : []),
    [selectedProvider, kind, autoFetchedIds],
  );
  const modelInOptions = options.some((o) => o.id === model);
  const selectedOption = options.find((o) => o.id === model);
  const ctxInfo = useMemo(() => ctxInfoForModel(options, model), [options, model]);

  // 权威模型：仅当 ctx 表单为空（未选/初次进无保存值）时自动带出官方值。
  // 不再强制覆盖非空表单值 —— 允许 per-model 覆盖上下文窗口（getContextWindow 会优先认保存的
  // context_window，故覆盖真生效）；用户显式改小/改大的值得以保留，官方值仅作默认与「恢复默认」目标。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 有意省依赖——hook 规则 4 ref-shim/边沿触发语义（见邻近注释）
  useEffect(() => {
    if (kind !== "chat" || !onContextWindowChange) return;
    if (ctxInfo.source === "authoritative" && ctxInfo.value !== undefined && (contextWindow ?? "").trim() === "") {
      onContextWindowChange(String(ctxInfo.value));
    }
  }, [ctxInfo.source, ctxInfo.value, contextWindow, kind]);

  const applyCatalogUpdate = (updater: (prev: ModelCatalog) => ModelCatalog) => {
    catalogMutationVersion++;
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
    // 选中「云端新发现」的模型 = 启用它：原子 append 进 enabled_models（enableModel 把
    // 读-合并-写收进同一把设置写锁，对抗审 C1 终审修复——UI 层 fresh-read + 整表覆写仍有竞态）。
    // 对抗审 W3：持久化失败给用户非阻塞错误提示（选择本身已生效，不阻塞流程）。
    const picked = options.find((o) => o.id === id);
    if (picked?.origin === "fetched" && selectedProvider) {
      const providerId = selectedProvider.id;
      const entry = createCustomModelEntry({ id, display_name: id, type: kind });
      enableModel(providerId, entry)
        .then((added) => {
          if (!added) return; // 已在列表（重复点选）
          applyCatalogUpdate((prev) => {
            const existing = prev.enabled_models[providerId] ?? [];
            if (existing.some((m) => m.id === id)) return prev;
            return {
              ...prev,
              enabled_models: { ...prev.enabled_models, [providerId]: [...existing, entry] },
            };
          });
        })
        .catch((error) => {
          catchAndLog("modelPicker", "auto-enable fetched model failed")(error);
          showError(error, t("modelPicker.autoEnableFailed"));
        });
    }
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
    let fresh: ModelCatalog | null;
    try {
      fresh = await readCatalogVersioned();
    } catch (error) {
      // 细节进日志；toast 给上下文文案（showError 对 Error 会优先取 error.message，
      // 那样用户只看到裸底层报错、不知道发生了什么 —— 故传 null 让 fallback 生效）。
      catchAndLog("modelPicker", "getModelCatalog refresh failed")(error);
      showError(null, t("modelPicker.fetchSheet.catalogRefreshFailed"));
      return;
    }
    if (!fresh) {
      // 版本持续不一致（罕见）——禁止拿过期快照开 sheet（终审 v3）
      showError(null, t("modelPicker.fetchSheet.catalogRefreshFailed"));
      return;
    }
    setCatalog(fresh);
    setFetchSheetOpen(true);
  };

  const handleFetchConfirm = async (models: CustomModelEntry[], sheetUniverseIds: Set<string>) => {
    if (!selectedProvider) return;
    setSavingEnabled(true);
    try {
      // 终审 v5 P1：合并搬进引擎写锁（replaceEnabledModelsInUniverse 锁内读-合-写原子）——
      // 可见宇宙内以本次勾选为准；宇宙外且未勾选的条目锁内 fresh 保留。不再需要 UI 锁外
      // fresh-read（读后写间的并发 mutation 互踩窗口已由引擎锁消除）。
      const merged = await replaceEnabledModelsInUniverse(selectedProvider.id, models, sheetUniverseIds);
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
  const selectClass =
    "h-11 w-full rounded-md border border-black/20 bg-background px-3 text-base text-text outline-hidden focus:ring-1 focus:ring-accent dark:border-white/20 md:h-9 md:text-sm";

  const optionLabel = (o: PickerModelOption) =>
    o.ctx.value !== undefined ? `${o.displayName} · ${formatCtx(o.ctx.value)}` : o.displayName;

  const groupedOptions = (["recommended", "enabled", "custom", "fetched"] as const)
    .map((origin) => ({ origin, items: options.filter((o) => o.origin === origin) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-3">
      {/* 供应商行 */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={providerSelectId} className="text-xs font-bold text-text/70">
          {t("modelPicker.providerLabel")}
        </label>
        <div className="flex gap-2">
          <select
            id={providerSelectId}
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
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
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
        <label htmlFor={modelFieldId} className="text-xs font-bold text-text/70">
          {t("common.labels.model")}
        </label>
        {manualModel ? (
          <div className="flex gap-2">
            <Input
              id={modelFieldId}
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
              id={modelFieldId}
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
                    <option key={o.id} value={o.id}>
                      {optionLabel(o)}
                    </option>
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
          <label htmlFor={contextWindowId} className="text-xs font-bold text-text/70">
            {t("common.labels.contextWindow")}
          </label>
          <Input
            id={contextWindowId}
            type="number"
            value={contextWindow ?? ""}
            onChange={(e) => onContextWindowChange?.(e.target.value)}
            disabled={disabled}
            aria-label={t("common.labels.contextWindow")}
            className="h-11 text-base md:h-9 md:text-sm"
          />
          {ctxInfo.source === "authoritative" &&
            (ctxOverridesAuthoritative ? (
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
              <p className="text-xs text-text/50">
                {t("modelPicker.ctxAuthoritativeEditable", { ctx: formatCtx(ctxInfo.value ?? 0) })}
              </p>
            ))}
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
