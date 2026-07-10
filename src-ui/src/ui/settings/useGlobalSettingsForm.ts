// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { saveGlobalSettingsForEditing, type SettingsInfo } from '../../api/engine-client';
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import { useFeedback } from '../../hooks/useFeedback';
import { useTranslation } from '../../i18n/useAppTranslation';
import {
  buildGlobalSettingsSaveInput,
  createDefaultGlobalSettingsFormState,
  hydrateGlobalSettingsForm,
  type GlobalSettingsFormState,
} from './form-mappers';

/**
 * 脏检查快照（R2-5）：只含「保存」按钮管辖的连接与模型选择字段。
 * 语言 / 提取开关 / 字体 / 服务商目录与模型清单是即时保存的，不计脏。
 * 用固定序数组序列化（对象键序随构造点漂移，字符串比对会误报）。
 *
 * contextWindow 计脏（per-model 覆盖后）：选择器的自动校正已放宽为「仅表单为空时 seed 一次」，
 * 不再每次打开就强制回填官方值 —— 常见情况（配置已存 ctx 值 → 打开时字段非空 → 不触发 seed）
 * 不再误报「打开就脏」。故把它纳入脏检查，让「只改了 ctx 覆盖就关窗」也能弹丢弃确认（否则该覆盖
 * 会被静默丢失）。仅遗留「权威模型 + 空 ctx 的迁移旧配置」打开时 seed 一次 → 罕见的一次性误报，
 * 首次保存后自愈。
 */
const formSnapshot = (f: GlobalSettingsFormState): string => JSON.stringify([
  f.mode, f.model, f.localModelPath, f.ollamaModel, f.apiBase, f.apiKey,
  f.contextWindow, f.chatPath, f.embeddingModel, f.embeddingApiBase, f.embeddingApiKey,
]);

/**
 * useGlobalSettingsForm — 全局设置表单（GlobalSettingsFormState 单一对象）
 * + 脏检查基线 + 保存动作。
 *
 * hydrate 只随 loadKey 触发（loadKey = useGlobalSettingsData 加载成功 +1），
 * settings 经 ref shim 读取（hook 规则 4）—— 不把 settings 放进 dep，
 * 表单编辑期间上游对象身份变化不得重灌吞掉未保存输入。
 */
export function useGlobalSettingsForm(isOpen: boolean, settings: SettingsInfo | null, loadKey: number) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useFeedback();
  const guard = useActiveRequestGuard(isOpen ? 'global-settings-open' : 'global-settings-closed');

  const [form, setForm] = useState<GlobalSettingsFormState>(createDefaultGlobalSettingsFormState);
  const [saving, setSaving] = useState(false);
  // 脏检查基线：hydrate / 保存成功后的表单快照（R2-5）。null = 尚未加载完成（视为不脏）。
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // 开/关都复位：加载期间与关闭后不残留上次表单，saving / 基线一并归零
  useEffect(() => {
    setForm(createDefaultGlobalSettingsFormState());
    setSaving(false);
    setSavedSnapshot(null);
  }, [isOpen]);

  // useLayoutEffect：hydrate 在 paint 前完成，避免 loading 结束帧闪现默认值
  useLayoutEffect(() => {
    const current = settingsRef.current;
    const hydrated = hydrateGlobalSettingsForm(current);
    setForm(hydrated);
    // 基线只在真实加载成功时建立（current 非 null）；mount 时 loadKey=0 的空跑保持 null
    setSavedSnapshot(current ? formSnapshot(hydrated) : null);
  }, [loadKey]);

  // memo：快照序列化只应随 form 变化重算，不随无关 re-render（如弹窗开合）重跑
  const currentSnapshot = useMemo(() => formSnapshot(form), [form]);
  const isDirty = savedSnapshot !== null && currentSnapshot !== savedSnapshot;

  // 受控绑定 setter（hook 规则 5 例外①：input / select / picker 双向绑定）
  const fieldSetters = useMemo(() => {
    const set = <K extends keyof GlobalSettingsFormState>(key: K) =>
      (value: GlobalSettingsFormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));
    return {
      setMode: set('mode'),
      setModel: set('model'),
      setLocalModelPath: set('localModelPath'),
      setOllamaModel: set('ollamaModel'),
      setApiBase: set('apiBase'),
      setApiKey: set('apiKey'),
      setContextWindow: set('contextWindow'),
      setChatPath: set('chatPath'),
      setEmbeddingModel: set('embeddingModel'),
      setEmbeddingApiBase: set('embeddingApiBase'),
      setEmbeddingApiKey: set('embeddingApiKey'),
    };
  }, []);

  const save = async () => {
    if (!settingsRef.current) return;
    const token = guard.start();
    setSaving(true);
    try {
      const snapshot = form;
      await saveGlobalSettingsForEditing(buildGlobalSettingsSaveInput(snapshot));
      if (guard.isStale(token)) return;
      // Don't auto-close — user explicitly asked to keep the modal open after
      // save so they can continue tweaking other sections without reopening.
      // A toast confirms the save landed.
      setSavedSnapshot(formSnapshot(snapshot));
      showSuccess(t('settings.global.savedToast'));
    } catch (error) {
      if (guard.isStale(token)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!guard.isStale(token)) {
        setSaving(false);
      }
    }
  };

  return {
    form,
    saving,
    isDirty,
    save,
    ...fieldSetters,
  };
}
