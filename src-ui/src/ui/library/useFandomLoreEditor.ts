// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from "react";
import { deleteLore, listFandomFiles, readFandomFile, saveLore, type FandomFileEntry } from "../../api/engine-client";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";
import {
  buildDefaultFandomLoreContent,
  fandomDirNameOf,
  isLoreEditorDirty,
  toCanonicalCreateKey,
  type FandomLoreCategory,
} from "./lore-utils";
import type { useFandomLoreFiles } from "./useFandomLoreFiles";

type FandomLoreFilesApi = ReturnType<typeof useFandomLoreFiles>;

/**
 * useFandomLoreEditor — Fandom 资料编辑器（选中文件 / 内容 / 忙碌态）+ 增删改读四个操作。
 *
 * 操作改侧栏列表走 files 的语义化方法（hook 规则 3）；files 以整个 hook 返回对象注入，
 * 编辑器函数与原实现一样逐 render 重建，不进任何 dep 数组，故注入对象身份不稳无碍。
 */
export function useFandomLoreEditor(fandomPath: string | undefined, files: FandomLoreFilesApi) {
  const { t } = useTranslation();
  const { showError, showToast } = useFeedback();
  const contextKey = fandomPath ?? "";
  const fandomDirName = fandomDirNameOf(fandomPath);
  // 单实例双语义：start/isStale 保 openFile latest-wins；isKeyStale 做「是否已离开此 fandom」
  // 导航检查（合并审阅：原先同 key 开两个 guard，第二个的 id 计数器是死代码，已并一）。
  const selectFileGuard = useActiveRequestGuard(contextKey);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<FandomLoreCategory>("core_characters");
  const [editorContent, setEditorContent] = useState("");
  const [savedEditorContent, setSavedEditorContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [settingsChatBusy, setSettingsChatBusy] = useState(false);
  // 故意不随 fandom 切换复位（原行为：仅新建成功后切到编辑态）
  const [previewMode, setPreviewMode] = useState(true);

  // 切 fandom 复位（hook 规则 2：state 与 reset 同文件）
  useEffect(() => {
    setSelectedFile(null);
    setSelectedCategory("core_characters");
    setEditorContent("");
    setSavedEditorContent("");
    setIsSaving(false);
    setIsReadingFile(false);
    setSettingsChatBusy(false);
  }, [fandomPath]);

  const isEditorDirty = isLoreEditorDirty(selectedFile, editorContent, savedEditorContent);
  const editorBusy = isSaving || isReadingFile || settingsChatBusy;
  const settingsChatDisabled = isSaving || isReadingFile || isEditorDirty;

  const openFile = async (filename: string, category: FandomLoreCategory) => {
    if (!fandomDirName) return;
    const token = selectFileGuard.start();
    setSelectedFile(filename);
    setSelectedCategory(category);
    setEditorContent("");
    setSavedEditorContent("");
    setIsReadingFile(true);
    try {
      const result = await readFandomFile(fandomDirName, category, filename);
      if (selectFileGuard.isStale(token)) return;
      setEditorContent(result.content);
      setSavedEditorContent(result.content);
      setIsReadingFile(false);
    } catch {
      if (selectFileGuard.isStale(token)) return;
      setSelectedFile(null);
      setEditorContent("");
      setSavedEditorContent("");
      setIsReadingFile(false);
    }
  };

  const saveSelectedLore = async () => {
    if (!selectedFile || !fandomPath) return;
    const contextSnapshot = contextKey;
    setIsSaving(true);
    try {
      await saveLore({
        fandom_path: fandomPath,
        category: selectedCategory,
        filename: selectedFile,
        content: editorContent,
      });
      if (selectFileGuard.isKeyStale(contextSnapshot)) {
        setIsSaving(false);
        return;
      }
      setSavedEditorContent(editorContent);
    } catch (e) {
      if (selectFileGuard.isKeyStale(contextSnapshot)) {
        setIsSaving(false);
        return;
      }
      showError(e, t("error_messages.unknown"));
    } finally {
      if (!selectFileGuard.isKeyStale(contextSnapshot)) {
        setIsSaving(false);
      }
    }
  };

  /**
   * 新建资料。校验（空名/重名/拉最新列表失败）不通过时弹窗保持打开；
   * 校验通过后经 closeCreateModal 关弹窗再落库（弹窗归 chrome hook，只借语义化关闭方法）。
   */
  const createLore = async (rawInput: string, category: FandomLoreCategory, closeCreateModal: () => void) => {
    const rawName = rawInput.trim();
    if (!rawName || !fandomPath) return;
    const contextSnapshot = contextKey;
    setIsSaving(true);

    const displayName = rawName.replace(/\.md$/i, "").trim();
    if (!displayName) {
      showToast(t("settingsMode.validation.nameRequired"), "warning");
      setIsSaving(false);
      return;
    }
    const filename = `${displayName}.md`;
    let latestFiles: { characters: FandomFileEntry[]; worldbuilding: FandomFileEntry[] } | null = null;

    try {
      latestFiles = await listFandomFiles(fandomDirName);
      if (selectFileGuard.isKeyStale(contextSnapshot)) {
        setIsSaving(false);
        return;
      }
      files.applyFileLists(latestFiles);
    } catch (e) {
      if (selectFileGuard.isKeyStale(contextSnapshot)) {
        setIsSaving(false);
        return;
      }
      showError(e, t("error_messages.unknown"));
      setIsSaving(false);
      return;
    }

    const existingFiles = category === "core_characters" ? latestFiles.characters : latestFiles.worldbuilding;
    if (existingFiles.some((file) => toCanonicalCreateKey(file.filename) === toCanonicalCreateKey(filename))) {
      showToast(t("fandomLore.createDuplicate", { name: filename }), "warning");
      setIsSaving(false);
      return;
    }

    const defaultContent = buildDefaultFandomLoreContent(displayName);

    closeCreateModal();
    selectFileGuard.start();
    try {
      await saveLore({
        fandom_path: fandomPath,
        category,
        filename,
        content: defaultContent,
      });
      if (selectFileGuard.isKeyStale(contextSnapshot)) return;
      setSelectedFile(filename);
      setSelectedCategory(category);
      setPreviewMode(false);
      setEditorContent(defaultContent);
      setSavedEditorContent(defaultContent);
      setIsReadingFile(false);
      files.appendFile(category, { name: displayName, filename });
    } catch (e) {
      if (selectFileGuard.isKeyStale(contextSnapshot)) return;
      showError(e, t("error_messages.unknown"));
    } finally {
      if (!selectFileGuard.isKeyStale(contextSnapshot)) {
        setIsSaving(false);
      }
    }
  };

  const deleteSelectedLore = async () => {
    if (!selectedFile || !fandomPath) return;
    const contextSnapshot = contextKey;
    setIsSaving(true);
    selectFileGuard.start();
    try {
      await deleteLore({
        fandom_path: fandomPath,
        category: selectedCategory,
        filename: selectedFile,
      });
      if (selectFileGuard.isKeyStale(contextSnapshot)) {
        setIsSaving(false);
        return;
      }
      files.removeFile(selectedCategory, selectedFile);
      setSelectedFile(null);
      setEditorContent("");
      setSavedEditorContent("");
      setIsReadingFile(false);
      files.bumpTrashRefresh();
    } catch (e) {
      if (selectFileGuard.isKeyStale(contextSnapshot)) {
        setIsSaving(false);
        return;
      }
      showError(e, t("error_messages.unknown"));
    } finally {
      if (!selectFileGuard.isKeyStale(contextSnapshot)) {
        setIsSaving(false);
      }
    }
  };

  /** 对话面板 onAfterMutation 发现当前文件已被移除时，清空右侧编辑区 */
  const clearSelection = useCallback(() => {
    setSelectedFile(null);
    setEditorContent("");
    setSavedEditorContent("");
  }, []);

  const showEditMode = useCallback(() => setPreviewMode(false), []);
  const showPreviewMode = useCallback(() => setPreviewMode(true), []);

  /** SettingsChatPanel onBusyChange 回调（子组件忙碌态上报，动词命名 — hook 规则 5） */
  const markSettingsChatBusy = useCallback((busy: boolean) => setSettingsChatBusy(busy), []);

  return {
    selectedFile,
    selectedCategory,
    editorContent,
    isSaving,
    isReadingFile,
    previewMode,
    isEditorDirty,
    editorBusy,
    settingsChatDisabled,
    setEditorContent, // 受控绑定（正文 textarea 双向绑定 — hook 规则 5 例外①）
    openFile,
    saveSelectedLore,
    createLore,
    deleteSelectedLore,
    clearSelection,
    showEditMode,
    showPreviewMode,
    markSettingsChatBusy,
  };
}
