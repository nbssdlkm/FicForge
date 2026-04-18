// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect } from 'react';
import { Spinner } from "./shared/Spinner";
import { Card } from './shared/Card';
import { Button } from './shared/Button';
import { InlineBanner } from './shared/InlineBanner';
import { ThemeToggle } from './shared/ThemeToggle';
import { Input } from './shared/Input';
import { Settings, Plus, BookOpen, FileText, Trash2, ArchiveRestore } from 'lucide-react';
import { Modal } from './shared/Modal';
import { GlobalSettingsModal } from './settings/GlobalSettingsModal';
import { EmptyState } from './shared/EmptyState';
import { ImportFlow } from './import/ImportFlow';
import { createFandom, createAu, deleteFandom, deleteAu, getDataDir } from '../api/engine-client';
import { useLibraryData } from '../hooks/useLibraryData';
import { TrashPanel } from './shared/TrashPanel';
import { getSettings } from '../api/engine-client';
import { useTranslation } from '../i18n/useAppTranslation';
import { FeedbackProvider, useFeedback } from '../hooks/useFeedback';
import { OnboardingFlow, isOnboardingCompleted } from './onboarding/OnboardingFlow';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { OnboardingCompletion } from './onboarding/MobileOnboarding';
import { LibraryModals } from './LibraryModals';

type Props = {
  onNavigate: (page: string, auPath?: string) => void;
};

function LibraryInner({ onNavigate }: Props) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const { fandoms, loading, loadFandoms } = useLibraryData();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isFandomModalOpen, setFandomModalOpen] = useState(false);
  const [isAuModalOpen, setAuModalOpen] = useState(false);
  const [isGlobalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [isImportModalOpen, setImportModalOpen] = useState(false);
  const [resumeImportAfterFandomCreate, setResumeImportAfterFandomCreate] = useState(false);
  const [importAuPath, setImportAuPath] = useState('');
  const [importNewAuName, setImportNewAuName] = useState('');
  const [importSelectedFandom, setImportSelectedFandom] = useState<{ name: string; dir: string } | null>(null);
  const [importCreatingAu, setImportCreatingAu] = useState(false);
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
  const [showApiWarning, setShowApiWarning] = useState(false);

  const resetImportSelection = () => {
    setImportAuPath('');
    setImportSelectedFandom(null);
    setImportNewAuName('');
  };

  const openImportPicker = () => {
    resetImportSelection();
    setImportModalOpen(true);
  };

  const hasUsableConnectionConfig = (settings: Awaited<ReturnType<typeof getSettings>> | null | undefined) => {
    const llm = settings?.default_llm;
    if (!llm) return false;
    if (llm.mode === 'local') {
      return Boolean(llm.local_model_path?.trim());
    }
    if (llm.mode === 'ollama') {
      return Boolean((llm.ollama_model || llm.model || '').trim());
    }
    return Boolean(llm.api_key?.trim());
  };

  useEffect(() => {
    let cancelled = false;
    // 检查是否需要显示引导流程
    if (isOnboardingCompleted()) {
      // 已完成引导，但仍检查 API 配置是否有效
      getSettings().then(settings => {
        if (!cancelled && !hasUsableConnectionConfig(settings)) {
          setShowApiWarning(true);
        }
      }).catch(() => {});
    } else {
      getSettings().then(settings => {
        if (!cancelled && !hasUsableConnectionConfig(settings)) {
          setShowOnboarding(true);
        }
      }).catch(() => {
        if (!cancelled) setShowOnboarding(true);
      });
    }
    void loadFandoms();
    return () => { cancelled = true; };
  }, []);

  const handleCreateFandom = async () => {
    if (!newFandomName.trim() || creatingFandom) return;
    setCreatingFandom(true);
    try {
      const createdFandom = await createFandom(newFandomName.trim());
      setFandomModalOpen(false);
      setNewFandomName('');
      await loadFandoms();
      if (resumeImportAfterFandomCreate) {
        setImportAuPath('');
        setImportSelectedFandom({ name: createdFandom.name, dir: createdFandom.name });
        setImportNewAuName('');
        setImportModalOpen(true);
        setResumeImportAfterFandomCreate(false);
      }
    } catch (e: any) {
      showError(e, t("error_messages.unknown"));
    } finally {
      setCreatingFandom(false);
    }
  };

  const handleCloseFandomModal = () => {
    setFandomModalOpen(false);
    setResumeImportAfterFandomCreate(false);
  };

  const handleCreateAu = async () => {
    if (!newAuName.trim() || !selectedFandomDir || creatingAu) return;
    setCreatingAu(true);
    try {
      const fandomPath = `${getDataDir()}/fandoms/${selectedFandomDir}`;
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

  const handleImportClick = () => {
    openImportPicker();
  };

  const handleOnboardingComplete = (result?: OnboardingCompletion) => {
    setShowOnboarding(false);
    void loadFandoms().finally(() => {
      if (result?.openAuPath) {
        onNavigate('writer', result.openAuPath);
      } else if (result?.nextAction === 'open-import') {
        openImportPicker();
      } else if (result?.nextAction === 'open-settings') {
        setGlobalSettingsOpen(true);
      }
    });
  };

  if (showOnboarding) {
    return (
      <OnboardingFlow onComplete={handleOnboardingComplete} />
    );
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button tone="neutral" fill="outline" onClick={handleImportClick} disabled={creatingFandom || creatingAu || deleting} className="w-full sm:w-auto">
              {t("common.actions.importOldWork")}
            </Button>
            <Button onClick={() => setFandomModalOpen(true)} className="w-full sm:w-auto" disabled={creatingFandom || creatingAu || deleting}>
              <Plus size={16} className="mr-2" /> {t("library.fandomButton")}
            </Button>
          </div>
        </div>

        {showApiWarning && (
          <InlineBanner
            className="mb-6"
            tone="warning"
            message={t('library.apiWarning')}
            actions={
              <Button tone="neutral" fill="outline" size="sm" onClick={() => { setShowApiWarning(false); setGlobalSettingsOpen(true); }}>
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
                  <Button tone="neutral" fill="outline" onClick={handleImportClick}>
                    {t("common.actions.importOldWork")}
                  </Button>
                ),
              },
            ]}
          />
        ) : (
          <div className="space-y-8 md:space-y-12">
            {fandoms.map(fandom => (
              <div key={fandom.name}>
                <div className="mb-4 flex flex-col gap-3 border-b border-black/10 pb-3 dark:border-white/10 md:flex-row md:items-center md:justify-between md:pb-2">
                  <h2 className="text-xl font-sans font-semibold text-text/90">
                    {t("common.scope.fandomTitle", { name: fandom.name })}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button tone="neutral" fill="outline" size="sm" onClick={() => onNavigate('fandom_lore', `${getDataDir()}/fandoms/${fandom.dir_name}`)} className="bg-surface/80 border-black/10 dark:border-white/10 text-text/70">
                      <FileText size={14} className="mr-2 text-text/50" /> {t("library.fandomSectionButton")}
                    </Button>
                    <Button tone="neutral" fill="plain" size="sm" onClick={() => { setSelectedFandom(fandom.name); setSelectedFandomDir(fandom.dir_name); setAuModalOpen(true); }} disabled={creatingFandom || creatingAu || deleting}>
                      <Plus size={14} className="mr-1 text-accent" /> {t("library.createAuButton")}
                    </Button>
                    <Button tone="neutral" fill="plain" size="sm" className="text-text/50 hover:text-text/70" onClick={() => setTrashTarget({ fandomDir: fandom.dir_name, fandomName: fandom.name })} title={t('trash.tooltip')}>
                      <ArchiveRestore size={14} />
                    </Button>
                    <Button tone="neutral" fill="plain" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => setDeleteTarget({ type: 'fandom', fandomDir: fandom.dir_name, fandomName: fandom.name })} disabled={creatingFandom || creatingAu || deleting}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {fandom.aus.length === 0 ? (
                    <p className="text-text/50 text-sm col-span-3">{t("library.emptyAuList")}</p>
                  ) : (
                    fandom.aus.map(au => (
                      <Card key={au} className="relative cursor-pointer rounded-xl p-5 transition-colors hover:border-accent/50 group" onClick={() => onNavigate('writer', `${getDataDir()}/fandoms/${fandom.dir_name}/aus/${au}`)}>
                        <button
                          className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-md p-0 text-text/30 opacity-100 transition-opacity hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 md:h-9 md:w-9 md:opacity-0 md:group-hover:opacity-100"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'au', fandomDir: fandom.dir_name, fandomName: fandom.name, auName: au }); }}
                          title={t("common.actions.delete")}
                          disabled={creatingFandom || creatingAu || deleting}
                        >
                          <Trash2 size={14} />
                        </button>
                        <h3 className="text-lg font-sans font-medium mb-4">{t("common.scope.auTitle", { name: au })}</h3>
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

      {/* Import flow: AU selector → ImportFlow */}
      <Modal
        isOpen={isImportModalOpen && !importAuPath}
        onClose={importCreatingAu ? () => {} : () => { setImportModalOpen(false); resetImportSelection(); }}
        title={t('import.selectAu')}
      >
        <div className="space-y-4">
          <p className="text-sm text-text/70">{t('import.selectAuDesc')}</p>
          <div className="max-h-[50vh] overflow-y-auto space-y-4">
            {fandoms.length === 0 ? (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm text-text/50">{t('import.noFandom')}</p>
                <Button tone="accent" fill="solid" size="sm" onClick={() => {
                  setResumeImportAfterFandomCreate(true);
                  setImportModalOpen(false);
                  resetImportSelection();
                  setFandomModalOpen(true);
                }}>
                  {t('import.createFandomFirst')}
                </Button>
              </div>
            ) : (
              fandoms.map(f => (
                <div key={f.dir_name} className="space-y-1.5">
                  <div className="text-xs font-medium text-text/50 px-1">{f.name}</div>
                  {f.aus.map(au => {
                    const auPath = `${getDataDir()}/fandoms/${f.dir_name}/aus/${au}`;
                    return (
                      <button
                        key={auPath}
                        className="min-h-[44px] w-full rounded-lg border border-black/10 px-4 py-2.5 text-left transition-colors hover:border-accent/30 hover:bg-accent/5 dark:border-white/10"
                        onClick={() => setImportAuPath(auPath)}
                      >
                        <div className="text-sm font-medium">{au}</div>
                      </button>
                    );
                  })}
                  {/* 在每个 Fandom 下新建 AU */}
                  {importSelectedFandom?.dir === f.dir_name ? (
                    <div className="flex gap-2 px-1">
                      <Input
                        className="flex-1 h-11 text-base md:h-8 md:text-sm"
                        placeholder={t('library.createAuModal.namePlaceholder')}
                        value={importNewAuName}
                        onChange={e => setImportNewAuName(e.target.value)}
                        disabled={importCreatingAu}
                      />
                      <Button tone="accent" fill="solid" size="sm" className="h-11 shrink-0 md:h-8" disabled={!importNewAuName.trim() || importCreatingAu} onClick={async () => {
                        if (!importNewAuName.trim()) return;
                        setImportCreatingAu(true);
                        try {
                          const fandomPath = `${getDataDir()}/fandoms/${f.dir_name}`;
                          const auName = importNewAuName.trim();
                          await createAu(f.dir_name, auName, fandomPath);
                          await loadFandoms();
                          setImportAuPath(`${fandomPath}/aus/${auName}`);
                          setImportSelectedFandom(null);
                          setImportNewAuName('');
                        } catch (e: any) {
                          showError(e, t('error_messages.unknown'));
                        } finally {
                          setImportCreatingAu(false);
                        }
                      }}>
                        {importCreatingAu ? <Spinner size="md" /> : t('common.actions.create')}
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="min-h-[44px] w-full rounded-lg px-4 py-2 text-left text-sm text-accent transition-colors hover:bg-accent/5"
                      onClick={() => { setImportSelectedFandom({ name: f.name, dir: f.dir_name }); setImportNewAuName(''); }}
                    >
                      + {t('import.newAuInFandom')}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
          <div className={`flex ${isMobile ? 'justify-stretch' : 'justify-end'}`}>
            <Button tone="neutral" fill="plain" onClick={() => { setImportModalOpen(false); resetImportSelection(); }} disabled={importCreatingAu}>{t('common.actions.cancel')}</Button>
          </div>
        </div>
      </Modal>
      <ImportFlow
        isOpen={isImportModalOpen && !!importAuPath}
        onClose={() => { setImportModalOpen(false); resetImportSelection(); }}
        auPath={importAuPath}
        onComplete={(target) => {
          const nextAuPath = importAuPath;
          setImportModalOpen(false);
          resetImportSelection();
          onNavigate(target || 'writer', nextAuPath);
        }}
      />

      {/* Trash panel modal */}
      <Modal isOpen={!!trashTarget} onClose={() => setTrashTarget(null)} title={`${t('trash.title')} — ${trashTarget?.fandomName || ''}`}>
        {trashTarget && (
          <TrashPanel
            scope="fandom"
            path={`${getDataDir()}/fandoms/${trashTarget.fandomDir}`}
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
