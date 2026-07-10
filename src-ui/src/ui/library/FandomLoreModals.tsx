// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Modal } from '../shared/Modal';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { useTranslation } from '../../i18n/useAppTranslation';
import type { FandomLoreCategory } from './lore-utils';

export type FandomLoreModalsProps = {
  // Create modal
  createModalOpen: boolean;
  closeCreateModal: () => void;
  createModalCategory: FandomLoreCategory;
  createName: string;
  setCreateName: (name: string) => void; // 受控绑定（新建输入框）
  handleCreateLore: () => void;
  editorBusy: boolean;

  // Delete modal
  deleteConfirmOpen: boolean;
  closeDeleteConfirm: () => void;
  selectedEntry: { filename: string } | null;
  selectedFile: string | null;
  handleDeleteLore: () => void;

  // Discard changes modal
  discardChangesOpen: boolean;
  handleCancelDiscardChanges: () => void;
  handleConfirmDiscardChanges: () => void;
};

export function FandomLoreModals({
  createModalOpen,
  closeCreateModal,
  createModalCategory,
  createName,
  setCreateName,
  handleCreateLore,
  editorBusy,
  deleteConfirmOpen,
  closeDeleteConfirm,
  selectedEntry,
  selectedFile,
  handleDeleteLore,
  discardChangesOpen,
  handleCancelDiscardChanges,
  handleConfirmDiscardChanges,
}: FandomLoreModalsProps) {
  const { t } = useTranslation();

  return (
    <>
      <Modal isOpen={createModalOpen} onClose={closeCreateModal} title={createModalCategory === 'core_characters' ? t('fandomLore.createCharacterTitle') : t('fandomLore.createWorldbuildingTitle')}>
        <div className="flex flex-col gap-4">
          <Input
            placeholder={createModalCategory === 'core_characters' ? t('fandomLore.characterPlaceholder') : t('fandomLore.worldbuildingPlaceholder')}
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            className="h-10"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button tone="neutral" fill="plain" onClick={closeCreateModal}>{t("common.actions.cancel")}</Button>
            <Button tone="accent" fill="solid" onClick={handleCreateLore} disabled={!createName.trim() || editorBusy}>{t("common.actions.create")}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={closeDeleteConfirm}
        onConfirm={handleDeleteLore}
        title={t("fandomLore.deleteTitle")}
        message={t("fandomLore.deleteMessage", { name: selectedEntry?.filename || selectedFile || '' })}
        destructive
        confirmLabel={t('common.actions.confirmDelete')}
        loading={editorBusy}
      />

      <ConfirmDialog
        isOpen={discardChangesOpen}
        onClose={handleCancelDiscardChanges}
        onConfirm={handleConfirmDiscardChanges}
        title={t('fandomLore.discardChangesTitle')}
        message={t('fandomLore.discardChangesMessage')}
        confirmLabel={t('fandomLore.discardChangesConfirm')}
      />
    </>
  );
}
