// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Button } from './shared/Button';
import { Input } from './shared/Input';
import { Modal } from './shared/Modal';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '../i18n/useAppTranslation';

export type LibraryModalsProps = {
  // Create fandom modal
  isFandomModalOpen: boolean;
  handleCloseFandomModal: () => void;
  newFandomName: string;
  setNewFandomName: (name: string) => void;
  handleCreateFandom: () => void;
  creatingFandom: boolean;

  // Create AU modal
  isAuModalOpen: boolean;
  setAuModalOpen: (open: boolean) => void;
  newAuName: string;
  setNewAuName: (name: string) => void;
  selectedFandom: string;
  handleCreateAu: () => void;
  creatingAu: boolean;

  // Delete confirmation modal
  deleteTarget: { type: 'fandom' | 'au'; fandomDir: string; fandomName: string; auName?: string } | null;
  setDeleteTarget: (target: { type: 'fandom' | 'au'; fandomDir: string; fandomName: string; auName?: string } | null) => void;
  handleDelete: () => void;
  deleting: boolean;
};

export function LibraryModals({
  isFandomModalOpen,
  handleCloseFandomModal,
  newFandomName,
  setNewFandomName,
  handleCreateFandom,
  creatingFandom,
  isAuModalOpen,
  setAuModalOpen,
  newAuName,
  setNewAuName,
  selectedFandom,
  handleCreateAu,
  creatingAu,
  deleteTarget,
  setDeleteTarget,
  handleDelete,
  deleting,
}: LibraryModalsProps) {
  const { t } = useTranslation();

  return (
    <>
      <Modal isOpen={isFandomModalOpen} onClose={creatingFandom ? () => {} : handleCloseFandomModal} title={t("library.createFandomModal.title")}>
        <p className="text-sm text-text/70 mb-5">{t("library.createFandomModal.description")}</p>
        <div className="flex flex-col gap-4">
          <Input placeholder={t("library.createFandomModal.namePlaceholder")} value={newFandomName} onChange={(e) => setNewFandomName(e.target.value)} className="w-full bg-surface/50 text-base" disabled={creatingFandom} />
          <Button tone="accent" fill="solid" className="mt-2 h-11 w-full font-medium tracking-wide" onClick={handleCreateFandom} disabled={creatingFandom || !newFandomName.trim()}>
            {creatingFandom ? <Loader2 size={16} className="animate-spin" /> : t("library.createFandomModal.submit")}
          </Button>
        </div>
      </Modal>

      <Modal isOpen={isAuModalOpen} onClose={creatingAu ? () => {} : () => setAuModalOpen(false)} title={t("library.createAuModal.title")}>
        <p className="text-sm text-text/70 mb-5 leading-relaxed">{t("library.createAuModal.description")}</p>
        <div className="flex flex-col gap-5">
          <Input placeholder={t("library.createAuModal.namePlaceholder")} value={newAuName} onChange={(e) => setNewAuName(e.target.value)} className="w-full bg-surface/50 text-base" disabled={creatingAu} />
          <div className="flex flex-col gap-2">
             <label className="text-sm font-bold text-text/90">{t("library.createAuModal.inheritLabel")}</label>
             <div className="flex min-h-[44px] items-center rounded-md border border-black/20 bg-surface/60 px-3 text-base text-text/75 dark:border-white/20 md:text-sm">
                {selectedFandom}
             </div>
          </div>
          <div className="flex flex-col gap-2">
             <label className="text-sm font-bold text-text/90">{t("library.createAuModal.initLabel")}</label>
             <div className="rounded-md border border-black/20 bg-surface/60 px-3 py-3 text-base text-text/75 dark:border-white/20 md:text-sm">
                {t("library.createAuModal.initGlobal")}
             </div>
          </div>
          <Button tone="accent" fill="solid" className="mt-2 h-11 w-full font-medium tracking-wide" onClick={handleCreateAu} disabled={creatingAu || !newAuName.trim()}>
            {creatingAu ? <Loader2 size={16} className="animate-spin" /> : t("library.createAuModal.submit")}
          </Button>
        </div>
      </Modal>

      <Modal isOpen={!!deleteTarget} onClose={deleting ? () => {} : () => setDeleteTarget(null)} title={deleteTarget?.type === 'fandom' ? t('library.deleteFandomTitle') : t('library.deleteAuTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/80 leading-relaxed">
            {deleteTarget?.type === 'fandom'
              ? t('library.deleteFandomMessage', { name: deleteTarget.fandomName })
              : t('library.deleteAuMessage', { name: deleteTarget?.auName || '' })}
          </p>
          <div className="flex justify-end gap-2">
            <Button tone="neutral" fill="plain" onClick={() => setDeleteTarget(null)} disabled={deleting}>{t("common.actions.cancel")}</Button>
            <Button tone="accent" fill="solid" className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 size={16} className="animate-spin" /> : t("common.actions.confirmDelete")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
