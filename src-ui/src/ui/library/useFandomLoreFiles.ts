// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from 'react';
import {
  getFandomDisplayInfo,
  listFandomFiles,
  type FandomFileEntry,
  type TrashEntry,
} from '../../api/engine-client';
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import { useFeedback } from '../../hooks/useFeedback';
import { useTranslation } from '../../i18n/useAppTranslation';
import { fandomDirNameOf, type FandomLoreCategory } from './lore-utils';

export type FandomFileLists = {
  characters: FandomFileEntry[];
  worldbuilding: FandomFileEntry[];
};

function getRestoredFandomFile(entry: TrashEntry): { category: FandomLoreCategory; file: FandomFileEntry } | null {
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

/**
 * useFandomLoreFiles — Fandom 资料页侧栏数据（两类文件列表 / 显示名 / 垃圾箱刷新）。
 *
 * 编辑器操作（新建/删除）经下方语义化方法改列表（hook 规则 3），不拿 setter；
 * 乐观更新前先 invalidateInflightLoad 作废在途 loadFiles，防旧响应回写覆盖。
 */
export function useFandomLoreFiles(fandomPath: string | undefined) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const contextKey = fandomPath ?? '';
  const guard = useActiveRequestGuard(contextKey);
  const fandomDirName = fandomDirNameOf(fandomPath);
  const fallbackFandomName = fandomDirName || t('common.unknownFandom');

  const [characterFiles, setCharacterFiles] = useState<FandomFileEntry[]>([]);
  const [worldbuildingFiles, setWorldbuildingFiles] = useState<FandomFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fandomName, setFandomName] = useState(fallbackFandomName);
  // 故意不随 fandom 切换复位：TrashPanel 自己随 path 重拉，token 只负责「删除后刷新」
  const [trashRefreshToken, setTrashRefreshToken] = useState(0);

  // 切 fandom 复位（hook 规则 2：state 与 reset 同文件）
  useEffect(() => {
    setCharacterFiles([]);
    setWorldbuildingFiles([]);
    setFilesLoading(false);
    setFandomName(fallbackFandomName);
  }, [fallbackFandomName, fandomPath]);

  const loadFiles = useCallback(async (): Promise<FandomFileLists | null> => {
    if (!fandomPath || !fandomDirName) return null;
    const token = guard.start();
    setFilesLoading(true);
    try {
      const [displayInfo, data] = await Promise.all([
        getFandomDisplayInfo(fandomPath).catch(() => null),
        listFandomFiles(fandomDirName),
      ]);
      if (guard.isStale(token)) return null;
      setFandomName(displayInfo?.name || fallbackFandomName);
      setCharacterFiles(data.characters);
      setWorldbuildingFiles(data.worldbuilding);
      return data;
    } catch (e) {
      if (guard.isStale(token)) return null;
      showError(e, t('error_messages.unknown'));
      return null;
    } finally {
      if (!guard.isStale(token)) {
        setFilesLoading(false);
      }
    }
  }, [fandomPath, fandomDirName, fallbackFandomName, guard, showError, t]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  /** 新建成功后把新文件追加进对应分类（乐观更新，不重拉） */
  const appendFile = useCallback((category: FandomLoreCategory, file: FandomFileEntry) => {
    if (category === 'core_characters') setCharacterFiles((prev) => [...prev, file]);
    else setWorldbuildingFiles((prev) => [...prev, file]);
  }, []);

  /** 删除成功后从对应分类移除 */
  const removeFile = useCallback((category: FandomLoreCategory, filename: string) => {
    if (category === 'core_characters') setCharacterFiles((prev) => prev.filter((f) => f.filename !== filename));
    else setWorldbuildingFiles((prev) => prev.filter((f) => f.filename !== filename));
  }, []);

  /** 新建前重名校验拉到的最新列表整体回填 */
  const applyFileLists = useCallback((data: FandomFileLists) => {
    setCharacterFiles(data.characters);
    setWorldbuildingFiles(data.worldbuilding);
  }, []);

  /** 作废在途 loadFiles（增删乐观更新前调用，防旧响应回写覆盖） */
  const invalidateInflightLoad = useCallback(() => {
    guard.start();
  }, [guard]);

  /** 删除落库后驱动 TrashPanel 重拉 */
  const bumpTrashRefresh = useCallback(() => {
    setTrashRefreshToken((current) => current + 1);
  }, []);

  /** 垃圾箱恢复回调：恢复的文件插回列表并排序。闭包 contextKey 防切 fandom 后旧回调误写 */
  const applyTrashRestore = useCallback((entry: TrashEntry) => {
    if (guard.isKeyStale(contextKey)) return;

    const restored = getRestoredFandomFile(entry);
    if (!restored) return;

    const applyRestore = (prev: FandomFileEntry[]) => {
      if (prev.some((file) => file.filename === restored.file.filename)) return prev;
      return [...prev, restored.file].sort((left, right) => left.name.localeCompare(right.name));
    };

    if (restored.category === 'core_characters') setCharacterFiles(applyRestore);
    else setWorldbuildingFiles(applyRestore);
  }, [contextKey, guard]);

  return {
    fandomName,
    characterFiles,
    worldbuildingFiles,
    filesLoading,
    trashRefreshToken,
    loadFiles,
    appendFile,
    removeFile,
    applyFileLists,
    invalidateInflightLoad,
    bumpTrashRefresh,
    applyTrashRestore,
  };
}
