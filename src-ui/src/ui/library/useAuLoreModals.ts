// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from 'react';

/**
 * useAuLoreModals — 设定集页四个弹窗的开关 + 新建名输入 + pin 里程碑横幅。
 * 切 AU 弹窗全部复位；pinMilestoneDismissed 有意不复位（会话级一次性横幅，沿用旧行为）。
 */
export function useAuLoreModals(auPath: string) {
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [isDeleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isImportOpen, setImportOpen] = useState(false);
  const [isCoreLimitOpen, setCoreLimitOpen] = useState(false);
  const [coreLimitTarget, setCoreLimitTarget] = useState<string | null>(null);
  const [pinMilestoneDismissed, setPinMilestoneDismissed] = useState(false);

  useEffect(() => {
    setCreateOpen(false);
    setCreateName('');
    setDeleteConfirmOpen(false);
    setImportOpen(false);
    setCoreLimitOpen(false);
    setCoreLimitTarget(null);
  }, [auPath]);

  // 打开时统一清空输入（旧实现各入口清空不一致，个别 EmptyState 入口会残留上次输入）
  const openCreate = useCallback(() => {
    setCreateName('');
    setCreateOpen(true);
  }, []);
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  const openDeleteConfirm = useCallback(() => setDeleteConfirmOpen(true), []);
  const closeDeleteConfirm = useCallback(() => setDeleteConfirmOpen(false), []);
  const openImport = useCallback(() => setImportOpen(true), []);
  const closeImport = useCallback(() => setImportOpen(false), []);
  /** pin 的角色正文缺「核心限制」段落 → 弹提示引导去补。 */
  const promptCoreLimit = useCallback((name: string) => {
    setCoreLimitTarget(name);
    setCoreLimitOpen(true);
  }, []);
  const closeCoreLimit = useCallback(() => setCoreLimitOpen(false), []);
  const dismissPinMilestone = useCallback(() => setPinMilestoneDismissed(true), []);

  return {
    isCreateOpen,
    createName,
    isDeleteConfirmOpen,
    isImportOpen,
    isCoreLimitOpen,
    coreLimitTarget,
    pinMilestoneDismissed,
    openCreate,
    closeCreate,
    openDeleteConfirm,
    closeDeleteConfirm,
    openImport,
    closeImport,
    promptCoreLimit,
    closeCoreLimit,
    dismissPinMilestone,
    setCreateName, // 受控绑定（hook 规则 5 例外①：新建名 Input）
  };
}
