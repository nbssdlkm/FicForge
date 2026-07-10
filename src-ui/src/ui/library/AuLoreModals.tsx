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
import type { LoreCategory, LoreFileEntry } from './lore-utils';

export type AuLoreModalsProps = {
  // Create modal
  createModalOpen: boolean;
  closeCreate: () => void;
  createName: string;
  setCreateName: (name: string) => void; // 受控绑定（新建名 Input）
  selectedCategory: LoreCategory;
  handleCreate: () => void;

  // Delete modal
  deleteConfirmOpen: boolean;
  closeDeleteConfirm: () => void;
  selectedFile: string | null;
  handleDeleteLore: () => void;

  // Import modal
  importModalOpen: boolean;
  closeImport: () => void;
  importLoading: boolean;
  importCandidates: LoreFileEntry[];
  selectedImports: string[];
  handleToggleImport: (name: string) => void;
  handleImportSelected: () => void;
  isSaving: boolean;

  // Core limit modal
  coreLimitModalOpen: boolean;
  closeCoreLimit: () => void;
  coreLimitTarget: string | null;
  /** 「去补核心限制」→ 打开该角色文件进入编辑。 */
  openCharacterFile: (name: string) => void;
};

export function AuLoreModals({
  createModalOpen,
  closeCreate,
  createName,
  setCreateName,
  selectedCategory,
  handleCreate,
  deleteConfirmOpen,
  closeDeleteConfirm,
  selectedFile,
  handleDeleteLore,
  importModalOpen,
  closeImport,
  importLoading,
  importCandidates,
  selectedImports,
  handleToggleImport,
  handleImportSelected,
  isSaving,
  coreLimitModalOpen,
  closeCoreLimit,
  coreLimitTarget,
  openCharacterFile,
}: AuLoreModalsProps) {
  const { t } = useTranslation();

  return (
    <>
      <Modal isOpen={createModalOpen} onClose={closeCreate} title={selectedCategory === 'worldbuilding' ? t('auLore.createTitleWorldbuilding') : t('auLore.createTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/70">{selectedCategory === 'worldbuilding' ? t('auLore.createDescriptionWorldbuilding') : t('auLore.createDescription')}</p>
          <Input value={createName} onChange={e => setCreateName(e.target.value)} placeholder={selectedCategory === 'worldbuilding' ? t('auLore.createPlaceholderWorldbuilding') : t('auLore.createPlaceholder')} autoFocus />
          <div className="flex justify-end gap-2">
            <Button tone="neutral" fill="plain" onClick={closeCreate}>{t('common.actions.cancel')}</Button>
            <Button tone="accent" fill="solid" onClick={handleCreate} disabled={!createName.trim()}>{t('common.actions.create')}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={closeDeleteConfirm}
        onConfirm={handleDeleteLore}
        title={t('auLore.deleteTitle')}
        message={t('auLore.deleteMessage', { name: `${selectedFile}.md` })}
        destructive
        confirmLabel={t('common.actions.confirmDelete')}
      />

      <ConfirmDialog
        isOpen={coreLimitModalOpen}
        onClose={closeCoreLimit}
        onConfirm={() => {
          closeCoreLimit();
          if (coreLimitTarget) openCharacterFile(coreLimitTarget);
        }}
        title={t('coreIncludes.missingCoreLimit')}
        message={t('coreIncludes.missingCoreLimitDesc')}
        confirmLabel={t('coreIncludes.goEdit')}
        cancelLabel={t('coreIncludes.later')}
      />

      <Modal isOpen={importModalOpen} onClose={isSaving ? () => {} : closeImport} title={t('auLore.importTitle')}>
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
            <Button tone="neutral" fill="plain" onClick={closeImport} disabled={isSaving}>{t('common.actions.cancel')}</Button>
            <Button tone="accent" fill="solid" onClick={handleImportSelected} disabled={selectedImports.length === 0 || isSaving}>
              {isSaving ? <Spinner size="md" /> : t('common.actions.importSelected')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
