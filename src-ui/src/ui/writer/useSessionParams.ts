// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  saveGlobalModelParams,
  saveProjectModelParamsOverride,
  type WriterProjectContext,
  type WriterSessionConfig,
} from "../../api/engine-client";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { DEFAULT_DEEPSEEK_MODEL } from "../../config/defaults";
import { useTranslation } from "../../i18n/useAppTranslation";
import {
  buildPickerProviders,
  matchProviderByBaseUrl,
  modelOptionsForProvider,
  resolveSessionLayer,
  type PickerModelOption,
  type SessionLayer,
} from "../settings/model-picker/model-picker-utils";

export function hasSessionLlmOverride(llm: WriterProjectContext["llm"] | null | undefined): boolean {
  return Boolean(llm?.has_override);
}

export function getConfiguredLlmModel(
  llm: WriterProjectContext["llm"] | WriterSessionConfig["default_llm"] | null | undefined,
): string {
  if (!llm) return "";
  if (llm.mode === "ollama") {
    return llm.ollama_model || llm.model || "";
  }
  if (llm.mode === "local") {
    if (llm.model) return llm.model;
    const path = llm.local_model_path?.trim() || "";
    if (!path) return "";
    const segments = path.split(/[\\/]/).filter(Boolean);
    return segments[segments.length - 1] || path;
  }
  return llm.model || "";
}

export function useSessionParams(
  auPath: string,
  projectInfo: WriterProjectContext | null,
  settingsInfo: WriterSessionConfig | null,
  showSuccess: (msg: string) => void,
  showError: (err: unknown, fallback: string) => void,
) {
  const { t, i18n } = useTranslation();
  const guard = useActiveRequestGuard(auPath);

  const [sessionModel, setSessionModel] = useState(DEFAULT_DEEPSEEK_MODEL);
  const [sessionTemp, setSessionTemp] = useState(1.0);
  const [sessionTopP, setSessionTopP] = useState(0.95);

  // AU 切换时 reset 到默认值（bootstrap 随后会通过下方 useEffect 派生正确值）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——effect 仅随 auPath 变化重置会话参数到默认；auPath 只作触发键、体内不读取；删除会使切 AU 后残留上一篇的会话模型/温度
  useEffect(() => {
    setSessionModel(DEFAULT_DEEPSEEK_MODEL);
    setSessionTemp(1.0);
    setSessionTopP(0.95);
  }, [auPath]);

  // 从 bootstrap 加载的 projectInfo / settingsInfo 派生 session 默认值。
  // 原来这段逻辑在 bootstrap.loadData 里，通过 setSessionModel/Temp/TopP 反注入；
  // 现在改为 sessionParams 自己 watch + 派生，消除 sessionParamsBridgeRef。
  useEffect(() => {
    if (!projectInfo && !settingsInfo) return;

    let defModel = DEFAULT_DEEPSEEK_MODEL;
    let defTemp = 1.0;
    let defTopP = 0.95;

    const globalConfiguredModel = getConfiguredLlmModel(settingsInfo?.default_llm);
    if (globalConfiguredModel) {
      defModel = globalConfiguredModel;
      const globalParams = settingsInfo?.model_params?.[defModel];
      if (globalParams) {
        defTemp = globalParams.temperature;
        defTopP = globalParams.top_p;
      }
    }

    const projectConfiguredModel = getConfiguredLlmModel(projectInfo?.llm);
    if (projectConfiguredModel) {
      defModel = projectConfiguredModel;
    }
    if (projectInfo?.model_params_override?.[defModel]) {
      const override = projectInfo.model_params_override[defModel];
      defTemp = (override.temperature as number) ?? defTemp;
      defTopP = (override.top_p as number) ?? defTopP;
    }

    setSessionModel(defModel);
    setSessionTemp(defTemp);
    setSessionTopP(defTopP);
  }, [projectInfo, settingsInfo]);

  const handleSaveGlobalParams = useCallback(async () => {
    const requestAuPath = auPath;
    try {
      await saveGlobalModelParams(sessionModel, { temperature: sessionTemp, top_p: sessionTopP });
      if (guard.isKeyStale(requestAuPath)) return;
      showSuccess(t("writer.saveGlobalSuccess"));
    } catch (error) {
      if (guard.isKeyStale(requestAuPath)) return;
      showError(error, t("error_messages.unknown"));
    }
  }, [auPath, guard, sessionModel, sessionTemp, sessionTopP, showError, showSuccess, t]);

  const handleSaveAuParams = useCallback(async () => {
    const requestAuPath = auPath;
    try {
      await saveProjectModelParamsOverride(auPath, sessionModel, { temperature: sessionTemp, top_p: sessionTopP });
      if (guard.isKeyStale(requestAuPath)) return;
      showSuccess(t("writer.saveAuSuccess"));
    } catch (error) {
      if (guard.isKeyStale(requestAuPath)) return;
      showError(error, t("error_messages.unknown"));
    }
  }, [auPath, guard, sessionModel, sessionTemp, sessionTopP, showError, showSuccess, t]);

  // 当前生效配置源（AU 覆盖 > 全局默认）—— 会话层级 badge / 会话模型下拉共用判据
  const effectiveLlm = hasSessionLlmOverride(projectInfo?.llm) ? projectInfo?.llm : settingsInfo?.default_llm;

  /** 会话下拉的可选模型 = 生效供应商（按 api_base 匹配）的推荐 + 已启用 + 自定义模型。 */
  const sessionModelOptions: PickerModelOption[] = useMemo(() => {
    if (!effectiveLlm || (effectiveLlm.mode || "api") !== "api") return [];
    const lang: "zh" | "en" = i18n.resolvedLanguage === "en" ? "en" : "zh";
    const providers = buildPickerProviders(settingsInfo?.catalog ?? null, lang);
    const provider = matchProviderByBaseUrl(providers, effectiveLlm.api_base || "");
    return provider ? modelOptionsForProvider(provider, "chat") : [];
  }, [effectiveLlm, settingsInfo, i18n.resolvedLanguage]);

  /** 生效层级三态：会话临时 / AU 覆盖中 / 全局默认。 */
  const sessionLayer: SessionLayer = useMemo(
    () =>
      resolveSessionLayer({
        sessionModel,
        configuredModel: getConfiguredLlmModel(effectiveLlm),
        hasAuOverride: hasSessionLlmOverride(projectInfo?.llm),
      }),
    [sessionModel, effectiveLlm, projectInfo],
  );

  const sessionLlmPayload = useMemo(() => {
    if (!sessionModel) return null;

    const source = hasSessionLlmOverride(projectInfo?.llm) ? projectInfo?.llm : settingsInfo?.default_llm;

    // model 发会话层的 sessionModel：默认由上方 useEffect 镜像配置层模型（等价），
    // 用户在会话下拉临时改过时就是会话模型 —— 与 resolveSessionLayer 的「会话临时」badge 同口径。
    // （F-1 修复：旧实现发 getConfiguredLlmModel(source) 优先，会话选择永远不生效。）
    // 注意：不发送 api_key —— 后端 resolveLlmConfig 会从磁盘读取真实 key。
    return {
      mode: source?.mode || "api",
      model: sessionModel,
      api_base: source?.api_base || "",
      local_model_path: source?.local_model_path || "",
      ollama_model: source?.ollama_model || "",
    };
  }, [projectInfo, sessionModel, settingsInfo]);

  return {
    // state
    sessionModel,
    setSessionModel,
    sessionTemp,
    setSessionTemp,
    sessionTopP,
    setSessionTopP,

    // handlers
    handleSaveGlobalParams,
    handleSaveAuParams,

    // derived
    sessionLlmPayload,
    sessionLayer,
    sessionModelOptions,

    // helpers (re-exported for consumers that need them)
    hasSessionLlmOverride,
    getConfiguredLlmModel,
  };
}
