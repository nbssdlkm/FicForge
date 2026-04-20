// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useState } from 'react';

export function useWriterChromeState() {
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
    mobileToolsOpen,
    setMobileToolsOpen,
    rightCollapsed,
    isExportOpen,
    setExportOpen,
    isDirtyOpen,
    setDirtyOpen,
    dirtyTargetChapter,
    isFinalizeConfirmOpen,
    setFinalizeConfirmOpen,
    chapterTitle,
    setChapterTitle,
    isDiscardConfirmOpen,
    setDiscardConfirmOpen,
    isUndoConfirmOpen,
    setUndoConfirmOpen,
    dirtyBannerDismissed,
    setDirtyBannerDismissed,
    footerCollapsed,
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
