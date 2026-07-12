// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from "react";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import {
  getProjectForEditing,
  listLoreFiles,
  saveProjectCastRegistryCharacters,
  type ProjectInfo,
} from "../../api/engine-client";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";
import type { LoreCategory, LoreFileEntry } from "./lore-utils";

/**
 * useAuLoreData — AU 设定集页的数据层（project / 角色文件列表 / 世界观文件列表）。
 *
 * loadKey：每次全量加载成功 +1，是 editor hook 重对齐（reconcile）选中文件的唯一
 * 触发信号。文件列表的局部更新（新建/删除/回收站恢复）走语义化方法、不 bump loadKey——
 * 只有全量重拉（切 AU / 导入成功后 reload）才需要 editor 重新校验选中文件是否仍存在。
 */
export function useAuLoreData(auPath: string) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const guard = useActiveRequestGuard(auPath);

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [files, setFiles] = useState<LoreFileEntry[]>([]);
  const [worldbuildingFiles, setWorldbuildingFiles] = useState<LoreFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadKey, setLoadKey] = useState(0);
  const [trashRefreshToken, setTrashRefreshToken] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 有意省依赖——hook 规则 4 ref-shim/边沿触发语义（见邻近注释）
  const reload = useCallback(async () => {
    const token = guard.start();
    setLoading(true);
    try {
      // files 固定拉 characters：旧实现误用当时的 selectedCategory 拉这份列表，
      // 用户停在世界观分类时切 AU / 导入会把世界观列表灌进角色区
      const [proj, characterFiles, wbFiles] = await Promise.all([
        getProjectForEditing(auPath),
        listLoreFiles({ au_path: auPath, category: "characters" }),
        listLoreFiles({ au_path: auPath, category: "worldbuilding" }),
      ]);
      if (guard.isStale(token)) return;
      setProject(proj);
      setFiles(characterFiles.files);
      setWorldbuildingFiles(wbFiles.files);
      // 与列表同一 commit 递增，保证 editor reconcile 读到的列表已是本次结果
      setLoadKey((k) => k + 1);
    } catch (error) {
      if (guard.isStale(token)) return;
      showError(error, t("error_messages.unknown"));
    } finally {
      if (!guard.isStale(token)) {
        setLoading(false);
      }
    }
    // guard/showError/t 均为稳定引用，重拉只应随 auPath 变化
  }, [auPath]);

  // 切 AU：清掉上一篇的数据再重拉（loading 期间全屏 spinner 遮挡，不闪旧列表）
  useEffect(() => {
    if (!auPath) return;
    setProject(null);
    setFiles([]);
    setWorldbuildingFiles([]);
    void reload();
  }, [auPath, reload]);

  /**
   * 持久化 cast registry 并同步本地 project 快照（语义化注入，hook 规则 3 的 bridge 例外）。
   * requestAuPath 是调用方发起操作时的快照，中途切 AU 则丢弃本地更新。
   */
  const syncRegistry = useCallback(
    async (names: string[], requestAuPath: string) => {
      const deduped = Array.from(new Set(names));
      await saveProjectCastRegistryCharacters(requestAuPath, deduped);
      if (guard.isKeyStale(requestAuPath)) return;
      setProject((prev) => (prev ? { ...prev, cast_registry: { ...prev.cast_registry, characters: deduped } } : prev));
    },
    [guard],
  );

  /** pin 持久化成功后局部同步 core_always_include（不重灌列表）。 */
  const applyCoreIncludes = useCallback((next: string[]) => {
    setProject((prev) => (prev ? { ...prev, core_always_include: next } : prev));
  }, []);

  /** 新建成功后把文件插入对应列表（保持字典序）。 */
  const addFileEntry = useCallback((category: LoreCategory, entry: LoreFileEntry) => {
    const setTarget = category === "worldbuilding" ? setWorldbuildingFiles : setFiles;
    setTarget((prev) => [...prev, entry].sort((a, b) => a.name.localeCompare(b.name)));
  }, []);

  /** 删除成功后把文件从对应列表移除。 */
  const removeFileEntry = useCallback((category: LoreCategory, name: string) => {
    const setTarget = category === "worldbuilding" ? setWorldbuildingFiles : setFiles;
    setTarget((prev) => prev.filter((file) => file.name !== name));
  }, []);

  /** 回收站恢复了角色文件：插回列表 + 补回 cast registry（磁盘已恢复，这里对齐本地快照）。 */
  const restoreCharacterFile = useCallback((file: LoreFileEntry) => {
    setFiles((prev) => {
      if (prev.some((existing) => existing.filename === file.filename)) return prev;
      return [...prev, file].sort((left, right) => left.name.localeCompare(right.name));
    });
    setProject((prev) => {
      if (!prev) return prev;
      const characters = prev.cast_registry.characters || [];
      if (characters.includes(file.name)) return prev;
      return {
        ...prev,
        cast_registry: { ...prev.cast_registry, characters: [...characters, file.name] },
      };
    });
  }, []);

  /** 删除落回收站后 bump，驱动 TrashPanel 重拉。 */
  const bumpTrashRefresh = useCallback(() => setTrashRefreshToken((v) => v + 1), []);

  return {
    project,
    files,
    worldbuildingFiles,
    loading,
    loadKey,
    trashRefreshToken,
    reload,
    syncRegistry,
    applyCoreIncludes,
    addFileEntry,
    removeFileEntry,
    restoreCharacterFile,
    bumpTrashRefresh,
  };
}
