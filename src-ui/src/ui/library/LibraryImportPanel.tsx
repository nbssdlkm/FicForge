// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Spinner } from "../shared/Spinner";
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Modal } from '../shared/Modal';
import { ImportFlow } from '../import/ImportFlow';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useTranslation } from '../../i18n/useAppTranslation';
import { type FandomInfo } from '../../api/engine-client';
import { type ImportSelectedFandom } from './useLibraryImportFlow';

type LibraryImportPanelProps = {
  dataDir: string;
  isOpen: boolean;
  importAuPath: string;
  fandoms: FandomInfo[];
  importSelectedFandom: ImportSelectedFandom;
  importNewAuName: string;
  importCreatingAu: boolean;
  onClose: () => void;
  onRequestCreateFandom: () => void;
  onSelectAuPath: (path: string) => void;
  onSelectFandom: (fandom: { name: string; dir: string }) => void;
  onImportNewAuNameChange: (name: string) => void;
  onCreateImportAu: (fandomDir: string) => void;
  onComplete: (target?: string) => void;
};

export function LibraryImportPanel({
  dataDir,
  isOpen,
  importAuPath,
  fandoms,
  importSelectedFandom,
  importNewAuName,
  importCreatingAu,
  onClose,
  onRequestCreateFandom,
  onSelectAuPath,
  onSelectFandom,
  onImportNewAuNameChange,
  onCreateImportAu,
  onComplete,
}: LibraryImportPanelProps) {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');

  return (
    <>
      <Modal
        isOpen={isOpen && !importAuPath}
        onClose={importCreatingAu ? () => {} : onClose}
        title={t('import.selectAu')}
      >
        <div className="space-y-4">
          <p className="text-sm text-text/70">{t('import.selectAuDesc')}</p>
          <div className="max-h-[50vh] overflow-y-auto space-y-4">
            {fandoms.length === 0 ? (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm text-text/50">{t('import.noFandom')}</p>
                <Button tone="accent" fill="solid" size="sm" onClick={onRequestCreateFandom}>
                  {t('import.createFandomFirst')}
                </Button>
              </div>
            ) : (
              fandoms.map((fandom) => (
                <div key={fandom.dir_name} className="space-y-1.5">
                  <div className="text-xs font-medium text-text/50 px-1">{fandom.name}</div>
                  {fandom.aus.map((au) => {
                    const auPath = `${dataDir}/fandoms/${fandom.dir_name}/aus/${au.dir_name}`;
                    return (
                      <button
                        key={auPath}
                        className="min-h-[44px] w-full rounded-lg border border-black/10 px-4 py-2.5 text-left transition-colors hover:border-accent/30 hover:bg-accent/5 dark:border-white/10"
                        onClick={() => onSelectAuPath(auPath)}
                      >
                        <div className="text-sm font-medium">{au.name}</div>
                      </button>
                    );
                  })}
                  {importSelectedFandom?.dir === fandom.dir_name ? (
                    <div className="flex gap-2 px-1">
                      <Input
                        className="flex-1 h-11 text-base md:h-8 md:text-sm"
                        placeholder={t('library.createAuModal.namePlaceholder')}
                        value={importNewAuName}
                        onChange={(event) => onImportNewAuNameChange(event.target.value)}
                        disabled={importCreatingAu}
                      />
                      <Button
                        tone="accent"
                        fill="solid"
                        size="sm"
                        className="h-11 shrink-0 md:h-8"
                        disabled={!importNewAuName.trim() || importCreatingAu}
                        onClick={() => onCreateImportAu(fandom.dir_name)}
                      >
                        {importCreatingAu ? <Spinner size="md" /> : t('common.actions.create')}
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="min-h-[44px] w-full rounded-lg px-4 py-2 text-left text-sm text-accent transition-colors hover:bg-accent/5"
                      onClick={() => onSelectFandom({ name: fandom.name, dir: fandom.dir_name })}
                    >
                      + {t('import.newAuInFandom')}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
          <div className={`flex ${isMobile ? 'justify-stretch' : 'justify-end'}`}>
            <Button tone="neutral" fill="plain" onClick={onClose} disabled={importCreatingAu}>
              {t('common.actions.cancel')}
            </Button>
          </div>
        </div>
      </Modal>

      <ImportFlow
        isOpen={isOpen && !!importAuPath}
        onClose={onClose}
        auPath={importAuPath}
        onComplete={onComplete}
      />
    </>
  );
}
