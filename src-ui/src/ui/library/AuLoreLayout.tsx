// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect, useRef } from 'react';
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { Modal } from '../shared/Modal';
import { EmptyState } from '../shared/EmptyState';
import { TrashPanel } from '../shared/TrashPanel';
import type { TrashEntry } from '../../api/engine-client';
import { Search, Plus, FileText, ChevronDown, ChevronRight, Folder, Loader2, Trash2, Download, Pin, Eye, Pencil } from 'lucide-react';
import { SettingsMarkdown } from '../shared/SettingsMarkdown';
import { getProject, updateProject, type ProjectInfo } from '../../api/engine-client';
import { saveLore, readLore, deleteLore, listLoreFiles, importFromFandom, getLoreContent } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import { useMilestoneGuide } from '../../hooks/useMilestoneGuide';
import { MilestoneGuide } from '../shared/MilestoneGuide';

type LoreFileEntry = {
  name: string;
  filename: string;
};

function buildDefaultCharacterContent(name: string): string {
  return `---\nname: ${name}\naliases: []\n---\n\n# ${name}\n\n`;
}

function buildDefaultWorldbuildingContent(name: string): string {
  return `# ${name}\n\n`;
}

function parseAliasesFromContent(content: string): string[] {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];
  const fm = match[1];
  // Parse aliases: [a, b, c] or aliases:\n- a\n- b
  const inlineMatch = fm.match(/aliases:\s*\[([^\]]*)\]/);
  if (inlineMatch) {
    return inlineMatch[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  const lines = fm.split('\n');
  const idx = lines.findIndex(l => l.startsWith('aliases:'));
  if (idx < 0) return [];
  const result: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*(.+)/);
    if (m) result.push(m[1].trim().replace(/^["']|["']$/g, ''));
    else break;
  }
  return result;
}

function setAliasesInContent(content: string, aliases: string[]): string {
  const aliasYaml = aliases.length > 0 ? `aliases: [${aliases.join(', ')}]` : 'aliases: []';
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return content;
  const fm = match[1];
  // Replace existing aliases line(s)
  const lines = fm.split('\n');
  const idx = lines.findIndex(l => l.startsWith('aliases:'));
  if (idx >= 0) {
    // Remove old aliases line + any continuation list items
    let endIdx = idx + 1;
    while (endIdx < lines.length && lines[endIdx].match(/^\s*-\s/)) endIdx++;
    lines.splice(idx, endIdx - idx, aliasYaml);
  } else {
    // Add after name line
    const nameIdx = lines.findIndex(l => l.startsWith('name:'));
    lines.splice(nameIdx >= 0 ? nameIdx + 1 : lines.length, 0, aliasYaml);
  }
  return content.replace(/^---\n[\s\S]*?\n---/, `---\n${lines.join('\n')}\n---`);
}

function toCanonicalCreateKey(value: string): string {
  return value
    .trim()
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '_');
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
  const { showError, showSuccess, showToast } = useFeedback();
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
        : loreFiles.files[0]?.name || null;

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
                  <Button variant="ghost" size="sm" className="p-0 h-6 w-6" onClick={(event) => { event.stopPropagation(); setSelectedCategory('characters'); setCreateName(''); setCreateModalOpen(true); }}>
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
                            className={`flex items-center justify-between pl-6 pr-2 py-1.5 text-sm cursor-pointer rounded-md ${selectedFile === file.name && selectedCategory === 'characters' ? 'bg-accent/10 text-accent font-medium' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5 hover:text-text'}`}
                            onClick={() => { setSelectedCategory('characters'); void loadFileContent(file.name, undefined, 'characters'); }}
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

            {/* 世界观分区 */}
            <div className="space-y-2">
              <div className="px-3 pb-1 text-[11px] font-sans font-bold text-text/40 uppercase tracking-widest">
                {t('common.labels.worldbuilding')} ({worldbuildingFiles.length})
              </div>
              <div>
                <div className="flex items-center justify-between px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/80 font-bold font-sans" onClick={() => toggleFolder('worldbuilding')}>
                  <div className="flex items-center gap-2">
                    {expandedFolders.worldbuilding ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Folder size={14} className="text-info" fill="currentColor" fillOpacity={0.2} />
                    <span>{t('common.labels.worldbuilding')}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="p-0 h-6 w-6" onClick={(event) => { event.stopPropagation(); setSelectedCategory('worldbuilding'); setCreateName(''); setCreateModalOpen(true); }}>
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
                              <Button variant="primary" size="sm" onClick={() => { setSelectedCategory('worldbuilding'); setCreateModalOpen(true); }}>
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
                <span className="rounded-full bg-info/10 px-2 py-1 text-xs text-info">{selectedCategory === 'worldbuilding' ? t('auLore.selectedTagWorldbuilding') : t('auLore.selectedTag')}</span>
                {coreIncludes.includes(selectedFile) && (
                  <span className="rounded-full bg-accent/10 px-2 py-1 text-xs text-accent flex items-center gap-1">
                    <Pin size={10} fill="currentColor" /> {t('coreIncludes.pinned')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" className="h-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => setDeleteConfirmOpen(true)} disabled={isSaving || isReadingFile}>
                  <Trash2 size={14} />
                </Button>
                <div className="inline-flex rounded-md border border-black/10 dark:border-white/10 bg-surface/60 p-0.5 mr-2">
                  <button className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${!previewMode ? 'bg-accent text-white' : 'text-text/60 hover:text-text'}`} onClick={() => setPreviewMode(false)}>
                    <Pencil size={12} /> {t('common.actions.edit')}
                  </button>
                  <button className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${previewMode ? 'bg-accent text-white' : 'text-text/60 hover:text-text'}`} onClick={() => setPreviewMode(true)}>
                    <Eye size={12} /> {t('common.actions.preview')}
                  </button>
                </div>
                <Button variant="primary" size="sm" className="h-8 w-24" onClick={handleSaveLore} disabled={isSaving || isReadingFile}>
                  {isSaving || isReadingFile ? <Loader2 size={14} className="animate-spin" /> : t('auLore.saveButton')}
                </Button>
              </div>
            </>
          ) : (
            <span className="font-mono text-sm opacity-40">{t('auLore.unselected')}</span>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-6 w-full flex flex-col gap-6">
          {selectedFile ? (
            <div className="flex flex-col gap-2 flex-1">
              <label className="text-sm font-bold text-text/90">{t('navigation.auLore')}</label>

              {/* 别名编辑（仅角色） */}
              {selectedCategory === 'characters' && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-surface/30 px-3 py-2 min-h-[36px]">
                  <span className="text-[10px] text-text/40 font-sans mr-1">{t('auLore.aliasesLabel')}</span>
                  {aliases.map((alias, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-md bg-accent/10 text-accent text-xs px-2 py-0.5 font-sans">
                      {alias}
                      <button className="hover:text-red-500 text-accent/60" onClick={() => setAliases(prev => prev.filter((_, j) => j !== i))}>×</button>
                    </span>
                  ))}
                  <input
                    className="flex-1 min-w-[80px] bg-transparent text-xs outline-none placeholder:text-text/30 font-sans"
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
                <div className="flex-1 min-h-[420px] rounded-md border border-black/10 bg-surface/30 p-6 dark:border-white/10 overflow-y-auto">
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

      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title={selectedCategory === 'worldbuilding' ? t('auLore.createTitleWorldbuilding') : t('auLore.createTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/70">{selectedCategory === 'worldbuilding' ? t('auLore.createDescriptionWorldbuilding') : t('auLore.createDescription')}</p>
          <Input value={createName} onChange={e => setCreateName(e.target.value)} placeholder={selectedCategory === 'worldbuilding' ? t('auLore.createPlaceholderWorldbuilding') : t('auLore.createPlaceholder')} autoFocus />
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
