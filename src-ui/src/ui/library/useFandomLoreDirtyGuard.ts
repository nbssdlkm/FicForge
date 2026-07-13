// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useRef, useState } from "react";
import type { FandomLoreCategory } from "./lore-utils";

/** 弃改确认后要继续执行的动作（原实现的 4 个互斥 pending ref 收敛为单个判别联合） */
export type PendingLoreAction =
  | { type: "select"; filename: string; category: FandomLoreCategory }
  | { type: "create"; category: FandomLoreCategory }
  | { type: "delete" }
  | { type: "navigate"; page: string };

/**
 * useFandomLoreDirtyGuard — 「放弃未保存修改」确认流。
 * 调用方在编辑器脏时 requestDiscardConfirm(action)，用户确认后回调 executeAction 继续；
 * executeAction 经 ref shim 读取（hook 规则 4），调用方无需保证其引用稳定。
 */
export function useFandomLoreDirtyGuard(
  fandomPath: string | undefined,
  executeAction: (action: PendingLoreAction) => void,
) {
  const [discardChangesOpen, setDiscardChangesOpen] = useState(false);
  const pendingActionRef = useRef<PendingLoreAction | null>(null);
  const executeActionRef = useRef(executeAction);
  executeActionRef.current = executeAction;

  // 切 fandom 复位（hook 规则 2：state 与 reset 同文件）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——体内仅 setter/ref 清理（非依赖），仅应随 fandomPath 变化复位；biome 判 fandomPath 多余，删掉会导致切 fandom 不再复位（残留上一圈的待确认动作）
  useEffect(() => {
    setDiscardChangesOpen(false);
    pendingActionRef.current = null;
  }, [fandomPath]);

  const requestDiscardConfirm = useCallback((action: PendingLoreAction) => {
    pendingActionRef.current = action;
    setDiscardChangesOpen(true);
  }, []);

  const confirmDiscard = useCallback(() => {
    setDiscardChangesOpen(false);
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action) executeActionRef.current(action);
  }, []);

  const cancelDiscard = useCallback(() => {
    setDiscardChangesOpen(false);
    pendingActionRef.current = null;
  }, []);

  return { discardChangesOpen, requestDiscardConfirm, confirmDiscard, cancelDiscard };
}
