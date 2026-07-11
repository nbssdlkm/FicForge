// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useSimpleChatChrome — 面板 chrome 状态（设置抽屉 / 清空确认 / 字号行距）。
 *
 * drawerOpen / clearChatConfirmOpen 是纯 UI 开关，切 AU 归位；字号 / 行距走 useKV
 * （全局偏好，跨 AU 持久，不随 auPath reset —— 与旧集中 reset 块口径一致）。
 */

import { useCallback, useEffect, useState } from "react";
import { useKV } from "../../hooks/useKV";

export function useSimpleChatChrome(auPath: string) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [clearChatConfirmOpen, setClearChatConfirmOpen] = useState(false);

  const [fontSizeStr, setFontSizeKV] = useKV("ficforge.fontSize", "18");
  const [lineHeightStr, setLineHeightKV] = useKV("ficforge.lineHeight", "1.8");
  const fontSize = parseInt(fontSizeStr, 10) || 18;
  const lineHeight = parseFloat(lineHeightStr) || 1.8;

  // 切 AU reset（铁律②：state 与 reset 同文件）
  useEffect(() => {
    setDrawerOpen(false);
    setClearChatConfirmOpen(false);
  }, [auPath]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openClearChatConfirm = useCallback(() => setClearChatConfirmOpen(true), []);
  const closeClearChatConfirm = useCallback(() => setClearChatConfirmOpen(false), []);

  // 受控绑定（hook 规则 5 例外①：SimpleSettingsDrawer 字号/行距滑杆的双向绑定）
  const setFontSize = useCallback((v: number) => setFontSizeKV(String(v)), [setFontSizeKV]);
  const setLineHeight = useCallback((v: number) => setLineHeightKV(String(v)), [setLineHeightKV]);

  return {
    drawerOpen,
    openDrawer,
    closeDrawer,
    clearChatConfirmOpen,
    openClearChatConfirm,
    closeClearChatConfirm,
    fontSize,
    setFontSize, // 受控绑定（hook 规则 5 例外①：drawer 滑杆双向绑定）
    lineHeight,
    setLineHeight, // 受控绑定（hook 规则 5 例外①：drawer 滑杆双向绑定）
  };
}
