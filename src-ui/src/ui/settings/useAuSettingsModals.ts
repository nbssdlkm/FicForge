// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from "react";

/**
 * useAuSettingsModals — AU 设置页四个弹窗的开关（对齐 useWriterChromeState 形态）。
 * 切 AU 全部复位，语义化 open/close，不暴露 raw setter。
 */
export function useAuSettingsModals(auPath: string) {
  const [isGlobalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [isCoreIncludeOpen, setCoreIncludeOpen] = useState(false);
  const [isBackfillOpen, setBackfillOpen] = useState(false);
  const [isArchiveOpen, setArchiveOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——体内全是 setter（非依赖），仅应随 auPath 变化关闭所有弹窗；biome 判 auPath 多余，删掉会导致切 AU 不再复位（残留上一篇打开的弹窗）
  useEffect(() => {
    setGlobalSettingsOpen(false);
    setCoreIncludeOpen(false);
    setBackfillOpen(false);
    setArchiveOpen(false);
  }, [auPath]);

  const openGlobalSettings = useCallback(() => setGlobalSettingsOpen(true), []);
  const closeGlobalSettings = useCallback(() => setGlobalSettingsOpen(false), []);
  const openCoreInclude = useCallback(() => setCoreIncludeOpen(true), []);
  const closeCoreInclude = useCallback(() => setCoreIncludeOpen(false), []);
  const openBackfill = useCallback(() => setBackfillOpen(true), []);
  const closeBackfill = useCallback(() => setBackfillOpen(false), []);
  const openArchive = useCallback(() => setArchiveOpen(true), []);
  const closeArchive = useCallback(() => setArchiveOpen(false), []);

  return {
    isGlobalSettingsOpen,
    isCoreIncludeOpen,
    isBackfillOpen,
    isArchiveOpen,
    openGlobalSettings,
    closeGlobalSettings,
    openCoreInclude,
    closeCoreInclude,
    openBackfill,
    closeBackfill,
    openArchive,
    closeArchive,
  };
}
