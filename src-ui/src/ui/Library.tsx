// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect, useRef } from 'react';
import { Card } from './shared/Card';
import { Button } from './shared/Button';
import { ThemeToggle } from './shared/ThemeToggle';
import { Input } from './shared/Input';
import { Settings, Plus, BookOpen, FileText, Loader2, Trash2, ArchiveRestore } from 'lucide-react';
import { Modal } from './shared/Modal';
import { GlobalSettingsModal } from './settings/GlobalSettingsModal';
import { EmptyState } from './shared/EmptyState';
import { ImportFlow } from './import/ImportFlow';
import { listFandoms, createFandom, createAu, deleteFandom, deleteAu, type FandomInfo } from '../api/fandoms';
import { TrashPanel } from './shared/TrashPanel';
import { getSettings } from '../api/settings';
import { useTranslation } from '../i18n/useAppTranslation';
import { FeedbackProvider, useFeedback } from '../hooks/useFeedback';
import { OnboardingFlow, isOnboardingCompleted } from './onboarding/OnboardingFlow';

type Props = {
  onNavigate: (page: string, auPath?: string) => void;
};

function LibraryInner({ onNavigate }: Props) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const loadFandomsRequestIdRef = useRef(0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isFandomModalOpen, setFandomModalOpen] = useState(false);
  const [isAuModalOpen, setAuModalOpen] = useState(false);
  const [isGlobalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [isImportModalOpen, setImportModalOpen] = useState(false);
  const [importAuPath, setImportAuPath] = useState('');
  const [importNewAuName, setImportNewAuName] = useState('');
  const [importSelectedFandom, setImportSelectedFandom] = useState<{ name: string; dir: string } | null>(null);
  const [importCreatingAu, setImportCreatingAu] = useState(false);
  const [fandoms, setFandoms] = useState<FandomInfo[]>([]);
  const [loading, setLoading] = useState(true);
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
    // 检查是否需要显示引导流程
    if (isOnboardingCompleted()) {
      // 已完成引导，直接加载
    } else {
      getSettings().then(settings => {
        if (!hasUsableConnectionConfig(settings)) {
          setShowOnboarding(true);
        }
      }).catch(() => {
        setShowOnboarding(true);
      });
    }
    void loadFandoms();
  }, []);

  const loadFandoms = async () => {
    const requestId = ++loadFandomsRequestIdRef.current;
    setLoading(true);
    try {
      const data = await listFandoms();
      if (requestId !== loadFandomsRequestIdRef.current) return;
      setFandoms(data);
    } catch (e: any) {
      if (requestId !== loadFandomsRequestIdRef.current) return;
      showError(e, t("error_messages.unknown"));
    } finally {
      if (requestId === loadFandomsRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  const handleCreateFandom = async () => {
    if (!newFandomName.trim() || creatingFandom) return;
    setCreatingFandom(true);
    try {
      await createFandom(newFandomName.trim());
      setFandomModalOpen(false);
      setNewFandomName('');
      await loadFandoms();
    } catch (e: any) {
      showError(e, t("error_messages.unknown"));
    } finally {
      setCreatingFandom(false);
    }
  };

  const handleCreateAu = async () => {
    if (!newAuName.trim() || !selectedFandomDir || creatingAu) return;
    setCreatingAu(true);
    try {
      const fandomPath = `./fandoms/fandoms/${selectedFandomDir}`;
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
    setImportModalOpen(true);
  };

  if (showOnboarding) {
    return (
      <OnboardingFlow onComplete={() => { setShowOnboarding(false); void loadFandoms(); }} />
    );
  }

  return (
    <div className="min-h-screen bg-background text-text flex flex-col font-sans transition-colors duration-200">
      <header className="h-16 border-b border-black/10 dark:border-white/10 flex items-center justify-between px-6 bg-surface transition-colors duration-200">
        <div className="flex items-center gap-2 font-serif text-xl font-bold">
          <BookOpen className="text-accent" />
          <span>{t("common.appName")}</span>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={() => setGlobalSettingsOpen(true)} className="h-10 w-10 p-0 rounded-full" title={t("settings.global.title")}>
            <Settings size={20} />
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-serif font-bold">{t("library.title")}</h1>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={handleImportClick} disabled={creatingFandom || creatingAu || deleting}>
              {t("common.actions.importOldWork")}
            </Button>
            <Button onClick={() => setFandomModalOpen(true)} className="shadow-md" disabled={creatingFandom || creatingAu || deleting}>
              <Plus size={16} className="mr-2" /> {t("library.fandomButton")}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-accent" size={32} />
            <span className="ml-3 text-text/60">{t("library.loading")}</span>
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
                  <Button variant="secondary" onClick={handleImportClick}>
                    {t("common.actions.importOldWork")}
                  </Button>
                ),
              },
            ]}
          />
        ) : (
          <div className="space-y-12">
            {fandoms.map(fandom => (
              <div key={fandom.name}>
                <div className="flex items-center justify-between mb-4 border-b border-black/10 dark:border-white/10 pb-2">
                  <h2 className="text-xl font-sans font-semibold text-text/80 flex items-center gap-2">
                    <span className="opacity-50 text-accent text-sm">📚</span> {t("common.scope.fandomTitle", { name: fandom.name })}
                  </h2>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => onNavigate('fandom_lore', `./fandoms/fandoms/${fandom.dir_name}`)} className="bg-surface/80 border-black/10 dark:border-white/10 text-text/70">
                      <FileText size={14} className="mr-2 text-text/50" /> {t("library.fandomSectionButton")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setSelectedFandom(fandom.name); setSelectedFandomDir(fandom.dir_name); setAuModalOpen(true); }} disabled={creatingFandom || creatingAu || deleting}>
                      <Plus size={14} className="mr-1 text-accent" /> {t("library.createAuButton")}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-text/40 hover:text-text/60" onClick={() => setTrashTarget({ fandomDir: fandom.dir_name, fandomName: fandom.name })} title={t('trash.tooltip')}>
                      <ArchiveRestore size={14} />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => setDeleteTarget({ type: 'fandom', fandomDir: fandom.dir_name, fandomName: fandom.name })} disabled={creatingFandom || creatingAu || deleting}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {fandom.aus.length === 0 ? (
                    <p className="text-text/40 text-sm col-span-3">{t("library.emptyAuList")}</p>
                  ) : (
                    fandom.aus.map(au => (
                      <Card key={au} className="hover:border-accent/50 cursor-pointer transition-colors relative group" onClick={() => onNavigate('writer', `./fandoms/fandoms/${fandom.dir_name}/aus/${au}`)}>
                        <button
                          className="absolute top-2 right-2 p-1.5 rounded-md text-text/30 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'au', fandomDir: fandom.dir_name, fandomName: fandom.name, auName: au }); }}
                          title={t("common.actions.delete")}
                          disabled={creatingFandom || creatingAu || deleting}
                        >
                          <Trash2 size={14} />
                        </button>
                        <h3 className="text-lg font-sans font-medium mb-4">{t("common.scope.auTitle", { name: au })}</h3>
                        <div className="flex items-center text-sm text-text/60">
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

      <Modal isOpen={isFandomModalOpen} onClose={creatingFandom ? () => {} : () => setFandomModalOpen(false)} title={t("library.createFandomModal.title")}>
        <p className="text-sm text-text/70 mb-5">{t("library.createFandomModal.description")}</p>
        <div className="flex flex-col gap-4">
          <Input placeholder={t("library.createFandomModal.namePlaceholder")} value={newFandomName} onChange={(e) => setNewFandomName(e.target.value)} className="w-full h-10 bg-surface/50 text-base" disabled={creatingFandom} />
          <Button variant="primary" className="w-full h-10 mt-2 font-medium tracking-wide" onClick={handleCreateFandom} disabled={creatingFandom || !newFandomName.trim()}>
            {creatingFandom ? <Loader2 size={16} className="animate-spin" /> : t("library.createFandomModal.submit")}
          </Button>
        </div>
      </Modal>

      <Modal isOpen={isAuModalOpen} onClose={creatingAu ? () => {} : () => setAuModalOpen(false)} title={t("library.createAuModal.title")}>
        <p className="text-sm text-text/70 mb-5 leading-relaxed">{t("library.createAuModal.description")}</p>
        <div className="flex flex-col gap-5">
          <Input placeholder={t("library.createAuModal.namePlaceholder")} value={newAuName} onChange={(e) => setNewAuName(e.target.value)} className="w-full h-10 bg-surface/50 text-base" disabled={creatingAu} />
          <div className="flex flex-col gap-2">
             <label className="text-sm font-bold text-text/90">{t("library.createAuModal.inheritLabel")}</label>
             <div className="flex min-h-10 items-center rounded-md border border-black/20 bg-surface/60 px-3 text-sm text-text/75 dark:border-white/20">
                {selectedFandom}
             </div>
          </div>
          <div className="flex flex-col gap-2">
             <label className="text-sm font-bold text-text/90">{t("library.createAuModal.initLabel")}</label>
             <div className="rounded-md border border-black/20 bg-surface/60 px-3 py-2 text-sm text-text/75 dark:border-white/20">
                {t("library.createAuModal.initGlobal")}
             </div>
          </div>
          <Button variant="primary" className="w-full h-10 mt-2 font-medium tracking-wide" onClick={handleCreateAu} disabled={creatingAu || !newAuName.trim() || !selectedFandomDir}>
            {creatingAu ? <Loader2 size={16} className="animate-spin" /> : t("library.createAuModal.submit")}
          </Button>
        </div>
      </Modal>

      <GlobalSettingsModal isOpen={isGlobalSettingsOpen} onClose={() => setGlobalSettingsOpen(false)} />

      {/* Import flow: AU selector → ImportFlow */}
      <Modal isOpen={isImportModalOpen && !importAuPath} onClose={() => { setImportModalOpen(false); setImportSelectedFandom(null); setImportNewAuName(''); }} title={t('import.selectAu')}>
        <div className="space-y-4">
          <p className="text-sm text-text/70">{t('import.selectAuDesc')}</p>
          <div className="max-h-[50vh] overflow-y-auto space-y-4">
            {fandoms.length === 0 ? (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm text-text/50">{t('import.noFandom')}</p>
                <Button variant="primary" size="sm" onClick={() => { setImportModalOpen(false); setFandomModalOpen(true); }}>
                  {t('import.createFandomFirst')}
                </Button>
              </div>
            ) : (
              fandoms.map(f => (
                <div key={f.dir_name} className="space-y-1.5">
                  <div className="text-xs font-bold text-text/50 uppercase tracking-wide px-1">{f.name}</div>
                  {f.aus.map(au => {
                    const auPath = `./fandoms/fandoms/${f.dir_name}/aus/${au}`;
                    return (
                      <button
                        key={auPath}
                        className="w-full text-left px-4 py-2.5 rounded-lg border border-black/10 dark:border-white/10 hover:bg-accent/5 hover:border-accent/30 transition-colors"
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
                        className="h-8 text-sm flex-1"
                        placeholder={t('library.createAuModal.namePlaceholder')}
                        value={importNewAuName}
                        onChange={e => setImportNewAuName(e.target.value)}
                        disabled={importCreatingAu}
                      />
                      <Button variant="primary" size="sm" className="h-8 shrink-0" disabled={!importNewAuName.trim() || importCreatingAu} onClick={async () => {
                        if (!importNewAuName.trim()) return;
                        setImportCreatingAu(true);
                        try {
                          const fandomPath = `./fandoms/fandoms/${f.dir_name}`;
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
                        {t('common.actions.create')}
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="w-full text-left px-4 py-2 rounded-lg text-xs text-accent hover:bg-accent/5 transition-colors"
                      onClick={() => { setImportSelectedFandom({ name: f.name, dir: f.dir_name }); setImportNewAuName(''); }}
                    >
                      + {t('import.newAuInFandom')}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => { setImportModalOpen(false); setImportSelectedFandom(null); setImportNewAuName(''); }}>{t('common.actions.cancel')}</Button>
          </div>
        </div>
      </Modal>
      <ImportFlow
        isOpen={isImportModalOpen && !!importAuPath}
        onClose={() => { setImportModalOpen(false); setImportAuPath(''); }}
        auPath={importAuPath}
        onComplete={() => { setImportModalOpen(false); setImportAuPath(''); onNavigate('writer', importAuPath); }}
      />

      {/* Trash panel modal */}
      <Modal isOpen={!!trashTarget} onClose={() => setTrashTarget(null)} title={`${t('trash.title')} — ${trashTarget?.fandomName || ''}`}>
        {trashTarget && (
          <TrashPanel
            scope="fandom"
            path={`./fandoms/fandoms/${trashTarget.fandomDir}`}
            onRestore={() => { setTrashRefreshToken(v => v + 1); void loadFandoms(); }}
            refreshToken={trashRefreshToken}
          />
        )}
      </Modal>

      <Modal isOpen={!!deleteTarget} onClose={deleting ? () => {} : () => setDeleteTarget(null)} title={deleteTarget?.type === 'fandom' ? t('library.deleteFandomTitle') : t('library.deleteAuTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/80 leading-relaxed">
            {deleteTarget?.type === 'fandom'
              ? t('library.deleteFandomMessage', { name: deleteTarget.fandomName })
              : t('library.deleteAuMessage', { name: deleteTarget?.auName || '' })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>{t("common.actions.cancel")}</Button>
            <Button variant="primary" className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 size={16} className="animate-spin" /> : t("common.actions.confirmDelete")}
            </Button>
          </div>
        </div>
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
