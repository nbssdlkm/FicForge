// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useMemo, type KeyboardEvent } from "react";

import { Spinner } from "../shared/Spinner";
import { Button } from "../shared/Button";
import { Input, Textarea } from "../shared/Input";
import { Tag } from "../shared/Tag";
import { EmptyState } from "../shared/EmptyState";
import { TrashPanel } from "../shared/TrashPanel";
import { SettingsChatPanel } from "../shared/settings-chat/SettingsChatPanel";
import type { FandomFileEntry } from "../../api/engine-client";
import {
  Search,
  Plus,
  ArrowLeft,
  FileText,
  ChevronDown,
  ChevronRight,
  Folder,
  Trash2,
  Users,
  Globe2,
  Eye,
  Pencil,
  MessageSquare,
  X,
} from "lucide-react";
import { SettingsMarkdown } from "../shared/SettingsMarkdown";
import { FandomLoreModals } from "./FandomLoreModals";
import { useTranslation } from "../../i18n/useAppTranslation";
import { FeedbackProvider, useFeedback } from "../../hooks/useFeedback";
import type { FandomLoreCategory } from "./lore-utils";
import { useFandomLoreFiles } from "./useFandomLoreFiles";
import { useFandomLoreEditor } from "./useFandomLoreEditor";
import { useFandomLoreChrome } from "./useFandomLoreChrome";
import { useFandomLoreDirtyGuard } from "./useFandomLoreDirtyGuard";

type Props = {
  fandomPath?: string;
  onNavigate: (page: string) => void;
};

/** role="button" 的 div 统一走这个处理 Enter/Space 键盘触发（noStaticElementInteractions），避免每处手写。 */
function activateOnEnterOrSpace(event: KeyboardEvent<HTMLElement>, activate: () => void) {
  // 只认自身获焦的按键（F3 对抗审）：这些容器内嵌真 <button>，子元素的 Enter/Space
  // 会冒泡上来——不过滤会一次按键双动作（子按钮 + 父折叠/打开）。
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activate();
  }
}

function FandomLoreLayoutInner({ fandomPath, onNavigate }: Props) {
  const { t } = useTranslation();
  const { showToast } = useFeedback();

  // 状态下沉四 hook（长期债②）：数据 / 编辑器 / 界面镶边 / 弃改确认
  const files = useFandomLoreFiles(fandomPath);
  const editor = useFandomLoreEditor(fandomPath, files);
  const chrome = useFandomLoreChrome(fandomPath);
  const dirtyGuard = useFandomLoreDirtyGuard(fandomPath, (action) => {
    switch (action.type) {
      case "select":
        void editor.openFile(action.filename, action.category);
        break;
      case "create":
        chrome.openCreateModal(action.category);
        break;
      case "delete":
        chrome.openDeleteConfirm();
        break;
      case "navigate":
        onNavigate(action.page);
        break;
    }
  });

  // memo：正文 textarea 每键入一字触发全组件 re-render，选中项/过滤只应随列表/搜索词重算
  const selectedEntry = useMemo(
    () =>
      editor.selectedFile
        ? ((editor.selectedCategory === "core_characters" ? files.characterFiles : files.worldbuildingFiles).find(
            (file) => file.filename === editor.selectedFile,
          ) ?? null)
        : null,
    [editor.selectedFile, editor.selectedCategory, files.characterFiles, files.worldbuildingFiles],
  );
  const normalizedSearch = chrome.searchTerm.trim().toLowerCase();
  const filterBySearch = (list: FandomFileEntry[]) =>
    normalizedSearch
      ? list.filter(
          (file) =>
            file.name.toLowerCase().includes(normalizedSearch) ||
            file.filename.toLowerCase().includes(normalizedSearch),
        )
      : list;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 有意省依赖——hook 规则 4 ref-shim/边沿触发语义（见邻近注释）
  const filteredCharacterFiles = useMemo(
    () => filterBySearch(files.characterFiles),
    [files.characterFiles, normalizedSearch],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: 有意省依赖——hook 规则 4 ref-shim/边沿触发语义（见邻近注释）
  const filteredWorldbuildingFiles = useMemo(
    () => filterBySearch(files.worldbuildingFiles),
    [files.worldbuildingFiles, normalizedSearch],
  );

  // ——— 意图层：编辑器脏时先走弃改确认，干净则直接执行 ———

  const handleSelectFileIntent = (filename: string, category: FandomLoreCategory) => {
    if (editor.editorBusy) {
      return;
    }

    if (editor.selectedFile === filename && editor.selectedCategory === category) {
      return;
    }

    if (editor.isEditorDirty) {
      dirtyGuard.requestDiscardConfirm({ type: "select", filename, category });
      return;
    }

    void editor.openFile(filename, category);
  };

  const openCreateModalIntent = (category: FandomLoreCategory) => {
    if (editor.isEditorDirty) {
      dirtyGuard.requestDiscardConfirm({ type: "create", category });
      return;
    }
    chrome.openCreateModal(category);
  };

  const handleDeleteIntent = () => {
    if (editor.isEditorDirty) {
      dirtyGuard.requestDiscardConfirm({ type: "delete" });
      return;
    }
    chrome.openDeleteConfirm();
  };

  const handleNavigateIntent = (page: string) => {
    if (editor.isEditorDirty) {
      dirtyGuard.requestDiscardConfirm({ type: "navigate", page });
      return;
    }

    onNavigate(page);
  };

  const handleCreateLore = () => {
    void editor.createLore(chrome.createName, chrome.createModalCategory, chrome.closeCreateModal);
  };

  const handleDeleteLore = () => {
    chrome.closeDeleteConfirm();
    void editor.deleteSelectedLore();
  };

  // 对话面板改动落库后：重拉列表，当前文件被删则关编辑区，干净则重读回显
  const handleAfterChatMutation = async () => {
    const refreshed = await files.loadFiles();
    if (!refreshed) return;
    if (!editor.selectedFile) return;
    const refreshedFiles =
      editor.selectedCategory === "core_characters" ? refreshed?.characters || [] : refreshed?.worldbuilding || [];
    const fileStillExists = refreshedFiles.some((file) => file.filename === editor.selectedFile);
    if (!fileStillExists) {
      editor.clearSelection();
      showToast(t("fandomLore.selectedFileRemoved"), "warning");
      return;
    }
    if (!editor.isEditorDirty) {
      await editor.openFile(editor.selectedFile, editor.selectedCategory);
    } else {
      showToast(t("fandomLore.pendingEditsPreserved"), "warning");
    }
  };

  return (
    <div className="flex h-screen bg-background text-text transition-colors duration-200 w-full overflow-hidden">
      <div className="w-[300px] md:w-[340px] shrink-0 border-r border-black/10 dark:border-white/10 flex flex-col bg-surface/50">
        <header className="p-4 border-b border-black/10 dark:border-white/10 flex flex-col gap-3 shrink-0 bg-surface">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Button
                tone="neutral"
                fill="plain"
                size="sm"
                onClick={() => handleNavigateIntent("library")}
                className="p-1 h-8 w-8 text-text/70 hover:text-text rounded-full"
                title={t("common.actions.back")}
              >
                <ArrowLeft size={18} />
              </Button>
              <h1 className="font-serif text-lg font-bold">
                {t("common.scope.fandomTitle", { name: files.fandomName })}
              </h1>
            </div>
            <Button
              tone="neutral"
              fill="plain"
              size="sm"
              className="px-2"
              onClick={() => openCreateModalIntent("core_characters")}
              disabled={editor.editorBusy || files.filesLoading}
            >
              {editor.isSaving ? <Spinner size="md" /> : <Plus size={16} />}
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 text-text/50" size={14} />
            <Input
              className="pl-8 h-8 text-xs placeholder:text-xs"
              placeholder={t("common.search.files")}
              value={chrome.searchTerm}
              onChange={(e) => chrome.setSearchTerm(e.target.value)}
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
                {/* biome-ignore lint/a11y/useSemanticElements: 内含真 <button>（新建角色），button 不可嵌 button，只能保留 div+role */}
                <div
                  className="flex items-center justify-between px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/90 font-bold font-sans"
                  role="button"
                  tabIndex={0}
                  onClick={() => chrome.toggleFolder("core_characters")}
                  onKeyDown={(event) => activateOnEnterOrSpace(event, () => chrome.toggleFolder("core_characters"))}
                >
                  <div className="flex items-center gap-2">
                    {chrome.expandedFolders.core_characters ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Folder size={14} className="text-accent" fill="currentColor" fillOpacity={0.2} />
                    <span>{t("fandomLore.category.characters")}</span>
                  </div>
                  <Button
                    tone="neutral"
                    fill="plain"
                    size="sm"
                    className="p-0 h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      openCreateModalIntent("core_characters");
                    }}
                    disabled={editor.editorBusy || files.filesLoading}
                  >
                    <Plus size={12} />
                  </Button>
                </div>
                {chrome.expandedFolders.core_characters && (
                  <div className="mt-1 space-y-0.5">
                    {files.filesLoading ? (
                      <div className="pl-6 py-2">
                        <Spinner size="sm" className="text-accent" />
                      </div>
                    ) : filteredCharacterFiles.length === 0 ? (
                      <EmptyState
                        compact
                        icon={<Users size={28} />}
                        title={
                          files.characterFiles.length === 0
                            ? t("emptyState.fandomCharacters.title")
                            : t("facts.noSearchResultTitle")
                        }
                        description={
                          files.characterFiles.length === 0
                            ? t("emptyState.fandomCharacters.description")
                            : t("facts.noSearchResultDescription")
                        }
                        actions={
                          files.characterFiles.length === 0
                            ? [
                                {
                                  key: "create-character",
                                  element: (
                                    <Button
                                      tone="accent"
                                      fill="solid"
                                      size="sm"
                                      onClick={() => openCreateModalIntent("core_characters")}
                                    >
                                      {t("common.actions.addCharacter")}
                                    </Button>
                                  ),
                                },
                              ]
                            : undefined
                        }
                      />
                    ) : (
                      filteredCharacterFiles.map((f) => (
                        <button
                          type="button"
                          key={f.filename}
                          className={`flex w-full items-center gap-2 pl-6 pr-2 py-1.5 text-left text-sm cursor-pointer rounded-md transition-colors ${
                            editor.selectedFile === f.filename && editor.selectedCategory === "core_characters"
                              ? "bg-accent/10 text-accent font-semibold"
                              : "hover:bg-black/5 dark:hover:bg-white/5 text-text/70"
                          } ${editor.editorBusy ? "pointer-events-none opacity-60" : ""}`}
                          onClick={() => handleSelectFileIntent(f.filename, "core_characters")}
                        >
                          <FileText size={13} />
                          <span>{f.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div>
                {/* biome-ignore lint/a11y/useSemanticElements: 内含真 <button>（新建世界观条目），button 不可嵌 button，只能保留 div+role */}
                <div
                  className="flex items-center justify-between px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/90 font-bold font-sans"
                  role="button"
                  tabIndex={0}
                  onClick={() => chrome.toggleFolder("core_worldbuilding")}
                  onKeyDown={(event) => activateOnEnterOrSpace(event, () => chrome.toggleFolder("core_worldbuilding"))}
                >
                  <div className="flex items-center gap-2">
                    {chrome.expandedFolders.core_worldbuilding ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Folder size={14} className="text-warning" fill="currentColor" fillOpacity={0.2} />
                    <span>{t("fandomLore.category.worldbuilding")}</span>
                  </div>
                  <Button
                    tone="neutral"
                    fill="plain"
                    size="sm"
                    className="p-0 h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      openCreateModalIntent("core_worldbuilding");
                    }}
                    disabled={editor.editorBusy || files.filesLoading}
                  >
                    <Plus size={12} />
                  </Button>
                </div>
                {chrome.expandedFolders.core_worldbuilding && (
                  <div className="mt-1 space-y-0.5">
                    {files.filesLoading ? (
                      <div className="pl-6 py-2">
                        <Spinner size="sm" className="text-accent" />
                      </div>
                    ) : filteredWorldbuildingFiles.length === 0 ? (
                      <EmptyState
                        compact
                        icon={<Globe2 size={28} />}
                        title={
                          files.worldbuildingFiles.length === 0
                            ? t("emptyState.fandomWorldbuilding.title")
                            : t("facts.noSearchResultTitle")
                        }
                        description={
                          files.worldbuildingFiles.length === 0
                            ? t("emptyState.fandomWorldbuilding.description")
                            : t("facts.noSearchResultDescription")
                        }
                        actions={
                          files.worldbuildingFiles.length === 0
                            ? [
                                {
                                  key: "create-worldbuilding",
                                  element: (
                                    <Button
                                      tone="accent"
                                      fill="solid"
                                      size="sm"
                                      onClick={() => openCreateModalIntent("core_worldbuilding")}
                                    >
                                      {t("common.actions.addWorldbuilding")}
                                    </Button>
                                  ),
                                },
                              ]
                            : undefined
                        }
                      />
                    ) : (
                      filteredWorldbuildingFiles.map((f) => (
                        <button
                          type="button"
                          key={f.filename}
                          className={`flex w-full items-center gap-2 pl-6 pr-2 py-1.5 text-left text-sm cursor-pointer rounded-md transition-colors ${
                            editor.selectedFile === f.filename && editor.selectedCategory === "core_worldbuilding"
                              ? "bg-accent/10 text-accent font-semibold"
                              : "hover:bg-black/5 dark:hover:bg-white/5 text-text/70"
                          } ${editor.editorBusy ? "pointer-events-none opacity-60" : ""}`}
                          onClick={() => handleSelectFileIntent(f.filename, "core_worldbuilding")}
                        >
                          <FileText size={13} />
                          <span>{f.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <TrashPanel
            scope="fandom"
            path={fandomPath}
            onRestore={files.applyTrashRestore}
            refreshToken={files.trashRefreshToken}
            disabled={editor.editorBusy}
          />
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-background relative">
        <header className="h-14 border-b border-black/10 dark:border-white/10 flex items-center px-6 justify-between shrink-0 bg-surface/30">
          {editor.selectedFile ? (
            <>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-semibold opacity-70">
                  {selectedEntry?.filename || editor.selectedFile}
                </span>
                <Tag tone={editor.selectedCategory === "core_characters" ? "success" : "warning"}>
                  {editor.selectedCategory === "core_characters"
                    ? t("fandomLore.selectedTagCharacter")
                    : t("fandomLore.selectedTagWorldbuilding")}
                </Tag>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-text/50 bg-black/5 dark:bg-white/5 px-2 py-1 rounded-md hidden xl:block">
                  {t("fandomLore.referenceHint")}
                </span>
                <Button
                  tone="destructive"
                  fill="plain"
                  size="sm"
                  className="h-8"
                  onClick={handleDeleteIntent}
                  disabled={editor.editorBusy}
                  aria-label={t("common.actions.delete")}
                >
                  <Trash2 size={14} />
                </Button>
                <div className="inline-flex rounded-md border border-black/10 dark:border-white/10 bg-surface/60 p-0.5 mr-2">
                  <button
                    type="button"
                    className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${!editor.previewMode ? "bg-accent text-inv-text" : "text-text/70 hover:text-text"}`}
                    onClick={editor.showEditMode}
                  >
                    <Pencil size={12} /> {t("common.actions.edit")}
                  </button>
                  <button
                    type="button"
                    className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${editor.previewMode ? "bg-accent text-inv-text" : "text-text/70 hover:text-text"}`}
                    onClick={editor.showPreviewMode}
                  >
                    <Eye size={12} /> {t("common.actions.preview")}
                  </button>
                </div>
                <Button
                  tone="accent"
                  fill="solid"
                  size="sm"
                  className="h-8 w-28"
                  onClick={editor.saveSelectedLore}
                  disabled={editor.editorBusy}
                >
                  {editor.isSaving || editor.isReadingFile ? <Spinner size="sm" /> : t("fandomLore.saveButton")}
                </Button>
              </div>
            </>
          ) : (
            <span className="font-mono text-sm opacity-40">{t("fandomLore.unselected")}</span>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-6 w-full flex flex-col gap-6">
          {editor.selectedFile ? (
            <div className="flex flex-col gap-2 flex-1">
              {/* 小节标题，不关联单一控件（下方视 previewMode/加载态渲染 spinner、Markdown 预览或 Textarea） */}
              <p className="text-sm font-bold text-text/90">
                {editor.selectedCategory === "core_characters"
                  ? t("fandomLore.category.characters")
                  : t("fandomLore.category.worldbuilding")}
              </p>
              {editor.isReadingFile ? (
                <div className="flex min-h-[300px] flex-1 items-center justify-center">
                  <Spinner size="md" className="text-accent" />
                </div>
              ) : editor.previewMode ? (
                <div className="flex-1 min-h-[300px] overflow-y-auto">
                  <SettingsMarkdown content={editor.editorContent} />
                </div>
              ) : (
                <Textarea
                  value={editor.editorContent}
                  onChange={(e) => editor.setEditorContent(e.target.value)}
                  disabled={editor.editorBusy}
                  className="font-mono flex-1 min-h-[300px] text-sm leading-relaxed resize-y"
                />
              )}
            </div>
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
      <div
        className={`shrink-0 border-l border-black/10 dark:border-white/10 flex flex-col bg-surface/30 transition-all duration-300 overflow-hidden ${chrome.aiPanelOpen ? "w-[320px] lg:w-[360px]" : "w-0"}`}
      >
        <div
          className={`flex-1 flex flex-col min-h-0 transition-opacity duration-200 ${chrome.aiPanelOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        >
          <div className="p-3 border-b border-black/10 dark:border-white/10 flex items-center justify-between shrink-0">
            <span className="text-xs font-bold text-text/70">{t("settingsMode.fandomAiTitle")}</span>
            <Button tone="neutral" fill="plain" size="sm" className="h-6 w-6 p-0" onClick={chrome.closeAiPanel}>
              <X size={14} />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <SettingsChatPanel
              mode="fandom"
              basePath={fandomPath}
              fandomPath={fandomPath}
              placeholder={t("settingsMode.fandomPlaceholder")}
              title=""
              compact
              disabled={editor.settingsChatDisabled}
              onBusyChange={editor.markSettingsChatBusy}
              onAfterMutation={handleAfterChatMutation}
            />
          </div>
        </div>
      </div>
      {!chrome.aiPanelOpen && (
        <Button
          tone="neutral"
          fill="plain"
          size="sm"
          className="fixed right-3 top-16 z-20 h-8 px-2 bg-surface border border-black/10 dark:border-white/10 shadow-xs"
          onClick={chrome.openAiPanel}
        >
          <MessageSquare size={14} className="mr-1" /> AI
        </Button>
      )}

      <FandomLoreModals
        createModalOpen={chrome.createModalOpen}
        closeCreateModal={chrome.closeCreateModal}
        createModalCategory={chrome.createModalCategory}
        createName={chrome.createName}
        setCreateName={chrome.setCreateName}
        handleCreateLore={handleCreateLore}
        editorBusy={editor.editorBusy}
        deleteConfirmOpen={chrome.deleteConfirmOpen}
        closeDeleteConfirm={chrome.closeDeleteConfirm}
        selectedEntry={selectedEntry ?? null}
        selectedFile={editor.selectedFile}
        handleDeleteLore={handleDeleteLore}
        discardChangesOpen={dirtyGuard.discardChangesOpen}
        handleCancelDiscardChanges={dirtyGuard.cancelDiscard}
        handleConfirmDiscardChanges={dirtyGuard.confirmDiscard}
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
