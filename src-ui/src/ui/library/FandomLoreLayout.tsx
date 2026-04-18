// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect, useRef } from 'react';
import { Spinner } from "../shared/Spinner";
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { Tag } from '../shared/Tag';
import { EmptyState } from '../shared/EmptyState';
import { TrashPanel } from '../shared/TrashPanel';
import { SettingsChatPanel } from '../shared/settings-chat/SettingsChatPanel';
import type { TrashEntry } from '../../api/engine-client';
import { Search, Plus, ArrowLeft, FileText, ChevronDown, ChevronRight, Folder, Trash2, Users, Globe2, Eye, Pencil, MessageSquare, X } from 'lucide-react';
import { SettingsMarkdown } from '../shared/SettingsMarkdown';
import { FandomLoreModals } from './FandomLoreModals';
import { saveLore, deleteLore } from '../../api/engine-client';
import { listFandomFiles, readFandomFile, type FandomFileEntry } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { FeedbackProvider, useFeedback } from '../../hooks/useFeedback';

type Props = {
  fandomPath?: string;
  onNavigate: (page: string) => void;
};

function getRestoredFandomFile(entry: TrashEntry): { category: 'core_characters' | 'core_worldbuilding'; file: FandomFileEntry } | null {
  const [category, filename] = entry.original_path.split('/', 2);
  if (!filename) return null;
  if (category !== 'core_characters' && category !== 'core_worldbuilding') return null;
  return {
    category,
    file: {
      name: entry.entity_name || filename.replace(/\.md$/, ''),
      filename,
    },
  };
}

import { toCanonicalCreateKey } from "./lore-utils";

function FandomLoreLayoutInner({ fandomPath, onNavigate }: Props) {
  const { t } = useTranslation();
  const { showError, showToast } = useFeedback();
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    core_characters: true,
    core_worldbuilding: true,
  });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<'core_characters' | 'core_worldbuilding'>('core_characters');
  const [editorContent, setEditorContent] = useState('');
  const [savedEditorContent, setSavedEditorContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [settingsChatBusy, setSettingsChatBusy] = useState(false);
  const [previewMode, setPreviewMode] = useState(true);
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [characterFiles, setCharacterFiles] = useState<FandomFileEntry[]>([]);
  const [worldbuildingFiles, setWorldbuildingFiles] = useState<FandomFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalCategory, setCreateModalCategory] = useState<'core_characters' | 'core_worldbuilding'>('core_characters');
  const [createName, setCreateName] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [discardChangesOpen, setDiscardChangesOpen] = useState(false);
  const [trashRefreshToken, setTrashRefreshToken] = useState(0);
  const loadFilesRequestIdRef = useRef(0);
  const selectFileRequestIdRef = useRef(0);
  const contextVersionRef = useRef(0);
  const pendingSelectionRef = useRef<{ filename: string; category: 'core_characters' | 'core_worldbuilding' } | null>(null);
  const pendingCreateCategoryRef = useRef<'core_characters' | 'core_worldbuilding' | null>(null);
  const pendingNavigationRef = useRef<string | null>(null);
  const pendingDeleteRef = useRef(false);

  const fandomName = fandomPath?.split('/').pop() || t('common.unknownFandom');
  const renderContextVersion = contextVersionRef.current;
  const editorBusy = isSaving || isReadingFile || settingsChatBusy;
  const isEditorDirty = selectedFile !== null && editorContent !== savedEditorContent;
  const settingsChatDisabled = isSaving || isReadingFile || isEditorDirty;
  const selectedEntry = selectedFile
    ? (selectedCategory === 'core_characters' ? characterFiles : worldbuildingFiles)
      .find((file) => file.filename === selectedFile)
    : null;
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredCharacterFiles = normalizedSearch
    ? characterFiles.filter((file) =>
        file.name.toLowerCase().includes(normalizedSearch)
        || file.filename.toLowerCase().includes(normalizedSearch)
      )
    : characterFiles;
  const filteredWorldbuildingFiles = normalizedSearch
    ? worldbuildingFiles.filter((file) =>
        file.name.toLowerCase().includes(normalizedSearch)
        || file.filename.toLowerCase().includes(normalizedSearch)
      )
    : worldbuildingFiles;

  useEffect(() => {
    contextVersionRef.current += 1;
    loadFilesRequestIdRef.current += 1;
    selectFileRequestIdRef.current += 1;
    setCharacterFiles([]);
    setWorldbuildingFiles([]);
    setSelectedFile(null);
    setSelectedCategory('core_characters');
    setEditorContent('');
    setSavedEditorContent('');
    setIsSaving(false);
    setIsReadingFile(false);
    setSettingsChatBusy(false);
    setDeleteConfirmOpen(false);
    setDiscardChangesOpen(false);
    setCreateModalOpen(false);
    setCreateName('');
    setSearchTerm('');
    setFilesLoading(false);
    pendingSelectionRef.current = null;
    pendingCreateCategoryRef.current = null;
    pendingNavigationRef.current = null;
    pendingDeleteRef.current = false;
  }, [fandomPath]);

  const loadFiles = async (): Promise<{
    characters: FandomFileEntry[];
    worldbuilding: FandomFileEntry[];
  } | null> => {
    if (!fandomPath) return null;
    const requestId = ++loadFilesRequestIdRef.current;
    setFilesLoading(true);
    try {
      const data = await listFandomFiles(fandomName);
      if (requestId !== loadFilesRequestIdRef.current) return null;
      setCharacterFiles(data.characters);
      setWorldbuildingFiles(data.worldbuilding);
      return data;
    } catch (e) {
      if (requestId !== loadFilesRequestIdRef.current) return null;
      showError(e, t("error_messages.unknown"));
      return null;
    } finally {
      if (requestId === loadFilesRequestIdRef.current) {
        setFilesLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadFiles();
  }, [fandomName, fandomPath, showError, t]);

  const openDiscardChangesConfirm = (
    nextAction:
      | { type: 'select'; filename: string; category: 'core_characters' | 'core_worldbuilding' }
      | { type: 'create'; category: 'core_characters' | 'core_worldbuilding' }
      | { type: 'delete' }
      | { type: 'navigate'; page: string }
  ) => {
    if (nextAction.type === 'select') {
      pendingSelectionRef.current = { filename: nextAction.filename, category: nextAction.category };
      pendingCreateCategoryRef.current = null;
      pendingNavigationRef.current = null;
      pendingDeleteRef.current = false;
    } else if (nextAction.type === 'create') {
      pendingCreateCategoryRef.current = nextAction.category;
      pendingSelectionRef.current = null;
      pendingNavigationRef.current = null;
      pendingDeleteRef.current = false;
    } else if (nextAction.type === 'delete') {
      pendingSelectionRef.current = null;
      pendingCreateCategoryRef.current = null;
      pendingNavigationRef.current = null;
      pendingDeleteRef.current = true;
    } else {
      pendingSelectionRef.current = null;
      pendingCreateCategoryRef.current = null;
      pendingNavigationRef.current = nextAction.page;
      pendingDeleteRef.current = false;
    }
    setDiscardChangesOpen(true);
  };

  const handleSelectFile = async (filename: string, category: 'core_characters' | 'core_worldbuilding') => {
    const requestId = ++selectFileRequestIdRef.current;
    setSelectedFile(filename);
    setSelectedCategory(category);
    setEditorContent('');
    setSavedEditorContent('');
    setIsReadingFile(true);
    try {
      const result = await readFandomFile(fandomName, category, filename);
      if (requestId !== selectFileRequestIdRef.current) return;
      setEditorContent(result.content);
      setSavedEditorContent(result.content);
      setIsReadingFile(false);
    } catch {
      if (requestId !== selectFileRequestIdRef.current) return;
      setSelectedFile(null);
      setEditorContent('');
      setSavedEditorContent('');
      setIsReadingFile(false);
    }
  };

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => ({ ...prev, [folder]: !prev[folder] }));
  };

  const openCreateModal = (category: 'core_characters' | 'core_worldbuilding') => {
    if (isEditorDirty) {
      openDiscardChangesConfirm({ type: 'create', category });
      return;
    }
    setCreateModalCategory(category);
    setCreateName('');
    setCreateModalOpen(true);
  };

  const handleSelectFileIntent = (filename: string, category: 'core_characters' | 'core_worldbuilding') => {
    if (editorBusy) {
      return;
    }

    if (selectedFile === filename && selectedCategory === category) {
      return;
    }

    if (isEditorDirty && (selectedFile !== filename || selectedCategory !== category)) {
      openDiscardChangesConfirm({ type: 'select', filename, category });
      return;
    }

    void handleSelectFile(filename, category);
  };

  const handleConfirmDiscardChanges = () => {
    setDiscardChangesOpen(false);
    const pendingSelection = pendingSelectionRef.current;
    const pendingCreateCategory = pendingCreateCategoryRef.current;
    const pendingNavigation = pendingNavigationRef.current;
    const pendingDelete = pendingDeleteRef.current;
    pendingSelectionRef.current = null;
    pendingCreateCategoryRef.current = null;
    pendingNavigationRef.current = null;
    pendingDeleteRef.current = false;

    if (pendingSelection) {
      void handleSelectFile(pendingSelection.filename, pendingSelection.category);
      return;
    }

    if (pendingCreateCategory) {
      setCreateModalCategory(pendingCreateCategory);
      setCreateName('');
      setCreateModalOpen(true);
      return;
    }

    if (pendingNavigation) {
      onNavigate(pendingNavigation);
      return;
    }

    if (pendingDelete) {
      setDeleteConfirmOpen(true);
    }
  };

  const handleCancelDiscardChanges = () => {
    setDiscardChangesOpen(false);
    pendingSelectionRef.current = null;
    pendingCreateCategoryRef.current = null;
    pendingNavigationRef.current = null;
    pendingDeleteRef.current = false;
  };

  const handleNavigateIntent = (page: string) => {
    if (isEditorDirty) {
      openDiscardChangesConfirm({ type: 'navigate', page });
      return;
    }

    onNavigate(page);
  };

  const handleCreateLore = async () => {
    const rawName = createName.trim();
    if (!rawName || !fandomPath) return;
    const contextVersion = contextVersionRef.current;
    setIsSaving(true);

    const displayName = rawName.replace(/\.md$/i, '').trim();
    if (!displayName) {
      showToast(t('settingsMode.validation.nameRequired'), 'warning');
      setIsSaving(false);
      return;
    }
    const filename = `${displayName}.md`;
    let latestFiles: { characters: FandomFileEntry[]; worldbuilding: FandomFileEntry[] } | null = null;

    try {
      latestFiles = await listFandomFiles(fandomName);
      if (contextVersion !== contextVersionRef.current) { setIsSaving(false); return; }
      setCharacterFiles(latestFiles.characters);
      setWorldbuildingFiles(latestFiles.worldbuilding);
    } catch (e: any) {
      if (contextVersion !== contextVersionRef.current) { setIsSaving(false); return; }
      showError(e, t("error_messages.unknown"));
      setIsSaving(false);
      return;
    }

    const existingFiles = createModalCategory === 'core_characters'
      ? latestFiles.characters
      : latestFiles.worldbuilding;
    if (existingFiles.some((file) => toCanonicalCreateKey(file.filename) === toCanonicalCreateKey(filename))) {
      showToast(t('fandomLore.createDuplicate', { name: filename }), 'warning');
      setIsSaving(false);
      return;
    }

    const defaultContent = `# ${displayName}\n\n[]`;

    setCreateModalOpen(false);
    loadFilesRequestIdRef.current += 1;
    selectFileRequestIdRef.current += 1;
    try {
      await saveLore({
        fandom_path: fandomPath,
        category: createModalCategory,
        filename,
        content: defaultContent,
      });
      if (contextVersion !== contextVersionRef.current) return;
      setSelectedFile(filename);
      setSelectedCategory(createModalCategory);
      setPreviewMode(false);
      setEditorContent(defaultContent);
      setSavedEditorContent(defaultContent);
      setIsReadingFile(false);
      if (createModalCategory === 'core_characters') {
        setCharacterFiles(prev => [...prev, { name: displayName, filename }]);
      } else {
        setWorldbuildingFiles(prev => [...prev, { name: displayName, filename }]);
      }
    } catch (e: any) {
      if (contextVersion !== contextVersionRef.current) return;
      showError(e, t("error_messages.unknown"));
    } finally {
      if (contextVersion === contextVersionRef.current) {
        setIsSaving(false);
      }
    }
  };

  const handleSaveLore = async () => {
    if (!selectedFile || !fandomPath) return;
    const contextVersion = contextVersionRef.current;
    setIsSaving(true);
    try {
      await saveLore({
        fandom_path: fandomPath,
        category: selectedCategory,
        filename: selectedFile,
        content: editorContent
      });
      if (contextVersion !== contextVersionRef.current) { setIsSaving(false); return; }
      setSavedEditorContent(editorContent);
    } catch (e: any) {
      if (contextVersion !== contextVersionRef.current) { setIsSaving(false); return; }
      showError(e, t("error_messages.unknown"));
    } finally {
      if (contextVersion === contextVersionRef.current) {
        setIsSaving(false);
      }
    }
  };

  const handleDeleteLore = async () => {
    if (!selectedFile || !fandomPath) return;
    const contextVersion = contextVersionRef.current;
    setDeleteConfirmOpen(false);
    setIsSaving(true);
    loadFilesRequestIdRef.current += 1;
    selectFileRequestIdRef.current += 1;
    try {
      await deleteLore({
        fandom_path: fandomPath,
        category: selectedCategory,
        filename: selectedFile,
      });
      if (contextVersion !== contextVersionRef.current) { setIsSaving(false); return; }
      if (selectedCategory === 'core_characters') {
        setCharacterFiles(prev => prev.filter(f => f.filename !== selectedFile));
      } else {
        setWorldbuildingFiles(prev => prev.filter(f => f.filename !== selectedFile));
      }
      setSelectedFile(null);
      setEditorContent('');
      setSavedEditorContent('');
      setIsReadingFile(false);
      setTrashRefreshToken(current => current + 1);
    } catch (e: any) {
      if (contextVersion !== contextVersionRef.current) { setIsSaving(false); return; }
      showError(e, t("error_messages.unknown"));
    } finally {
      if (contextVersion === contextVersionRef.current) {
        setIsSaving(false);
      }
    }
  };

  const handleTrashRestore = (entry: TrashEntry) => {
    if (renderContextVersion !== contextVersionRef.current) return;

    const restored = getRestoredFandomFile(entry);
    if (!restored) return;

    const applyRestore = (prev: FandomFileEntry[]) => {
      if (prev.some((file) => file.filename === restored.file.filename)) return prev;
      return [...prev, restored.file].sort((left, right) => left.name.localeCompare(right.name));
    };

    if (restored.category === 'core_characters') {
      setCharacterFiles(applyRestore);
      return;
    }

    setWorldbuildingFiles(applyRestore);
  };

  return (
    <div className="flex h-screen bg-background text-text transition-colors duration-200 w-full overflow-hidden">
      <div className="w-[300px] md:w-[340px] shrink-0 border-r border-black/10 dark:border-white/10 flex flex-col bg-surface/50">
        <header className="p-4 border-b border-black/10 dark:border-white/10 flex flex-col gap-3 shrink-0 bg-surface">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
            <Button tone="neutral" fill="plain" size="sm" onClick={() => handleNavigateIntent('library')} className="p-1 h-8 w-8 text-text/70 hover:text-text rounded-full" title={t("common.actions.back")}>
                <ArrowLeft size={18} />
              </Button>
              <h1 className="font-serif text-lg font-bold">{t("common.scope.fandomTitle", { name: fandomName })}</h1>
            </div>
            <Button tone="neutral" fill="plain" size="sm" className="px-2" onClick={() => openCreateModal('core_characters')} disabled={editorBusy || filesLoading}>
              {isSaving ? <Spinner size="md" /> : <Plus size={16}/>}
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 text-text/50" size={14} />
            <Input
              className="pl-8 h-8 text-xs placeholder:text-xs"
              placeholder={t("common.search.files")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </header>

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 overflow-y-auto p-2 space-y-6 font-mono py-4">
            <div className="space-y-2">
              <div className="px-3 pb-1 text-xs font-sans font-medium text-text/50 flex justify-between items-center">
                <span>{t("fandomLore.rootLabel")}</span>
              </div>

              <div>
                <div className="flex items-center justify-between px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/90 font-bold font-sans" onClick={() => toggleFolder('core_characters')}>
                  <div className="flex items-center gap-2">
                    {expandedFolders['core_characters'] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                    <Folder size={14} className="text-accent" fill="currentColor" fillOpacity={0.2} />
                    <span>{t("fandomLore.category.characters")}</span>
                  </div>
                  <Button tone="neutral" fill="plain" size="sm" className="p-0 h-6 w-6" onClick={(e) => { e.stopPropagation(); openCreateModal('core_characters'); }} disabled={editorBusy || filesLoading}>
                    <Plus size={12} />
                  </Button>
                </div>
                {expandedFolders['core_characters'] && (
                  <div className="mt-1 space-y-0.5">
                    {filesLoading ? (
                      <div className="pl-6 py-2"><Spinner size="sm" className="text-accent" /></div>
                    ) : filteredCharacterFiles.length === 0 ? (
                      <EmptyState
                        compact
                        icon={<Users size={28} />}
                        title={characterFiles.length === 0 ? t("emptyState.fandomCharacters.title") : t("facts.noSearchResultTitle")}
                        description={characterFiles.length === 0 ? t("emptyState.fandomCharacters.description") : t("facts.noSearchResultDescription")}
                        actions={characterFiles.length === 0 ? [
                          {
                            key: 'create-character',
                            element: <Button tone="accent" fill="solid" size="sm" onClick={() => openCreateModal('core_characters')}>{t("common.actions.addCharacter")}</Button>,
                          },
                        ] : undefined}
                      />
                    ) : (
                      filteredCharacterFiles.map(f => (
                        <div
                          key={f.filename}
                          className={`flex items-center gap-2 pl-6 pr-2 py-1.5 text-sm cursor-pointer rounded-md transition-colors ${
                            selectedFile === f.filename && selectedCategory === 'core_characters'
                              ? 'bg-accent/10 text-accent font-semibold'
                              : 'hover:bg-black/5 dark:hover:bg-white/5 text-text/70'
                          } ${editorBusy ? 'pointer-events-none opacity-60' : ''}`}
                          onClick={() => handleSelectFileIntent(f.filename, 'core_characters')}
                        >
                          <FileText size={13} />
                          <span>{f.name}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/90 font-bold font-sans" onClick={() => toggleFolder('core_worldbuilding')}>
                  <div className="flex items-center gap-2">
                    {expandedFolders['core_worldbuilding'] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                    <Folder size={14} className="text-warning" fill="currentColor" fillOpacity={0.2} />
                    <span>{t("fandomLore.category.worldbuilding")}</span>
                  </div>
                  <Button tone="neutral" fill="plain" size="sm" className="p-0 h-6 w-6" onClick={(e) => { e.stopPropagation(); openCreateModal('core_worldbuilding'); }} disabled={editorBusy || filesLoading}>
                    <Plus size={12} />
                  </Button>
                </div>
                {expandedFolders['core_worldbuilding'] && (
                  <div className="mt-1 space-y-0.5">
                    {filesLoading ? (
                      <div className="pl-6 py-2"><Spinner size="sm" className="text-accent" /></div>
                    ) : filteredWorldbuildingFiles.length === 0 ? (
                      <EmptyState
                        compact
                        icon={<Globe2 size={28} />}
                        title={worldbuildingFiles.length === 0 ? t("emptyState.fandomWorldbuilding.title") : t("facts.noSearchResultTitle")}
                        description={worldbuildingFiles.length === 0 ? t("emptyState.fandomWorldbuilding.description") : t("facts.noSearchResultDescription")}
                        actions={worldbuildingFiles.length === 0 ? [
                          {
                            key: 'create-worldbuilding',
                            element: <Button tone="accent" fill="solid" size="sm" onClick={() => openCreateModal('core_worldbuilding')}>{t("common.actions.addWorldbuilding")}</Button>,
                          },
                        ] : undefined}
                      />
                    ) : (
                      filteredWorldbuildingFiles.map(f => (
                        <div
                          key={f.filename}
                          className={`flex items-center gap-2 pl-6 pr-2 py-1.5 text-sm cursor-pointer rounded-md transition-colors ${
                            selectedFile === f.filename && selectedCategory === 'core_worldbuilding'
                              ? 'bg-accent/10 text-accent font-semibold'
                              : 'hover:bg-black/5 dark:hover:bg-white/5 text-text/70'
                          } ${editorBusy ? 'pointer-events-none opacity-60' : ''}`}
                          onClick={() => handleSelectFileIntent(f.filename, 'core_worldbuilding')}
                        >
                          <FileText size={13} />
                          <span>{f.name}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <TrashPanel scope="fandom" path={fandomPath} onRestore={handleTrashRestore} refreshToken={trashRefreshToken} disabled={editorBusy} />
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-background relative">
        <header className="h-14 border-b border-black/10 dark:border-white/10 flex items-center px-6 justify-between shrink-0 bg-surface/30">
          {selectedFile ? (
            <>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-semibold opacity-70">{selectedEntry?.filename || selectedFile}</span>
                <Tag tone={selectedCategory === 'core_characters' ? 'success' : 'warning'}>
                  {selectedCategory === 'core_characters' ? t('fandomLore.selectedTagCharacter') : t('fandomLore.selectedTagWorldbuilding')}
                </Tag>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-text/50 bg-black/5 dark:bg-white/5 px-2 py-1 rounded-md hidden xl:block">
                  {t("fandomLore.referenceHint")}
                </span>
                <Button
                  tone="neutral" fill="plain"
                  size="sm"
                  className="h-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  onClick={() => {
                    if (isEditorDirty) {
                      openDiscardChangesConfirm({ type: 'delete' });
                      return;
                    }
                    setDeleteConfirmOpen(true);
                  }}
                  disabled={editorBusy}
                >
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
                <Button tone="accent" fill="solid" size="sm" className="h-8 w-28" onClick={handleSaveLore} disabled={editorBusy}>
                  {isSaving || isReadingFile ? <Spinner size="sm" /> : t('fandomLore.saveButton')}
                </Button>
              </div>
            </>
          ) : (
            <span className="font-mono text-sm opacity-40">{t("fandomLore.unselected")}</span>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-6 w-full flex flex-col gap-6">
          {selectedFile ? (
            <>
              <div className="flex flex-col gap-2 flex-1">
                <label className="text-sm font-bold text-text/90">{selectedCategory === 'core_characters' ? t("fandomLore.category.characters") : t("fandomLore.category.worldbuilding")}</label>
                {isReadingFile ? (
                  <div className="flex min-h-[300px] flex-1 items-center justify-center rounded-md border border-black/10 bg-surface/30 p-4 dark:border-white/10">
                    <Spinner size="md" className="text-accent" />
                  </div>
                ) : previewMode ? (
                  <div className="flex-1 min-h-[300px] rounded-md border border-black/10 bg-surface/30 p-6 dark:border-white/10 overflow-y-auto">
                    <SettingsMarkdown content={editorContent} />
                  </div>
                ) : (
                  <Textarea
                    value={editorContent}
                    onChange={e => setEditorContent(e.target.value)}
                    disabled={editorBusy}
                    className="font-mono flex-1 min-h-[300px] text-sm leading-relaxed bg-surface/30 p-4 resize-y"
                  />
                )}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<FileText size={48} />}
              title={t("navigation.fandomLore")}
              description={t("fandomLore.referenceHint")}
            />
          )}
        </div>
      </div>

      {/* Right panel: AI Assistant */}
      <div className={`shrink-0 border-l border-black/10 dark:border-white/10 flex flex-col bg-surface/30 transition-all duration-300 overflow-hidden ${aiPanelOpen ? 'w-[320px] lg:w-[360px]' : 'w-0'}`}>
          <div className={`flex-1 flex flex-col min-h-0 transition-opacity duration-200 ${aiPanelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <div className="p-3 border-b border-black/10 dark:border-white/10 flex items-center justify-between shrink-0">
              <span className="text-xs font-bold text-text/70">{t('settingsMode.fandomAiTitle')}</span>
              <Button tone="neutral" fill="plain" size="sm" className="h-6 w-6 p-0" onClick={() => setAiPanelOpen(false)}>
                <X size={14} />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <SettingsChatPanel
                mode="fandom"
                basePath={fandomPath}
                fandomPath={fandomPath}
                placeholder={t('settingsMode.fandomPlaceholder')}
                title=""
                compact
                disabled={settingsChatDisabled}
                onBusyChange={setSettingsChatBusy}
                onAfterMutation={async () => {
                  const refreshed = await loadFiles();
                  if (!refreshed) return;
                  if (!selectedFile) return;
                  const refreshedFiles = selectedCategory === 'core_characters'
                    ? (refreshed?.characters || [])
                    : (refreshed?.worldbuilding || []);
                  const fileStillExists = refreshedFiles.some((file) => file.filename === selectedFile);
                  if (!fileStillExists) {
                    setSelectedFile(null);
                    setEditorContent('');
                    setSavedEditorContent('');
                    showToast(t('fandomLore.selectedFileRemoved'), 'warning');
                    return;
                  }
                  if (!isEditorDirty) {
                    await handleSelectFile(selectedFile, selectedCategory);
                  } else {
                    showToast(t('fandomLore.pendingEditsPreserved'), 'warning');
                  }
                }}
              />
            </div>
          </div>
      </div>
      {!aiPanelOpen && (
        <Button
          tone="neutral" fill="plain"
          size="sm"
          className="fixed right-3 top-16 z-20 h-8 px-2 bg-surface border border-black/10 dark:border-white/10 shadow-sm"
          onClick={() => setAiPanelOpen(true)}
        >
          <MessageSquare size={14} className="mr-1" /> AI
        </Button>
      )}

      <FandomLoreModals
        createModalOpen={createModalOpen}
        setCreateModalOpen={setCreateModalOpen}
        createModalCategory={createModalCategory}
        createName={createName}
        setCreateName={setCreateName}
        handleCreateLore={handleCreateLore}
        editorBusy={editorBusy}
        deleteConfirmOpen={deleteConfirmOpen}
        setDeleteConfirmOpen={setDeleteConfirmOpen}
        selectedEntry={selectedEntry ?? null}
        selectedFile={selectedFile}
        handleDeleteLore={handleDeleteLore}
        discardChangesOpen={discardChangesOpen}
        handleCancelDiscardChanges={handleCancelDiscardChanges}
        handleConfirmDiscardChanges={handleConfirmDiscardChanges}
      />
    </div>
  );
}

export function FandomLoreLayout(props: Props) {
  return (
    <FeedbackProvider>
      <FandomLoreLayoutInner {...props} />
    </FeedbackProvider>
  );
}
