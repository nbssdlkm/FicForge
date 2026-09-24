// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from "react";
import type { FandomCategory } from "./useMobileFandomFiles";
import type { FandomLoreTab } from "../library/lore-utils";

/**
 * useMobileFandomViewChrome — 圈子视图的界面编排：分类 tab、新建/删除弹窗、AI 助手 overlay。
 * 切圈子全部复位；语义化 open/close，不暴露 raw setter（对齐 useAuSettingsModals 形态）。
 */
export function useMobileFandomViewChrome(fandomPath: string) {
  // 列表视图当前 tab（角色/世界观/垃圾箱三段切换，2026-09-09 与桌面端拉齐）
  const [activeTab, setActiveTab] = useState<FandomLoreTab>("core_characters");
  const [category, setCategory] = useState<FandomCategory>("core_characters");
  const [aiOverlayOpen, setAiOverlayOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——体内全是 setter（非依赖），仅应随 fandomPath 变化复位；biome 判 fandomPath 多余，删掉会导致切圈子不再复位（残留上一圈的分类/弹窗）
  useEffect(() => {
    setActiveTab("core_characters");
    setCategory("core_characters");
    setAiOverlayOpen(false);
    setCreateOpen(false);
    setCreateName("");
    setDeleteOpen(false);
  }, [fandomPath]);

  /** 切 tab；内容分类同步进 category 作新建目标（本视图打开文件是全屏 overlay，tab 不可点，无编辑中错类风险）。 */
  const selectTab = useCallback((tab: FandomLoreTab) => {
    setActiveTab(tab);
    if (tab !== "trash") setCategory(tab);
  }, []);
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
    activeTab,
    selectTab,
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
