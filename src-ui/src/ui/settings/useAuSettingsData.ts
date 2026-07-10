// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from 'react';
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import {
  getProjectForEditing,
  getSettingsForEditing,
  getState,
  type ProjectInfo,
  type SettingsInfo,
} from '../../api/engine-client';
import { useFeedback } from '../../hooks/useFeedback';
import { useTranslation } from '../../i18n/useAppTranslation';

/**
 * useAuSettingsData — AU 设置页的只读数据拉取（project / 全局 settings / index 状态）。
 *
 * loadKey：每次加载 settle（成败皆算）+1，是表单 hook 重灌（hydrate）的唯一触发信号。
 * 表单不能直接依赖 project 的对象身份 —— syncCastRegistry 局部更新 project 时，
 * 若以 project 为 dep 会把用户未保存的表单编辑整体重灌掉。
 */
export function useAuSettingsData(auPath: string) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const guard = useActiveRequestGuard(auPath);

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [globalSettings, setGlobalSettings] = useState<SettingsInfo | null>(null);
  const [indexStatus, setIndexStatus] = useState('stale');
  const [loading, setLoading] = useState(true);
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    if (!auPath) return;
    setLoading(true);
    setProject(null);
    setGlobalSettings(null);
    setIndexStatus('stale');

    const token = guard.start();
    Promise.allSettled([
      getProjectForEditing(auPath),
      getSettingsForEditing(),
      getState(auPath),
    ]).then(([projResult, settingsResult, stateResult]) => {
      if (guard.isStale(token)) return;
      let firstError: unknown = null;
      const proj = projResult.status === 'fulfilled' ? projResult.value : null;
      const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null;
      const state = stateResult.status === 'fulfilled' ? stateResult.value : null;

      if (projResult.status === 'rejected') firstError = firstError || projResult.reason;
      if (settingsResult.status === 'rejected') firstError = firstError || settingsResult.reason;
      if (stateResult.status === 'rejected') firstError = firstError || stateResult.reason;

      setProject(proj);
      setGlobalSettings(settings);
      setIndexStatus(state?.index_status || 'stale');
      // 与 setProject 同一 commit 递增，保证表单 hydrate 读到的 projectRef 已是本次结果
      setLoadKey((k) => k + 1);
      if (firstError) {
        showError(firstError, t('error_messages.unknown'));
      }
    }).finally(() => {
      if (!guard.isStale(token)) {
        setLoading(false);
      }
    });
    // guard/showError/t 均为稳定引用，加载只应随 auPath 重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auPath]);

  /**
   * 语义化注入（hook 规则 3 的 bridge 例外）：把「刚持久化成功的 cast registry 变更」
   * 同步回本地 project 快照，不触发表单重灌（loadKey 不变）。
   */
  const syncCastRegistry = useCallback((characters: string[], coreIncludes: string[]) => {
    setProject((prev) => prev
      ? { ...prev, cast_registry: { ...prev.cast_registry, characters }, core_always_include: coreIncludes }
      : prev);
  }, []);

  return { project, globalSettings, indexStatus, loading, loadKey, syncCastRegistry };
}
