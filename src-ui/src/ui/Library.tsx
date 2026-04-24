// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useMemo, useState } from 'react';
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

  const stats = useMemo(() => {
    const totalAus = fandoms.reduce((sum, f) => sum + f.aus.length, 0);
    return [
      { value: fandoms.length, label: 'FANDOM' },
      { value: totalAus, label: t("library.cardType") },
    ];
  }, [fandoms, t]);
  const mutating = mutations.creatingFandom || mutations.creatingAu || mutations.deleting;

  if (showOnboarding) {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="min-app-height bg-background text-text flex flex-col font-sans transition-colors duration-200">
      {/* TOP BAR — brand seal + title italic, quiet chrome */}
      <header className="safe-area-top border-b border-rule bg-surface px-4 py-3 md:h-16 md:px-6 transition-colors duration-200">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border-[1.5px] border-accent"
            >
              <span className="font-display italic text-lg font-semibold leading-none text-accent">
                F
              </span>
              <span className="pointer-events-none absolute inset-[3px] rounded-[2px] border border-accent/50 opacity-60" />
            </div>
            <div className="leading-tight">
              <div className="font-display text-lg font-semibold tracking-[0.02em] text-text">
                {t("common.appName")}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">
                粮坊 · Fanfic
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              tone="neutral"
              fill="plain"
              size="sm"
              onClick={() => setGlobalSettingsOpen(true)}
              className="h-11 w-11 rounded-full p-0 md:h-10 md:w-10"
              title={t("settings.global.title")}
            >
              <Settings size={20} />
            </Button>
          </div>
        </div>
      </header>

      {/* HERO — Index of Works italic + CN subtitle + stats pills + primary actions */}
      <section className="border-b-4 border-double border-rule bg-background px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-display italic text-3xl font-medium uppercase leading-tight tracking-[0.04em] text-accent md:text-4xl">
              Index of Works
            </h1>
            <p className="mt-2 font-serif text-base tracking-[0.04em] text-ink-muted">
              {t("library.title")}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              {stats.map(({ value, label }) => (
                <span
                  key={label}
                  className="inline-flex items-baseline gap-1 rounded-full border border-rule bg-surface px-2.5 py-[3px]"
                >
                  <strong className="font-display text-sm font-semibold not-italic text-accent">
                    {value}
                  </strong>
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-row items-center gap-2 sm:gap-3">
            <Button
              tone="neutral"
              fill="outline"
              size="sm"
              onClick={importFlow.openImportPicker}
              disabled={mutating}
            >
              {t("common.actions.importOldWork")}
            </Button>
            <Button
              tone="neutral"
              fill="outline"
              size="sm"
              onClick={() => setGlobalTrashOpen(true)}
              disabled={mutating}
            >
              <Trash2 size={14} className="mr-2" />
              {t("trash.title")}
            </Button>
            <Button size="sm" onClick={mutations.openFandomModal} disabled={mutating}>
              {t("library.fandomButton")}
            </Button>
          </div>
        </div>
      </section>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 pb-[calc(7rem+var(--safe-area-bottom))] md:px-8 md:py-8">
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
