// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useState } from 'react';
import { getSettingsForEditing, getDisplayDataDir, type SettingsInfo } from '../../api/engine-client';
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import { useFeedback } from '../../hooks/useFeedback';
import { useTranslation } from '../../i18n/useAppTranslation';
import { catchAndLog } from '../../utils/ui-logger';

/**
 * useGlobalSettingsData — 全局设置弹窗的只读数据拉取（settings / 数据目录展示路径）。
 *
 * loadKey：settings 加载成功 +1，是表单 hook hydrate 的唯一触发信号
 * （与 useAuSettingsData 的 settle 语义不同：这里失败不递增 —— 原实现失败时
 * 不 hydrate、脏检查基线保持 null，保留该行为）。
 * displayDataDir 独立拉取、失败只落日志不打断（展示性信息，非关键路径）。
 */
export function useGlobalSettingsData(isOpen: boolean) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const guard = useActiveRequestGuard(isOpen ? 'global-settings-open' : 'global-settings-closed');

  const [settings, setSettings] = useState<SettingsInfo | null>(null);
  const [displayDataDir, setDisplayDataDir] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setSettings(null);
      setDisplayDataDir('');
      setLoading(false);
      return;
    }
    const token = guard.start();
    setLoading(true);
    setSettings(null);
    getDisplayDataDir().then((dir) => {
      if (!guard.isStale(token)) setDisplayDataDir(dir);
    }).catch(catchAndLog('globalSettings', 'getDisplayDataDir failed'));
    getSettingsForEditing().then((res) => {
      if (guard.isStale(token)) return;
      setSettings(res);
      // 与 setSettings 同一 commit 递增，保证表单 hydrate 读到的 settingsRef 已是本次结果
      setLoadKey((k) => k + 1);
    }).catch((error) => {
      if (guard.isStale(token)) return;
      showError(error, t('error_messages.unknown'));
    }).finally(() => {
      if (!guard.isStale(token)) {
        setLoading(false);
      }
    });
    // guard/showError/t 均为稳定引用，加载只应随开关重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return { settings, displayDataDir, loading, loadKey };
}
