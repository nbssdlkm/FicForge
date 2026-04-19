// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useState } from 'react';
import { Settings, BookOpen } from 'lucide-react';
import { Spinner } from "./shared/Spinner";
import { Button } from './shared/Button';
import { InlineBanner } from './shared/InlineBanner';
import { ThemeToggle } from './shared/ThemeToggle';
import { Modal } from './shared/Modal';
import { GlobalSettingsModal } from './settings/GlobalSettingsModal';
import { EmptyState } from './shared/EmptyState';
import { createFandom, createAu, deleteFandom, deleteAu, getDataDir } from '../api/engine-client';
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
import { useLibraryOnboardingGate } from './library/useLibraryOnboardingGate';

type Props = {
  onNavigate: (page: string, auPath?: string) => void;
};

function LibraryInner({ onNavigate }: Props) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const dataDir = getDataDir();
  const { fandoms, loading, loadFandoms } = useLibraryData();
  const [isFandomModalOpen, setFandomModalOpen] = useState(false);
  const [isAuModalOpen, setAuModalOpen] = useState(false);
  const [isGlobalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [creatingFandom, setCreatingFandom] = useState(false);
  const [creatingAu, setCreatingAu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newFandomName, setNewFandomName] = useState('');
  const [newAuName, setNewAuName] = useState('');
  const [selectedFandom, setSelectedFandom] = useState('');
  const [selectedFandomDir, setSelectedFandomDir] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'fandom' | 'au'; fandomDir: string; fandomName: string; auName?: string } | null>(null);
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
    onOpenFandomModal: () => setFandomModalOpen(true),
  });

  useEffect(() => {
    void loadFandoms();
  }, [loadFandoms]);

  const handleCreateFandom = async () => {
    if (!newFandomName.trim() || creatingFandom) return;
    setCreatingFandom(true);
    try {
      const createdFandom = await createFandom(newFandomName.trim());
      setFandomModalOpen(false);
      setNewFandomName('');
      await loadFandoms();
      importFlow.handleCreatedFandom(createdFandom);
    } catch (e: any) {
      showError(e, t("error_messages.unknown"));
    } finally {
      setCreatingFandom(false);
    }
  };

  const handleCloseFandomModal = () => {
    setFandomModalOpen(false);
    importFlow.cancelPendingImportResume();
  };

  const handleCreateAu = async () => {
    if (!newAuName.trim() || !selectedFandomDir || creatingAu) return;
    setCreatingAu(true);
    try {
      const fandomPath = `${dataDir}/fandoms/${selectedFandomDir}`;
      const auName = newAuName.trim();
      await createAu(selectedFandomDir, auName, fandomPath);
      setAuModalOpen(false);
      setNewAuName('');
      onNavigate('writer', `${fandomPath}/aus/${auName}`);
    } catch (e: any) {
      showError(e, t("error_messages.unknown"));
    } finally {
      setCreatingAu(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      if (deleteTarget.type === 'fandom') {
        await deleteFandom(deleteTarget.fandomDir);
      } else {
        await deleteAu(deleteTarget.fandomDir, deleteTarget.auName!);
      }
      setDeleteTarget(null);
      await loadFandoms();
    } catch (e: any) {
      showError(e, t("error_messages.unknown"));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

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
            <Button tone="neutral" fill="outline" size="sm" onClick={importFlow.openImportPicker} disabled={creatingFandom || creatingAu || deleting}>
              {t("common.actions.importOldWork")}
            </Button>
            <Button size="sm" onClick={() => setFandomModalOpen(true)} disabled={creatingFandom || creatingAu || deleting}>
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
                  <Button onClick={() => setFandomModalOpen(true)}>
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
            creatingFandom={creatingFandom}
            creatingAu={creatingAu}
            deleting={deleting}
            onNavigate={onNavigate}
            onOpenAuModal={(fandomName, fandomDir) => {
              setSelectedFandom(fandomName);
              setSelectedFandomDir(fandomDir);
              setAuModalOpen(true);
            }}
            onOpenTrash={(fandomDir, fandomName) => setTrashTarget({ fandomDir, fandomName })}
            onDeleteFandom={(fandomDir, fandomName) => setDeleteTarget({ type: 'fandom', fandomDir, fandomName })}
            onDeleteAu={(fandomDir, fandomName, auName) => setDeleteTarget({ type: 'au', fandomDir, fandomName, auName })}
          />
        )}
      </main>

      <LibraryModals
        isFandomModalOpen={isFandomModalOpen}
        handleCloseFandomModal={handleCloseFandomModal}
        newFandomName={newFandomName}
        setNewFandomName={setNewFandomName}
        handleCreateFandom={handleCreateFandom}
        creatingFandom={creatingFandom}
        isAuModalOpen={isAuModalOpen}
        setAuModalOpen={setAuModalOpen}
        newAuName={newAuName}
        setNewAuName={setNewAuName}
        selectedFandom={selectedFandom}
        handleCreateAu={handleCreateAu}
        creatingAu={creatingAu}
        deleteTarget={deleteTarget}
        setDeleteTarget={setDeleteTarget}
        handleDelete={handleDelete}
        deleting={deleting}
      />

      <GlobalSettingsModal isOpen={isGlobalSettingsOpen} onClose={() => setGlobalSettingsOpen(false)} />

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
