// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — useSimpleToolExecutor
 *
 * 简版 tool call 执行 hook。复用主仓库 settings-chat 的所有 helper：
 *  - validation：getToolValidationError / Missing / Overwrite / Duplicate
 *  - frontmatter：CHARACTER_FRONTMATTER_KEYS / applyManagedFrontmatter / preserve…
 *  - API：saveLore / readLoreWithLegacyFallback / deleteLore / addPinned / deletePinned /
 *    getProjectForEditing / saveProjectCastRegistryCharacters / saveProjectWritingStyle
 *
 * 此 hook 仅 dispatch 简版支持的 6 个 modify tool（按 P2 物理收紧后 simple
 * mode tool list 的子集）：create/modify ×character/worldbuilding +
 * add_pinned_context + update_writing_style。其他 toolName 走 unsupported
 * fallthrough，由调用方决定显示什么错误。
 *
 * **不**做 UI 状态管理（loading flag / status update）：execute() 是纯 async
 * I/O + validation，throw on error；caller 自己包 isLoading / setStatus。
 *
 * Hook 5 铁律：state + reset 同文件（此 hook 无 state，纯 useCallback）；
 * 不暴露 raw setter；返回值仅含 execute / undo 两个动词命名 method。
 */

import { assertNever, isSimpleMutatingToolName, type SimpleMutatingToolName } from "@ficforge/engine";
import { useCallback } from "react";
import { useTranslation } from "../../i18n/useAppTranslation";
import {
  deletePinned,
  deleteLore,
  getProjectForEditing,
  listLoreFiles,
  type ProjectInfo,
} from "../../api/engine-client";
import {
  getToolDuplicateWarning,
  getToolMissingTargetError,
  getToolOverwriteWarning,
  getToolValidationError,
  type LoreFileOption,
  type ToolUndoMeta,
} from "../shared/settings-chat/types";
import {
  runAddPinnedContext,
  runCreateCharacterFile,
  runCreateWorldbuildingFile,
  runModifyCharacterFile,
  runModifyWorldbuildingFile,
  runUpdateWritingStyle,
  type ToolRunnerContext,
} from "../shared/settings-chat/tool-runners";

export interface SimpleToolExecutorOptions {
  /** AU 路径；简版 mode 永远是 "au"，basePath 即 auPath。空字符串视为未就绪。 */
  auPath: string;
}

export interface SimpleToolExecutionResult {
  /** 已 i18n 化的"已执行：xxx"卡片备注。 */
  resultNote: string;
  /** 用于"撤销"还原的元数据；不可撤销 tool 给 kind="unsupported"。 */
  undoMeta: ToolUndoMeta | null;
  /** 非阻断的提示文案（如 update_core_includes 部分缺失），简版 6 tool 通常 null。 */
  warningMessage: string | null;
}

export interface UseSimpleToolExecutorResult {
  /**
   * 执行 tool。throws Error on validation fail / IO error / unsupported tool。
   * Error message 已 i18n 化，调用方直接展示给用户。
   */
  execute: (toolName: string, args: Record<string, unknown>) => Promise<SimpleToolExecutionResult>;
  /** 基于 undoMeta 撤销之前 execute 的副作用。throws on IO error。 */
  undo: (undoMeta: ToolUndoMeta) => Promise<{ resultNote: string }>;
}

export function useSimpleToolExecutor(options: SimpleToolExecutorOptions): UseSimpleToolExecutorResult {
  const { auPath } = options;
  const { t } = useTranslation();

  const execute = useCallback(
    async (rawToolName: string, args: Record<string, unknown>): Promise<SimpleToolExecutionResult> => {
      if (!auPath) {
        throw new Error(t("error_messages.unknown"));
      }
      // 工具名契约单源（盲审 2026-07-11）：入口即校验并窄化为引擎导出的联合类型，
      // 未知工具提前失败（不白跑支撑 IO）；链尾 assertNever 锁引擎侧改名/增删。
      if (!isSimpleMutatingToolName(rawToolName)) {
        throw new Error(t("settingsMode.error.unsupportedTool", { name: rawToolName }));
      }
      const toolName: SimpleMutatingToolName = rawToolName;

      // === 1. 拉最新 lore 列表（防覆盖 / 防缺失校验依据）===
      let latestCharacterFiles: { files: LoreFileOption[] };
      let latestWorldbuildingFiles: { files: LoreFileOption[] };
      try {
        [latestCharacterFiles, latestWorldbuildingFiles] = await Promise.all([
          listLoreFiles({ au_path: auPath, category: "characters" }),
          listLoreFiles({ au_path: auPath, category: "worldbuilding" }),
        ]);
      } catch {
        throw new Error(t("settingsMode.error.supportDataUnavailable"));
      }

      const characterFileNames = new Set(latestCharacterFiles.files.map((f) => f.filename));
      const worldbuildingFileNames = new Set(latestWorldbuildingFiles.files.map((f) => f.filename));
      const availableCharacterNames = new Set(latestCharacterFiles.files.map((f) => f.name));

      // === 2. 校验三连（schema / target 存在 / 防覆盖）===
      const validationError = getToolValidationError(toolName, args, t, availableCharacterNames);
      if (validationError) throw new Error(validationError);

      const missingError = getToolMissingTargetError(toolName, args, characterFileNames, worldbuildingFileNames, t);
      if (missingError) throw new Error(missingError);

      const overwriteWarning = getToolOverwriteWarning(toolName, args, characterFileNames, worldbuildingFileNames, t);
      if (overwriteWarning) throw new Error(overwriteWarning);

      // === 3. 拉 project（pinned 防重 + create_character_file rollback 用）===
      let project: ProjectInfo;
      try {
        project = await getProjectForEditing(auPath);
      } catch {
        throw new Error(t("settingsMode.error.projectUnavailable"));
      }

      const duplicateWarning = getToolDuplicateWarning(toolName, args, project.pinned_context ?? [], t);
      if (duplicateWarning) throw new Error(duplicateWarning);

      // === 4. dispatch 6 个支持的 tool（执行体走共享 tool-runners，单一真相源）===
      // 简版恒 au 模式；project 上方已保证非空（getProjectForEditing 失败会提前 throw）。
      const runnerCtx: ToolRunnerContext = { basePath: auPath, mode: "au", project, t };
      if (toolName === "create_character_file") return runCreateCharacterFile(runnerCtx, args);
      if (toolName === "modify_character_file") return runModifyCharacterFile(runnerCtx, args);
      if (toolName === "create_worldbuilding_file") return runCreateWorldbuildingFile(runnerCtx, args);
      if (toolName === "modify_worldbuilding_file") return runModifyWorldbuildingFile(runnerCtx, args);
      if (toolName === "add_pinned_context") return runAddPinnedContext(runnerCtx, args);
      if (toolName === "update_writing_style") return runUpdateWritingStyle(runnerCtx, args);

      // 全部联合成员均已在上方分支 return —— toolName 在此收窄为 never（引擎新增
      // 简版工具而这里没接分支时，这行就是编译错误落点）。
      return assertNever(toolName, "unhandled simple tool");
    },
    [auPath, t],
  );

  const undo = useCallback(
    async (undoMeta: ToolUndoMeta): Promise<{ resultNote: string }> => {
      if (!auPath) {
        throw new Error(t("error_messages.unknown"));
      }

      if (undoMeta.kind === "lore" && undoMeta.category && undoMeta.filename) {
        await deleteLore({
          au_path: auPath,
          category: undoMeta.category,
          filename: undoMeta.filename,
        });
        return { resultNote: t("settingsMode.undone") };
      }

      if (undoMeta.kind === "pinned") {
        // pinnedIndex 可能因为期间又有别人改 pinned 而漂移；优先按 content 重定位（与
        // 主仓库 SettingsChatPanel.handleUndoTool 一致），找不到再认 index。
        const project = await getProjectForEditing(auPath);
        const pinnedContext = project.pinned_context || [];
        const pinnedContent = (undoMeta.pinned_content || "").trim();
        let pinnedIndex =
          typeof undoMeta.pinned_index === "number" && pinnedContext[undoMeta.pinned_index]?.trim() === pinnedContent
            ? undoMeta.pinned_index
            : -1;

        if (pinnedIndex < 0 && pinnedContent) {
          pinnedIndex = pinnedContext.map((item) => item.trim()).lastIndexOf(pinnedContent);
        }

        if (pinnedIndex < 0) {
          throw new Error(t("settingsMode.error.pinnedUndoNotFound"));
        }

        await deletePinned(auPath, pinnedIndex);
        return { resultNote: t("settingsMode.undone") };
      }

      throw new Error(t("settingsMode.undoNotSupported"));
    },
    [auPath, t],
  );

  return { execute, undo };
}
