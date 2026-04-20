// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Plus, BookOpen, FileText, Trash2, ArchiveRestore } from 'lucide-react';
import { Card } from '../shared/Card';
import { Button } from '../shared/Button';
import { type FandomInfo } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';

type LibraryFandomSectionsProps = {
  dataDir: string;
  fandoms: FandomInfo[];
  creatingFandom: boolean;
  creatingAu: boolean;
  deleting: boolean;
  onNavigate: (page: string, auPath?: string) => void;
  onOpenAuModal: (fandomName: string, fandomDir: string) => void;
  onOpenTrash: (fandomDir: string, fandomName: string) => void;
  onDeleteFandom: (fandomDir: string, fandomName: string) => void;
  onDeleteAu: (fandomDir: string, fandomName: string, auDir: string, auName: string) => void;
};

export function LibraryFandomSections({
  dataDir,
  fandoms,
  creatingFandom,
  creatingAu,
  deleting,
  onNavigate,
  onOpenAuModal,
  onOpenTrash,
  onDeleteFandom,
  onDeleteAu,
}: LibraryFandomSectionsProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-8 md:space-y-12">
      {fandoms.map((fandom) => (
        <div key={fandom.name}>
          <div className="mb-4 flex flex-col gap-3 border-b border-black/10 pb-3 dark:border-white/10 md:flex-row md:items-center md:justify-between md:pb-2">
            <h2 className="text-xl font-sans font-semibold text-text/90">
              {t("common.scope.fandomTitle", { name: fandom.name })}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <Button tone="neutral" fill="outline" size="sm" onClick={() => onNavigate('fandom_lore', `${dataDir}/fandoms/${fandom.dir_name}`)} className="bg-surface/80 border-black/10 dark:border-white/10 text-text/70">
                <FileText size={14} className="mr-2 text-text/50" /> {t("library.fandomSectionButton")}
              </Button>
              <Button tone="neutral" fill="plain" size="sm" onClick={() => onOpenAuModal(fandom.name, fandom.dir_name)} disabled={creatingFandom || creatingAu || deleting}>
                <Plus size={14} className="mr-1" /> {t("library.createAuButton")}
              </Button>
              <Button tone="neutral" fill="plain" size="sm" className="text-text/50 hover:text-text/70" onClick={() => onOpenTrash(fandom.dir_name, fandom.name)} title={t('trash.tooltip')}>
                <ArchiveRestore size={14} />
              </Button>
              <Button tone="neutral" fill="plain" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => onDeleteFandom(fandom.dir_name, fandom.name)} disabled={creatingFandom || creatingAu || deleting}>
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {fandom.aus.length === 0 ? (
              <p className="text-text/50 text-sm col-span-3">{t("library.emptyAuList")}</p>
            ) : (
              fandom.aus.map((au) => (
                <Card
                  key={`${fandom.dir_name}/${au.dir_name}`}
                  className="relative cursor-pointer rounded-xl p-5 transition-colors hover:border-accent/50 group"
                  onClick={() => onNavigate('writer', `${dataDir}/fandoms/${fandom.dir_name}/aus/${au.dir_name}`)}
                >
                  <button
                    className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-md p-0 text-text/30 opacity-100 transition-opacity hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 md:h-9 md:w-9 md:opacity-0 md:group-hover:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteAu(fandom.dir_name, fandom.name, au.dir_name, au.name);
                    }}
                    title={t("common.actions.delete")}
                    disabled={creatingFandom || creatingAu || deleting}
                  >
                    <Trash2 size={14} />
                  </button>
                  <h3 className="text-lg font-sans font-medium mb-4">{t("common.scope.auTitle", { name: au.name })}</h3>
                  <div className="flex items-center text-sm text-text/70">
                    <span className="flex items-center gap-1"><BookOpen size={14} /> {t("library.cardType")}</span>
                  </div>
                </Card>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
