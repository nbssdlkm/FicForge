import { useState, useEffect } from 'react';
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { Modal } from '../shared/Modal';
import { EmptyState } from '../shared/EmptyState';
import { TrashPanel } from '../shared/TrashPanel';
import type { TrashEntry } from '../../api/trash';
import { Search, Plus, FileText, ChevronDown, ChevronRight, Folder, Loader2, Trash2, Download, Pin } from 'lucide-react';
import { getProject, updateProject, type ProjectInfo } from '../../api/project';
import { saveLore, readLore, deleteLore, listLoreFiles, importFromFandom, getLoreContent } from '../../api/lore';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';

type LoreFileEntry = {
  name: string;
  filename: string;
};

function buildDefaultCharacterContent(name: string): string {
  return `---\nname: ${name}\n---\n\n# ${name}\n\n`;
}

function deriveFandomPath(auPath: string): string {
  return auPath.replace(/\/aus\/[^/]+$/, '');
}

function getRestoredCharacterFile(entry: TrashEntry): LoreFileEntry | null {
  if (!entry.original_path.startsWith('characters/')) return null;
  const filename = entry.original_path.split('/').pop();
  if (!filename) return null;
  return {
    name: entry.entity_name || filename.replace(/\.md$/, ''),
    filename,
  };
}

export const AuLoreLayout = ({ auPath }: { auPath: string }) => {
  const { t } = useTranslation();
  const { showError, showSuccess } = useFeedback();
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [files, setFiles] = useState<LoreFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ characters: true });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importCandidates, setImportCandidates] = useState<LoreFileEntry[]>([]);
  const [selectedImports, setSelectedImports] = useState<string[]>([]);
  const [trashRefreshToken, setTrashRefreshToken] = useState(0);
  const [coreLimitModalOpen, setCoreLimitModalOpen] = useState(false);
  const [coreLimitTarget, setCoreLimitTarget] = useState<string | null>(null);

  const syncRegistry = async (names: string[]) => {
    const deduped = Array.from(new Set(names));
    await updateProject(auPath, { cast_registry: { characters: deduped } });
    setProject(prev => prev ? {
      ...prev,
      cast_registry: {
        ...prev.cast_registry,
        characters: deduped,
      },
    } : prev);
  };

  const coreIncludes = project?.core_always_include || [];

  const handleTogglePin = async (name: string) => {
    if (!project || isSaving) return;
    setIsSaving(true);

    try {
      // 用函数式更新读最新 state，防止并发 stale 覆盖
      const current = project.core_always_include || [];
      const isPinned = current.includes(name);

      let next: string[];
      if (isPinned) {
        next = current.filter(n => n !== name);
      } else {
        next = [...current, name];
        // 检测核心限制段落
        try {
          const result = await getLoreContent({ au_path: auPath, category: 'characters', filename: `${name}.md` });
          if (!result.content.includes('## 核心限制')) {
            setCoreLimitTarget(name);
            setCoreLimitModalOpen(true);
          }
        } catch { /* 读取失败不阻塞 */ }
      }

      await updateProject(auPath, { core_always_include: next });
      setProject(prev => prev ? { ...prev, core_always_include: next } : prev);
      showSuccess(isPinned ? t('coreIncludes.unpinnedToast') : t('coreIncludes.pinnedToast'));
    } catch (error) {
      showError(error, t('error_messages.unknown'));
    } finally {
      setIsSaving(false);
    }
  };

  const loadFileContent = async (name: string) => {
    setSelectedFile(name);
    try {
      const result = await readLore({ au_path: auPath, category: 'characters', filename: `${name}.md` });
      setEditorContent(result.content || buildDefaultCharacterContent(name));
    } catch {
      setEditorContent(buildDefaultCharacterContent(name));
    }
  };

  const loadData = async () => {
    if (!auPath) return;
    setLoading(true);
    try {
      const [proj, loreFiles] = await Promise.all([
        getProject(auPath),
        listLoreFiles({ au_path: auPath, category: 'characters' }),
      ]);

      setProject(proj);
      setFiles(loreFiles.files);

      const nextSelected = selectedFile && loreFiles.files.some(file => file.name === selectedFile)
        ? selectedFile
        : loreFiles.files[0]?.name || null;

      if (nextSelected) {
        await loadFileContent(nextSelected);
      } else {
        setSelectedFile(null);
        setEditorContent('');
      }
    } catch (error) {
      showError(error, t('error_messages.unknown'));
      setFiles([]);
      setSelectedFile(null);
      setEditorContent('');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [auPath]);

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => ({ ...prev, [folder]: !prev[folder] }));
  };

  const handleSaveLore = async () => {
    if (!selectedFile) return;
    setIsSaving(true);
    try {
      await saveLore({
        au_path: auPath,
        category: 'characters',
        filename: `${selectedFile}.md`,
        content: editorContent,
      });
      showSuccess(t('common.actions.save'));
    } catch (error) {
      showError(error, t('error_messages.unknown'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteLore = async () => {
    if (!selectedFile || !project) return;
    setDeleteConfirmOpen(false);
    setIsSaving(true);
    try {
      await deleteLore({
        au_path: auPath,
        category: 'characters',
        filename: `${selectedFile}.md`,
      });

      const remainingNames = (project.cast_registry.characters || []).filter(name => name !== selectedFile);
      await syncRegistry(remainingNames);
      // 同时清理 core_always_include 中的已删除角色
      const remainingPins = (project.core_always_include || []).filter(n => n !== selectedFile);
      if (remainingPins.length !== (project.core_always_include || []).length) {
        await updateProject(auPath, { core_always_include: remainingPins });
        setProject(prev => prev ? { ...prev, core_always_include: remainingPins } : prev);
      }
      setFiles(prev => prev.filter(file => file.name !== selectedFile));
      setSelectedFile(null);
      setEditorContent('');
      setTrashRefreshToken(current => current + 1);
    } catch (error) {
      showError(error, t('error_messages.unknown'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreate = async () => {
    const rawName = createName.trim();
    if (!rawName || !project) return;

    const defaultContent = buildDefaultCharacterContent(rawName);
    setCreateModalOpen(false);
    setIsSaving(true);

    try {
      await saveLore({
        au_path: auPath,
        category: 'characters',
        filename: `${rawName}.md`,
        content: defaultContent,
      });

      await syncRegistry([...(project.cast_registry.characters || []), rawName]);
      setFiles(prev => [...prev, { name: rawName, filename: `${rawName}.md` }].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedFile(rawName);
      setEditorContent(defaultContent);
      setCreateName('');
    } catch (error) {
      showError(error, t('error_messages.unknown'));
    } finally {
      setIsSaving(false);
    }
  };

  const openImportModal = async () => {
    setImportModalOpen(true);
    setImportLoading(true);
    setSelectedImports([]);
    try {
      const fandomFiles = await listLoreFiles({ fandom_path: deriveFandomPath(auPath), category: 'core_characters' });
      const existing = new Set(files.map(file => file.name));
      setImportCandidates(fandomFiles.files.filter(file => !existing.has(file.name)));
    } catch (error) {
      showError(error, t('error_messages.unknown'));
      setImportCandidates([]);
    } finally {
      setImportLoading(false);
    }
  };

  const handleToggleImport = (name: string) => {
    setSelectedImports(prev => prev.includes(name) ? prev.filter(item => item !== name) : [...prev, name]);
  };

  const handleImportSelected = async () => {
    if (selectedImports.length === 0 || !project) return;
    setIsSaving(true);
    try {
      await importFromFandom({
        fandom_path: deriveFandomPath(auPath),
        au_path: auPath,
        filenames: selectedImports.map(name => `${name}.md`),
        source_category: 'core_characters',
      });

      await syncRegistry([...(project.cast_registry.characters || []), ...selectedImports]);
      setImportModalOpen(false);
      setSelectedImports([]);
      showSuccess(t('auLore.importSuccess', { count: selectedImports.length }));
      await loadData();
    } catch (error) {
      showError(error, t('error_messages.unknown'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTrashRestore = (entry: TrashEntry) => {
    const restoredFile = getRestoredCharacterFile(entry);
    if (!restoredFile) return;

    setFiles((prev) => {
      if (prev.some((file) => file.filename === restoredFile.filename)) return prev;
      return [...prev, restoredFile].sort((left, right) => left.name.localeCompare(right.name));
    });

    setProject((prev) => {
      if (!prev) return prev;
      const currentCharacters = prev.cast_registry.characters || [];
      if (currentCharacters.includes(restoredFile.name)) return prev;
      return {
        ...prev,
        cast_registry: {
          ...prev.cast_registry,
          characters: [...currentCharacters, restoredFile.name],
        },
      };
    });
  };

  const filteredFiles = files.filter(file => {
    if (!searchTerm.trim()) return true;
    return file.name.includes(searchTerm.trim());
  });

  const auName = project?.name || auPath.split('/').pop() || t('common.unknownAu');

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-accent" size={32} />
      </div>
    );
  }

  return (
    <>
      <div className="w-[300px] md:w-[340px] shrink-0 border-r border-black/10 dark:border-white/10 flex flex-col bg-surface/50">
        <header className="p-4 border-b border-black/10 dark:border-white/10 flex flex-col gap-3 shrink-0 bg-surface">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-lg font-bold">{t('common.scope.auTitle', { name: auName })}</h1>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="px-2" onClick={openImportModal} disabled={isSaving} title={t('common.actions.importFromFandom')}>
                <Download size={16} />
              </Button>
              <Button variant="ghost" size="sm" className="px-2" onClick={() => { setCreateName(''); setCreateModalOpen(true); }} disabled={isSaving}>
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              </Button>
            </div>
          </div>
          <div className="text-xs text-text/60">{t('auLore.referenceHint')}</div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 text-text/50" size={14} />
            <Input className="pl-8 h-8 text-xs placeholder:text-xs" placeholder={t('auLore.searchPlaceholder')} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
        </header>

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 overflow-y-auto p-2 space-y-6 font-mono py-4">
            <div className="space-y-2">
              <div className="px-3 pb-1 text-[11px] font-sans font-bold text-text/40 uppercase tracking-widest">
                {t('auLore.charactersLabel')} ({files.length})
              </div>
              <div>
                <div className="flex items-center justify-between px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/80 font-bold font-sans" onClick={() => toggleFolder('characters')}>
                  <div className="flex items-center gap-2">
                    {expandedFolders.characters ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Folder size={14} className="text-accent" fill="currentColor" fillOpacity={0.2} />
                    <span>{t('common.labels.characters')}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="p-0 h-6 w-6" onClick={(event) => { event.stopPropagation(); setCreateName(''); setCreateModalOpen(true); }}>
                    <Plus size={12} />
                  </Button>
                </div>
                {expandedFolders.characters && (
                  <div className="mt-1 space-y-0.5">
                    {filteredFiles.length === 0 ? (
                      <EmptyState
                        compact
                        icon={<FileText size={28} />}
                        title={t('emptyState.auCharacters.title')}
                        description={t('emptyState.auCharacters.description')}
                        actions={[
                          {
                            key: 'add-character',
                            element: (
                              <Button variant="primary" size="sm" onClick={() => setCreateModalOpen(true)}>
                                {t('common.actions.addCharacter')}
                              </Button>
                            ),
                          },
                          {
                            key: 'import-character',
                            element: (
                              <Button variant="secondary" size="sm" onClick={openImportModal}>
                                {t('common.actions.importFromFandom')}
                              </Button>
                            ),
                          },
                        ]}
                      />
                    ) : (
                      filteredFiles.map(file => {
                        const isPinned = coreIncludes.includes(file.name);
                        return (
                          <div
                            key={file.name}
                            className={`flex items-center justify-between pl-6 pr-2 py-1.5 text-sm cursor-pointer rounded-md ${selectedFile === file.name ? 'bg-accent/10 text-accent font-medium' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5 hover:text-text'}`}
                            onClick={() => { void loadFileContent(file.name); }}
                          >
                            <div className="flex items-center gap-2 overflow-hidden">
                              <FileText size={14} className="opacity-50 shrink-0" />
                              <span className="truncate">{file.name}.md</span>
                            </div>
                            <button
                              className={`shrink-0 p-1 rounded transition-colors ${isPinned ? 'text-accent' : 'text-text/20 hover:text-text/50'} ${isSaving ? 'opacity-30 cursor-not-allowed' : ''}`}
                              title={isPinned ? t('coreIncludes.pinned') : t('coreIncludes.setPin')}
                              disabled={isSaving}
                              onClick={(e) => { e.stopPropagation(); void handleTogglePin(file.name); }}
                            >
                              <Pin size={12} fill={isPinned ? 'currentColor' : 'none'} />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="px-4 pb-2 space-y-2">
            {coreIncludes.length > 3 && (
              <div className="text-xs text-warning bg-warning/10 rounded-md px-3 py-2">
                {t('coreIncludes.tooMany', { count: coreIncludes.length })}
              </div>
            )}
            <div className="text-[11px] text-text/40 leading-relaxed px-1">
              {t('coreIncludes.hint')}
            </div>
          </div>
          <TrashPanel scope="au" path={auPath} onRestore={handleTrashRestore} refreshToken={trashRefreshToken} />
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-background relative">
        <header className="h-14 border-b border-black/10 dark:border-white/10 flex items-center px-6 justify-between shrink-0 bg-surface/30">
          {selectedFile ? (
            <>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-semibold opacity-70">{selectedFile}.md</span>
                <span className="rounded-full bg-info/10 px-2 py-1 text-xs text-info">{t('auLore.selectedTag')}</span>
                {coreIncludes.includes(selectedFile) && (
                  <span className="rounded-full bg-accent/10 px-2 py-1 text-xs text-accent flex items-center gap-1">
                    <Pin size={10} fill="currentColor" /> {t('coreIncludes.pinned')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" className="h-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => setDeleteConfirmOpen(true)} disabled={isSaving}>
                  <Trash2 size={14} />
                </Button>
                <Button variant="primary" size="sm" className="h-8 w-24" onClick={handleSaveLore} disabled={isSaving}>
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : t('auLore.saveButton')}
                </Button>
              </div>
            </>
          ) : (
            <span className="font-mono text-sm opacity-40">{t('auLore.unselected')}</span>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-8 lg:p-12 w-full max-w-4xl mx-auto flex flex-col gap-6">
          {selectedFile ? (
            <div className="flex flex-col gap-2 flex-1">
              <label className="text-sm font-bold text-text/90">{t('navigation.auLore')}</label>
              <Textarea
                value={editorContent}
                onChange={e => setEditorContent(e.target.value)}
                className="font-mono flex-1 min-h-[420px] text-sm leading-relaxed bg-surface/30 p-4 resize-y"
              />
            </div>
          ) : (
            <EmptyState
              icon={<FileText size={40} />}
              title={t('navigation.auLore')}
              description={t('auLore.referenceHint')}
              actions={[
                {
                  key: 'create-character-empty',
                  element: (
                    <Button variant="primary" onClick={() => setCreateModalOpen(true)}>
                      {t('common.actions.addCharacter')}
                    </Button>
                  ),
                },
                {
                  key: 'import-character-empty',
                  element: (
                    <Button variant="secondary" onClick={openImportModal}>
                      {t('common.actions.importFromFandom')}
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </div>
      </div>

      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title={t('auLore.createTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/70">{t('auLore.createDescription')}</p>
          <Input value={createName} onChange={e => setCreateName(e.target.value)} placeholder={t('auLore.createPlaceholder')} autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateModalOpen(false)}>{t('common.actions.cancel')}</Button>
            <Button variant="primary" onClick={handleCreate} disabled={!createName.trim()}>{t('common.actions.create')}</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} title={t('auLore.deleteTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/80">{t('auLore.deleteMessage', { name: `${selectedFile}.md` })}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)}>{t('common.actions.cancel')}</Button>
            <Button variant="primary" className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDeleteLore}>{t('common.actions.confirmDelete')}</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={coreLimitModalOpen} onClose={() => setCoreLimitModalOpen(false)} title={t('coreIncludes.missingCoreLimit')}>
        <div className="space-y-4">
          <p className="text-sm text-text/80 leading-relaxed">{t('coreIncludes.missingCoreLimitDesc')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCoreLimitModalOpen(false)}>{t('coreIncludes.later')}</Button>
            <Button variant="primary" onClick={() => {
              setCoreLimitModalOpen(false);
              if (coreLimitTarget) void loadFileContent(coreLimitTarget);
            }}>{t('coreIncludes.goEdit')}</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={importModalOpen} onClose={() => setImportModalOpen(false)} title={t('auLore.importTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/70">{t('auLore.importDescription')}</p>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto rounded-lg border border-black/10 p-2 dark:border-white/10">
            {importLoading ? (
              <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-accent" /></div>
            ) : importCandidates.length === 0 ? (
              <EmptyState compact icon={<Download size={28} />} title={t('auLore.importEmpty')} description={t('fandomLore.referenceHint')} />
            ) : (
              importCandidates.map(file => (
                <label key={file.name} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedImports.includes(file.name)}
                    onChange={() => handleToggleImport(file.name)}
                    className="accent-accent"
                  />
                  <span className="text-sm">{file.name}</span>
                </label>
              ))
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setImportModalOpen(false)}>{t('common.actions.cancel')}</Button>
            <Button variant="primary" onClick={handleImportSelected} disabled={selectedImports.length === 0 || isSaving}>
              {isSaving ? <Loader2 size={16} className="animate-spin" /> : t('common.actions.importSelected')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
