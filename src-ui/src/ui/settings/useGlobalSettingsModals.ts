// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from "react";

/**
 * useGlobalSettingsModals — 全局设置弹窗内两个子弹窗的开关
 * （对齐 useAuSettingsModals 形态）。开/关主弹窗全部复位，
 * 语义化 open/close，不暴露 raw setter。
 */
export function useGlobalSettingsModals(isOpen: boolean) {
  const [isApiHelpOpen, setApiHelpOpen] = useState(false);
  const [isDiscardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——体内全是 setter（非依赖），仅应随 isOpen 变化关闭子弹窗；biome 判 isOpen 多余，删掉会导致开/关面板不再复位（残留打开的子弹窗）
  useEffect(() => {
    setApiHelpOpen(false);
    setDiscardConfirmOpen(false);
  }, [isOpen]);

  const openApiHelp = useCallback(() => setApiHelpOpen(true), []);
  const closeApiHelp = useCallback(() => setApiHelpOpen(false), []);
  const openDiscardConfirm = useCallback(() => setDiscardConfirmOpen(true), []);
  const closeDiscardConfirm = useCallback(() => setDiscardConfirmOpen(false), []);

  return {
    isApiHelpOpen,
    isDiscardConfirmOpen,
    openApiHelp,
    closeApiHelp,
    openDiscardConfirm,
    closeDiscardConfirm,
  };
}
