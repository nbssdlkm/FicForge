// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useSimpleToolCardActions — 工具卡片的确认 / 跳过 / 撤销编排。
 *
 * 复用 useSimpleToolExecutor（其内部 dispatch 到主仓库已实现的 saveLore /
 * addPinned / saveProjectWritingStyle 等 API + frontmatter 守护 + cast_registry
 * rollback 等）。验证 / 防覆盖 / 防重复全在 executor 里，error 已 i18n 化直接展示。
 *
 * 自身只持有 executingToolId（工具执行重入闸：全局一次只执行一个）；卡片状态经
 * chat 的语义化 method（markToolCallStatus）写入。
 */

import { useCallback, useEffect, useState } from "react";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";
import type { useSimpleChat } from "./useSimpleChat";
import { useSimpleToolExecutor } from "./useSimpleToolExecutor";

interface UseSimpleToolCardActionsParams {
  auPath: string;
  chat: ReturnType<typeof useSimpleChat>;
}

export function useSimpleToolCardActions({ auPath, chat }: UseSimpleToolCardActionsParams) {
  const { t } = useTranslation();
  const { showError, showToast } = useFeedback();
  const toolExecutor = useSimpleToolExecutor({ auPath });

  const [executingToolId, setExecutingToolId] = useState<string | null>(null);

  // 切 AU reset（铁律②：state 与 reset 同文件）：上一篇的执行残留不得挡住新上下文
  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——effect 仅随 auPath 变化复位执行闸；auPath 只作触发键、体内不读取；删除会使切 AU 后残留上一篇的执行态
  useEffect(() => {
    setExecutingToolId(null);
  }, [auPath]);

  const handleConfirmTool = useCallback(
    async (messageId: string) => {
      const target = chat.messages.find((m) => m.id === messageId);
      if (target?.kind !== "tool-call") return;
      if (target.status !== "pending" && target.status !== "error") return;
      if (executingToolId) return;

      setExecutingToolId(messageId);
      try {
        const result = await toolExecutor.execute(target.tool_name, target.tool_args);
        chat.markToolCallStatus(messageId, "confirmed", {
          resultNote: result.resultNote,
          undoMeta: result.undoMeta,
          errorMessage: undefined,
        });
        if (result.warningMessage) {
          showToast(result.warningMessage, "warning");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        chat.markToolCallStatus(messageId, "error", { errorMessage: message });
        showError(err, t("error_messages.unknown"));
      } finally {
        setExecutingToolId(null);
      }
    },
    [chat, executingToolId, showError, showToast, t, toolExecutor],
  );

  const handleSkipTool = useCallback((messageId: string) => chat.markToolCallStatus(messageId, "skipped"), [chat]);

  const handleUndoTool = useCallback(
    async (messageId: string) => {
      const target = chat.messages.find((m) => m.id === messageId);
      if (target?.kind !== "tool-call") return;
      if (target.status !== "confirmed") return;
      if (!target.undo_meta || target.undo_meta.kind === "unsupported") {
        // modify_* 主仓库也不支持 undo，温和提示
        showToast(
          t("simple.toolCard.undoUnsupported", {
            defaultValue: "此操作不支持撤销",
          }),
          "warning",
        );
        return;
      }
      if (executingToolId) return;

      setExecutingToolId(messageId);
      try {
        const result = await toolExecutor.undo(target.undo_meta);
        chat.markToolCallStatus(messageId, "undone", {
          resultNote: result.resultNote,
          undoMeta: null,
          errorMessage: undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        chat.markToolCallStatus(messageId, "error", { errorMessage: message });
        showError(err, t("error_messages.unknown"));
      } finally {
        setExecutingToolId(null);
      }
    },
    [chat, executingToolId, showError, showToast, t, toolExecutor],
  );

  return { executingToolId, handleConfirmTool, handleSkipTool, handleUndoTool };
}
