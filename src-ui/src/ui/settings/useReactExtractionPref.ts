// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isReactExtractionEnabled } from "@ficforge/engine";
import { saveAppPreferences, type SettingsInfo } from "../../api/engine-client";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";

/**
 * useReactExtractionPref — 增强事实提取开关（M9，默认开 PD-4）。
 *
 * 即时保存偏好，不归「保存」按钮管辖、不计脏（与 GlobalSettingsFormState 分离的原因）。
 * toggle 乐观更新 + 落盘失败回滚。hydrate 同表单 hook：随 loadKey 触发、
 * settings 经 ref shim 读取（hook 规则 4）。
 */
export function useReactExtractionPref(isOpen: boolean, settings: SettingsInfo | null, loadKey: number) {
  const { t } = useTranslation();
  const { showError } = useFeedback();

  const [enabled, setEnabled] = useState(true);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——体内仅 setter（非依赖），仅应随 isOpen 变化重置为默认开；biome 判 isOpen 多余，删掉会导致重开面板不再复位
  useEffect(() => {
    setEnabled(true);
  }, [isOpen]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——读 settingsRef.current（ref，无需入依赖），仅应随 loadKey（加载完成信号）变化重灌开关；biome 判 loadKey 多余，删掉会导致加载完成后不 hydrate 开关
  useLayoutEffect(() => {
    setEnabled(isReactExtractionEnabled(settingsRef.current?.app));
  }, [loadKey]);

  const toggle = async (next: boolean) => {
    setEnabled(next);
    try {
      await saveAppPreferences({ react_extraction_enabled: next });
    } catch (err) {
      setEnabled(!next);
      showError(err, t("error_messages.unknown"));
    }
  };

  return { enabled, toggle };
}
