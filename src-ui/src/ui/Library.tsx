import { useState, useEffect } from 'react';
import { Card } from './shared/Card';
import { Button } from './shared/Button';
import { ThemeToggle } from './shared/ThemeToggle';
import { Input, Textarea } from './shared/Input';
import { Settings, Plus, BookOpen, Clock, FileText, Loader2, Trash2 } from 'lucide-react';
import { Modal } from './shared/Modal';
import { GlobalSettingsModal } from './settings/GlobalSettingsModal';
import { EmptyState } from './shared/EmptyState';
import { listFandoms, createFandom, createAu, deleteFandom, deleteAu, type FandomInfo } from '../api/fandoms';
import { useTranslation } from '../i18n/useAppTranslation';
import { FeedbackProvider, useFeedback } from '../hooks/useFeedback';

type Props = {
  onNavigate: (page: string, auPath?: string) => void;
};

function LibraryInner({ onNavigate }: Props) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const [isFandomModalOpen, setFandomModalOpen] = useState(false);
  const [isAuModalOpen, setAuModalOpen] = useState(false);
  const [isGlobalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [isImportModalOpen, setImportModalOpen] = useState(false);
  const [fandoms, setFandoms] = useState<FandomInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newFandomName, setNewFandomName] = useState('');
  const [newAuName, setNewAuName] = useState('');
  const [selectedFandom, setSelectedFandom] = useState('');
  const [selectedFandomDir, setSelectedFandomDir] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'fandom' | 'au'; fandomDir: string; fandomName: string; auName?: string } | null>(null);

  useEffect(() => {
    void loadFandoms();
  }, []);

  const loadFandoms = async () => {
    setLoading(true);
    try {
      const data = await listFandoms();
      setFandoms(data);
    } catch (e: any) {
      showError(e, t("error_messages.unknown"));
      setFandoms([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFandom = async () => {
    if (!newFandomName.trim()) return;
    try {
      await createFandom(newFandomName.trim());
      setFandomModalOpen(false);
      setNewFandomName('');
      await loadFandoms();
    } catch (e: any) {
      showError(e, t("error_messages.unknown"));
    }
  };

  const handleCreateAu = async () => {
    if (!newAuName.trim() || !selectedFandomDir) return;
    try {
      const fandomPath = `./fandoms/fandoms/${selectedFandomDir}`;
      await createAu(selectedFandomDir, newAuName.trim(), fandomPath);
      setAuModalOpen(false);
      setNewAuName('');
      await loadFandoms();
    } catch (e: any) {
      showError(e, t("error_messages.unknown"));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
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
    }
  };

  const handleImportClick = () => {
    setImportModalOpen(true);
  };

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
          <Button onClick={() => setFandomModalOpen(true)} className="shadow-md">
            <Plus size={16} className="mr-2" /> {t("library.fandomButton")}
          </Button>
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
                    <Button variant="ghost" size="sm" onClick={() => { setSelectedFandom(fandom.name); setSelectedFandomDir(fandom.dir_name); setAuModalOpen(true); }}>
                      <Plus size={14} className="mr-1 text-accent" /> {t("library.createAuButton")}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => setDeleteTarget({ type: 'fandom', fandomDir: fandom.dir_name, fandomName: fandom.name })}>
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
                        >
                          <Trash2 size={14} />
                        </button>
                        <h3 className="text-lg font-sans font-medium mb-4">{t("common.scope.auTitle", { name: au })}</h3>
                        <div className="flex items-center justify-between text-sm text-text/60">
                          <span className="flex items-center gap-1"><BookOpen size={14} /> {t("library.cardType")}</span>
                          <span className="flex items-center gap-1"><Clock size={14} /> —</span>
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

      <Modal isOpen={isFandomModalOpen} onClose={() => setFandomModalOpen(false)} title={t("library.createFandomModal.title")}>
        <p className="text-sm text-text/70 mb-5">{t("library.createFandomModal.description")}</p>
        <div className="flex flex-col gap-4">
          <Input placeholder={t("library.createFandomModal.namePlaceholder")} value={newFandomName} onChange={(e) => setNewFandomName(e.target.value)} className="w-full h-10 bg-surface/50 text-base" />
          <Textarea placeholder={t("library.createFandomModal.notesPlaceholder")} className="w-full min-h-[120px] text-sm bg-surface/50 leading-relaxed resize-y" />
          <Button variant="primary" className="w-full h-10 mt-2 font-medium tracking-wide" onClick={handleCreateFandom}>{t("library.createFandomModal.submit")}</Button>
        </div>
      </Modal>

      <Modal isOpen={isAuModalOpen} onClose={() => setAuModalOpen(false)} title={t("library.createAuModal.title")}>
        <p className="text-sm text-text/70 mb-5 leading-relaxed">{t("library.createAuModal.description")}</p>
        <div className="flex flex-col gap-5">
          <Input placeholder={t("library.createAuModal.namePlaceholder")} value={newAuName} onChange={(e) => setNewAuName(e.target.value)} className="w-full h-10 bg-surface/50 text-base" />
          <div className="flex flex-col gap-2">
             <label className="text-sm font-bold text-text/90">{t("library.createAuModal.inheritLabel")}</label>
             <select className="h-10 rounded-md border border-black/20 dark:border-white/20 bg-surface/80 px-3 text-sm focus:ring-2 focus:ring-accent outline-none w-full">
                <option>{selectedFandom}</option>
             </select>
          </div>
          <div className="flex flex-col gap-2">
             <label className="text-sm font-bold text-text/90">{t("library.createAuModal.initLabel")}</label>
             <select className="h-10 rounded-md border border-black/20 dark:border-white/20 bg-surface/80 px-3 text-sm focus:ring-2 focus:ring-accent outline-none w-full">
                <option>{t("library.createAuModal.initGlobal")}</option>
                <option>{t("library.createAuModal.initCustom")}</option>
             </select>
          </div>
          <Button variant="primary" className="w-full h-10 mt-2 font-medium tracking-wide" onClick={handleCreateAu}>{t("library.createAuModal.submit")}</Button>
        </div>
      </Modal>

      <GlobalSettingsModal isOpen={isGlobalSettingsOpen} onClose={() => setGlobalSettingsOpen(false)} />

      <Modal isOpen={isImportModalOpen} onClose={() => setImportModalOpen(false)} title={t('library.importFlow.title')}>
        <div className="space-y-4">
          <p className="text-sm text-text/80 leading-relaxed">{t('library.importFlow.description')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setImportModalOpen(false)}>{t('common.actions.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                setImportModalOpen(false);
                setFandomModalOpen(true);
              }}
            >
              {t('library.importFlow.start')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={deleteTarget?.type === 'fandom' ? t('library.deleteFandomTitle') : t('library.deleteAuTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/80 leading-relaxed">
            {deleteTarget?.type === 'fandom'
              ? t('library.deleteFandomMessage', { name: deleteTarget.fandomName })
              : t('library.deleteAuMessage', { name: deleteTarget?.auName || '' })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>{t("common.actions.cancel")}</Button>
            <Button variant="primary" className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete}>{t("common.actions.confirmDelete")}</Button>
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
