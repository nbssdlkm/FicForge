// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmChapter,
  deleteDrafts,
  undoChapter,
  type ContextSummary,
  type StateInfo,
} from "../../api/engine-client";
import type { ActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import type { DraftItem } from "./useWriterDraftController";

type UseWriterChapterActionsOptions = {
  auPath: string;
  state: StateInfo | null;
  drafts: DraftItem[];
  activeDraftIndex: number;
  chapterTitle: string;
  focusSelection: string[];
  skipFactsPrompt: boolean;
  loadGuard: ActiveRequestGuard<string>;
  clearDraftState: (discard?: boolean) => void;
  replaceDraftSummaries: (chapterNum: number, summaries: Record<string, ContextSummary>) => void;
  loadData: () => Promise<void>;
  focusInstructionInput: () => void;
  onChaptersChanged?: () => void;
  onCloseFinalizeConfirm: () => void;
  onCloseDiscardConfirm: () => void;
  onCloseUndoConfirm: () => void;
  onOpenFactsPrompt: () => void;
  showSuccess: (message: string) => void;
  showToast: (message: string, tone?: "info" | "success" | "warning" | "error") => void;
  showError: (error: unknown, fallback: string) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
};

export function useWriterChapterActions({
  auPath,
  state,
  drafts,
  activeDraftIndex,
  chapterTitle,
  focusSelection,
  skipFactsPrompt,
  loadGuard,
  clearDraftState,
  replaceDraftSummaries,
  loadData,
  focusInstructionInput,
  onChaptersChanged,
  onCloseFinalizeConfirm,
  onCloseDiscardConfirm,
  onCloseUndoConfirm,
  onOpenFactsPrompt,
  showSuccess,
  showToast,
  showError,
  t,
}: UseWriterChapterActionsOptions) {
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [lastConfirmedChapter, setLastConfirmedChapter] = useState<number | null>(null);
  // M24：同步在飞锁。isUndoing 是 state（驱动弹窗 loading / 按钮 disable），但 setState
  // 异步 —— 同一渲染里的两次 handleUndoConfirmed 闭包读到的 isUndoing 都还是 false，
  // 拦不住同步双击。ref 立即生效，作为真正的重入闸门。
  const undoingRef = useRef(false);

  useEffect(() => {
    setIsFinalizing(false);
    setIsDiscarding(false);
    setIsUndoing(false);
    undoingRef.current = false;
    setLastConfirmedChapter(null);
  }, [auPath]);

  const handleConfirm = useCallback(async () => {
    const currentDraft = drafts[activeDraftIndex];
    if (!currentDraft || !state) return;
    const requestAuPath = auPath;
    const confirmedFocus = [...focusSelection];

    setIsFinalizing(true);
    try {
      const confirmedChapter = state.current_chapter;
      await confirmChapter(
        auPath,
        confirmedChapter,
        currentDraft.draftId,
        currentDraft.generatedWith || undefined,
        currentDraft.modified ? currentDraft.content : undefined,
        chapterTitle.trim() || undefined,
      );
      if (loadGuard.isKeyStale(requestAuPath)) return;

      clearDraftState(true);
      replaceDraftSummaries(confirmedChapter, {});
      onCloseFinalizeConfirm();
      setLastConfirmedChapter(confirmedChapter);
      await loadData();
      onChaptersChanged?.();

      if (skipFactsPrompt) {
        showSuccess(t("drafts.finalizeSuccess", { chapter: confirmedChapter }));
        if (confirmedFocus.length > 0) {
          showToast(t("focus.resolvePrompt"), "info");
        }
        focusInstructionInput();
        return;
      }

      onOpenFactsPrompt();
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t("error_messages.unknown"));
    } finally {
      if (!loadGuard.isKeyStale(requestAuPath)) {
        setIsFinalizing(false);
      }
    }
  }, [
    activeDraftIndex,
    auPath,
    chapterTitle,
    clearDraftState,
    drafts,
    focusInstructionInput,
    focusSelection,
    skipFactsPrompt,
    loadData,
    loadGuard,
    onChaptersChanged,
    onCloseFinalizeConfirm,
    onOpenFactsPrompt,
    replaceDraftSummaries,
    showError,
    showSuccess,
    showToast,
    state,
    t,
  ]);

  const handleUndoConfirmed = useCallback(async () => {
    // M24：in-flight 防重入。undo 是 10 步级联回滚（数百 ms~数秒），旧代码进函数就先
    // onCloseUndoConfirm() 关弹窗、再 await —— 但 ConfirmDialog 的 confirm 按钮在这段
    // 空窗里未 disabled，快速双击 / 弹窗关闭前的第二次点击能并发进入第二次回滚，多撤一章。
    // 对照 discard：保留 isUndoing 状态，弹窗用 loading 锁按钮，成功后才关。
    // ref 先判先占（同步），state 仅供 UI；两者配合堵住同步双击 + 渲染前的第二次点击。
    if (undoingRef.current) return;
    undoingRef.current = true;
    const requestAuPath = auPath;
    setIsUndoing(true);
    try {
      await undoChapter(auPath);
      if (loadGuard.isKeyStale(requestAuPath)) return;
      onCloseUndoConfirm();
      clearDraftState(true);
      showSuccess(t("writer.undoSuccess"));
      await loadData();
      onChaptersChanged?.();
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t("error_messages.unknown"));
    } finally {
      // ref 无条件释放（即便 key 已 stale，也不能永久锁死本 hook 实例）；
      // isUndoing state 仅在 key 未变时复位（stale 时组件即将随 AU 切换重置）。
      undoingRef.current = false;
      if (!loadGuard.isKeyStale(requestAuPath)) {
        setIsUndoing(false);
      }
    }
  }, [auPath, clearDraftState, loadData, loadGuard, onChaptersChanged, onCloseUndoConfirm, showError, showSuccess, t]);

  const handleDiscardDrafts = useCallback(async () => {
    if (!state || drafts.length === 0) return;
    const requestAuPath = auPath;
    const currentDraft = drafts[activeDraftIndex];
    const isSingleDraft = drafts.length === 1;

    setIsDiscarding(true);
    try {
      await deleteDrafts(auPath, state.current_chapter, isSingleDraft ? currentDraft?.label : undefined);
      if (loadGuard.isKeyStale(requestAuPath)) return;

      clearDraftState(true);
      replaceDraftSummaries(state.current_chapter, {});
      onCloseDiscardConfirm();
      if (isSingleDraft) {
        showToast(t("drafts.discardSuccess"), "info");
      } else {
        showToast(t("drafts.discardAllSuccess"), "info");
      }
      focusInstructionInput();
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t("error_messages.unknown"));
    } finally {
      if (!loadGuard.isKeyStale(requestAuPath)) {
        setIsDiscarding(false);
      }
    }
  }, [
    activeDraftIndex,
    auPath,
    clearDraftState,
    drafts,
    focusInstructionInput,
    loadGuard,
    onCloseDiscardConfirm,
    replaceDraftSummaries,
    showError,
    showToast,
    state,
    t,
  ]);

  return {
    isFinalizing,
    isDiscarding,
    isUndoing,
    lastConfirmedChapter,
    handleConfirm,
    handleUndoConfirmed,
    handleDiscardDrafts,
  };
}
