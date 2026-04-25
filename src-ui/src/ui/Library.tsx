// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useMemo, useState } from 'react';
import { Settings, BookOpen, Trash2, Plus } from 'lucide-react';
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

  // Hero stats — 3 numbers: fandoms / AUs / total chapters across all AUs.
  // chapter_count is enriched by listFandoms via state.yaml, falls back to 0.
  const stats = useMemo(() => {
    const totalAus = fandoms.reduce((sum, f) => sum + f.aus.length, 0);
    const totalChapters = fandoms.reduce(
      (sum, f) => sum + f.aus.reduce((s, au) => s + (au.chapter_count ?? 0), 0),
      0,
    );
    return [
      { value: fandoms.length, label: 'FANDOM' },
      { value: totalAus, label: t('library.cardType') },
      { value: totalChapters, label: '章' },
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
              <div className="font-sans text-[10px] font-medium uppercase tracking-[0.18em] text-gold">
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

      {/* HERO — v13 .app-hero: title-anchored left, primary CTA floats top
          right, ornament + stats pills below the subtitle, secondary
          actions on the same row as the pills (right-aligned). */}
      <section className="relative border-b border-rule bg-background px-4 py-6 md:px-8 md:py-9">
        <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-3">
          {/* Primary CTA — absolute top-right of the hero, mirrors v13
              .new-btn (sage bg + cream text, rectangular not pill). */}
          <Button
            size="sm"
            onClick={mutations.openFandomModal}
            disabled={mutating}
            className="absolute right-0 top-0 h-9 px-4 font-sans text-[11px] font-medium uppercase tracking-[0.08em]"
          >
            <Plus size={14} className="mr-1" />
            {t('library.fandomButton')}
          </Button>

          <h1 className="font-display italic text-3xl font-medium uppercase leading-[1.05] tracking-[0.04em] text-accent md:text-[42px]">
            Index of Works
          </h1>
          <p className="font-serif text-base tracking-[0.04em] text-ink-muted">
            {t('library.title')}
          </p>

          {/* Gold ornament — typographic divider between subtitle and stats */}
          <div
            aria-hidden="true"
            className="mt-1 select-none font-mono text-[11px] text-gold"
            style={{ letterSpacing: '1.2em', paddingLeft: '1.2em' }}
          >
            · · ·
          </div>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
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

            {/* Secondary actions — quieter than the floating CTA above. */}
            <div className="flex items-center gap-1">
              <Button
                tone="neutral"
                fill="plain"
                size="sm"
                onClick={importFlow.openImportPicker}
                disabled={mutating}
                className="font-sans text-[11px] uppercase tracking-[0.08em] text-ink-muted hover:text-text"
              >
                {t('common.actions.importOldWork')}
              </Button>
              <Button
                tone="neutral"
                fill="plain"
                size="sm"
                onClick={() => setGlobalTrashOpen(true)}
                disabled={mutating}
                className="font-sans text-[11px] uppercase tracking-[0.08em] text-ink-muted hover:text-text"
              >
                <Trash2 size={13} className="mr-1.5" />
                {t('trash.title')}
              </Button>
            </div>
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
