// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useState } from "react";
import { findArchivalCandidates, recalcState, rebuildIndex as rebuildIndexApi } from "../../api/engine-client";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";

/**
 * useAuSettingsAdvancedOps — AU 设置页「高级操作」区：recalc / 重建索引 / 归档候选数徽标。
 *
 * isArchiveOpen 以 value 传入（hook 规则 3）：归档 modal 开着时不重扫（它自己在扫），
 * 关闭后重扫计数，反映刚归档掉的数量。
 */
export function useAuSettingsAdvancedOps(auPath: string, isArchiveOpen: boolean) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useFeedback();
  const guard = useActiveRequestGuard(auPath);

  const [recalcing, setRecalcing] = useState(false);
  // 最后一公里：归档候选数徽标——让「整理旧剧情笔记」的可用性一眼可见（功能在但用户发现不了）。
  // 只读扫描（findArchivalCandidates 不改数据）。
  const [archiveCandidateCount, setArchiveCandidateCount] = useState<number | null>(null);

  // 切 AU：复位进行中标志；候选数先清零，避免揭开高级区时闪现上一篇的候选数（对抗审①）
  useEffect(() => {
    setRecalcing(false);
    setArchiveCandidateCount(null);
  }, [auPath]);

  // 扫归档候选数（只读）→ 供高级操作按钮徽标。auPath 变或 archive modal 关闭后重扫。
  useEffect(() => {
    if (!auPath || isArchiveOpen) return;
    let cancelled = false;
    const requestAuPath = auPath;
    findArchivalCandidates(auPath)
      .then((list) => {
        if (!cancelled && !guard.isKeyStale(requestAuPath)) setArchiveCandidateCount(list.length);
      })
      .catch(() => {
        if (!cancelled) setArchiveCandidateCount(null);
      }); // 扫失败静默（不干扰设置页）
    return () => {
      cancelled = true;
    };
  }, [auPath, isArchiveOpen, guard]);

  const recalc = async () => {
    const requestAuPath = auPath;
    setRecalcing(true);
    try {
      const result = await recalcState(auPath);
      if (guard.isKeyStale(requestAuPath)) return;
      showSuccess(t("advanced.recalcSuccess", { scanned: result.chapters_scanned, dirty: result.cleaned_dirty_count }));
    } catch (error) {
      if (guard.isKeyStale(requestAuPath)) return;
      showError(error, t("error_messages.unknown"));
    } finally {
      if (!guard.isKeyStale(requestAuPath)) {
        setRecalcing(false);
      }
    }
  };

  const rebuildIndex = async () => {
    try {
      await rebuildIndexApi(auPath);
      showSuccess(t("advanced.rebuildIndexSuccess"));
    } catch (e) {
      showError(e, t("advanced.rebuildIndexFail"));
    }
  };

  return { recalcing, archiveCandidateCount, recalc, rebuildIndex };
}
