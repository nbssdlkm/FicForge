// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Modal } from '../shared/Modal';
import { EmptyState } from '../shared/EmptyState';
import { Loader2, Download } from 'lucide-react';
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
            <Button variant="ghost" onClick={() => setCreateModalOpen(false)}>{t('common.actions.cancel')}</Button>
            <Button variant="primary" onClick={handleCreate} disabled={!createName.trim()}>{t('common.actions.create')}</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} title={t('auLore.deleteTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/80">{t('auLore.deleteMessage', { name: `${selectedFile}.md` })}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)}>{t('common.actions.cancel')}</Button>
            <Button variant="primary" className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDeleteLore}>{t('common.actions.confirmDelete')}</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={coreLimitModalOpen} onClose={() => setCoreLimitModalOpen(false)} title={t('coreIncludes.missingCoreLimit')}>
        <div className="space-y-4">
          <p className="text-sm text-text/80 leading-relaxed">{t('coreIncludes.missingCoreLimitDesc')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCoreLimitModalOpen(false)}>{t('coreIncludes.later')}</Button>
            <Button variant="primary" onClick={() => {
              setCoreLimitModalOpen(false);
              if (coreLimitTarget) loadFileContent(coreLimitTarget);
            }}>{t('coreIncludes.goEdit')}</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={importModalOpen} onClose={isSaving ? () => {} : () => setImportModalOpen(false)} title={t('auLore.importTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/70">{t('auLore.importDescription')}</p>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto rounded-lg border border-black/10 p-2 dark:border-white/10">
            {importLoading ? (
              <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-accent" /></div>
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
            <Button variant="ghost" onClick={() => setImportModalOpen(false)} disabled={isSaving}>{t('common.actions.cancel')}</Button>
            <Button variant="primary" onClick={handleImportSelected} disabled={selectedImports.length === 0 || isSaving}>
              {isSaving ? <Loader2 size={16} className="animate-spin" /> : t('common.actions.importSelected')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
