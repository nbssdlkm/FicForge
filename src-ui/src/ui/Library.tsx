// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useState } from 'react';
import { Settings, BookOpen, Trash2 } from 'lucide-react';
import { Spinner } from "./shared/Spinner";
import { Button } from './shared/Button';
import { InlineBanner } from './shared/InlineBanner';
import { ThemeToggle } from './shared/ThemeToggle';
import { Modal } from './shared/Modal';
import { GlobalSettingsModal } from './settings/GlobalSettingsModal';
import { EmptyState } from './shared/EmptyState';
import { getDataDir } from '../api/engine-client';
import { useLibraryData } from '../hooks/useLibraryData';
import { TrashPanel } from './shared/TrashPanel';
import { useTranslation } from '../i18n/useAppTranslation';
import { FeedbackProvider, useFeedback } from '../hooks/useFeedback';
import { OnboardingFlow } from './onboarding/OnboardingFlow';
import type { OnboardingCompletion } from './onboarding/MobileOnboarding';
import { LibraryModals } from './LibraryModals';
import { LibraryFandomSections } from './library/LibraryFandomSections';
import { LibraryImportPanel } from './library/LibraryImportPanel';
import { useLibraryImportFlow } from './library/useLibraryImportFlow';
import { useLibraryMutations } from './library/useLibraryMutations';
import { useLibraryOnboardingGate } from './library/useLibraryOnboardingGate';

type Props = {
  onNavigate: (page: string, auPath?: string) => void;
};

function LibraryInner({ onNavigate }: Props) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const dataDir = getDataDir();
  const { fandoms, loading, loadFandoms } = useLibraryData();
  const [isGlobalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [isGlobalTrashOpen, setGlobalTrashOpen] = useState(false);
  const [trashTarget, setTrashTarget] = useState<{ fandomDir: string; fandomName: string } | null>(null);
  const [trashRefreshToken, setTrashRefreshToken] = useState(0);
  const {
    showOnboarding,
    setShowOnboarding,
    showApiWarning,
    dismissApiWarning,
  } = useLibraryOnboardingGate();
  const importFlow = useLibraryImportFlow({
    dataDir,
    loadFandoms,
    onNavigate,
    onError: (error) => showError(error, t("error_messages.unknown")),
    onOpenFandomModal: () => mutations.openFandomModal(),
  });
  const mutations = useLibraryMutations({
    dataDir,
    loadFandoms,
    onNavigate,
    onError: (error) => showError(error, t("error_messages.unknown")),
    onCreatedFandom: importFlow.handleCreatedFandom,
    onCloseFandomModal: importFlow.cancelPendingImportResume,
  });

  useEffect(() => {
    void loadFandoms();
  }, [loadFandoms]);

  const handleOnboardingComplete = (result?: OnboardingCompletion) => {
    setShowOnboarding(false);
    void loadFandoms().finally(() => {
      if (result?.openAuPath) {
        onNavigate('writer', result.openAuPath);
      } else if (result?.nextAction === 'open-import') {
        importFlow.openImportPicker();
      } else if (result?.nextAction === 'open-settings') {
        setGlobalSettingsOpen(true);
      }
    });
  };

  if (showOnboarding) {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="min-app-height bg-background text-text flex flex-col font-sans transition-colors duration-200">
      <header className="safe-area-top border-b border-black/10 dark:border-white/10 bg-surface px-4 py-3 md:h-16 md:px-6 transition-colors duration-200">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-serif text-xl font-bold">
            <BookOpen className="text-accent" />
            <span>{t("common.appName")}</span>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Button tone="neutral" fill="plain" size="sm" onClick={() => setGlobalSettingsOpen(true)} className="h-11 w-11 rounded-full p-0 md:h-10 md:w-10" title={t("settings.global.title")}>
              <Settings size={20} />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-5 pb-[calc(7rem+var(--safe-area-bottom))] md:p-8">
        <div className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl font-serif font-medium">{t("library.title")}</h1>
          <div className="flex flex-row items-center gap-2 sm:gap-3">
            <Button tone="neutral" fill="outline" size="sm" onClick={importFlow.openImportPicker} disabled={mutations.creatingFandom || mutations.creatingAu || mutations.deleting}>
              {t("common.actions.importOldWork")}
            </Button>
            <Button tone="neutral" fill="outline" size="sm" onClick={() => setGlobalTrashOpen(true)} disabled={mutations.creatingFandom || mutations.creatingAu || mutations.deleting}>
              <Trash2 size={14} className="mr-2" />
              {t("trash.title")}
            </Button>
            <Button size="sm" onClick={mutations.openFandomModal} disabled={mutations.creatingFandom || mutations.creatingAu || mutations.deleting}>
              {t("library.fandomButton")}
            </Button>
          </div>
        </div>

        {showApiWarning && (
          <InlineBanner
            className="mb-6"
            tone="warning"
            message={t('library.apiWarning')}
            actions={
              <Button tone="neutral" fill="outline" size="sm" onClick={() => { dismissApiWarning(); setGlobalSettingsOpen(true); }}>
                {t('library.apiWarningAction')}
              </Button>
            }
          />
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner size="lg" className="text-accent" />
            <span className="ml-3 text-text/70">{t("library.loading")}</span>
          </div>
        ) : fandoms.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={48} />}
            title={t("emptyState.library.title")}
            description={t("emptyState.library.description")}
            actions={[
              {
                key: "create-fandom",
                element: (
                  <Button onClick={mutations.openFandomModal}>
                    {t("common.actions.createFandom")}
                  </Button>
                ),
              },
              {
                key: "import-old-work",
                element: (
                  <Button tone="neutral" fill="outline" onClick={importFlow.openImportPicker}>
                    {t("common.actions.importOldWork")}
                  </Button>
                ),
              },
            ]}
          />
        ) : (
          <LibraryFandomSections
            dataDir={dataDir}
            fandoms={fandoms}
            creatingFandom={mutations.creatingFandom}
            creatingAu={mutations.creatingAu}
            deleting={mutations.deleting}
            onNavigate={onNavigate}
            onOpenAuModal={mutations.openAuModal}
            onOpenTrash={(fandomDir, fandomName) => setTrashTarget({ fandomDir, fandomName })}
            onDeleteFandom={mutations.openDeleteFandom}
            onDeleteAu={mutations.openDeleteAu}
          />
        )}
      </main>

      <LibraryModals
        isFandomModalOpen={mutations.isFandomModalOpen}
        handleCloseFandomModal={mutations.closeFandomModal}
        newFandomName={mutations.newFandomName}
        setNewFandomName={mutations.setNewFandomName}
        handleCreateFandom={mutations.handleCreateFandom}
        creatingFandom={mutations.creatingFandom}
        isAuModalOpen={mutations.isAuModalOpen}
        setAuModalOpen={mutations.setAuModalOpen}
        newAuName={mutations.newAuName}
        setNewAuName={mutations.setNewAuName}
        selectedFandom={mutations.selectedFandom}
        handleCreateAu={mutations.handleCreateAu}
        creatingAu={mutations.creatingAu}
        deleteTarget={mutations.deleteTarget}
        setDeleteTarget={mutations.setDeleteTarget}
        handleDelete={mutations.handleDelete}
        deleting={mutations.deleting}
      />

      <GlobalSettingsModal isOpen={isGlobalSettingsOpen} onClose={() => setGlobalSettingsOpen(false)} />

      <Modal isOpen={isGlobalTrashOpen} onClose={() => setGlobalTrashOpen(false)} title={t('trash.title')}>
        <TrashPanel
          scope="fandom"
          path={`${dataDir}/fandoms`}
          onRestore={() => { setTrashRefreshToken(v => v + 1); void loadFandoms(); }}
          refreshToken={trashRefreshToken}
        />
      </Modal>

      <LibraryImportPanel
        dataDir={dataDir}
        isOpen={importFlow.isImportModalOpen}
        importAuPath={importFlow.importAuPath}
        fandoms={fandoms}
        importSelectedFandom={importFlow.importSelectedFandom}
        importNewAuName={importFlow.importNewAuName}
        importCreatingAu={importFlow.importCreatingAu}
        onClose={importFlow.closeImportFlow}
        onRequestCreateFandom={importFlow.requestCreateFandomFromImport}
        onSelectAuPath={importFlow.setImportAuPath}
        onSelectFandom={importFlow.selectImportFandom}
        onImportNewAuNameChange={importFlow.setImportNewAuName}
        onCreateImportAu={importFlow.handleCreateImportAu}
        onComplete={importFlow.handleImportComplete}
      />

      <Modal isOpen={!!trashTarget} onClose={() => setTrashTarget(null)} title={`${t('trash.title')} - ${trashTarget?.fandomName || ''}`}>
        {trashTarget && (
          <TrashPanel
            scope="fandom"
            path={`${dataDir}/fandoms/${trashTarget.fandomDir}`}
            onRestore={() => { setTrashRefreshToken(v => v + 1); void loadFandoms(); }}
            refreshToken={trashRefreshToken}
          />
        )}
      </Modal>
    </div>
  );
}

export function Library(props: Props) {
  return (
    <FeedbackProvider>
      <LibraryInner {...props} />
    </FeedbackProvider>
  );
}
