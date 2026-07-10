// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from "react";
import type { FandomCategory } from "./useMobileFandomFiles";

/**
 * useMobileFandomViewChrome — 圈子视图的界面编排：分类 tab、新建/删除弹窗、AI 助手 overlay。
 * 切圈子全部复位；语义化 open/close，不暴露 raw setter（对齐 useAuSettingsModals 形态）。
 */
export function useMobileFandomViewChrome(fandomPath: string) {
  const [category, setCategory] = useState<FandomCategory>("core_characters");
  const [aiOverlayOpen, setAiOverlayOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setCategory("core_characters");
    setAiOverlayOpen(false);
    setCreateOpen(false);
    setCreateName("");
    setDeleteOpen(false);
  }, [fandomPath]);

  const selectCategory = useCallback((cat: FandomCategory) => setCategory(cat), []);
  const openCreate = useCallback(() => {
    setCreateName("");
    setCreateOpen(true);
  }, []);
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  const openDelete = useCallback(() => setDeleteOpen(true), []);
  const closeDelete = useCallback(() => setDeleteOpen(false), []);
  const openAiOverlay = useCallback(() => setAiOverlayOpen(true), []);
  const closeAiOverlay = useCallback(() => setAiOverlayOpen(false), []);

  return {
    category,
    selectCategory,
    aiOverlayOpen,
    openAiOverlay,
    closeAiOverlay,
    createOpen,
    openCreate,
    closeCreate,
    createName,
    setCreateName, // 受控绑定（新建名 Input 双向绑定，hook 规则 5 例外①）
    deleteOpen,
    openDelete,
    closeDelete,
  };
}
