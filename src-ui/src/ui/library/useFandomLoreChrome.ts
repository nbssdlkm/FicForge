// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from "react";
import type { FandomLoreCategory, FandomLoreTab } from "./lore-utils";

/**
 * useFandomLoreChrome — Fandom 资料页界面镶边（对齐 useWriterChromeState 形态）：
 * 新建/删除弹窗、AI 面板开关、列表 tab、搜索词。
 * 列表 tab 与 AI 面板跨 fandom 保持（原折叠态行为）；搜索词与弹窗随 fandom 复位。
 */
export function useFandomLoreChrome(fandomPath: string | undefined) {
  // 列表视图当前 tab（角色/世界观/垃圾箱三段切换，2026-09-09 取代 folder 竖排堆叠）
  const [activeTab, setActiveTab] = useState<FandomLoreTab>("core_characters");
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalCategory, setCreateModalCategory] = useState<FandomLoreCategory>("core_characters");
  const [createName, setCreateName] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // 切 fandom 复位（hook 规则 2：state 与 reset 同文件）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——体内全是 setter（非依赖），仅应随 fandomPath 变化复位；biome 判 fandomPath 多余，删掉会导致切 fandom 不再复位（残留上一圈的搜索/弹窗）
  useEffect(() => {
    setSearchTerm("");
    setCreateModalOpen(false);
    setCreateName("");
    setDeleteConfirmOpen(false);
  }, [fandomPath]);

  const selectTab = useCallback((tab: FandomLoreTab) => setActiveTab(tab), []);
  const openAiPanel = useCallback(() => setAiPanelOpen(true), []);
  const closeAiPanel = useCallback(() => setAiPanelOpen(false), []);
  const openCreateModal = useCallback((category: FandomLoreCategory) => {
    setCreateModalCategory(category);
    setCreateName("");
    setCreateModalOpen(true);
  }, []);
  const closeCreateModal = useCallback(() => setCreateModalOpen(false), []);
  const openDeleteConfirm = useCallback(() => setDeleteConfirmOpen(true), []);
  const closeDeleteConfirm = useCallback(() => setDeleteConfirmOpen(false), []);

  return {
    activeTab,
    aiPanelOpen,
    searchTerm,
    createModalOpen,
    createModalCategory,
    createName,
    deleteConfirmOpen,
    selectTab,
    openAiPanel,
    closeAiPanel,
    openCreateModal,
    closeCreateModal,
    openDeleteConfirm,
    closeDeleteConfirm,
    setSearchTerm, // 受控绑定（搜索输入框 — hook 规则 5 例外①）
    setCreateName, // 受控绑定（新建弹窗输入框 — hook 规则 5 例外①）
  };
}
