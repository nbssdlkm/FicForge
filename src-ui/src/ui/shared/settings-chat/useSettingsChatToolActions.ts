// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useRef } from "react";
import { useActiveRequestGuard } from "../../../hooks/useActiveRequestGuard";
import { useFeedback } from "../../../hooks/useFeedback";
import { useTranslation } from "../../../i18n/useAppTranslation";
import {
  executeSettingsTool,
  undoSettingsTool,
  STALE_CONTEXT_ERROR,
  type SettingsToolExecutionContext,
  type SettingsToolExecutionResult,
} from "./execute-settings-tool";
import {
  getToolDuplicateWarning,
  getToolMissingTargetError,
  getToolOverwriteWarning,
  getToolValidationError,
  isToolCallResolved,
  type SettingsMode,
} from "./types";
import type { SettingsChatConversation } from "./useSettingsChatConversation";
import type { SettingsChatSupportData } from "./useSettingsChatSupportData";

interface SettingsChatToolActionsParams {
  mode: SettingsMode;
  basePath?: string;
  currentChapter: number;
  disabled: boolean;
  onAfterMutation?: () => void | Promise<void>;
  conversation: SettingsChatConversation;
  supportData: SettingsChatSupportData;
}

/**
 * useSettingsChatToolActions — 工具卡的确认 / 跳过 / 撤销 / 批量操作编排。
 *
 * 自身只持有 loadingCardIdsRef（同步重入闸：卡片全局一次只执行一个）；
 * 卡片状态经 conversation 的语义化 method 写入，执行 I/O 走
 * execute-settings-tool 纯模块。panelContextGuard 把每次执行绑到发起时的
 * mode:basePath 快照上，切上下文后迟到的结果一律静默丢弃。
 */
export function useSettingsChatToolActions({
  mode,
  basePath,
  currentChapter,
  disabled,
  onAfterMutation,
  conversation,
  supportData,
}: SettingsChatToolActionsParams) {
  const { t } = useTranslation();
  const { showError, showToast } = useFeedback();
  const {
    sending,
    isPostMutationBusy,
    updateMessageCards,
    updateSingleCard,
    getToolCards,
    findToolCard,
    beginPostMutationRefresh,
    endPostMutationRefresh,
  } = conversation;
  const { loadSupportData, cacheLatestLoreFiles, cacheLatestProject, getLatestProject, getLatestLoreFiles } =
    supportData;

  const panelContextKey = `${mode}:${basePath ?? ""}`;
  const panelContextGuard = useActiveRequestGuard(panelContextKey);
  const loadingCardIdsRef = useRef<Set<string>>(new Set());
  const onAfterMutationRef = useRef<typeof onAfterMutation>(onAfterMutation);

  useEffect(() => {
    onAfterMutationRef.current = onAfterMutation;
  }, [onAfterMutation]);

  // 切上下文 reset（铁律②）：重入闸清空，上一篇的执行残留不得挡住新上下文
  useEffect(() => {
    loadingCardIdsRef.current.clear();
  }, [basePath, mode]);

  const buildExecutionContext = useCallback(
    (): SettingsToolExecutionContext => ({
      basePath,
      mode,
      currentChapter,
      t,
      isContextStale: (contextKey) => panelContextGuard.isKeyStale(contextKey),
      cacheLatestLoreFiles,
      cacheLatestProject,
      getLatestProject,
    }),
    [basePath, cacheLatestLoreFiles, cacheLatestProject, currentChapter, getLatestProject, mode, panelContextGuard, t],
  );

  const runAfterMutation = useCallback(
    async (expectedContextKey: string) => {
      await loadSupportData();
      if (panelContextGuard.isKeyStale(expectedContextKey)) {
        return;
      }
      if (onAfterMutationRef.current) {
        await onAfterMutationRef.current();
      }
    },
    [loadSupportData, panelContextGuard],
  );

  const confirmTool = useCallback(
    async (messageId: string, cardId: string, nextArgs?: Record<string, unknown>) => {
      const contextSnapshot = panelContextKey;
      const card = findToolCard(messageId, cardId);
      if (
        disabled ||
        sending ||
        isPostMutationBusy ||
        !card ||
        card.isLoading ||
        card.parseError ||
        loadingCardIdsRef.current.has(cardId) ||
        loadingCardIdsRef.current.size > 0
      ) {
        return;
      }

      loadingCardIdsRef.current.add(cardId);

      updateSingleCard(messageId, cardId, (current) => ({
        ...current,
        isLoading: true,
        errorMessage: null,
      }));

      let result: SettingsToolExecutionResult;

      try {
        result = await executeSettingsTool(buildExecutionContext(), card, nextArgs, contextSnapshot);
      } catch (error) {
        if (error instanceof Error && error.message === STALE_CONTEXT_ERROR) {
          loadingCardIdsRef.current.delete(cardId);
          return;
        }
        if (panelContextGuard.isKeyStale(contextSnapshot)) {
          loadingCardIdsRef.current.delete(cardId);
          return;
        }
        updateSingleCard(messageId, cardId, (current) => ({
          ...current,
          isLoading: false,
          status: "error",
          errorMessage: error instanceof Error ? error.message : t("error_messages.unknown"),
        }));
        showError(error, t("error_messages.unknown"));
        loadingCardIdsRef.current.delete(cardId);
        return;
      }

      if (panelContextGuard.isKeyStale(contextSnapshot)) {
        loadingCardIdsRef.current.delete(cardId);
        return;
      }

      updateSingleCard(messageId, cardId, (current) => ({
        ...current,
        parsedArgs: nextArgs || current.parsedArgs,
        status: "executed",
        isLoading: false,
        resultNote: result.resultNote,
        undoMeta: result.undoMeta,
        errorMessage: null,
      }));

      if (result.warningMessage) {
        showToast(result.warningMessage, "warning");
      }

      beginPostMutationRefresh();
      try {
        await runAfterMutation(contextSnapshot);
      } catch (error) {
        if (panelContextGuard.isKeyStale(contextSnapshot)) {
          loadingCardIdsRef.current.delete(cardId);
          return;
        }
        showError(error, t("error_messages.unknown"));
      } finally {
        if (!panelContextGuard.isKeyStale(contextSnapshot)) {
          endPostMutationRefresh();
        }
        loadingCardIdsRef.current.delete(cardId);
      }
    },
    [
      beginPostMutationRefresh,
      buildExecutionContext,
      disabled,
      endPostMutationRefresh,
      findToolCard,
      isPostMutationBusy,
      panelContextGuard,
      panelContextKey,
      runAfterMutation,
      sending,
      showError,
      showToast,
      t,
      updateSingleCard,
    ],
  );

  const skipTool = useCallback(
    (messageId: string, cardId: string) => {
      if (disabled || sending || isPostMutationBusy) {
        return;
      }
      updateSingleCard(messageId, cardId, (current) => ({
        ...current,
        status: "skipped",
        resultNote: t("settingsMode.skipped"),
        errorMessage: null,
      }));
    },
    [disabled, isPostMutationBusy, sending, t, updateSingleCard],
  );

  const undoTool = useCallback(
    async (messageId: string, cardId: string) => {
      const contextSnapshot = panelContextKey;
      const card = findToolCard(messageId, cardId);
      if (
        disabled ||
        sending ||
        isPostMutationBusy ||
        !card ||
        !card.undoMeta ||
        !basePath ||
        card.isLoading ||
        loadingCardIdsRef.current.has(cardId) ||
        loadingCardIdsRef.current.size > 0
      ) {
        return;
      }

      loadingCardIdsRef.current.add(cardId);

      updateSingleCard(messageId, cardId, (current) => ({
        ...current,
        isLoading: true,
        errorMessage: null,
      }));

      try {
        await undoSettingsTool(buildExecutionContext(), card.undoMeta);

        if (panelContextGuard.isKeyStale(contextSnapshot)) {
          loadingCardIdsRef.current.delete(cardId);
          return;
        }

        updateSingleCard(messageId, cardId, (current) => ({
          ...current,
          isLoading: false,
          status: "undone",
          resultNote: t("settingsMode.undone"),
          undoMeta: null,
        }));
        beginPostMutationRefresh();
        await runAfterMutation(contextSnapshot);
        loadingCardIdsRef.current.delete(cardId);
      } catch (error) {
        if (panelContextGuard.isKeyStale(contextSnapshot)) {
          loadingCardIdsRef.current.delete(cardId);
          return;
        }
        updateSingleCard(messageId, cardId, (current) => ({
          ...current,
          isLoading: false,
          errorMessage: error instanceof Error ? error.message : t("error_messages.unknown"),
        }));
        showError(error, t("error_messages.unknown"));
        loadingCardIdsRef.current.delete(cardId);
      } finally {
        if (!panelContextGuard.isKeyStale(contextSnapshot)) {
          endPostMutationRefresh();
        }
      }
    },
    [
      basePath,
      beginPostMutationRefresh,
      buildExecutionContext,
      disabled,
      endPostMutationRefresh,
      findToolCard,
      isPostMutationBusy,
      panelContextGuard,
      panelContextKey,
      runAfterMutation,
      sending,
      showError,
      t,
      updateSingleCard,
    ],
  );

  const confirmAllTools = useCallback(
    async (messageId: string) => {
      if (disabled || sending || isPostMutationBusy) {
        return;
      }
      // 预检用 freshness 缓存（可能比 state 新一拍：executeSettingsTool 执行前重拉会回写）
      const { characters, worldbuilding } = getLatestLoreFiles();
      const availableCharacterNames = new Set(characters.map((file) => file.name.trim()).filter(Boolean));
      const characterFileNames = new Set(characters.map((file) => file.filename));
      const worldbuildingFileNames = new Set(worldbuilding.map((file) => file.filename));
      const pinnedTexts = getLatestProject()?.pinned_context || [];

      const pendingIds = getToolCards(messageId)
        .filter(
          (card) =>
            !isToolCallResolved(card.status) &&
            !card.isLoading &&
            !loadingCardIdsRef.current.has(card.id) &&
            !card.parseError &&
            !getToolValidationError(card, card.parsedArgs, t, availableCharacterNames) &&
            !getToolMissingTargetError(card, card.parsedArgs, characterFileNames, worldbuildingFileNames, t) &&
            !getToolOverwriteWarning(card, card.parsedArgs, characterFileNames, worldbuildingFileNames, t) &&
            !getToolDuplicateWarning(card, card.parsedArgs, pinnedTexts, t),
        )
        .map((card) => card.id);

      for (const cardId of pendingIds) {
        await confirmTool(messageId, cardId);
      }
    },
    [confirmTool, disabled, getLatestLoreFiles, getLatestProject, getToolCards, isPostMutationBusy, sending, t],
  );

  const skipAllTools = useCallback(
    (messageId: string) => {
      if (disabled || sending || isPostMutationBusy) {
        return;
      }
      updateMessageCards(messageId, (cards) =>
        cards.map((card) =>
          isToolCallResolved(card.status) || card.isLoading || loadingCardIdsRef.current.has(card.id)
            ? card
            : {
                ...card,
                status: "skipped",
                resultNote: t("settingsMode.skipped"),
                errorMessage: null,
              },
        ),
      );
    },
    [disabled, isPostMutationBusy, sending, t, updateMessageCards],
  );

  return {
    confirmTool,
    skipTool,
    undoTool,
    confirmAllTools,
    skipAllTools,
  };
}
