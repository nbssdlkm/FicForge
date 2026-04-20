// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Modal } from '../shared/Modal';
import { Sidebar } from '../shared/Sidebar';
import { WriterSidePanelContent, type WriterSidePanelContentProps } from './WriterSidePanelContent';

type SharedSidePanelProps = Omit<
  WriterSidePanelContentProps,
  'isMobile' | 'onClose' | 'onUndoClick' | 'onExportClick' | 'currentChapter' | 'writeActionsDisabled'
>;

type WriterToolPanelsProps = {
  sidePanelProps: SharedSidePanelProps;
  rightCollapsed: boolean;
  onToggleRightCollapsed: () => void;
  mobileToolsOpen: boolean;
  onCloseMobileTools: () => void;
  onOpenUndo: () => void;
  onOpenExport: () => void;
  currentChapter: number;
  writeActionsDisabled: boolean;
  mobileToolsTitle: string;
};

export function WriterToolPanels({
  sidePanelProps,
  rightCollapsed,
  onToggleRightCollapsed,
  mobileToolsOpen,
  onCloseMobileTools,
  onOpenUndo,
  onOpenExport,
  currentChapter,
  writeActionsDisabled,
  mobileToolsTitle,
}: WriterToolPanelsProps) {
  return (
    <>
      <Sidebar
        position="right"
        width="320px"
        isCollapsed={rightCollapsed}
        onToggle={onToggleRightCollapsed}
        className="hidden flex-col bg-surface/50 border-l border-black/10 dark:border-white/10 md:flex"
      >
        <WriterSidePanelContent isMobile={false} {...sidePanelProps} />
      </Sidebar>

      <Modal isOpen={mobileToolsOpen} onClose={onCloseMobileTools} title={mobileToolsTitle}>
        <WriterSidePanelContent
          isMobile={true}
          onClose={onCloseMobileTools}
          onUndoClick={() => {
            onCloseMobileTools();
            onOpenUndo();
          }}
          onExportClick={() => {
            onCloseMobileTools();
            onOpenExport();
          }}
          currentChapter={currentChapter}
          writeActionsDisabled={writeActionsDisabled}
          {...sidePanelProps}
        />
      </Modal>
    </>
  );
}
