// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from "react";
import { getFandomDisplayInfo, listFandomFiles, type FandomFileEntry } from "../../api/engine-client";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";
import type { FandomLoreCategory } from "../library/lore-utils";

/**
 * 圈子 lore 分类：真相源在 library/lore-utils.FandomLoreCategory（合并审阅：
 * 原先此处平行定义同字面 union，两个真相源会随分类增删静默漂移）。
 * re-export 保持既有 import 路径可用。
 */
export type FandomCategory = FandomLoreCategory;

/**
 * useMobileFandomFiles — 圈子视图的数据面：显示名 + 两类文件列表。
 * reload 供创建/删除/设定助手改动后刷新（语义化方法，hook 规则 3）。
 */
export function useMobileFandomFiles(fandomPath: string, fandomDirName: string) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const loadGuard = useActiveRequestGuard(`${fandomPath}:load`);

  const fallbackFandomName = fandomDirName || t("common.unknownFandom");
  const [fandomName, setFandomName] = useState(fallbackFandomName);
  const [characterFiles, setCharacterFiles] = useState<FandomFileEntry[]>([]);
  const [worldbuildingFiles, setWorldbuildingFiles] = useState<FandomFileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadFiles = useCallback(async () => {
    if (!fandomDirName) return;
    const token = loadGuard.start();
    setLoading(true);
    try {
      const [displayInfo, data] = await Promise.all([
        getFandomDisplayInfo(fandomPath).catch(() => null),
        listFandomFiles(fandomDirName),
      ]);
      if (loadGuard.isStale(token)) return;
      setFandomName(displayInfo?.name || fallbackFandomName);
      setCharacterFiles(data.characters);
      setWorldbuildingFiles(data.worldbuilding);
    } catch (error) {
      if (loadGuard.isStale(token)) return;
      showError(error, t("error_messages.unknown"));
    } finally {
      if (!loadGuard.isStale(token)) setLoading(false);
    }
  }, [fallbackFandomName, fandomDirName, fandomPath, loadGuard, showError, t]);

  // 切圈子：显示名先回退到目录名（加载期间不残留上一圈的名字），随即重拉
  useEffect(() => {
    setFandomName(fallbackFandomName);
    void loadFiles();
  }, [fallbackFandomName, loadFiles]);

  return { fandomName, characterFiles, worldbuildingFiles, loading, reload: loadFiles };
}
