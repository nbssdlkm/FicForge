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
