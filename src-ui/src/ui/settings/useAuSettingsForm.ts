// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { saveAuSettingsForEditing, type ProjectInfo } from "../../api/engine-client";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";
import {
  buildAuSettingsSaveInput,
  createDefaultAuSettingsFormState,
  hydrateAuSettingsForm,
  type AuSettingsFormState,
} from "./form-mappers";

/**
 * useAuSettingsForm — AU 设置表单（AuSettingsFormState 单一对象）+ 保存动作。
 *
 * hydrate 只随 loadKey 触发（loadKey = useAuSettingsData 每次加载 settle +1），
 * project 经 ref shim 读取（hook 规则 4）。故意不把 project 放进 dep：
 * syncCastRegistry 局部更新 project 身份时，重灌会吞掉用户未保存的表单编辑。
 */
export function useAuSettingsForm(auPath: string, project: ProjectInfo | null, loadKey: number) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useFeedback();
  const guard = useActiveRequestGuard(auPath);

  const [form, setForm] = useState<AuSettingsFormState>(createDefaultAuSettingsFormState);
  const [saving, setSaving] = useState(false);

  const projectRef = useRef(project);
  projectRef.current = project;

  // 切 AU：先回默认值（加载期间不残留上一篇的表单），saving 一并复位
  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——体内全是 setter（非依赖），仅应随 auPath 变化回默认值；biome 判 auPath 多余，删掉会导致切 AU 不再复位（残留上一篇表单）
  useEffect(() => {
    setForm(createDefaultAuSettingsFormState());
    setSaving(false);
  }, [auPath]);

  // useLayoutEffect：hydrate 在 paint 前完成，避免 loading 结束帧闪现默认值
  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——hydrate 读 projectRef.current（ref，无需入依赖），仅应随 loadKey（加载完成信号）变化重灌；biome 判 loadKey 多余，删掉会导致加载完成后表单不 hydrate
  useLayoutEffect(() => {
    setForm(projectRef.current ? hydrateAuSettingsForm(projectRef.current) : createDefaultAuSettingsFormState());
    setSaving(false);
  }, [loadKey]);

  // 受控绑定 setter（hook 规则 5 例外①：select / input / textarea / toggle / picker 双向绑定）
  const fieldSetters = useMemo(() => {
    const set =
      <K extends keyof AuSettingsFormState>(key: K) =>
      (value: AuSettingsFormState[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }));
    return {
      setPerspective: set("perspective"),
      setEmotionStyle: set("emotionStyle"),
      setChapterLength: set("chapterLength"),
      setCustomInstructions: set("customInstructions"),
      setIsLlmOverride: set("isLlmOverride"),
      setLlmMode: set("llmMode"),
      setAuModel: set("auModel"),
      setAuOllamaModel: set("auOllamaModel"),
      setAuApiBase: set("auApiBase"),
      setAuApiKey: set("auApiKey"),
      setContextWindow: set("contextWindow"),
      setChatPath: set("chatPath"),
      setIsEmbeddingOverride: set("isEmbeddingOverride"),
      setEmbModel: set("embModel"),
      setEmbApiBase: set("embApiBase"),
      setEmbApiKey: set("embApiKey"),
    };
  }, []);

  // 铁律（pinned context）列表操作
  const addPinnedRule = useCallback(
    () => setForm((prev) => ({ ...prev, pinnedContext: [...prev.pinnedContext, ""] })),
    [],
  );
  const removePinnedRule = useCallback(
    (idx: number) => setForm((prev) => ({ ...prev, pinnedContext: prev.pinnedContext.filter((_, i) => i !== idx) })),
    [],
  );
  const updatePinnedRule = useCallback(
    (idx: number, value: string) =>
      setForm((prev) => ({ ...prev, pinnedContext: prev.pinnedContext.map((v, i) => (i === idx ? value : v)) })),
    [],
  );

  // 必带角色（core includes）列表操作；replaceCoreIncludes 供 cast 移除后与持久化结果对齐
  const addCoreInclude = useCallback(
    (name: string) => setForm((prev) => ({ ...prev, coreIncludes: [...prev.coreIncludes, name] })),
    [],
  );
  const removeCoreInclude = useCallback(
    (idx: number) => setForm((prev) => ({ ...prev, coreIncludes: prev.coreIncludes.filter((_, i) => i !== idx) })),
    [],
  );
  const replaceCoreIncludes = useCallback((next: string[]) => setForm((prev) => ({ ...prev, coreIncludes: next })), []);

  const save = async () => {
    const requestAuPath = auPath;
    setSaving(true);
    try {
      if (!projectRef.current) {
        throw new Error(t("settingsMode.error.projectUnavailable"));
      }
      await saveAuSettingsForEditing(auPath, buildAuSettingsSaveInput(form));
      if (guard.isKeyStale(requestAuPath)) return;
      showSuccess(t("common.actions.save"));
    } catch (e) {
      if (guard.isKeyStale(requestAuPath)) return;
      showError(e, t("error_messages.unknown"));
    } finally {
      if (!guard.isKeyStale(requestAuPath)) {
        setSaving(false);
      }
    }
  };

  return {
    form,
    saving,
    save,
    ...fieldSetters,
    addPinnedRule,
    removePinnedRule,
    updatePinnedRule,
    addCoreInclude,
    removeCoreInclude,
    replaceCoreIncludes,
  };
}
