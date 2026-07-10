// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { ArrowLeft, FileText, Pencil, Eye, Trash2, Users, Globe2, Sparkles } from "lucide-react";
import { Spinner } from "../shared/Spinner";
import { useTranslation } from "../../i18n/useAppTranslation";
import { TrashPanel } from "../shared/TrashPanel";
import { Button } from "../shared/Button";
import { Input, Textarea } from "../shared/Input";
import { Modal } from "../shared/Modal";
import { EmptyState } from "../shared/EmptyState";
import { SettingsMarkdown } from "../shared/SettingsMarkdown";
import { SettingsChatPanel } from "../shared/settings-chat/SettingsChatPanel";
import { cn } from "../shared/utils";
import { FeedbackProvider } from "../../hooks/useFeedback";
import { useMobileFandomFiles } from "./useMobileFandomFiles";
import { useMobileFandomFileEditor } from "./useMobileFandomFileEditor";
import { useMobileFandomViewChrome } from "./useMobileFandomViewChrome";

interface MobileFandomViewProps {
  fandomPath: string;
  onNavigate: (page: string, path?: string) => void;
}

export function MobileFandomView(props: MobileFandomViewProps) {
  return (
    <FeedbackProvider>
      <MobileFandomViewInner {...props} />
    </FeedbackProvider>
  );
}

function MobileFandomViewInner({ fandomPath, onNavigate }: MobileFandomViewProps) {
  const { t } = useTranslation();
  const fandomDirName = fandomPath.split("/").pop() || "";

  const files = useMobileFandomFiles(fandomPath, fandomDirName);
  const editor = useMobileFandomFileEditor(fandomPath, fandomDirName);
  const chrome = useMobileFandomViewChrome(fandomPath);

  const currentFiles = chrome.category === "core_characters" ? files.characterFiles : files.worldbuildingFiles;
  const categoryLabel = chrome.category === "core_characters" ? t("fandomLore.category.characters") : t("fandomLore.category.worldbuilding");

  // 新建 → 关弹窗 → 刷列表 → 直接打开新文件（跨 hook 编排只在组件层，hook 间不互持状态）
  const handleCreate = async () => {
    const filename = await editor.createFile(chrome.createName, chrome.category);
    if (!filename) return;
    chrome.closeCreate();
    await files.reload();
    await editor.openFile(filename, chrome.category);
  };

  const handleDelete = async () => {
    const deleted = await editor.deleteSelected();
    if (!deleted) return;
    chrome.closeDelete();
    await files.reload();
  };

  // ==========================================================================
  // File Detail Overlay
  // ==========================================================================
  if (editor.selectedFile) {
    const displayName = editor.selectedFile.replace(/\.md$/, "");
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background md:hidden">
        <header className="safe-area-top flex items-center justify-between border-b border-black/10 bg-surface/95 px-4 py-3 backdrop-blur-sm dark:border-white/10">
          <Button tone="neutral" fill="plain" size="sm" className="h-11 px-3" onClick={editor.closeFile}>
            <ArrowLeft size={16} className="mr-2" />
            {t("common.actions.back")}
          </Button>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-sm font-semibold text-text">{displayName}</p>
            <p className="text-xs text-text/50">{categoryLabel}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button tone="neutral" fill="plain" size="sm" className="h-11 w-11 p-0" onClick={chrome.openDelete}>
              <Trash2 size={16} className="text-error" />
            </Button>
            <Button tone="accent" fill="solid" size="sm" className="h-11 px-4" onClick={editor.save} disabled={editor.saving || !editor.isDirty}>
              {editor.saving ? <Spinner size="sm" /> : t("common.actions.save")}
            </Button>
          </div>
        </header>

        {/* Edit/Preview toggle */}
        <div className="flex gap-2 border-b border-black/5 px-4 py-2 dark:border-white/5">
          <button
            type="button"
            className={cn("flex items-center gap-1 rounded-lg px-3 py-2 text-sm", !editor.previewMode ? "bg-accent text-inv-text" : "text-text/50")}
            onClick={editor.showEditor}
          >
            <Pencil size={14} /> {t("common.actions.edit")}
          </button>
          <button
            type="button"
            className={cn("flex items-center gap-1 rounded-lg px-3 py-2 text-sm", editor.previewMode ? "bg-accent text-inv-text" : "text-text/50")}
            onClick={editor.showPreview}
          >
            <Eye size={14} /> {t("common.actions.preview")}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {editor.readingFile ? (
            <div className="flex items-center justify-center py-24">
              <Spinner size="lg" className="text-accent" />
            </div>
          ) : editor.previewMode ? (
            <SettingsMarkdown content={editor.editorContent} />
          ) : (
            <Textarea
              value={editor.editorContent}
              onChange={(e) => editor.setEditorContent(e.target.value)}
              className="min-h-[60vh] font-mono text-sm"
            />
          )}
        </div>

        {/* Delete confirm modal */}
        <Modal isOpen={chrome.deleteOpen} onClose={chrome.closeDelete} title={t("fandomLore.deleteTitle")}>
          <div className="space-y-4">
            <p className="text-sm text-text/90">{t("fandomLore.deleteMessage", { name: editor.selectedFile })}</p>
            <div className="flex justify-end gap-2">
              <Button tone="neutral" fill="plain" onClick={chrome.closeDelete}>{t("common.actions.cancel")}</Button>
              <Button tone="destructive" fill="solid" onClick={handleDelete}>
                {t("common.actions.confirmDelete")}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  // ==========================================================================
  // Main List View
  // ==========================================================================
  return (
    <section className="flex h-full flex-col bg-background md:hidden">
      {/* Header */}
      <header className="safe-area-top border-b border-rule bg-surface/85 px-4 py-4 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1 font-sans text-[11px] font-medium tracking-[0.04em] text-accent"
            onClick={() => onNavigate("library")}
          >
            <ArrowLeft size={14} />
            <span>{t("library.title")}</span>
          </button>
        </div>
        <h1 className="mt-2 font-display text-xl font-semibold text-text">
          {t("common.scope.fandomTitle", { name: files.fandomName })}
        </h1>
      </header>

      {/* Category tabs */}
      <div className="border-b border-rule px-4 pt-3">
        <div className="inline-flex w-full rounded-sm border border-rule bg-background/60 p-1">
          {(["core_characters", "core_worldbuilding"] as const).map((cat) => {
            const Icon = cat === "core_characters" ? Users : Globe2;
            const label = cat === "core_characters" ? t("fandomLore.category.characters") : t("fandomLore.category.worldbuilding");
            const count = cat === "core_characters" ? files.characterFiles.length : files.worldbuildingFiles.length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => chrome.selectCategory(cat)}
                className={cn(
                  "flex min-h-[44px] flex-1 items-center justify-center rounded-[3px] text-sm font-medium transition-colors",
                  chrome.category === cat ? "bg-accent text-inv-text" : "text-text/55 hover:bg-rule-soft",
                )}
              >
                <Icon size={15} className="mr-2" />
                {label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {files.loading ? (
          <div className="flex items-center justify-center py-24">
            <Spinner size="lg" className="text-accent" />
          </div>
        ) : currentFiles.length === 0 ? (
          <EmptyState
            icon={<FileText size={32} />}
            title={chrome.category === "core_characters" ? t("fandomLore.emptyCharacters.title") : t("fandomLore.emptyWorldbuilding.title")}
            description={chrome.category === "core_characters" ? t("fandomLore.emptyCharacters.description") : t("fandomLore.emptyWorldbuilding.description")}
            actions={[{
              key: "create",
              element: (
                <Button tone="accent" fill="solid" size="sm" onClick={chrome.openCreate}>
                  {chrome.category === "core_characters" ? t("common.actions.addCharacter") : t("common.actions.addWorldbuilding")}
                </Button>
              ),
            }]}
          />
        ) : (
          currentFiles.map((file) => (
            <button
              key={file.filename}
              type="button"
              className="flex w-full items-center justify-between rounded-r-sm border border-rule border-l-2 border-l-gold bg-surface px-4 py-3.5 text-left transition-colors hover:bg-rule-soft"
              onClick={() => editor.openFile(file.filename, chrome.category)}
            >
              <div className="min-w-0">
                <p className="truncate font-display text-base font-medium text-text">{file.name}</p>
                <p className="mt-1 font-sans text-[10px] font-medium uppercase tracking-[0.12em] text-gold">{categoryLabel}</p>
              </div>
              <FileText size={16} className="ml-3 shrink-0 text-text/30" />
            </button>
          ))
        )}

        {/* Add button when list not empty */}
        {!files.loading && currentFiles.length > 0 && (
          <div className="pt-2">
            <Button tone="neutral" fill="outline" size="sm" className="w-full" onClick={chrome.openCreate}>
              {chrome.category === "core_characters" ? t("common.actions.addCharacter") : t("common.actions.addWorldbuilding")}
            </Button>
          </div>
        )}

        <TrashPanel scope="fandom" path={fandomPath} />
      </div>

      {/* Create modal */}
      <Modal isOpen={chrome.createOpen} onClose={chrome.closeCreate} title={chrome.category === "core_characters" ? t("fandomLore.createCharacterTitle") : t("fandomLore.createWorldbuildingTitle")}>
        <div className="space-y-4">
          <Input
            value={chrome.createName}
            onChange={(e) => chrome.setCreateName(e.target.value)}
            placeholder={chrome.category === "core_characters" ? t("fandomLore.characterPlaceholder") : t("fandomLore.worldbuildingPlaceholder")}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button tone="neutral" fill="plain" onClick={chrome.closeCreate}>{t("common.actions.cancel")}</Button>
            <Button tone="accent" fill="solid" onClick={handleCreate} disabled={!chrome.createName.trim() || editor.saving}>
              {editor.saving ? <Spinner size="sm" /> : t("common.actions.create")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* AI assistant floating button */}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-end px-4 md:hidden">
        <Button
          tone="accent" fill="solid"
          className="pointer-events-auto h-12 rounded-full px-5 shadow-strong"
          onClick={chrome.openAiOverlay}
        >
          <Sparkles size={16} className="mr-2" />
          {t("settingsMode.title")}
        </Button>
      </div>

      {/* AI assistant overlay */}
      {chrome.aiOverlayOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background md:hidden">
          <header className="safe-area-top flex items-center justify-between border-b border-rule bg-surface/95 px-4 py-3 backdrop-blur-sm">
            <Button tone="neutral" fill="plain" size="sm" className="h-11 px-3" onClick={chrome.closeAiOverlay}>
              <ArrowLeft size={16} className="mr-2" />
              {t("common.actions.back")}
            </Button>
            <h2 className="font-display text-base font-semibold text-text">{t("settingsMode.title")}</h2>
            <div className="w-[68px]" />
          </header>
          <div className="flex-1 overflow-hidden">
            <SettingsChatPanel
              mode="fandom"
              basePath={fandomPath}
              fandomPath={fandomPath}
              placeholder={t("settingsMode.fandomPlaceholder")}
              className="h-full"
              onAfterMutation={async () => { await files.reload(); }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
