// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useMemo } from 'react';
import { Spinner } from "../shared/Spinner";
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { EmptyState } from '../shared/EmptyState';
import { TrashPanel } from '../shared/TrashPanel';
import type { TrashEntry } from '../../api/engine-client';
import { Search, Plus, FileText, ChevronDown, ChevronRight, Folder, Trash2, Download, Pin, Eye, Pencil } from 'lucide-react';
import { SettingsMarkdown } from '../shared/SettingsMarkdown';
import { chapterNumFromTrashEntry } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useMilestoneGuide } from '../../hooks/useMilestoneGuide';
import { MilestoneGuide } from '../shared/MilestoneGuide';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { AuLoreModals } from './AuLoreModals';
import type { LoreFileEntry } from './lore-utils';
import { useAuLoreData } from './useAuLoreData';
import { useAuLoreEditor } from './useAuLoreEditor';
import { useAuLoreModals } from './useAuLoreModals';
import { useAuLoreActions } from './useAuLoreActions';

function getRestoredCharacterFile(entry: TrashEntry): LoreFileEntry | null {
  if (!entry.original_path.startsWith('characters/')) return null;
  const filename = entry.original_path.split('/').pop();
  if (!filename) return null;
  return {
    // entity_name 由 deleteLore 落库时传的是带 .md 的 filename——一并剥掉，
    // 否则恢复后列表显示「x.md.md」且 cast registry 被插入带后缀的名字
    name: (entry.entity_name || filename).replace(/\.md$/, ''),
    filename,
  };
}

/**
 * AuLoreLayout — AU 设定集（角色 / 世界观）列表 + 编辑器 + 弹窗编排。
 * 状态全部下沉到四个 hook（长期债②）：data 数据层 / editor 编辑器与列表 UI /
 * modals 弹窗 / actions 写路径。本组件只做 JSX 编排与跨 hook 接线。
 */
export const AuLoreLayout = ({ auPath, onChaptersChanged }: {
  auPath: string;
  /** 回收站恢复了章节文件时通知宿主刷新章节列表 + 常驻挂载的写文/对话面板（R1-5）。 */
  onChaptersChanged?: () => void;
}) => {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const { shouldShow: shouldShowMilestone, dismiss: dismissMilestone } = useMilestoneGuide();

  const data = useAuLoreData(auPath);
  const editor = useAuLoreEditor(auPath, data.files, data.worldbuildingFiles, data.loadKey);
  const modals = useAuLoreModals(auPath);
  const actions = useAuLoreActions(auPath, {
    project: data.project,
    files: data.files,
    selectedCategory: editor.selectedCategory,
    selectedFile: editor.selectedFile,
    editorContent: editor.editorContent,
    aliases: editor.aliases,
    reload: data.reload,
    syncRegistry: data.syncRegistry,
    applyCoreIncludes: data.applyCoreIncludes,
    addFileEntry: data.addFileEntry,
    removeFileEntry: data.removeFileEntry,
    bumpTrashRefresh: data.bumpTrashRefresh,
    applyCreated: editor.applyCreated,
    markContentSaved: editor.markContentSaved,
    closeFile: editor.closeFile,
    clearSearch: editor.clearSearch,
    closeCreate: modals.closeCreate,
    closeDeleteConfirm: modals.closeDeleteConfirm,
    closeImport: modals.closeImport,
    promptCoreLimit: modals.promptCoreLimit,
  });

  const { project, files, worldbuildingFiles, loading, trashRefreshToken } = data;
  const {
    selectedCategory, selectedFile, editorContent, aliases, newAlias,
    previewMode, isReadingFile, searchTerm, expandedFolders,
  } = editor;
  const { isSaving } = actions;

  const coreIncludes = project?.core_always_include || [];

  const handleOpenImport = () => {
    modals.openImport();
    void actions.loadImportCandidates();
  };

  const handleDismissPinMilestone = () => {
    dismissMilestone('pin_intro');
    modals.dismissPinMilestone();
  };

  const handleTrashRestore = (entry: TrashEntry) => {
    // R1-5：恢复的是章节文件 → 通知宿主走 external 通道刷新（章节侧栏 + keep-mounted
    // 的写文/对话面板），否则恢复的章在别的 tab 看不见、生成还拿旧 state。
    if (chapterNumFromTrashEntry(entry) !== null) {
      onChaptersChanged?.();
      return;
    }

    const restoredFile = getRestoredCharacterFile(entry);
    if (!restoredFile) return;
    data.restoreCharacterFile(restoredFile);
  };

  // memo：正文 textarea 每键入一字触发全组件 re-render，列表过滤只应随列表/搜索词重算
  const filteredFiles = useMemo(() => {
    const term = searchTerm.trim();
    return term ? files.filter((file) => file.name.includes(term)) : files;
  }, [files, searchTerm]);
  const filteredWorldbuildingFiles = useMemo(() => {
    const term = searchTerm.trim();
    return term ? worldbuildingFiles.filter((file) => file.name.includes(term)) : worldbuildingFiles;
  }, [worldbuildingFiles, searchTerm]);

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
                className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-accent/60 transition-colors hover:text-error md:-mr-1 md:h-5 md:w-5"
                onClick={() => editor.removeAliasAt(i)}
              >
                ×
              </button>
            </span>
          ))}
          <input
            className="min-w-[80px] flex-1 bg-transparent text-xs font-sans outline-hidden placeholder:text-text/30"
            placeholder={t('auLore.aliasPlaceholder')}
            value={newAlias}
            onChange={e => editor.setNewAlias(e.target.value)}
            onKeyDown={e => {
              if ((e.key === 'Enter' || e.key === ',') && newAlias.trim()) {
                e.preventDefault();
                editor.commitNewAlias();
              }
              if (e.key === 'Backspace' && !newAlias && aliases.length > 0) {
                editor.popLastAlias();
              }
            }}
            disabled={isReadingFile}
          />
        </div>
      )}

      {previewMode ? (
        <div className="min-h-[420px] flex-1 overflow-y-auto">
          <SettingsMarkdown content={editorContent} />
        </div>
      ) : (
        <Textarea
          value={editorContent}
          onChange={e => editor.setEditorContent(e.target.value)}
          disabled={isReadingFile}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file && (file.name.endsWith('.txt') || file.name.endsWith('.md'))) {
              file.text().then(text => editor.appendDroppedText(text));
            }
          }}
          className="font-mono flex-1 min-h-[420px] text-sm leading-relaxed resize-y"
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
            // 按钮文案是「添加角色」→ 必须锁定 characters 分类：selectedCategory 可能停留
            // 在 worldbuilding（点过世界观「+」再取消），否则文件落错目录且漏挂 cast_registry
            // （2026-07-10 合并审阅确认的存量缺陷）
            <Button
              tone="accent"
              fill="solid"
              onClick={() => {
                editor.selectCategory('characters');
                modals.openCreate();
              }}
            >
              {t('common.actions.addCharacter')}
            </Button>
          ),
        },
        {
          key: 'import-character-empty',
          element: (
            <Button tone="neutral" fill="outline" onClick={handleOpenImport}>
              {t('common.actions.importFromFandom')}
            </Button>
          ),
        },
      ]}
    />
  );

  const sharedModals = (
    <AuLoreModals
      createModalOpen={modals.isCreateOpen}
      closeCreate={modals.closeCreate}
      createName={modals.createName}
      setCreateName={modals.setCreateName}
      selectedCategory={selectedCategory}
      handleCreate={() => { void actions.createFile(modals.createName); }}
      deleteConfirmOpen={modals.isDeleteConfirmOpen}
      closeDeleteConfirm={modals.closeDeleteConfirm}
      selectedFile={selectedFile}
      handleDeleteLore={() => { void actions.deleteCurrentFile(); }}
      importModalOpen={modals.isImportOpen}
      closeImport={modals.closeImport}
      importLoading={actions.importLoading}
      importCandidates={actions.importCandidates}
      selectedImports={actions.selectedImports}
      handleToggleImport={actions.toggleImport}
      handleImportSelected={() => { void actions.importSelected(); }}
      isSaving={isSaving}
      coreLimitModalOpen={modals.isCoreLimitOpen}
      closeCoreLimit={modals.closeCoreLimit}
      coreLimitTarget={modals.coreLimitTarget}
      openCharacterFile={(name) => { void editor.openFile(name, 'characters'); }}
    />
  );

  if (isMobile) {
    const currentFiles = selectedCategory === 'characters' ? filteredFiles : filteredWorldbuildingFiles;

    return (
      <>
        <div className="min-h-full bg-background pb-28 md:hidden">
          <header className="safe-area-top sticky top-0 z-20 border-b border-black/10 bg-surface/90 px-4 py-4 backdrop-blur-sm dark:border-white/10">
            <div className="flex items-center justify-between gap-3">
              {selectedFile ? (
                <div className="flex min-w-0 items-center gap-2">
                  <Button tone="neutral" fill="plain" size="sm" className="px-3" onClick={editor.closeFile}>
                    ← {t('common.actions.back')}
                  </Button>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text">{selectedFile}.md</p>
                    <p className="text-xs text-text/50">{selectedCategory === 'worldbuilding' ? t('auLore.selectedTagWorldbuilding') : t('auLore.selectedTag')}</p>
                  </div>
                </div>
              ) : (
                <div>
                  <h1 className="truncate font-serif text-2xl font-bold">{auName}</h1>
                </div>
              )}

              <div className="flex items-center gap-2">
                {selectedFile ? (
                  <>
                    <Button tone="destructive" fill="plain" size="sm" className="px-3" onClick={modals.openDeleteConfirm} disabled={isSaving || isReadingFile}>
                      <Trash2 size={16} />
                    </Button>
                    <Button tone="accent" fill="solid" size="sm" className="px-3" onClick={() => { void actions.saveCurrentFile(); }} disabled={isSaving || isReadingFile}>
                      {isSaving || isReadingFile ? <Spinner size="sm" /> : t('auLore.saveButton')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button tone="neutral" fill="plain" size="sm" className="px-3" onClick={handleOpenImport} disabled={isSaving} title={t('common.actions.importFromFandom')}>
                      <Download size={16} />
                    </Button>
                    <Button tone="accent" fill="solid" size="sm" className="px-3" onClick={modals.openCreate} disabled={isSaving}>
                      <Plus size={16} />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {selectedFile ? (
              <div className="mt-3 inline-flex rounded-md border border-black/10 bg-surface/60 p-0.5 dark:border-white/10">
                <button className={`flex min-h-[44px] items-center gap-1 rounded px-3 py-2 text-sm ${!previewMode ? 'bg-accent text-inv-text' : 'text-text/70 hover:text-text'}`} onClick={editor.showEditor}>
                  <Pencil size={12} /> {t('common.actions.edit')}
                </button>
                <button className={`flex min-h-[44px] items-center gap-1 rounded px-3 py-2 text-sm ${previewMode ? 'bg-accent text-inv-text' : 'text-text/70 hover:text-text'}`} onClick={editor.showPreview}>
                  <Eye size={12} /> {t('common.actions.preview')}
                </button>
              </div>
            ) : (
              <>
                <div className="mt-4 inline-flex w-full rounded-xl border border-black/10 bg-background/70 p-1 dark:border-white/10">
                  <button type="button" onClick={() => editor.selectCategory('characters')} className={`flex min-h-[44px] flex-1 items-center justify-center rounded-xl text-sm font-medium transition-colors ${selectedCategory === 'characters' ? 'bg-accent text-inv-text' : 'text-text/50'}`}>
                    {t('common.labels.characters')}
                  </button>
                  <button type="button" onClick={() => editor.selectCategory('worldbuilding')} className={`flex min-h-[44px] flex-1 items-center justify-center rounded-xl text-sm font-medium transition-colors ${selectedCategory === 'worldbuilding' ? 'bg-accent text-inv-text' : 'text-text/50'}`}>
                    {t('common.labels.worldbuilding')}
                  </button>
                </div>
                <div className="relative mt-3">
                  <Search className="absolute left-3 top-3 text-text/50" size={16} />
                  <Input className="pl-10" placeholder={t('auLore.searchPlaceholder')} value={searchTerm} onChange={e => editor.setSearchTerm(e.target.value)} />
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
                          <Button tone="accent" fill="solid" size="sm" onClick={modals.openCreate}>
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
                      onClick={() => { void editor.openFile(file.name, selectedCategory); }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void editor.openFile(file.name, selectedCategory);
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
                          onClick={(event) => { event.stopPropagation(); void actions.togglePin(file.name); }}
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
              <Button tone="neutral" fill="plain" size="sm" className="px-2" onClick={handleOpenImport} disabled={isSaving} title={t('common.actions.importFromFandom')}>
                <Download size={16} />
              </Button>
              <Button tone="neutral" fill="plain" size="sm" className="px-2" onClick={modals.openCreate} disabled={isSaving}>
                {isSaving ? <Spinner size="md" /> : <Plus size={16} />}
              </Button>
            </div>
          </div>
          <div className="text-xs text-text/70">{t('auLore.referenceHint')}</div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 text-text/50" size={14} />
            <Input className="pl-8 h-8 text-xs placeholder:text-xs" placeholder={t('auLore.searchPlaceholder')} value={searchTerm} onChange={e => editor.setSearchTerm(e.target.value)} />
          </div>
        </header>

        <div className="flex-1 min-h-0 flex flex-col">
          {/* Milestone 4: Pin intro when characters exist but no pins */}
          {files.length > 0 && coreIncludes.length === 0 && shouldShowMilestone('pin_intro') && !modals.pinMilestoneDismissed && (
            <MilestoneGuide
              title={t('milestones.pinIntro.title')}
              description={t('milestones.pinIntro.desc')}
              primaryAction={{ label: t('milestones.pinIntro.goSet'), onClick: handleDismissPinMilestone }}
              secondaryAction={{ label: t('milestones.pinIntro.later'), onClick: handleDismissPinMilestone }}
              onDismiss={handleDismissPinMilestone}
            />
          )}
          <div className="flex-1 overflow-y-auto p-2 space-y-6 font-mono py-4">
            <div className="space-y-2">
              <div className="px-3 pb-1 text-xs font-sans font-medium text-text/50">
                {t('auLore.charactersLabel')} ({files.length})
              </div>
              <div>
                <div className="flex items-center justify-between px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/90 font-bold font-sans" onClick={() => editor.toggleFolder('characters')}>
                  <div className="flex items-center gap-2">
                    {expandedFolders.characters ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Folder size={14} className="text-accent" fill="currentColor" fillOpacity={0.2} />
                    <span>{t('common.labels.characters')}</span>
                  </div>
                  <Button tone="neutral" fill="plain" size="sm" className="p-0 h-6 w-6" onClick={(event) => { event.stopPropagation(); editor.selectCategory('characters'); modals.openCreate(); }}>
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
                              <Button tone="accent" fill="solid" size="sm" onClick={() => { editor.selectCategory('characters'); modals.openCreate(); }}>
                                {t('common.actions.addCharacter')}
                              </Button>
                            ),
                          },
                          {
                            key: 'import-character',
                            element: (
                              <Button tone="neutral" fill="outline" size="sm" onClick={handleOpenImport}>
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
                            onClick={() => { void editor.openFile(file.name, 'characters'); }}
                          >
                            <div className="flex items-center gap-2 overflow-hidden">
                              <FileText size={14} className="opacity-50 shrink-0" />
                              <span className="truncate">{file.name}.md</span>
                            </div>
                            <button
                              className={`shrink-0 p-1 rounded transition-colors ${isPinned ? 'text-accent' : 'text-text/30 hover:text-text/50'} ${isSaving ? 'opacity-30 cursor-not-allowed' : ''}`}
                              title={isPinned ? t('coreIncludes.pinned') : t('coreIncludes.setPin')}
                              disabled={isSaving}
                              onClick={(e) => { e.stopPropagation(); void actions.togglePin(file.name); }}
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
                <div className="flex items-center justify-between px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/90 font-bold font-sans" onClick={() => editor.toggleFolder('worldbuilding')}>
                  <div className="flex items-center gap-2">
                    {expandedFolders.worldbuilding ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Folder size={14} className="text-info" fill="currentColor" fillOpacity={0.2} />
                    <span>{t('common.labels.worldbuilding')}</span>
                  </div>
                  <Button tone="neutral" fill="plain" size="sm" className="p-0 h-6 w-6" onClick={(event) => { event.stopPropagation(); editor.selectCategory('worldbuilding'); modals.openCreate(); }}>
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
                              <Button tone="accent" fill="solid" size="sm" onClick={() => { editor.selectCategory('worldbuilding'); modals.openCreate(); }}>
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
                          onClick={() => { void editor.openFile(file.name, 'worldbuilding'); }}
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
                <Button tone="destructive" fill="plain" size="sm" className="h-8" onClick={modals.openDeleteConfirm} disabled={isSaving || isReadingFile}>
                  <Trash2 size={14} />
                </Button>
                <div className="inline-flex rounded-md border border-black/10 dark:border-white/10 bg-surface/60 p-0.5 mr-2">
                  <button className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${!previewMode ? 'bg-accent text-inv-text' : 'text-text/70 hover:text-text'}`} onClick={editor.showEditor}>
                    <Pencil size={12} /> {t('common.actions.edit')}
                  </button>
                  <button className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${previewMode ? 'bg-accent text-inv-text' : 'text-text/70 hover:text-text'}`} onClick={editor.showPreview}>
                    <Eye size={12} /> {t('common.actions.preview')}
                  </button>
                </div>
                <Button tone="accent" fill="solid" size="sm" className="h-8 w-24" onClick={() => { void actions.saveCurrentFile(); }} disabled={isSaving || isReadingFile}>
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
