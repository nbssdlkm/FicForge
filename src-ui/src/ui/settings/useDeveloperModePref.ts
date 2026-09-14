// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isDeveloperMode, setDebugCaptureEnabled } from "@ficforge/engine";
import { saveAppPreferences, type SettingsInfo } from "../../api/engine-client";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";

/**
 * useDeveloperModePref — 开发者模式开关（2026-09-08 调试观测面，默认关）。
 *
 * 与 useReactExtractionPref 同款接线：即时保存偏好，不归「保存」按钮管辖、不计脏；
 * toggle 乐观更新 + 落盘失败回滚。额外职责：开关变更与 hydrate 时同步引擎侧
 * setDebugCaptureEnabled（关 = 引擎清空缓冲，零保留）。
 */
export function useDeveloperModePref(isOpen: boolean, settings: SettingsInfo | null, loadKey: number) {
  const { t } = useTranslation();
  const { showError } = useFeedback();

  const [enabled, setEnabled] = useState(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——体内仅 setter（非依赖），仅应随 isOpen 变化重置为默认关；biome 判 isOpen 多余，删掉会导致重开面板不再复位
  useEffect(() => {
    setEnabled(false);
  }, [isOpen]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——读 settingsRef.current（ref，无需入依赖），仅应随 loadKey（加载完成信号）变化重灌开关；biome 判 loadKey 多余，删掉会导致加载完成后不 hydrate 开关
  useLayoutEffect(() => {
    const app = settingsRef.current?.app;
    // settings 未加载时绝不碰引擎开关（2026-09-09 实测抓获）：弹窗常驻挂载，关闭状态下
    // 挂载时机 settings=null → isDeveloperMode(null)=false 会把 bootstrap 刚同步的
    // 引擎捕获开关误关，表现为「开关持久化是开的，但捕获永远不工作」。
    if (app == null) return;
    const next = isDeveloperMode(app);
    setEnabled(next);
    setDebugCaptureEnabled(next);
  }, [loadKey]);

  const toggle = async (next: boolean) => {
    setEnabled(next);
    // 引擎开关先行（内存态，即生即效）：等持久化完成再同步会留出「已开但捕获未开」
    // 的竞态窗口（对抗审 2026-09-09）。保存失败时连同引擎开关一起回滚。
    setDebugCaptureEnabled(next);
    try {
      await saveAppPreferences({ developer_mode: next });
    } catch (err) {
      setEnabled(!next);
      setDebugCaptureEnabled(!next);
      showError(err, t("error_messages.unknown"));
    }
  };

  return { enabled, toggle };
}
