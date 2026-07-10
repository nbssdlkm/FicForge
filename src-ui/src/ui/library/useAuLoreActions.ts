// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useRef, useState } from 'react';
import {
  deleteLore as deleteLoreApi,
  getLoreContent,
  getProjectForEditing,
  importFromFandom,
  listLoreFiles,
  saveLore as saveLoreApi,
  saveProjectCoreIncludes,
  type ProjectInfo,
} from '../../api/engine-client';
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import { useFeedback } from '../../hooks/useFeedback';
import { useTranslation } from '../../i18n/useAppTranslation';
import {
  buildDefaultCharacterContent,
  buildDefaultWorldbuildingContent,
  deriveFandomPath,
  setAliasesInContent,
  toCanonicalCreateKey,
  type LoreCategory,
  type LoreFileEntry,
} from './lore-utils';

/**
 * useAuLoreActions 的跨 hook 依赖：值 + 语义化方法（hook 规则 1/3：不收裸 setter，
 * 修改他人 state 只调它暴露的动词方法）。整体经 ref shim 读取（规则 4），
 * 保证异步续段拿到 latest 值而非发起时的闭包快照。
 */
export type AuLoreActionDeps = {
  // 值
  project: ProjectInfo | null;
  files: LoreFileEntry[];
  selectedCategory: LoreCategory;
  selectedFile: string | null;
  editorContent: string;
  aliases: string[];
  // useAuLoreData 语义方法
  reload: () => Promise<void>;
  syncRegistry: (names: string[], requestAuPath: string) => Promise<void>;
  applyCoreIncludes: (next: string[]) => void;
  addFileEntry: (category: LoreCategory, entry: LoreFileEntry) => void;
  removeFileEntry: (category: LoreCategory, name: string) => void;
  bumpTrashRefresh: () => void;
  // useAuLoreEditor 语义方法
  applyCreated: (name: string, category: LoreCategory, content: string) => void;
  markContentSaved: () => void;
  closeFile: () => void;
  clearSearch: () => void;
  // useAuLoreModals 语义方法
  closeCreate: () => void;
  closeDeleteConfirm: () => void;
  closeImport: () => void;
  promptCoreLimit: (name: string) => void;
};

/**
 * useAuLoreActions — 设定集页全部写路径（保存/删除/新建/导入/pin）+ 导入候选流。
 *
 * isSaving 是横跨五个 mutation 的互斥闸（列表/编辑器/弹窗按钮统一禁用），
 * 单一 owner 只能有一个——这也是五个 mutation 收在同一个 hook 的原因。
 */
export function useAuLoreActions(auPath: string, deps: AuLoreActionDeps) {
  const { t } = useTranslation();
  const { showError, showSuccess, showToast } = useFeedback();
  const guard = useActiveRequestGuard(auPath);

  const depsRef = useRef(deps);
  depsRef.current = deps;

  const [isSaving, setIsSaving] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importCandidates, setImportCandidates] = useState<LoreFileEntry[]>([]);
  const [selectedImports, setSelectedImports] = useState<string[]>([]);

  // 切 AU：复位 in-flight 标志与导入流
  useEffect(() => {
    setIsSaving(false);
    setImportLoading(false);
    setImportCandidates([]);
    setSelectedImports([]);
  }, [auPath]);

  /** pin/unpin 必带角色；pin 且正文缺「核心限制」段落时弹引导（不阻塞 pin 本身）。 */
  const togglePin = async (name: string) => {
    if (!depsRef.current.project || isSaving) return;
    const requestAuPath = auPath;
    setIsSaving(true);
    try {
      const current = depsRef.current.project.core_always_include || [];
      const isPinned = current.includes(name);

      let next: string[];
      if (isPinned) {
        next = current.filter((n) => n !== name);
      } else {
        next = [...current, name];
        // 检测核心限制段落
        try {
          const result = await getLoreContent({ au_path: auPath, category: 'characters', filename: `${name}.md` });
          if (guard.isKeyStale(requestAuPath)) return;
          if (!result.content.includes('## 核心限制') && !result.content.includes('## Core Constraints')) {
            depsRef.current.promptCoreLimit(name);
          }
        } catch { /* 读取失败不阻塞 */ }
      }

      await saveProjectCoreIncludes(auPath, next);
      if (guard.isKeyStale(requestAuPath)) return;
      depsRef.current.applyCoreIncludes(next);
      showSuccess(isPinned ? t('coreIncludes.unpinnedToast') : t('coreIncludes.pinnedToast'));
    } catch (error) {
      if (guard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!guard.isKeyStale(requestAuPath)) {
        setIsSaving(false);
      }
    }
  };

  /** 保存当前打开的文件（characters 分类先把别名写回 frontmatter）。 */
  const saveCurrentFile = async () => {
    const { selectedFile, selectedCategory, editorContent, aliases } = depsRef.current;
    if (!selectedFile) return;
    const requestAuPath = auPath;
    setIsSaving(true);
    try {
      const contentToSave = selectedCategory === 'characters'
        ? setAliasesInContent(editorContent, aliases)
        : editorContent;
      await saveLoreApi({
        au_path: auPath,
        category: selectedCategory,
        filename: `${selectedFile}.md`,
        content: contentToSave,
      });
      if (guard.isKeyStale(requestAuPath)) return;
      // 落盘成功 → 刷新编辑器脏判据基线（reconcile 据此决定能否安全重读）
      depsRef.current.markContentSaved();
      showSuccess(t('common.actions.save'));
    } catch (error) {
      if (guard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!guard.isKeyStale(requestAuPath)) {
        setIsSaving(false);
      }
    }
  };

  /** 删除当前文件：落盘删除 → registry / 必带角色清理 → 列表与编辑器收尾。 */
  const deleteCurrentFile = async () => {
    const d = depsRef.current;
    if (!d.selectedFile || !d.project) return;
    const requestAuPath = auPath;
    const target = d.selectedFile;
    const category = d.selectedCategory;
    d.closeDeleteConfirm();
    setIsSaving(true);
    try {
      await deleteLoreApi({ au_path: auPath, category, filename: `${target}.md` });
      if (guard.isKeyStale(requestAuPath)) return;

      const remainingNames = (d.project.cast_registry.characters || []).filter((name) => name !== target);
      await d.syncRegistry(remainingNames, requestAuPath);
      if (guard.isKeyStale(requestAuPath)) return;
      // 同时清理 core_always_include 中的已删除角色
      const pins = d.project.core_always_include || [];
      const remainingPins = pins.filter((n) => n !== target);
      if (remainingPins.length !== pins.length) {
        await saveProjectCoreIncludes(auPath, remainingPins);
        if (guard.isKeyStale(requestAuPath)) return;
        depsRef.current.applyCoreIncludes(remainingPins);
      }
      depsRef.current.removeFileEntry(category, target);
      depsRef.current.closeFile();
      depsRef.current.bumpTrashRefresh();
    } catch (error) {
      if (guard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!guard.isKeyStale(requestAuPath)) {
        setIsSaving(false);
      }
    }
  };

  /** 新建文件：查重 → 落盘 → characters 同步 registry（失败回滚删文件）→ 打开编辑。 */
  const createFile = async (rawInput: string) => {
    const rawName = rawInput.trim();
    if (!rawName) return;
    const requestAuPath = auPath;
    const category = depsRef.current.selectedCategory;
    const displayName = rawName.replace(/\.md$/i, '').trim();
    if (!displayName) {
      showToast(t('settingsMode.validation.nameRequired'), 'warning');
      return;
    }

    const filename = `${displayName}.md`;
    const defaultContent = category === 'worldbuilding'
      ? buildDefaultWorldbuildingContent(displayName)
      : buildDefaultCharacterContent(displayName);
    depsRef.current.closeCreate();
    setIsSaving(true);

    try {
      let latestProject: ProjectInfo;
      let latestFiles: { files: LoreFileEntry[] };
      try {
        [latestProject, latestFiles] = await Promise.all([
          getProjectForEditing(auPath),
          listLoreFiles({ au_path: auPath, category }),
        ]);
      } catch (error) {
        if (guard.isKeyStale(requestAuPath)) return;
        showError(error, t('error_messages.unknown'));
        return;
      }
      if (guard.isKeyStale(requestAuPath)) return;

      if (latestFiles.files.some((file) => toCanonicalCreateKey(file.filename) === toCanonicalCreateKey(filename))) {
        showToast(t('auLore.createDuplicate', { name: filename }), 'warning');
        return;
      }

      await saveLoreApi({ au_path: auPath, category, filename, content: defaultContent });
      try {
        if (category === 'characters') {
          await depsRef.current.syncRegistry(
            [...(latestProject.cast_registry.characters || []), displayName],
            requestAuPath,
          );
        }
      } catch (error) {
        // registry 同步失败 → 回滚刚写入的文件，避免「文件在、registry 没有」的半成功
        try {
          await deleteLoreApi({ au_path: auPath, category, filename });
        } catch {
          throw error;
        }
        throw error;
      }
      if (guard.isKeyStale(requestAuPath)) return;
      depsRef.current.addFileEntry(category, { name: displayName, filename });
      depsRef.current.applyCreated(displayName, category, defaultContent);
      depsRef.current.clearSearch();
    } catch (error) {
      if (guard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!guard.isKeyStale(requestAuPath)) {
        setIsSaving(false);
      }
    }
  };

  /** 打开导入弹窗后拉候选（原著 core_characters 里排除本 AU 已有的角色）。 */
  const loadImportCandidates = async () => {
    const requestAuPath = auPath;
    setImportLoading(true);
    setSelectedImports([]);
    try {
      const fandomFiles = await listLoreFiles({ fandom_path: deriveFandomPath(auPath), category: 'core_characters' });
      if (guard.isKeyStale(requestAuPath)) return;
      const existing = new Set(depsRef.current.files.map((file) => file.name));
      setImportCandidates(fandomFiles.files.filter((file) => !existing.has(file.name)));
    } catch (error) {
      if (guard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
      setImportCandidates([]);
    } finally {
      if (!guard.isKeyStale(requestAuPath)) {
        setImportLoading(false);
      }
    }
  };

  /** 勾选/取消勾选导入候选。 */
  const toggleImport = (name: string) => {
    setSelectedImports((prev) => (prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]));
  };

  /** 导入所选角色 → 同步 registry → 全量 reload（bump loadKey 触发 editor reconcile）。 */
  const importSelected = async () => {
    const d = depsRef.current;
    if (selectedImports.length === 0 || !d.project) return;
    const requestAuPath = auPath;
    setIsSaving(true);
    try {
      await importFromFandom({
        fandom_path: deriveFandomPath(auPath),
        au_path: auPath,
        filenames: selectedImports.map((name) => `${name}.md`),
        source_category: 'core_characters',
      });
      if (guard.isKeyStale(requestAuPath)) return;
      await d.syncRegistry([...(d.project.cast_registry.characters || []), ...selectedImports], requestAuPath);
      if (guard.isKeyStale(requestAuPath)) return;
      depsRef.current.closeImport();
      setSelectedImports([]);
      showSuccess(t('auLore.importSuccess', { count: selectedImports.length }));
      await depsRef.current.reload();
    } catch (error) {
      if (guard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!guard.isKeyStale(requestAuPath)) {
        setIsSaving(false);
      }
    }
  };

  return {
    isSaving,
    importLoading,
    importCandidates,
    selectedImports,
    togglePin,
    saveCurrentFile,
    deleteCurrentFile,
    createFile,
    loadImportCandidates,
    toggleImport,
    importSelected,
  };
}
