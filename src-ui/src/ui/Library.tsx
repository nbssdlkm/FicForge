// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useMemo, useState } from "react";
import { Settings, BookOpen, Trash2, Plus, Import, Archive } from "lucide-react";
import { Spinner } from "./shared/Spinner";
import { Button } from "./shared/Button";
import { InlineBanner } from "./shared/InlineBanner";
import { ThemeToggle } from "./shared/ThemeToggle";
import { Modal } from "./shared/Modal";
import { GlobalSettingsModal } from "./settings/GlobalSettingsModal";
import { EmptyState } from "./shared/EmptyState";
import { getDataDir } from "../api/engine-client";
import { useLibraryData } from "../hooks/useLibraryData";
import { TrashPanel } from "./shared/TrashPanel";
import { useTranslation } from "../i18n/useAppTranslation";
import { FeedbackProvider, useFeedback } from "../hooks/useFeedback";
import { OnboardingFlow } from "./onboarding/OnboardingFlow";
import type { OnboardingCompletion } from "./onboarding/MobileOnboarding";
import { LibraryModals } from "./LibraryModals";
import { RestoreBundleModal } from "./RestoreBundleModal";
import { LibraryFandomSections } from "./library/LibraryFandomSections";
import { LibraryImportPanel } from "./library/LibraryImportPanel";
import { useLibraryImportFlow } from "./library/useLibraryImportFlow";
import { useLibraryMutations } from "./library/useLibraryMutations";
import { useLibraryOnboardingGate } from "./library/useLibraryOnboardingGate";

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
  const [isRestoreOpen, setRestoreOpen] = useState(false);
  const [trashTarget, setTrashTarget] = useState<{ fandomDir: string; fandomName: string } | null>(null);
  const [trashRefreshToken, setTrashRefreshToken] = useState(0);
  const { showOnboarding, setShowOnboarding, showApiWarning, dismissApiWarning } = useLibraryOnboardingGate();
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
        onNavigate("chat", result.openAuPath);
      } else if (result?.nextAction === "open-import") {
        importFlow.openImportPicker();
      } else if (result?.nextAction === "open-settings") {
        setGlobalSettingsOpen(true);
      }
    });
  };

  // Hero stats — 3 numbers: fandoms / AUs / total chapters across all AUs.
  // chapter_count is enriched by listFandoms via state.yaml, falls back to 0.
  const stats = useMemo(() => {
    const totalAus = fandoms.reduce((sum, f) => sum + f.aus.length, 0);
    const totalChapters = fandoms.reduce((sum, f) => sum + f.aus.reduce((s, au) => s + (au.chapter_count ?? 0), 0), 0);
    return [
      { value: fandoms.length, label: "FANDOM" },
      { value: totalAus, label: t("library.cardType") },
      { value: totalChapters, label: t("library.chapterUnit") },
    ];
  }, [fandoms, t]);
  const mutating = mutations.creatingFandom || mutations.creatingAu || mutations.deleting;

  if (showOnboarding) {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="min-app-height bg-background text-text flex flex-col font-sans transition-colors duration-200">
      {/* TOP BAR — v13 .app-top: padding 8/16/10, actions 36×36 buttons.
          Lighter than the previous h-16 / 40px setup so the wordmark
          stays the visual anchor. */}
      <header className="safe-area-top border-b border-rule bg-surface px-4 py-2.5 md:h-14 md:px-6 transition-colors duration-200">
        <div className="flex h-full items-center justify-between gap-3">
          {/* Wordmark: the hand-brushed lockup is reserved for big moments
              (app icon / splash) — at topbar size its script gets fussy, so
              chrome uses the clean EB Garamond wordmark instead. */}
          <div className="font-display text-[17px] font-semibold tracking-[0.02em] text-text">
            {t("common.appName")}
          </div>
          {/* All toolbar buttons sized to v13's 36×36. Secondary actions
              (Import / Trash) use a smaller icon glyph (16px) so they
              read as quieter than primary chrome (Theme / Settings, 18px). */}
          <div className="flex items-center gap-1">
            <Button
              tone="neutral"
              fill="plain"
              size="sm"
              onClick={importFlow.openImportPicker}
              disabled={mutating}
              className="h-9 w-9 p-0 text-ink-muted hover:text-text"
              title={t("common.actions.importOldWork")}
            >
              <Import size={16} />
            </Button>
            <Button
              tone="neutral"
              fill="plain"
              size="sm"
              onClick={() => setGlobalTrashOpen(true)}
              disabled={mutating}
              className="h-9 w-9 p-0 text-ink-muted hover:text-text"
              title={t("trash.title")}
            >
              <Trash2 size={16} />
            </Button>
            <Button
              tone="neutral"
              fill="plain"
              size="sm"
              onClick={() => setRestoreOpen(true)}
              disabled={mutating}
              className="h-9 w-9 p-0 text-ink-muted hover:text-text"
              title={t("restoreBundle.title")}
            >
              <Archive size={16} />
            </Button>
            <span className="mx-1 h-4 w-px bg-rule" aria-hidden="true" />
            <ThemeToggle />
            <Button
              tone="neutral"
              fill="plain"
              size="sm"
              onClick={() => setGlobalSettingsOpen(true)}
              className="h-9 w-9 p-0 text-ink-muted hover:text-text"
              title={t("settings.global.title")}
            >
              <Settings size={18} />
            </Button>
          </div>
        </div>
      </header>

      {/* HERO — v13 .app-hero: title left, primary CTA aligned right at the
          same height as the title (its own row, side-by-side flex), then
          subtitle + ornament + stats pills below. Secondary actions
          (Import / Trash) live in the topbar so the hero stays uncluttered. */}
      <section className="border-b border-rule bg-background px-4 py-7 md:px-8 md:py-10">
        <div className="mx-auto w-full max-w-5xl">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              {/* v13 .app-hero h1: roman (NOT italic) EB Garamond, weight 500,
                  uppercase, tracking 0.04em, accent color, line-height 1.1.
                  Mobile mockup is 26px; we scale up on desktop while keeping
                  the same weight/tracking proportions. */}
              <h1 className="font-display text-3xl font-medium uppercase leading-[1.1] tracking-[0.04em] text-accent [.theme-night_&]:text-inv-text md:text-[42px]">
                Index of Works
              </h1>
              {/* v13 .app-hero h1 .cn: LXGW 13px weight 400 ink-muted
                  letter-spacing 0.06em, mt 4px (not 8). */}
              <p className="mt-1 font-serif text-[13px] font-normal tracking-[0.06em] text-ink-muted">
                {t("library.title")}
              </p>
            </div>

            {/* v13 .new-btn: padding 7 12, Inter 11px tracking 0.08em
                uppercase, border-radius 2px, accent bg + cream text. */}
            <Button
              size="sm"
              onClick={mutations.openFandomModal}
              disabled={mutating}
              className="mt-1 shrink-0 h-9 rounded-[2px] px-3.5 font-sans text-[11px] font-medium uppercase tracking-[0.08em]"
            >
              <Plus size={13} className="mr-1" />
              {t("library.fandomButton")}
            </Button>
          </div>

          {/* v13 .app-hero .stats: mono 9px tracking 0.08em ink-muted; strong
              EB Garamond weight 600 fontSize 11px accent. Pill: rounded-full
              + 1px rule border + paper bg, padding 3 7. */}
          <div className="mt-6 flex flex-wrap gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-ink-muted">
            {stats.map(({ value, label }) => (
              <span
                key={label}
                className="inline-flex items-baseline gap-1 rounded-full border border-rule bg-surface px-[7px] py-[3px]"
              >
                <strong className="font-display text-[11px] font-semibold not-italic text-accent">{value}</strong>
                {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 pb-[calc(7rem+var(--safe-area-bottom))] md:px-8 md:py-8">
        {showApiWarning && (
          <InlineBanner
            className="mb-6"
            tone="warning"
            message={t("library.apiWarning")}
            actions={
              <Button
                tone="neutral"
                fill="outline"
                size="sm"
                onClick={() => {
                  dismissApiWarning();
                  setGlobalSettingsOpen(true);
                }}
              >
                {t("library.apiWarningAction")}
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
                element: <Button onClick={mutations.openFandomModal}>{t("common.actions.createFandom")}</Button>,
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

      <RestoreBundleModal
        isOpen={isRestoreOpen}
        onClose={() => setRestoreOpen(false)}
        fandoms={fandoms}
        dataDir={dataDir}
        onComplete={loadFandoms}
        onGoBackfill={(auPath) => {
          setRestoreOpen(false);
          // 直达引导文案指向的落点：AU 设置页（高级操作区就有「补全旧章记忆」按钮）。
          onNavigate("settings", auPath);
        }}
      />

      <Modal isOpen={isGlobalTrashOpen} onClose={() => setGlobalTrashOpen(false)} title={t("trash.title")}>
        <TrashPanel
          scope="fandom"
          path={`${dataDir}/fandoms`}
          onRestore={() => {
            setTrashRefreshToken((v) => v + 1);
            void loadFandoms();
          }}
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

      <Modal
        isOpen={!!trashTarget}
        onClose={() => setTrashTarget(null)}
        title={`${t("trash.title")} - ${trashTarget?.fandomName || ""}`}
      >
        {trashTarget && (
          <TrashPanel
            scope="fandom"
            path={`${dataDir}/fandoms/${trashTarget.fandomDir}`}
            onRestore={() => {
              setTrashRefreshToken((v) => v + 1);
              void loadFandoms();
            }}
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
