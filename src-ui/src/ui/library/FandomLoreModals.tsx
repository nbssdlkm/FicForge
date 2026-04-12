// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Modal } from '../shared/Modal';
import { useTranslation } from '../../i18n/useAppTranslation';

export type FandomLoreModalsProps = {
  // Create modal
  createModalOpen: boolean;
  setCreateModalOpen: (open: boolean) => void;
  createModalCategory: 'core_characters' | 'core_worldbuilding';
  createName: string;
  setCreateName: (name: string) => void;
  handleCreateLore: () => void;
  editorBusy: boolean;

  // Delete modal
  deleteConfirmOpen: boolean;
  setDeleteConfirmOpen: (open: boolean) => void;
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
  setCreateModalOpen,
  createModalCategory,
  createName,
  setCreateName,
  handleCreateLore,
  editorBusy,
  deleteConfirmOpen,
  setDeleteConfirmOpen,
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
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title={createModalCategory === 'core_characters' ? t('fandomLore.createCharacterTitle') : t('fandomLore.createWorldbuildingTitle')}>
        <div className="flex flex-col gap-4">
          <Input
            placeholder={createModalCategory === 'core_characters' ? t('fandomLore.characterPlaceholder') : t('fandomLore.worldbuildingPlaceholder')}
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            className="h-10"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateModalOpen(false)}>{t("common.actions.cancel")}</Button>
            <Button variant="primary" onClick={handleCreateLore} disabled={!createName.trim() || editorBusy}>{t("common.actions.create")}</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} title={t("fandomLore.deleteTitle")}>
        <div className="space-y-4">
          <p className="text-sm text-text/80">{t("fandomLore.deleteMessage", { name: selectedEntry?.filename || selectedFile || '' })}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)}>{t("common.actions.cancel")}</Button>
            <Button variant="primary" className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDeleteLore} disabled={editorBusy}>{t("common.actions.confirmDelete")}</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={discardChangesOpen} onClose={handleCancelDiscardChanges} title={t("fandomLore.discardChangesTitle")}>
        <div className="space-y-4">
          <p className="text-sm text-text/80">{t("fandomLore.discardChangesMessage")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={handleCancelDiscardChanges}>{t("common.actions.cancel")}</Button>
            <Button variant="primary" onClick={handleConfirmDiscardChanges}>{t("fandomLore.discardChangesConfirm")}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
