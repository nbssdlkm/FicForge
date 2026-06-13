// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — useSimpleToolExecutor
 *
 * 简版 tool call 执行 hook。复用主仓库 settings-chat 的所有 helper：
 *  - validation：getToolValidationError / Missing / Overwrite / Duplicate
 *  - frontmatter：CHARACTER_FRONTMATTER_KEYS / applyManagedFrontmatter / preserve…
 *  - API：saveLore / readLore / deleteLore / addPinned / deletePinned /
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

import { useCallback } from "react";
import { useTranslation } from "../../i18n/useAppTranslation";
import {
  addPinned,
  deletePinned,
  deleteLore,
  getProjectForEditing,
  listLoreFiles,
  readLore,
  saveLore,
  saveProjectCastRegistryCharacters,
  saveProjectWritingStyle,
  type ProjectInfo,
} from "../../api/engine-client";
import {
  coerceString,
  getToolDuplicateWarning,
  getToolMissingTargetError,
  getToolOverwriteWarning,
  getToolValidationError,
  normalizeMarkdownFilename,
  type LoreFileOption,
  type ToolUndoMeta,
} from "../shared/settings-chat/types";
import {
  CHARACTER_FRONTMATTER_KEYS,
  applyManagedFrontmatter,
  coerceTrimmedString,
  normalizeDisplayName,
  preserveManagedFrontmatter,
} from "../shared/settings-chat/frontmatter-utils";

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
  execute: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<SimpleToolExecutionResult>;
  /** 基于 undoMeta 撤销之前 execute 的副作用。throws on IO error。 */
  undo: (undoMeta: ToolUndoMeta) => Promise<{ resultNote: string }>;
}

export function useSimpleToolExecutor(
  options: SimpleToolExecutorOptions,
): UseSimpleToolExecutorResult {
  const { auPath } = options;
  const { t } = useTranslation();

  const execute = useCallback(
    async (
      toolName: string,
      args: Record<string, unknown>,
    ): Promise<SimpleToolExecutionResult> => {
      if (!auPath) {
        throw new Error(t("error_messages.unknown"));
      }

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

      const characterFileNames = new Set(
        latestCharacterFiles.files.map((f) => f.filename),
      );
      const worldbuildingFileNames = new Set(
        latestWorldbuildingFiles.files.map((f) => f.filename),
      );
      const availableCharacterNames = new Set(
        latestCharacterFiles.files.map((f) => f.name),
      );

      // === 2. 校验三连（schema / target 存在 / 防覆盖）===
      const validationError = getToolValidationError(
        toolName,
        args,
        t,
        availableCharacterNames,
      );
      if (validationError) throw new Error(validationError);

      const missingError = getToolMissingTargetError(
        toolName,
        args,
        characterFileNames,
        worldbuildingFileNames,
        t,
      );
      if (missingError) throw new Error(missingError);

      const overwriteWarning = getToolOverwriteWarning(
        toolName,
        args,
        characterFileNames,
        worldbuildingFileNames,
        t,
      );
      if (overwriteWarning) throw new Error(overwriteWarning);

      // === 3. 拉 project（pinned 防重 + create_character_file rollback 用）===
      let project: ProjectInfo;
      try {
        project = await getProjectForEditing(auPath);
      } catch {
        throw new Error(t("settingsMode.error.projectUnavailable"));
      }

      const duplicateWarning = getToolDuplicateWarning(
        toolName,
        args,
        project.pinned_context ?? [],
        t,
      );
      if (duplicateWarning) throw new Error(duplicateWarning);

      // === 4. dispatch 6 个支持的 tool ===
      if (toolName === "create_character_file") {
        const name = normalizeDisplayName(args.name) || t("common.unknownAu");
        const filename = normalizeMarkdownFilename(name);
        const content = applyManagedFrontmatter(
          coerceString(args.content),
          { ...args, name },
          CHARACTER_FRONTMATTER_KEYS,
        );
        await saveLore({ au_path: auPath, category: "characters", filename, content });

        // cast_registry 同步失败要 rollback lore（沿用主仓库 D-0029 防原子性破坏）
        try {
          const nextCharacters = Array.from(
            new Set([...(project.cast_registry.characters || []), name]),
          );
          await saveProjectCastRegistryCharacters(auPath, nextCharacters);
        } catch (error) {
          try {
            await deleteLore({ au_path: auPath, category: "characters", filename });
          } catch {
            throw new Error(
              t("settingsMode.error.createCharacterRollbackFailed", { name: filename }),
            );
          }
          throw error;
        }

        return {
          resultNote: t("settingsMode.executedWithTarget", { target: filename }),
          undoMeta: { kind: "lore", category: "characters", filename },
          warningMessage: null,
        };
      }

      if (toolName === "modify_character_file") {
        const filename = normalizeMarkdownFilename(coerceString(args.filename));
        let finalContent = coerceString(args.new_content);
        // 守护 frontmatter 受管字段（name / aliases / importance / origin_ref）防 LLM 误覆盖
        try {
          const { content: oldContent } = await readLore({
            au_path: auPath,
            category: "characters",
            filename,
          });
          finalContent = preserveManagedFrontmatter(
            oldContent,
            finalContent,
            CHARACTER_FRONTMATTER_KEYS,
          );
        } catch {
          // 旧文件不存在的 race 直接用新内容
        }
        await saveLore({
          au_path: auPath,
          category: "characters",
          filename,
          content: finalContent,
        });
        return {
          resultNote: t("settingsMode.executedWithTarget", { target: filename }),
          undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
          warningMessage: null,
        };
      }

      if (toolName === "create_worldbuilding_file") {
        const name = coerceTrimmedString(args.name) || t("common.none");
        const filename = normalizeMarkdownFilename(name);
        await saveLore({
          au_path: auPath,
          category: "worldbuilding",
          filename,
          content: coerceString(args.content),
        });
        return {
          resultNote: t("settingsMode.executedWithTarget", { target: filename }),
          undoMeta: { kind: "lore", category: "worldbuilding", filename },
          warningMessage: null,
        };
      }

      if (toolName === "modify_worldbuilding_file") {
        const filename = normalizeMarkdownFilename(coerceString(args.filename));
        await saveLore({
          au_path: auPath,
          category: "worldbuilding",
          filename,
          content: coerceString(args.new_content),
        });
        return {
          resultNote: t("settingsMode.executedWithTarget", { target: filename }),
          undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
          warningMessage: null,
        };
      }

      if (toolName === "add_pinned_context") {
        const content = coerceString(args.content).trim();
        const index = project.pinned_context?.length ?? 0;
        await addPinned(auPath, content);
        return {
          resultNote: t("settingsMode.executedWithTarget", {
            target: t("common.labels.pinnedContext"),
          }),
          undoMeta: { kind: "pinned", pinnedIndex: index, pinnedContent: content },
          warningMessage: null,
        };
      }

      if (toolName === "update_writing_style") {
        const field = coerceString(args.field);
        const value = coerceString(args.value);
        const writingStyle = {
          ...(project.writing_style || {}),
          [field]: value,
        };
        await saveProjectWritingStyle(auPath, writingStyle);
        return {
          resultNote: t("settingsMode.executedWithTarget", {
            target: t("common.labels.writingStyle"),
          }),
          undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
          warningMessage: null,
        };
      }

      throw new Error(t("settingsMode.error.unsupportedTool", { name: toolName }));
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
        const pinnedContent = (undoMeta.pinnedContent || "").trim();
        let pinnedIndex =
          typeof undoMeta.pinnedIndex === "number"
            && pinnedContext[undoMeta.pinnedIndex]?.trim() === pinnedContent
            ? undoMeta.pinnedIndex
            : -1;

        if (pinnedIndex < 0 && pinnedContent) {
          pinnedIndex = pinnedContext
            .map((item) => item.trim())
            .lastIndexOf(pinnedContent);
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
