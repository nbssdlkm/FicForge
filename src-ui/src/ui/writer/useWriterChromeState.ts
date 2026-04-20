// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from 'react';

export function useWriterChromeState(auPath: string) {
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isExportOpen, setExportOpen] = useState(false);
  const [isDirtyOpen, setDirtyOpen] = useState(false);
  const [dirtyTargetChapter, setDirtyTargetChapter] = useState<number>(0);
  const [isFinalizeConfirmOpen, setFinalizeConfirmOpen] = useState(false);
  const [chapterTitle, setChapterTitle] = useState('');
  const [isDiscardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [isUndoConfirmOpen, setUndoConfirmOpen] = useState(false);
  const [dirtyBannerDismissed, setDirtyBannerDismissed] = useState(false);
  const [footerCollapsed, setFooterCollapsed] = useState(false);

  useEffect(() => {
    setMobileToolsOpen(false);
    setExportOpen(false);
    setDirtyOpen(false);
    setFinalizeConfirmOpen(false);
    setDiscardConfirmOpen(false);
    setUndoConfirmOpen(false);
    setDirtyBannerDismissed(false);
  }, [auPath]);

  const toggleRightCollapsed = useCallback(() => {
    setRightCollapsed((current) => !current);
  }, []);

  const openExport = useCallback(() => {
    setExportOpen(true);
  }, []);

  const closeExport = useCallback(() => {
    setExportOpen(false);
  }, []);

  const openDirty = useCallback((chapterNum: number) => {
    setDirtyTargetChapter(chapterNum);
    setDirtyOpen(true);
  }, []);

  const closeDirty = useCallback(() => {
    setDirtyOpen(false);
  }, []);

  const openFinalizeConfirm = useCallback(() => {
    setChapterTitle('');
    setFinalizeConfirmOpen(true);
  }, []);

  const closeFinalizeConfirm = useCallback(() => {
    setFinalizeConfirmOpen(false);
  }, []);

  const openDiscardConfirm = useCallback(() => {
    setDiscardConfirmOpen(true);
  }, []);

  const closeDiscardConfirm = useCallback(() => {
    setDiscardConfirmOpen(false);
  }, []);

  const openUndoConfirm = useCallback(() => {
    setUndoConfirmOpen(true);
  }, []);

  const closeUndoConfirm = useCallback(() => {
    setUndoConfirmOpen(false);
  }, []);

  const dismissDirtyBanner = useCallback(() => {
    setDirtyBannerDismissed(true);
  }, []);

  const toggleFooterCollapsed = useCallback(() => {
    setFooterCollapsed((current) => !current);
  }, []);

  const openMobileTools = useCallback(() => {
    setMobileToolsOpen(true);
  }, []);

  const closeMobileTools = useCallback(() => {
    setMobileToolsOpen(false);
  }, []);

  return {
    // values
    mobileToolsOpen,
    rightCollapsed,
    isExportOpen,
    isDirtyOpen,
    dirtyTargetChapter,
    isFinalizeConfirmOpen,
    chapterTitle,
    isDiscardConfirmOpen,
    isUndoConfirmOpen,
    dirtyBannerDismissed,
    footerCollapsed,

    // 用户事件 setter（受控组件/外部手动覆盖用，保留）：
    setChapterTitle,              // <input> 受控绑定
    setDirtyBannerDismissed,      // 外部一处调用（banner dismiss）

    // 语义化 method（推荐用法；原 raw setX 在 Phase 6.3 移除）
    toggleRightCollapsed,
    openExport,
    closeExport,
    openDirty,
    closeDirty,
    openFinalizeConfirm,
    closeFinalizeConfirm,
    openDiscardConfirm,
    closeDiscardConfirm,
    openUndoConfirm,
    closeUndoConfirm,
    dismissDirtyBanner,
    toggleFooterCollapsed,
    openMobileTools,
    closeMobileTools,
  };
}
