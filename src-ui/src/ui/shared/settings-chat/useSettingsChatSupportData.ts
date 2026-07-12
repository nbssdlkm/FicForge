// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getProjectForEditing, listLoreFiles, type ProjectInfo } from "../../../api/engine-client";
import { useActiveRequestGuard } from "../../../hooks/useActiveRequestGuard";
import { useFeedback } from "../../../hooks/useFeedback";
import { useTranslation } from "../../../i18n/useAppTranslation";
import type { LoreFileOption, SettingsMode } from "./types";

/**
 * useSettingsChatSupportData — 设定对话的支撑数据（project / 角色卡 / 世界观清单）。
 *
 * state 供渲染（工具卡的存在性/重复预警），ref 是 freshness 缓存供 async 闭包
 * 同步读：executeSettingsTool 执行前会重拉最新清单并经 cacheLatest* 语义化回写
 * （只写 ref 不 setState —— 状态本身等执行后 loadSupportData 统一刷新）。
 * ref 的取值语义 = max(最近一次 state 落地, 最近一次 cacheLatest* 回写)。
 */
export function useSettingsChatSupportData(mode: SettingsMode, basePath?: string) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const guard = useActiveRequestGuard(`support:${mode}:${basePath ?? ""}`);

  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const projectInfoRef = useRef<ProjectInfo | null>(null);
  const [characterFiles, setCharacterFiles] = useState<LoreFileOption[]>([]);
  const [worldbuildingFiles, setWorldbuildingFiles] = useState<LoreFileOption[]>([]);
  const characterFilesRef = useRef<LoreFileOption[]>([]);
  const worldbuildingFilesRef = useRef<LoreFileOption[]>([]);

  useEffect(() => {
    projectInfoRef.current = projectInfo;
  }, [projectInfo]);

  useEffect(() => {
    characterFilesRef.current = characterFiles;
  }, [characterFiles]);

  useEffect(() => {
    worldbuildingFilesRef.current = worldbuildingFiles;
  }, [worldbuildingFiles]);

  // 切上下文 reset（铁律②：state 与 reset 同文件）；ref 同步清，避免加载间隙读到上一篇
  useEffect(() => {
    setProjectInfo(null);
    projectInfoRef.current = null;
    setCharacterFiles([]);
    characterFilesRef.current = [];
    setWorldbuildingFiles([]);
    worldbuildingFilesRef.current = [];
  }, [basePath, mode]);

  const loadSupportData = useCallback(async () => {
    if (!basePath) return;
    const token = guard.start();

    try {
      if (mode === "au") {
        const [project, characters, worldbuilding] = await Promise.all([
          getProjectForEditing(basePath).catch(() => null),
          listLoreFiles({ au_path: basePath, category: "characters" }).catch(() => ({ files: [] })),
          listLoreFiles({ au_path: basePath, category: "worldbuilding" }).catch(() => ({ files: [] })),
        ]);
        if (guard.isStale(token)) return;
        setProjectInfo(project);
        setCharacterFiles(characters.files);
        characterFilesRef.current = characters.files;
        setWorldbuildingFiles(worldbuilding.files);
        worldbuildingFilesRef.current = worldbuilding.files;
        return;
      }

      const [characters, worldbuilding] = await Promise.all([
        listLoreFiles({ fandom_path: basePath, category: "core_characters" }).catch(() => ({ files: [] })),
        listLoreFiles({ fandom_path: basePath, category: "core_worldbuilding" }).catch(() => ({ files: [] })),
      ]);
      if (guard.isStale(token)) return;
      setProjectInfo(null);
      setCharacterFiles(characters.files);
      characterFilesRef.current = characters.files;
      setWorldbuildingFiles(worldbuilding.files);
      worldbuildingFilesRef.current = worldbuilding.files;
    } catch (error) {
      if (guard.isStale(token)) return;
      showError(error, t("error_messages.unknown"));
    }
  }, [basePath, mode, showError, guard, t]);

  useEffect(() => {
    void loadSupportData();
  }, [loadSupportData]);

  // 渲染用派生集合（工具卡预警判据）
  const existingCharacterFileNames = useMemo(
    () => new Set(characterFiles.map((file) => file.filename)),
    [characterFiles],
  );
  const existingWorldbuildingFileNames = useMemo(
    () => new Set(worldbuildingFiles.map((file) => file.filename)),
    [worldbuildingFiles],
  );
  const existingPinnedTexts = projectInfo?.pinned_context || [];
  const availableCharacterNames = useMemo(() => characterFiles.map((file) => file.name), [characterFiles]);
  const availableCharacterNameSet = useMemo(() => new Set(availableCharacterNames), [availableCharacterNames]);

  // 语义化注入（hook 规则 3 的 bridge 例外）：见文件头 freshness 缓存说明
  const cacheLatestLoreFiles = useCallback((characters: LoreFileOption[], worldbuilding: LoreFileOption[]) => {
    characterFilesRef.current = characters;
    worldbuildingFilesRef.current = worldbuilding;
  }, []);
  const cacheLatestProject = useCallback((project: ProjectInfo) => {
    projectInfoRef.current = project;
  }, []);

  // async 闭包的同步读口（不暴露 raw ref）
  const getLatestProject = useCallback(() => projectInfoRef.current, []);
  const getLatestLoreFiles = useCallback(
    () => ({
      characters: characterFilesRef.current,
      worldbuilding: worldbuildingFilesRef.current,
    }),
    [],
  );

  return {
    existingCharacterFileNames,
    existingWorldbuildingFileNames,
    existingPinnedTexts,
    availableCharacterNames,
    availableCharacterNameSet,
    loadSupportData,
    cacheLatestLoreFiles,
    cacheLatestProject,
    getLatestProject,
    getLatestLoreFiles,
  };
}

export type SettingsChatSupportData = ReturnType<typeof useSettingsChatSupportData>;
