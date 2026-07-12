// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useMemo, useState } from "react";
import { getOnboardingDefaults } from "../../api/engine-client";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { useLlmConnectionTest } from "../../hooks/useConnectionTest";
import { useTranslation } from "../../i18n/useAppTranslation";
import { canTestLlmConnection, type LlmConfigFields } from "../shared/llm-config";
import {
  createDefaultMobileOnboardingSettings,
  hydrateMobileOnboardingSettings,
  type MobileOnboardingSettingsState,
} from "./form-mappers";

/**
 * useMobileOnboardingSettingsForm — 引导页设置表单（LLM + embedding 单一对象）
 * + 已有全局配置的加载水合 + LLM 连接测试 + API 帮助页开关。
 *
 * 默认值 / 水合 / 保存 payload 均出自 form-mappers（单一真相源），此处只持有状态。
 * 引导页组件生命周期内无 key 切换，水合只在挂载时跑一次。
 */
export function useMobileOnboardingSettingsForm() {
  const { t } = useTranslation();
  const loadGuard = useActiveRequestGuard("mobile-onboarding-defaults");

  const [form, setForm] = useState<MobileOnboardingSettingsState>(createDefaultMobileOnboardingSettings);
  const [loading, setLoading] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);

  const llmConnection = useLlmConnectionTest({
    getSuccessMessage: (result, fields) =>
      t("onboarding.apiConfig.testSuccess", { model: result.model || fields.model }),
    getFailureMessage: (result) => result.message || t("error_messages.unknown"),
    getExceptionMessage: (error) =>
      error instanceof Error ? error.message || t("error_messages.unknown") : t("error_messages.unknown"),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: 有意省依赖——hook 规则 4 ref-shim/边沿触发语义（见邻近注释）
  useEffect(() => {
    const token = loadGuard.start();
    setLoading(true);
    getOnboardingDefaults()
      .then((settings) => {
        if (loadGuard.isStale(token)) return;
        setForm(hydrateMobileOnboardingSettings(settings));
      })
      .catch(() => {
        // 引导页默认配置足够继续
      })
      .finally(() => {
        if (!loadGuard.isStale(token)) {
          setLoading(false);
        }
      });
    // loadGuard 引用稳定，挂载时一次性加载
  }, []);

  // LLM 字段一动，上一次连接测试结果即失效（回 idle）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 有意省依赖——hook 规则 4 ref-shim/边沿触发语义（见邻近注释）
  useEffect(() => {
    llmConnection.reset();
    // reset 引用稳定，只应随字段变化触发
  }, [form.apiBase, form.apiKey, form.model, form.chatPath]);

  // 受控绑定 setter（hook 规则 5 例外①：input / picker 双向绑定）
  const fieldSetters = useMemo(() => {
    const set =
      <K extends keyof MobileOnboardingSettingsState>(key: K) =>
      (value: MobileOnboardingSettingsState[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }));
    return {
      setApiBase: set("apiBase"),
      setApiKey: set("apiKey"),
      setModel: set("model"),
      setContextWindow: set("contextWindow"),
      setChatPath: set("chatPath"),
      // StepCard onClick 单选是用户事件而非双向绑定 → 动词命名（hook 规则 1/5，合并审阅）
      chooseCustomEmbedding: set("useCustomEmbedding"),
      setEmbeddingModel: set("embeddingModel"),
      setEmbeddingApiBase: set("embeddingApiBase"),
      setEmbeddingApiKey: set("embeddingApiKey"),
    };
  }, []);

  // 连接测试与真实生成同字段口径（含 chatPath，审计 5b）
  const llmFields: LlmConfigFields = {
    mode: "api",
    model: form.model,
    apiBase: form.apiBase,
    apiKey: form.apiKey,
    localModelPath: "",
    ollamaModel: "",
    chatPath: form.chatPath,
  };

  const testConnection = async () => {
    await llmConnection.run(llmFields);
  };

  return {
    form,
    loading,
    connectionStatus: llmConnection.status,
    connectionMessage: llmConnection.message,
    canTestConnection: canTestLlmConnection(llmFields),
    testConnection,
    helpOpen,
    openHelp: () => setHelpOpen(true),
    closeHelp: () => setHelpOpen(false),
    ...fieldSetters,
  };
}
