// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, FileText, Loader2, Plus, Pencil, Eye, Trash2, Users, Globe2 } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { listFandomFiles, readFandomFile, saveLore, deleteLore, type FandomFileEntry } from "../../api/engine-client";
import { Button } from "../shared/Button";
import { Input, Textarea } from "../shared/Input";
import { Modal } from "../shared/Modal";
import { EmptyState } from "../shared/EmptyState";
import { SettingsMarkdown } from "../shared/SettingsMarkdown";
import { cn } from "../shared/utils";

interface MobileFandomViewProps {
  fandomPath: string;
  onNavigate: (page: string, path?: string) => void;
}

type FandomCategory = "core_characters" | "core_worldbuilding";

export function MobileFandomView({ fandomPath, onNavigate }: MobileFandomViewProps) {
  const { t } = useTranslation();
  const fandomName = fandomPath.split("/").pop() || "";

  // --- State ---
  const [category, setCategory] = useState<FandomCategory>("core_characters");
  const [characterFiles, setCharacterFiles] = useState<FandomFileEntry[]>([]);
  const [worldbuildingFiles, setWorldbuildingFiles] = useState<FandomFileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // File detail overlay
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<FandomCategory>("core_characters");
  const [editorContent, setEditorContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [previewMode, setPreviewMode] = useState(true);
  const [saving, setSaving] = useState(false);
  const [readingFile, setReadingFile] = useState(false);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");

  // Delete confirm
  const [deleteOpen, setDeleteOpen] = useState(false);

  const loadRequestRef = useRef(0);
  const readRequestRef = useRef(0);

  const currentFiles = category === "core_characters" ? characterFiles : worldbuildingFiles;

  // --- Load files ---
  const loadFiles = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    try {
      const data = await listFandomFiles(fandomName);
      if (requestId !== loadRequestRef.current) return;
      setCharacterFiles(data.characters);
      setWorldbuildingFiles(data.worldbuilding);
    } catch {
      // silent
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [fandomName]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  // --- Select file ---
  const handleSelectFile = async (filename: string, cat: FandomCategory) => {
    const requestId = ++readRequestRef.current;
    setSelectedFile(filename);
    setSelectedCategory(cat);
    setEditorContent("");
    setSavedContent("");
    setPreviewMode(true);
    setReadingFile(true);
    try {
      const result = await readFandomFile(fandomName, cat, filename);
      if (requestId !== readRequestRef.current) return;
      setEditorContent(result.content);
      setSavedContent(result.content);
    } catch {
      if (requestId !== readRequestRef.current) return;
      setSelectedFile(null);
    } finally {
      if (requestId === readRequestRef.current) setReadingFile(false);
    }
  };

  // --- Save ---
  const handleSave = async () => {
    if (!selectedFile || !fandomPath) return;
    setSaving(true);
    try {
      await saveLore({ fandom_path: fandomPath, category: selectedCategory, filename: selectedFile, content: editorContent });
      setSavedContent(editorContent);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  // --- Create ---
  const handleCreate = async () => {
    const name = createName.trim();
    if (!name || !fandomPath) return;
    setSaving(true);
    try {
      const filename = `${name}.md`;
      const template = `---\nname: ${name}\n---\n\n# ${name}\n\n`;
      await saveLore({ fandom_path: fandomPath, category, filename, content: template });
      setCreateOpen(false);
      setCreateName("");
      await loadFiles();
      await handleSelectFile(filename, category);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  // --- Delete ---
  const handleDelete = async () => {
    if (!selectedFile || !fandomPath) return;
    setSaving(true);
    try {
      await deleteLore({ fandom_path: fandomPath, category: selectedCategory, filename: selectedFile });
      setDeleteOpen(false);
      setSelectedFile(null);
      await loadFiles();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const isDirty = selectedFile !== null && editorContent !== savedContent;
  const categoryLabel = category === "core_characters" ? t("fandomLore.category.characters") : t("fandomLore.category.worldbuilding");

  // ==========================================================================
  // File Detail Overlay
  // ==========================================================================
  if (selectedFile) {
    const displayName = selectedFile.replace(/\.md$/, "");
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background md:hidden">
        <header className="safe-area-top flex items-center justify-between border-b border-black/10 bg-surface/95 px-4 py-3 backdrop-blur dark:border-white/10">
          <Button variant="ghost" size="sm" className="h-11 px-3" onClick={() => setSelectedFile(null)}>
            <ArrowLeft size={16} className="mr-2" />
            {t("common.actions.back")}
          </Button>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-sm font-semibold text-text">{displayName}</p>
            <p className="text-[10px] text-text/40">{categoryLabel}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-11 w-11 p-0" onClick={() => setDeleteOpen(true)}>
              <Trash2 size={16} className="text-error" />
            </Button>
            <Button variant="primary" size="sm" className="h-11 px-4" onClick={handleSave} disabled={saving || !isDirty}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : t("common.actions.save")}
            </Button>
          </div>
        </header>

        {/* Edit/Preview toggle */}
        <div className="flex gap-2 border-b border-black/5 px-4 py-2 dark:border-white/5">
          <button
            type="button"
            className={cn("flex items-center gap-1 rounded-lg px-3 py-2 text-sm", !previewMode ? "bg-accent text-white" : "text-text/55")}
            onClick={() => setPreviewMode(false)}
          >
            <Pencil size={14} /> {t("common.actions.edit")}
          </button>
          <button
            type="button"
            className={cn("flex items-center gap-1 rounded-lg px-3 py-2 text-sm", previewMode ? "bg-accent text-white" : "text-text/55")}
            onClick={() => setPreviewMode(true)}
          >
            <Eye size={14} /> {t("common.actions.preview")}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {readingFile ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="animate-spin text-accent" size={24} />
            </div>
          ) : previewMode ? (
            <SettingsMarkdown content={editorContent} />
          ) : (
            <Textarea
              value={editorContent}
              onChange={(e) => setEditorContent(e.target.value)}
              className="min-h-[60vh] font-mono text-sm"
            />
          )}
        </div>

        {/* Delete confirm modal */}
        <Modal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} title={t("fandomLore.deleteTitle")}>
          <div className="space-y-4">
            <p className="text-sm text-text/80">{t("fandomLore.deleteMessage", { name: selectedFile })}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteOpen(false)}>{t("common.actions.cancel")}</Button>
              <Button variant="primary" className="bg-red-600 text-white hover:bg-red-700" onClick={handleDelete}>
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
    <section className="flex min-h-full flex-col bg-background md:hidden">
      {/* Header */}
      <header className="safe-area-top border-b border-black/10 bg-surface/80 px-4 py-4 backdrop-blur dark:border-white/10">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1 text-sm text-accent"
            onClick={() => onNavigate("library")}
          >
            <ArrowLeft size={16} />
            <span>{t("library.title")}</span>
          </button>
        </div>
        <h1 className="mt-2 text-xl font-bold text-text">
          {t("common.scope.fandomTitle", { name: fandomName })}
        </h1>
      </header>

      {/* Category tabs */}
      <div className="border-b border-black/5 px-4 pt-3 dark:border-white/5">
        <div className="inline-flex w-full rounded-2xl border border-black/10 bg-background/70 p-1 dark:border-white/10">
          {(["core_characters", "core_worldbuilding"] as const).map((cat) => {
            const Icon = cat === "core_characters" ? Users : Globe2;
            const label = cat === "core_characters" ? t("fandomLore.category.characters") : t("fandomLore.category.worldbuilding");
            const count = cat === "core_characters" ? characterFiles.length : worldbuildingFiles.length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={cn(
                  "flex min-h-[44px] flex-1 items-center justify-center rounded-xl text-sm font-medium transition-colors",
                  category === cat ? "bg-accent text-white" : "text-text/55",
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
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin text-accent" size={24} />
          </div>
        ) : currentFiles.length === 0 ? (
          <EmptyState
            icon={<FileText size={32} />}
            title={category === "core_characters" ? t("fandomLore.emptyCharacters.title") : t("fandomLore.emptyWorldbuilding.title")}
            description={category === "core_characters" ? t("fandomLore.emptyCharacters.description") : t("fandomLore.emptyWorldbuilding.description")}
            actions={[{
              key: "create",
              element: (
                <Button variant="primary" size="sm" onClick={() => { setCreateName(""); setCreateOpen(true); }}>
                  <Plus size={14} className="mr-1" />
                  {category === "core_characters" ? t("common.actions.addCharacter") : t("common.actions.addWorldbuilding")}
                </Button>
              ),
            }]}
          />
        ) : (
          currentFiles.map((file) => (
            <button
              key={file.filename}
              type="button"
              className="flex w-full items-center justify-between rounded-2xl border border-black/10 bg-surface/35 px-4 py-4 text-left transition-colors dark:border-white/10"
              onClick={() => handleSelectFile(file.filename, category)}
            >
              <div className="min-w-0">
                <p className="truncate text-base font-medium text-text">{file.name}</p>
                <p className="mt-1 text-xs text-text/45">{categoryLabel}</p>
              </div>
              <FileText size={16} className="ml-3 shrink-0 text-text/30" />
            </button>
          ))
        )}

        {/* Add button when list not empty */}
        {!loading && currentFiles.length > 0 && (
          <div className="pt-2">
            <Button variant="secondary" size="sm" className="w-full" onClick={() => { setCreateName(""); setCreateOpen(true); }}>
              <Plus size={14} className="mr-1" />
              {category === "core_characters" ? t("common.actions.addCharacter") : t("common.actions.addWorldbuilding")}
            </Button>
          </div>
        )}

        {/* TODO: TrashPanel crashes on fandom scope in WebAdapter — investigate and re-enable */}
      </div>

      {/* Create modal */}
      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title={category === "core_characters" ? t("fandomLore.createCharacterTitle") : t("fandomLore.createWorldbuildingTitle")}>
        <div className="space-y-4">
          <Input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder={category === "core_characters" ? t("fandomLore.characterPlaceholder") : t("fandomLore.worldbuildingPlaceholder")}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>{t("common.actions.cancel")}</Button>
            <Button variant="primary" onClick={handleCreate} disabled={!createName.trim() || saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : t("common.actions.create")}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
