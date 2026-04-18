// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect, useRef } from 'react';
import { Spinner } from "../shared/Spinner";
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { EmptyState } from '../shared/EmptyState';
import { TrashPanel } from '../shared/TrashPanel';
import type { TrashEntry } from '../../api/engine-client';
import { Search, Plus, FileText, ChevronDown, ChevronRight, Folder, Trash2, Download, Pin, Eye, Pencil } from 'lucide-react';
import { SettingsMarkdown } from '../shared/SettingsMarkdown';
import { getProject, updateProject, type ProjectInfo } from '../../api/engine-client';
import { saveLore, readLore, deleteLore, listLoreFiles, importFromFandom, getLoreContent } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import { useMilestoneGuide } from '../../hooks/useMilestoneGuide';
import { MilestoneGuide } from '../shared/MilestoneGuide';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { AuLoreModals } from './AuLoreModals';

type LoreFileEntry = {
  name: string;
  filename: string;
};

import {
  buildDefaultCharacterContent,
  buildDefaultWorldbuildingContent,
  parseAliasesFromContent,
  setAliasesInContent,
  toCanonicalCreateKey,
  deriveFandomPath,
} from "./lore-utils";

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
  const { showError, showSuccess, showToast } = useFeedback();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const activeAuPathRef = useRef(auPath);
  activeAuPathRef.current = auPath;
  const loadDataRequestIdRef = useRef(0);
  const readFileRequestIdRef = useRef(0);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [files, setFiles] = useState<LoreFileEntry[]>([]);
  const [worldbuildingFiles, setWorldbuildingFiles] = useState<LoreFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ characters: true, worldbuilding: false });
  const [selectedCategory, setSelectedCategory] = useState<'characters' | 'worldbuilding'>('characters');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [newAlias, setNewAlias] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [previewMode, setPreviewMode] = useState(true);
  const [isReadingFile, setIsReadingFile] = useState(false);
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
  const { shouldShow: shouldShowMilestone, dismiss: dismissMilestone } = useMilestoneGuide();
  const [pinMilestoneDismissed, setPinMilestoneDismissed] = useState(false);

  const syncRegistry = async (names: string[], requestAuPath = auPath) => {
    const deduped = Array.from(new Set(names));
    await updateProject(auPath, { cast_registry: { characters: deduped } });
    if (activeAuPathRef.current !== requestAuPath) return;
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
    const requestAuPath = auPath;
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
          if (activeAuPathRef.current !== requestAuPath) return;
          if (!result.content.includes('## 核心限制') && !result.content.includes('## Core Constraints')) {
            setCoreLimitTarget(name);
            setCoreLimitModalOpen(true);
          }
        } catch { /* 读取失败不阻塞 */ }
      }

      await updateProject(auPath, { core_always_include: next });
      if (activeAuPathRef.current !== requestAuPath) return;
      setProject(prev => prev ? { ...prev, core_always_include: next } : prev);
      showSuccess(isPinned ? t('coreIncludes.unpinnedToast') : t('coreIncludes.pinnedToast'));
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setIsSaving(false);
      }
    }
  };

  const loadFileContent = async (name: string, loadRequestId?: number, categoryOverride?: 'characters' | 'worldbuilding') => {
    const readRequestId = ++readFileRequestIdRef.current;
    const requestAuPath = auPath;
    const effectiveCategory = categoryOverride ?? selectedCategory;
    setSelectedFile(name);
    setEditorContent('');
    setIsReadingFile(true);
    try {
      const result = await readLore({ au_path: auPath, category: effectiveCategory, filename: `${name}.md` });
      if (
        readRequestId !== readFileRequestIdRef.current
        || (typeof loadRequestId === 'number' && loadRequestId !== loadDataRequestIdRef.current)
        || activeAuPathRef.current !== requestAuPath
      ) {
        return;
      }
      const content = result.content || (effectiveCategory === 'worldbuilding' ? buildDefaultWorldbuildingContent(name) : buildDefaultCharacterContent(name));
      setEditorContent(content);
      setAliases(effectiveCategory === 'characters' ? parseAliasesFromContent(content) : []);
      setNewAlias('');
    } catch {
      if (
        readRequestId !== readFileRequestIdRef.current
        || (typeof loadRequestId === 'number' && loadRequestId !== loadDataRequestIdRef.current)
        || activeAuPathRef.current !== requestAuPath
      ) {
        return;
      }
      setEditorContent(effectiveCategory === 'worldbuilding' ? buildDefaultWorldbuildingContent(name) : buildDefaultCharacterContent(name));
    } finally {
      if (
        readRequestId === readFileRequestIdRef.current
        && (typeof loadRequestId !== 'number' || loadRequestId === loadDataRequestIdRef.current)
        && activeAuPathRef.current === requestAuPath
      ) {
        setIsReadingFile(false);
      }
    }
  };

  const loadData = async () => {
    if (!auPath) return;
    const requestId = ++loadDataRequestIdRef.current;
    const requestAuPath = auPath;
    setLoading(true);
    try {
      const [proj, loreFiles, wbFiles] = await Promise.all([
        getProject(auPath),
        listLoreFiles({ au_path: auPath, category: selectedCategory }),
        listLoreFiles({ au_path: auPath, category: 'worldbuilding' }),
      ]);
      if (requestId !== loadDataRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;

      setProject(proj);
      setFiles(loreFiles.files);
      setWorldbuildingFiles(wbFiles.files);

      const nextSelected = selectedFile && loreFiles.files.some(file => file.name === selectedFile)
        ? selectedFile
        : null;

      if (nextSelected) {
        await loadFileContent(nextSelected, requestId);
      } else {
        setSelectedFile(null);
        setEditorContent('');
      }
    } catch (error) {
      if (requestId !== loadDataRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (requestId === loadDataRequestIdRef.current && activeAuPathRef.current === requestAuPath) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    activeAuPathRef.current = auPath;
    loadDataRequestIdRef.current += 1;
    readFileRequestIdRef.current += 1;
    setLoading(true);
    setProject(null);
    setFiles([]);
    setSelectedFile(null);
    setEditorContent('');
    setIsSaving(false);
    setIsReadingFile(false);
    setCreateModalOpen(false);
    setDeleteConfirmOpen(false);
    setImportModalOpen(false);
    setImportLoading(false);
    setImportCandidates([]);
    setSelectedImports([]);
    setCoreLimitModalOpen(false);
    setCoreLimitTarget(null);
  }, [auPath]);

  useEffect(() => {
    void loadData();
  }, [auPath]);

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => ({ ...prev, [folder]: !prev[folder] }));
  };

  const handleSaveLore = async () => {
    if (!selectedFile) return;
    const requestAuPath = auPath;
    setIsSaving(true);
    try {
      const contentToSave = selectedCategory === 'characters'
        ? setAliasesInContent(editorContent, aliases)
        : editorContent;
      await saveLore({
        au_path: auPath,
        category: selectedCategory,
        filename: `${selectedFile}.md`,
        content: contentToSave,
      });
      if (activeAuPathRef.current !== requestAuPath) return;
      showSuccess(t('common.actions.save'));
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setIsSaving(false);
      }
    }
  };

  const handleDeleteLore = async () => {
    if (!selectedFile || !project) return;
    const requestAuPath = auPath;
    setDeleteConfirmOpen(false);
    setIsSaving(true);
    try {
      await deleteLore({
        au_path: auPath,
        category: selectedCategory,
        filename: `${selectedFile}.md`,
      });
      if (activeAuPathRef.current !== requestAuPath) return;

      const remainingNames = (project.cast_registry.characters || []).filter(name => name !== selectedFile);
      await syncRegistry(remainingNames, requestAuPath);
      if (activeAuPathRef.current !== requestAuPath) return;
      // 同时清理 core_always_include 中的已删除角色
      const remainingPins = (project.core_always_include || []).filter(n => n !== selectedFile);
      if (remainingPins.length !== (project.core_always_include || []).length) {
        await updateProject(auPath, { core_always_include: remainingPins });
        if (activeAuPathRef.current !== requestAuPath) return;
        setProject(prev => prev ? { ...prev, core_always_include: remainingPins } : prev);
      }
      const setTargetFilesForDelete = selectedCategory === 'worldbuilding' ? setWorldbuildingFiles : setFiles;
      setTargetFilesForDelete(prev => prev.filter(file => file.name !== selectedFile));
      setSelectedFile(null);
      setEditorContent('');
      setTrashRefreshToken(current => current + 1);
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setIsSaving(false);
      }
    }
  };

  const handleCreate = async () => {
    const rawName = createName.trim();
    if (!rawName) return;
    const requestAuPath = auPath;
    const displayName = rawName.replace(/\.md$/i, '').trim();
    if (!displayName) {
      showToast(t('settingsMode.validation.nameRequired'), 'warning');
      return;
    }

    const filename = `${displayName}.md`;
    const defaultContent = selectedCategory === 'worldbuilding'
      ? buildDefaultWorldbuildingContent(displayName)
      : buildDefaultCharacterContent(displayName);
    let latestProject: ProjectInfo;
    let latestFiles: { files: LoreFileEntry[] };
    setCreateModalOpen(false);
    setIsSaving(true);

    try {
      try {
        [latestProject, latestFiles] = await Promise.all([
          getProject(auPath),
          listLoreFiles({ au_path: auPath, category: selectedCategory }),
        ]);
      } catch (error) {
        if (activeAuPathRef.current !== requestAuPath) return;
        showError(error, t('error_messages.unknown'));
        return;
      }
      if (activeAuPathRef.current !== requestAuPath) return;

      if (latestFiles.files.some((file) => toCanonicalCreateKey(file.filename) === toCanonicalCreateKey(filename))) {
        showToast(t('auLore.createDuplicate', { name: filename }), 'warning');
        return;
      }

      await saveLore({
        au_path: auPath,
        category: selectedCategory,
        filename,
        content: defaultContent,
      });
      try {
        if (selectedCategory === 'characters') {
          await syncRegistry([...(latestProject.cast_registry.characters || []), displayName], requestAuPath);
        }
      } catch (error) {
        try {
          await deleteLore({
            au_path: auPath,
            category: selectedCategory,
            filename,
          });
        } catch {
          throw error;
        }
        throw error;
      }
      if (activeAuPathRef.current !== requestAuPath) return;
      const setTargetFiles = selectedCategory === 'worldbuilding' ? setWorldbuildingFiles : setFiles;
      setTargetFiles(prev => [...prev, { name: displayName, filename }].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedFile(displayName);
      setPreviewMode(false);
      setEditorContent(defaultContent);
      setCreateName('');
      setSearchTerm('');
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setIsSaving(false);
      }
    }
  };

  const openImportModal = async () => {
    const requestAuPath = auPath;
    setImportModalOpen(true);
    setImportLoading(true);
    setSelectedImports([]);
    try {
      const fandomFiles = await listLoreFiles({ fandom_path: deriveFandomPath(auPath), category: 'core_characters' });
      if (activeAuPathRef.current !== requestAuPath) return;
      const existing = new Set(files.map(file => file.name));
      setImportCandidates(fandomFiles.files.filter(file => !existing.has(file.name)));
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
      setImportCandidates([]);
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setImportLoading(false);
      }
    }
  };

  const handleToggleImport = (name: string) => {
    setSelectedImports(prev => prev.includes(name) ? prev.filter(item => item !== name) : [...prev, name]);
  };

  const handleImportSelected = async () => {
    if (selectedImports.length === 0 || !project) return;
    const requestAuPath = auPath;
    setIsSaving(true);
    try {
      await importFromFandom({
        fandom_path: deriveFandomPath(auPath),
        au_path: auPath,
        filenames: selectedImports.map(name => `${name}.md`),
        source_category: 'core_characters',
      });
      if (activeAuPathRef.current !== requestAuPath) return;
      await syncRegistry([...(project.cast_registry.characters || []), ...selectedImports], requestAuPath);
      if (activeAuPathRef.current !== requestAuPath) return;
      setImportModalOpen(false);
      setSelectedImports([]);
      showSuccess(t('auLore.importSuccess', { count: selectedImports.length }));
      await loadData();
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setIsSaving(false);
      }
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
  const filteredWorldbuildingFiles = worldbuildingFiles.filter(file => {
    if (!searchTerm.trim()) return true;
    return file.name.includes(searchTerm.trim());
  });

  const auName = project?.name || auPath.split('/').pop() || t('common.unknownAu');

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner size="lg" className="text-accent" />
      </div>
    );
  }

  const editorPanel = selectedFile ? (
    <div className="flex flex-1 flex-col gap-2">
      <label className="text-sm font-bold text-text/90">{t('navigation.auLore')}</label>

      {selectedCategory === 'characters' && (
        <div className="flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-lg border border-black/10 bg-surface/30 px-3 py-2 dark:border-white/10 md:min-h-[36px]">
          <span className="mr-1 text-xs font-sans text-text/50 md:text-xs">{t('auLore.aliasesLabel')}</span>
          {aliases.map((alias, i) => (
            <span key={i} className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-accent/10 px-3 py-1 text-sm font-sans text-accent md:min-h-0 md:rounded-md md:px-2 md:py-0.5 md:text-xs">
              {alias}
              <button
                type="button"
                className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-accent/60 transition-colors hover:text-red-500 md:-mr-1 md:h-5 md:w-5"
                onClick={() => setAliases(prev => prev.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </span>
          ))}
          <input
            className="min-w-[80px] flex-1 bg-transparent text-xs font-sans outline-none placeholder:text-text/30"
            placeholder={t('auLore.aliasPlaceholder')}
            value={newAlias}
            onChange={e => setNewAlias(e.target.value)}
            onKeyDown={e => {
              if ((e.key === 'Enter' || e.key === ',') && newAlias.trim()) {
                e.preventDefault();
                if (!aliases.includes(newAlias.trim())) {
                  setAliases(prev => [...prev, newAlias.trim()]);
                }
                setNewAlias('');
              }
              if (e.key === 'Backspace' && !newAlias && aliases.length > 0) {
                setAliases(prev => prev.slice(0, -1));
              }
            }}
            disabled={isReadingFile}
          />
        </div>
      )}

      {previewMode ? (
        <div className="min-h-[420px] flex-1 overflow-y-auto rounded-md border border-black/10 bg-surface/30 p-4 dark:border-white/10 md:p-6">
          <SettingsMarkdown content={editorContent} />
        </div>
      ) : (
        <Textarea
          value={editorContent}
          onChange={e => setEditorContent(e.target.value)}
          disabled={isReadingFile}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file && (file.name.endsWith('.txt') || file.name.endsWith('.md'))) {
              file.text().then(text => setEditorContent(prev => prev + '\n\n' + text));
            }
          }}
          className="font-mono flex-1 min-h-[420px] text-sm leading-relaxed bg-surface/30 p-4 resize-y"
        />
      )}
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
            <Button tone="accent" fill="solid" onClick={() => setCreateModalOpen(true)}>
              {t('common.actions.addCharacter')}
            </Button>
          ),
        },
        {
          key: 'import-character-empty',
          element: (
            <Button tone="neutral" fill="outline" onClick={openImportModal}>
              {t('common.actions.importFromFandom')}
            </Button>
          ),
        },
      ]}
    />
  );

  const sharedModals = (
    <AuLoreModals
      createModalOpen={createModalOpen}
      setCreateModalOpen={setCreateModalOpen}
      createName={createName}
      setCreateName={setCreateName}
      selectedCategory={selectedCategory}
      handleCreate={handleCreate}
      deleteConfirmOpen={deleteConfirmOpen}
      setDeleteConfirmOpen={setDeleteConfirmOpen}
      selectedFile={selectedFile}
      handleDeleteLore={handleDeleteLore}
      importModalOpen={importModalOpen}
      setImportModalOpen={setImportModalOpen}
      importLoading={importLoading}
      importCandidates={importCandidates}
      selectedImports={selectedImports}
      handleToggleImport={handleToggleImport}
      handleImportSelected={handleImportSelected}
      isSaving={isSaving}
      coreLimitModalOpen={coreLimitModalOpen}
      setCoreLimitModalOpen={setCoreLimitModalOpen}
      coreLimitTarget={coreLimitTarget}
      loadFileContent={(name) => { void loadFileContent(name); }}
    />
  );

  if (isMobile) {
    const currentFiles = selectedCategory === 'characters' ? filteredFiles : filteredWorldbuildingFiles;

    return (
      <>
        <div className="min-h-full bg-background pb-28 md:hidden">
          <header className="safe-area-top sticky top-0 z-20 border-b border-black/10 bg-surface/90 px-4 py-4 backdrop-blur dark:border-white/10">
            <div className="flex items-center justify-between gap-3">
              {selectedFile ? (
                <div className="flex min-w-0 items-center gap-2">
                  <Button tone="neutral" fill="plain" size="sm" className="px-3" onClick={() => setSelectedFile(null)}>
                    ← {t('common.actions.back')}
                  </Button>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text">{selectedFile}.md</p>
                    <p className="text-xs text-text/50">{selectedCategory === 'worldbuilding' ? t('auLore.selectedTagWorldbuilding') : t('auLore.selectedTag')}</p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium text-text/50">{t('navigation.auLore')}</p>
                  <h1 className="mt-1 truncate font-serif text-2xl font-bold">{auName}</h1>
                </div>
              )}

              <div className="flex items-center gap-2">
                {selectedFile ? (
                  <>
                    <Button tone="neutral" fill="plain" size="sm" className="px-3 text-red-500" onClick={() => setDeleteConfirmOpen(true)} disabled={isSaving || isReadingFile}>
                      <Trash2 size={16} />
                    </Button>
                    <Button tone="accent" fill="solid" size="sm" className="px-3" onClick={handleSaveLore} disabled={isSaving || isReadingFile}>
                      {isSaving || isReadingFile ? <Spinner size="sm" /> : t('auLore.saveButton')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button tone="neutral" fill="plain" size="sm" className="px-3" onClick={openImportModal} disabled={isSaving} title={t('common.actions.importFromFandom')}>
                      <Download size={16} />
                    </Button>
                    <Button tone="accent" fill="solid" size="sm" className="px-3" onClick={() => { setCreateName(''); setCreateModalOpen(true); }} disabled={isSaving}>
                      <Plus size={16} />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {selectedFile ? (
              <div className="mt-3 inline-flex rounded-md border border-black/10 bg-surface/60 p-0.5 dark:border-white/10">
                <button className={`flex min-h-[44px] items-center gap-1 rounded px-3 py-2 text-sm ${!previewMode ? 'bg-accent text-white' : 'text-text/70 hover:text-text'}`} onClick={() => setPreviewMode(false)}>
                  <Pencil size={12} /> {t('common.actions.edit')}
                </button>
                <button className={`flex min-h-[44px] items-center gap-1 rounded px-3 py-2 text-sm ${previewMode ? 'bg-accent text-white' : 'text-text/70 hover:text-text'}`} onClick={() => setPreviewMode(true)}>
                  <Eye size={12} /> {t('common.actions.preview')}
                </button>
              </div>
            ) : (
              <>
                <div className="mt-4 inline-flex w-full rounded-xl border border-black/10 bg-background/70 p-1 dark:border-white/10">
                  <button type="button" onClick={() => setSelectedCategory('characters')} className={`flex min-h-[44px] flex-1 items-center justify-center rounded-xl text-sm font-medium transition-colors ${selectedCategory === 'characters' ? 'bg-accent text-white' : 'text-text/50'}`}>
                    {t('common.labels.characters')}
                  </button>
                  <button type="button" onClick={() => setSelectedCategory('worldbuilding')} className={`flex min-h-[44px] flex-1 items-center justify-center rounded-xl text-sm font-medium transition-colors ${selectedCategory === 'worldbuilding' ? 'bg-accent text-white' : 'text-text/50'}`}>
                    {t('common.labels.worldbuilding')}
                  </button>
                </div>
                <div className="relative mt-3">
                  <Search className="absolute left-3 top-3 text-text/50" size={16} />
                  <Input className="pl-10" placeholder={t('auLore.searchPlaceholder')} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
              </>
            )}
          </header>

          <div className="px-4 py-4">
            {selectedFile ? (
              editorPanel
            ) : (
              <div className="space-y-3">
                {currentFiles.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<FileText size={28} />}
                    title={selectedCategory === 'characters' ? t('emptyState.auCharacters.title') : t('emptyState.auWorldbuilding.title')}
                    description={selectedCategory === 'characters' ? t('emptyState.auCharacters.description') : t('emptyState.auWorldbuilding.description')}
                    actions={[
                      {
                        key: 'add-item',
                        element: (
                          <Button tone="accent" fill="solid" size="sm" onClick={() => setCreateModalOpen(true)}>
                            {selectedCategory === 'characters' ? t('common.actions.addCharacter') : t('common.actions.addWorldbuilding')}
                          </Button>
                        ),
                      },
                    ]}
                  />
                ) : currentFiles.map(file => {
                  const isPinned = coreIncludes.includes(file.name);
                  return (
                    <div
                      key={file.name}
                      role="button"
                      tabIndex={0}
                      onClick={() => { void loadFileContent(file.name, undefined, selectedCategory); }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void loadFileContent(file.name, undefined, selectedCategory);
                        }
                      }}
                      className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-black/10 bg-surface/35 px-4 py-4 text-left transition-colors dark:border-white/10"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-base font-medium text-text">{file.name}.md</p>
                        <p className="mt-1 text-xs text-text/50">{selectedCategory === 'worldbuilding' ? t('auLore.selectedTagWorldbuilding') : t('auLore.selectedTag')}</p>
                      </div>
                      {selectedCategory === 'characters' ? (
                        <button
                          type="button"
                          className={`ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${isPinned ? 'text-accent' : 'text-text/30'}`}
                          onClick={(event) => { event.stopPropagation(); void handleTogglePin(file.name); }}
                        >
                          <Pin size={14} fill={isPinned ? 'currentColor' : 'none'} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}

                <div className="overflow-hidden rounded-xl border border-black/10 bg-surface/35 dark:border-white/10">
                  <TrashPanel scope="au" path={auPath} onRestore={handleTrashRestore} refreshToken={trashRefreshToken} />
                </div>
              </div>
            )}
          </div>
        </div>

        {sharedModals}
      </>
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
              <Button tone="neutral" fill="plain" size="sm" className="px-2" onClick={openImportModal} disabled={isSaving} title={t('common.actions.importFromFandom')}>
                <Download size={16} />
              </Button>
              <Button tone="neutral" fill="plain" size="sm" className="px-2" onClick={() => { setCreateName(''); setCreateModalOpen(true); }} disabled={isSaving}>
                {isSaving ? <Spinner size="md" /> : <Plus size={16} />}
              </Button>
            </div>
          </div>
          <div className="text-xs text-text/70">{t('auLore.referenceHint')}</div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 text-text/50" size={14} />
            <Input className="pl-8 h-8 text-xs placeholder:text-xs" placeholder={t('auLore.searchPlaceholder')} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
        </header>

        <div className="flex-1 min-h-0 flex flex-col">
          {/* Milestone 4: Pin intro when characters exist but no pins */}
          {files.length > 0 && coreIncludes.length === 0 && shouldShowMilestone('pin_intro') && !pinMilestoneDismissed && (
            <MilestoneGuide
              title={t('milestones.pinIntro.title')}
              description={t('milestones.pinIntro.desc')}
              primaryAction={{ label: t('milestones.pinIntro.goSet'), onClick: () => { dismissMilestone('pin_intro'); setPinMilestoneDismissed(true); } }}
              secondaryAction={{ label: t('milestones.pinIntro.later'), onClick: () => { dismissMilestone('pin_intro'); setPinMilestoneDismissed(true); } }}
              onDismiss={() => { dismissMilestone('pin_intro'); setPinMilestoneDismissed(true); }}
            />
          )}
          <div className="flex-1 overflow-y-auto p-2 space-y-6 font-mono py-4">
            <div className="space-y-2">
              <div className="px-3 pb-1 text-xs font-sans font-medium text-text/50">
                {t('auLore.charactersLabel')} ({files.length})
              </div>
              <div>
                <div className="flex items-center justify-between px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/90 font-bold font-sans" onClick={() => toggleFolder('characters')}>
                  <div className="flex items-center gap-2">
                    {expandedFolders.characters ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Folder size={14} className="text-accent" fill="currentColor" fillOpacity={0.2} />
                    <span>{t('common.labels.characters')}</span>
                  </div>
                  <Button tone="neutral" fill="plain" size="sm" className="p-0 h-6 w-6" onClick={(event) => { event.stopPropagation(); setSelectedCategory('characters'); setCreateName(''); setCreateModalOpen(true); }}>
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
                              <Button tone="accent" fill="solid" size="sm" onClick={() => setCreateModalOpen(true)}>
                                {t('common.actions.addCharacter')}
                              </Button>
                            ),
                          },
                          {
                            key: 'import-character',
                            element: (
                              <Button tone="neutral" fill="outline" size="sm" onClick={openImportModal}>
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
                            className={`flex items-center justify-between pl-6 pr-2 py-1.5 text-sm cursor-pointer rounded-md ${selectedFile === file.name && selectedCategory === 'characters' ? 'bg-accent/10 text-accent font-medium' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5 hover:text-text'}`}
                            onClick={() => { setSelectedCategory('characters'); void loadFileContent(file.name, undefined, 'characters'); }}
                          >
                            <div className="flex items-center gap-2 overflow-hidden">
                              <FileText size={14} className="opacity-50 shrink-0" />
                              <span className="truncate">{file.name}.md</span>
                            </div>
                            <button
                              className={`shrink-0 p-1 rounded transition-colors ${isPinned ? 'text-accent' : 'text-text/30 hover:text-text/50'} ${isSaving ? 'opacity-30 cursor-not-allowed' : ''}`}
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

            {/* 世界观分区 */}
            <div className="space-y-2">
              <div className="px-3 pb-1 text-xs font-sans font-medium text-text/50">
                {t('common.labels.worldbuilding')} ({worldbuildingFiles.length})
              </div>
              <div>
                <div className="flex items-center justify-between px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/90 font-bold font-sans" onClick={() => toggleFolder('worldbuilding')}>
                  <div className="flex items-center gap-2">
                    {expandedFolders.worldbuilding ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Folder size={14} className="text-info" fill="currentColor" fillOpacity={0.2} />
                    <span>{t('common.labels.worldbuilding')}</span>
                  </div>
                  <Button tone="neutral" fill="plain" size="sm" className="p-0 h-6 w-6" onClick={(event) => { event.stopPropagation(); setSelectedCategory('worldbuilding'); setCreateName(''); setCreateModalOpen(true); }}>
                    <Plus size={12} />
                  </Button>
                </div>
                {expandedFolders.worldbuilding && (
                  <div className="mt-1 space-y-0.5">
                    {worldbuildingFiles.length === 0 ? (
                      <EmptyState
                        compact
                        icon={<FileText size={28} />}
                        title={t('emptyState.auWorldbuilding.title')}
                        description={t('emptyState.auWorldbuilding.description')}
                        actions={[
                          {
                            key: 'add-worldbuilding',
                            element: (
                              <Button tone="accent" fill="solid" size="sm" onClick={() => { setSelectedCategory('worldbuilding'); setCreateModalOpen(true); }}>
                                {t('common.actions.addWorldbuilding')}
                              </Button>
                            ),
                          },
                        ]}
                      />
                    ) : (
                      worldbuildingFiles.map(file => (
                        <div
                          key={file.name}
                          className={`flex items-center justify-between pl-6 pr-2 py-1.5 text-sm cursor-pointer rounded-md ${selectedFile === file.name && selectedCategory === 'worldbuilding' ? 'bg-accent/10 text-accent font-medium' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5 hover:text-text'}`}
                          onClick={() => { setSelectedCategory('worldbuilding'); void loadFileContent(file.name, undefined, 'worldbuilding'); }}
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            <FileText size={14} className="opacity-50 shrink-0" />
                            <span className="truncate">{file.name}.md</span>
                          </div>
                        </div>
                      ))
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
            <div className="text-xs text-text/50 leading-relaxed px-1">
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
                <span className="rounded-full bg-info/10 px-2 py-1 text-xs text-info">{selectedCategory === 'worldbuilding' ? t('auLore.selectedTagWorldbuilding') : t('auLore.selectedTag')}</span>
                {coreIncludes.includes(selectedFile) && (
                  <span className="rounded-full bg-accent/10 px-2 py-1 text-xs text-accent flex items-center gap-1">
                    <Pin size={10} fill="currentColor" /> {t('coreIncludes.pinned')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4">
                <Button tone="neutral" fill="plain" size="sm" className="h-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => setDeleteConfirmOpen(true)} disabled={isSaving || isReadingFile}>
                  <Trash2 size={14} />
                </Button>
                <div className="inline-flex rounded-md border border-black/10 dark:border-white/10 bg-surface/60 p-0.5 mr-2">
                  <button className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${!previewMode ? 'bg-accent text-white' : 'text-text/70 hover:text-text'}`} onClick={() => setPreviewMode(false)}>
                    <Pencil size={12} /> {t('common.actions.edit')}
                  </button>
                  <button className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${previewMode ? 'bg-accent text-white' : 'text-text/70 hover:text-text'}`} onClick={() => setPreviewMode(true)}>
                    <Eye size={12} /> {t('common.actions.preview')}
                  </button>
                </div>
                <Button tone="accent" fill="solid" size="sm" className="h-8 w-24" onClick={handleSaveLore} disabled={isSaving || isReadingFile}>
                  {isSaving || isReadingFile ? <Spinner size="sm" /> : t('auLore.saveButton')}
                </Button>
              </div>
            </>
          ) : (
            <span className="font-mono text-sm opacity-40">{t('auLore.unselected')}</span>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-6 w-full flex flex-col gap-6">
          {editorPanel}
        </div>
      </div>

      {sharedModals}
    </>
  );
};
