// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useState } from "react";
import { deleteLore, readFandomFile, saveLore } from "../../api/engine-client";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";
import type { FandomCategory } from "./useMobileFandomFiles";

/**
 * useMobileFandomFileEditor — 圈子文件详情态：选中文件的读取 / 编辑 / 保存 / 新建 / 删除。
 *
 * createFile 返回新文件名（失败 null）、deleteSelected 返回是否成功——
 * 列表刷新（reload）由组件编排调用数据 hook，本 hook 不反向持有列表状态（hook 规则 3）。
 */
export function useMobileFandomFileEditor(fandomPath: string, fandomDirName: string) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const readGuard = useActiveRequestGuard(`${fandomPath}:read`);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<FandomCategory>("core_characters");
  const [editorContent, setEditorContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [previewMode, setPreviewMode] = useState(true);
  const [saving, setSaving] = useState(false);
  const [readingFile, setReadingFile] = useState(false);

  // 切圈子：详情态整体复位（不残留上一圈的选中文件）
  useEffect(() => {
    setSelectedFile(null);
    setSelectedCategory("core_characters");
    setEditorContent("");
    setSavedContent("");
    setPreviewMode(true);
    setSaving(false);
    setReadingFile(false);
  }, [fandomPath]);

  const openFile = async (filename: string, cat: FandomCategory) => {
    if (!fandomDirName) return;
    const token = readGuard.start();
    setSelectedFile(filename);
    setSelectedCategory(cat);
    setEditorContent("");
    setSavedContent("");
    setPreviewMode(true);
    setReadingFile(true);
    try {
      const result = await readFandomFile(fandomDirName, cat, filename);
      if (readGuard.isStale(token)) return;
      setEditorContent(result.content);
      setSavedContent(result.content);
    } catch (error) {
      if (readGuard.isStale(token)) return;
      showError(error, t("error_messages.unknown"));
      setSelectedFile(null);
    } finally {
      if (!readGuard.isStale(token)) setReadingFile(false);
    }
  };

  const closeFile = () => setSelectedFile(null);

  const showPreview = () => setPreviewMode(true);
  const showEditor = () => setPreviewMode(false);

  const save = async () => {
    if (!selectedFile || !fandomPath) return;
    setSaving(true);
    try {
      await saveLore({ fandom_path: fandomPath, category: selectedCategory, filename: selectedFile, content: editorContent });
      setSavedContent(editorContent);
    } catch (error) {
      showError(error, t("error_messages.unknown"));
    } finally {
      setSaving(false);
    }
  };

  const createFile = async (name: string, cat: FandomCategory): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed || !fandomPath) return null;
    setSaving(true);
    try {
      const filename = `${trimmed}.md`;
      const template = `---\nname: ${trimmed}\n---\n\n# ${trimmed}\n\n`;
      await saveLore({ fandom_path: fandomPath, category: cat, filename, content: template });
      return filename;
    } catch (error) {
      showError(error, t("error_messages.unknown"));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async (): Promise<boolean> => {
    if (!selectedFile || !fandomPath) return false;
    setSaving(true);
    try {
      await deleteLore({ fandom_path: fandomPath, category: selectedCategory, filename: selectedFile });
      setSelectedFile(null);
      return true;
    } catch (error) {
      showError(error, t("error_messages.unknown"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const isDirty = selectedFile !== null && editorContent !== savedContent;

  return {
    selectedFile,
    selectedCategory,
    editorContent,
    setEditorContent, // 受控绑定（textarea 双向绑定，hook 规则 5 例外①）
    previewMode,
    showPreview,
    showEditor,
    saving,
    readingFile,
    isDirty,
    openFile,
    closeFile,
    save,
    createFile,
    deleteSelected,
  };
}
