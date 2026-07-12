// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useState } from "react";
import { deleteLore, listFandomFiles, readFandomFile, saveLore } from "../../api/engine-client";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";
import {
  buildDefaultFandomLoreContent,
  isLoreEditorDirty,
  toCanonicalCreateKey,
  type FandomLoreCategory,
} from "../library/lore-utils";

/**
 * useMobileFandomFileEditor — 圈子文件详情态：选中文件的读取 / 编辑 / 保存 / 新建 / 删除。
 *
 * createFile 返回新文件名（失败 null）、deleteSelected 返回是否成功——
 * 列表刷新（reload）由组件编排调用数据 hook，本 hook 不反向持有列表状态（hook 规则 3）。
 */
export function useMobileFandomFileEditor(fandomPath: string, fandomDirName: string) {
  const { t } = useTranslation();
  const { showError, showToast } = useFeedback();
  const readGuard = useActiveRequestGuard(`${fandomPath}:read`);
  // 写路径 guard（合并审阅：save/create/delete 原先无 guard，切圈子后迟到的成功分支
  // 会把旧圈正文写进新圈的 savedContent，污染脏判据）
  const writeGuard = useActiveRequestGuard(`${fandomPath}:write`);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<FandomLoreCategory>("core_characters");
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

  const openFile = async (filename: string, cat: FandomLoreCategory) => {
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
    const token = writeGuard.start();
    setSaving(true);
    try {
      await saveLore({
        fandom_path: fandomPath,
        category: selectedCategory,
        filename: selectedFile,
        content: editorContent,
      });
      if (writeGuard.isStale(token)) return; // 已切圈：写盘目标（旧圈）正确，但不许污染新圈状态
      setSavedContent(editorContent);
    } catch (error) {
      if (writeGuard.isStale(token)) return;
      showError(error, t("error_messages.unknown"));
    } finally {
      if (!writeGuard.isStale(token)) setSaving(false);
    }
  };

  const createFile = async (name: string, cat: FandomLoreCategory): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed || !fandomPath) return null;
    const token = writeGuard.start();
    setSaving(true);
    try {
      const displayName = trimmed.replace(/\.md$/i, "").trim();
      if (!displayName) return null;
      const filename = `${displayName}.md`;
      // 重名校验（合并审阅：桌面 createLore 有 canonical-key 去重，移动端原先缺失 →
      // 同名/大小写变体静默覆盖已有文件）。判据与桌面同源 toCanonicalCreateKey。
      const latest = await listFandomFiles(fandomDirName);
      if (writeGuard.isStale(token)) return null;
      const existing = cat === "core_characters" ? latest.characters : latest.worldbuilding;
      if (existing.some((file) => toCanonicalCreateKey(file.filename) === toCanonicalCreateKey(filename))) {
        showToast(t("fandomLore.createDuplicate", { name: filename }), "warning");
        return null;
      }
      // 模板与桌面同源（原先移动端硬编码且给 worldbuilding 塞多余 name frontmatter）
      await saveLore({
        fandom_path: fandomPath,
        category: cat,
        filename,
        content: buildDefaultFandomLoreContent(displayName),
      });
      if (writeGuard.isStale(token)) return null;
      return filename;
    } catch (error) {
      if (writeGuard.isStale(token)) return null;
      showError(error, t("error_messages.unknown"));
      return null;
    } finally {
      if (!writeGuard.isStale(token)) setSaving(false);
    }
  };

  const deleteSelected = async (): Promise<boolean> => {
    if (!selectedFile || !fandomPath) return false;
    const token = writeGuard.start();
    setSaving(true);
    try {
      await deleteLore({ fandom_path: fandomPath, category: selectedCategory, filename: selectedFile });
      if (writeGuard.isStale(token)) return false;
      setSelectedFile(null);
      return true;
    } catch (error) {
      if (writeGuard.isStale(token)) return false;
      showError(error, t("error_messages.unknown"));
      return false;
    } finally {
      if (!writeGuard.isStale(token)) setSaving(false);
    }
  };

  const isDirty = isLoreEditorDirty(selectedFile, editorContent, savedContent);

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
