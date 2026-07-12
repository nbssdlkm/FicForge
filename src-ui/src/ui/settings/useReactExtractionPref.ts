// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

  useEffect(() => {
    setEnabled(true);
  }, [isOpen]);

  useLayoutEffect(() => {
    setEnabled(settingsRef.current?.app?.react_extraction_enabled !== false);
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
