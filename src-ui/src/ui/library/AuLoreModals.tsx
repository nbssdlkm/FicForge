// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Spinner } from "../shared/Spinner";
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Modal } from '../shared/Modal';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { EmptyState } from '../shared/EmptyState';
import { Download } from 'lucide-react';
import { useTranslation } from '../../i18n/useAppTranslation';

type LoreFileEntry = {
  name: string;
  filename: string;
};

export type AuLoreModalsProps = {
  // Create modal
  createModalOpen: boolean;
  setCreateModalOpen: (open: boolean) => void;
  createName: string;
  setCreateName: (name: string) => void;
  selectedCategory: 'characters' | 'worldbuilding';
  handleCreate: () => void;

  // Delete modal
  deleteConfirmOpen: boolean;
  setDeleteConfirmOpen: (open: boolean) => void;
  selectedFile: string | null;
  handleDeleteLore: () => void;

  // Import modal
  importModalOpen: boolean;
  setImportModalOpen: (open: boolean) => void;
  importLoading: boolean;
  importCandidates: LoreFileEntry[];
  selectedImports: string[];
  handleToggleImport: (name: string) => void;
  handleImportSelected: () => void;
  isSaving: boolean;

  // Core limit modal
  coreLimitModalOpen: boolean;
  setCoreLimitModalOpen: (open: boolean) => void;
  coreLimitTarget: string | null;
  loadFileContent: (name: string) => void;
};

export function AuLoreModals({
  createModalOpen,
  setCreateModalOpen,
  createName,
  setCreateName,
  selectedCategory,
  handleCreate,
  deleteConfirmOpen,
  setDeleteConfirmOpen,
  selectedFile,
  handleDeleteLore,
  importModalOpen,
  setImportModalOpen,
  importLoading,
  importCandidates,
  selectedImports,
  handleToggleImport,
  handleImportSelected,
  isSaving,
  coreLimitModalOpen,
  setCoreLimitModalOpen,
  coreLimitTarget,
  loadFileContent,
}: AuLoreModalsProps) {
  const { t } = useTranslation();

  return (
    <>
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title={selectedCategory === 'worldbuilding' ? t('auLore.createTitleWorldbuilding') : t('auLore.createTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/70">{selectedCategory === 'worldbuilding' ? t('auLore.createDescriptionWorldbuilding') : t('auLore.createDescription')}</p>
          <Input value={createName} onChange={e => setCreateName(e.target.value)} placeholder={selectedCategory === 'worldbuilding' ? t('auLore.createPlaceholderWorldbuilding') : t('auLore.createPlaceholder')} autoFocus />
          <div className="flex justify-end gap-2">
            <Button tone="neutral" fill="plain" onClick={() => setCreateModalOpen(false)}>{t('common.actions.cancel')}</Button>
            <Button tone="accent" fill="solid" onClick={handleCreate} disabled={!createName.trim()}>{t('common.actions.create')}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDeleteLore}
        title={t('auLore.deleteTitle')}
        message={t('auLore.deleteMessage', { name: `${selectedFile}.md` })}
        destructive
        confirmLabel={t('common.actions.confirmDelete')}
      />

      <ConfirmDialog
        isOpen={coreLimitModalOpen}
        onClose={() => setCoreLimitModalOpen(false)}
        onConfirm={() => {
          setCoreLimitModalOpen(false);
          if (coreLimitTarget) loadFileContent(coreLimitTarget);
        }}
        title={t('coreIncludes.missingCoreLimit')}
        message={t('coreIncludes.missingCoreLimitDesc')}
        confirmLabel={t('coreIncludes.goEdit')}
        cancelLabel={t('coreIncludes.later')}
      />

      <Modal isOpen={importModalOpen} onClose={isSaving ? () => {} : () => setImportModalOpen(false)} title={t('auLore.importTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/70">{t('auLore.importDescription')}</p>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto rounded-lg border border-black/10 p-2 dark:border-white/10">
            {importLoading ? (
              <div className="flex justify-center py-8"><Spinner size="md" className="text-accent" /></div>
            ) : importCandidates.length === 0 ? (
              <EmptyState compact icon={<Download size={28} />} title={t('auLore.importEmpty')} description={t('fandomLore.referenceHint')} />
            ) : (
              importCandidates.map(file => (
                <label key={file.name} className="flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedImports.includes(file.name)}
                    onChange={() => handleToggleImport(file.name)}
                    className="accent-accent"
                  />
                  <span className="text-sm">{file.name}</span>
                </label>
              ))
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button tone="neutral" fill="plain" onClick={() => setImportModalOpen(false)} disabled={isSaving}>{t('common.actions.cancel')}</Button>
            <Button tone="accent" fill="solid" onClick={handleImportSelected} disabled={selectedImports.length === 0 || isSaving}>
              {isSaving ? <Spinner size="md" /> : t('common.actions.importSelected')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
