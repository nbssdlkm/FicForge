// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect } from 'react';

type UseWriterResetOnAuChangeOptions = {
  auPath: string;
  setIsSettingsModeBusy: (busy: boolean) => void;
  setFocusSelection: (focus: string[]) => void;
  setLastConfirmedChapter: (chapter: number | null) => void;
  setUndoConfirmOpen: (open: boolean) => void;
  setDirtyBannerDismissed: (dismissed: boolean) => void;
  setIsFinalizing: (finalizing: boolean) => void;
  setIsDiscarding: (discarding: boolean) => void;
  setInstructionText: (text: string) => void;
  setFinalizeConfirmOpen: (open: boolean) => void;
  setDiscardConfirmOpen: (open: boolean) => void;
  setDirtyOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
  setMobileToolsOpen: (open: boolean) => void;
  resetFactsExtraction: () => void;
};

export function useWriterResetOnAuChange({
  auPath,
  setIsSettingsModeBusy,
  setFocusSelection,
  setLastConfirmedChapter,
  setUndoConfirmOpen,
  setDirtyBannerDismissed,
  setIsFinalizing,
  setIsDiscarding,
  setInstructionText,
  setFinalizeConfirmOpen,
  setDiscardConfirmOpen,
  setDirtyOpen,
  setExportOpen,
  setMobileToolsOpen,
  resetFactsExtraction,
}: UseWriterResetOnAuChangeOptions) {
  useEffect(() => {
    setIsSettingsModeBusy(false);
    setFocusSelection([]);
    setLastConfirmedChapter(null);
    setUndoConfirmOpen(false);
    setDirtyBannerDismissed(false);
    setIsFinalizing(false);
    setIsDiscarding(false);
    resetFactsExtraction();
    setInstructionText('');
    setFinalizeConfirmOpen(false);
    setDiscardConfirmOpen(false);
    setDirtyOpen(false);
    setExportOpen(false);
    setMobileToolsOpen(false);
  }, [
    auPath,
    resetFactsExtraction,
    setDirtyBannerDismissed,
    setDirtyOpen,
    setDiscardConfirmOpen,
    setExportOpen,
    setFinalizeConfirmOpen,
    setFocusSelection,
    setInstructionText,
    setIsDiscarding,
    setIsFinalizing,
    setIsSettingsModeBusy,
    setLastConfirmedChapter,
    setMobileToolsOpen,
    setUndoConfirmOpen,
  ]);
}
