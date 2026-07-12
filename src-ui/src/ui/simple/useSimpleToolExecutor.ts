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
  addPinned,
  deletePinned,
  deleteLore,
  getProjectForEditing,
  listLoreFiles,
  readLoreWithLegacyFallback,
  saveLore,
  sanitizePathSegment,
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

      // === 4. dispatch 6 个支持的 tool ===
      if (toolName === "create_character_file") {
        const name = normalizeDisplayName(args.name) || t("common.unknownAu");
        const filename = normalizeMarkdownFilename(name);
        const content = applyManagedFrontmatter(
          coerceString(args.content),
          { ...args, name },
          CHARACTER_FRONTMATTER_KEYS,
        );
        // M28：以 saveLore 实际落盘的 filename 为准 —— saveLore 内部 sanitizePathSegment
        // 会把全角标点等非白名单字符换成 _，磁盘名可能 ≠ 传入 filename。undo/rollback
        // 必须用磁盘真名，否则 deleteLore 找不到文件。
        const saved = await saveLore({ au_path: auPath, category: "characters", filename, content });
        const savedFilename = saved.filename;

        // cast_registry 同步失败要 rollback lore（沿用主仓库 D-0029 防原子性破坏）
        try {
          const nextCharacters = Array.from(new Set([...(project.cast_registry.characters || []), name]));
          await saveProjectCastRegistryCharacters(auPath, nextCharacters);
        } catch (error) {
          try {
            await deleteLore({ au_path: auPath, category: "characters", filename: savedFilename });
          } catch {
            throw new Error(t("settingsMode.error.createCharacterRollbackFailed", { name: savedFilename }));
          }
          throw error;
        }

        return {
          resultNote: t("settingsMode.executedWithTarget", { target: savedFilename }),
          undoMeta: { kind: "lore", category: "characters", filename: savedFilename },
          warningMessage: null,
        };
      }

      if (toolName === "modify_character_file") {
        // M28：先按磁盘白名单口径归一 filename（sanitizePathSegment），再读旧内容 ——
        // 否则 LLM 给的含全角标点的 filename 与磁盘真名不符，preserveManagedFrontmatter
        // 读不到旧文件、受管 frontmatter 白守护失效。
        const requestedFilename = normalizeMarkdownFilename(coerceString(args.filename));
        const diskFilename = sanitizePathSegment(requestedFilename);
        let finalContent = coerceString(args.new_content);
        // 守护 frontmatter 受管字段（name / aliases / importance / origin_ref）防 LLM 误覆盖。
        // F9：sanitize 名 read miss 时回退用原名（validateExistingPathSegment 允许的 legacy
        // 磁盘名）再读一次 —— 早期未清洗即落盘的含全角标点文件，磁盘真名 ≠ sanitize 名，
        // 若只按 sanitize 名读会 miss → 静默丢失受管字段守护。迁移语义：旧名内容保留守护、
        // 新写统一落 sanitize 名（下方 saveLore 仍用 diskFilename）。
        const oldContent = await readLoreWithLegacyFallback({
          au_path: auPath,
          category: "characters",
          diskFilename,
          legacyFilename: requestedFilename,
        });
        if (oldContent !== null) {
          finalContent = preserveManagedFrontmatter(oldContent, finalContent, CHARACTER_FRONTMATTER_KEYS);
        }
        const saved = await saveLore({
          au_path: auPath,
          category: "characters",
          filename: diskFilename,
          content: finalContent,
        });
        return {
          resultNote: t("settingsMode.executedWithTarget", { target: saved.filename }),
          undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
          warningMessage: null,
        };
      }

      if (toolName === "create_worldbuilding_file") {
        const name = coerceTrimmedString(args.name) || t("common.none");
        const filename = normalizeMarkdownFilename(name);
        // M28：undoMeta 用 saveLore 回传的磁盘真名（sanitize 后），保证 undo 能删到文件。
        const saved = await saveLore({
          au_path: auPath,
          category: "worldbuilding",
          filename,
          content: coerceString(args.content),
        });
        return {
          resultNote: t("settingsMode.executedWithTarget", { target: saved.filename }),
          undoMeta: { kind: "lore", category: "worldbuilding", filename: saved.filename },
          warningMessage: null,
        };
      }

      if (toolName === "modify_worldbuilding_file") {
        const filename = normalizeMarkdownFilename(coerceString(args.filename));
        const saved = await saveLore({
          au_path: auPath,
          category: "worldbuilding",
          filename,
          content: coerceString(args.new_content),
        });
        return {
          resultNote: t("settingsMode.executedWithTarget", { target: saved.filename }),
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
        const pinnedContent = (undoMeta.pinnedContent || "").trim();
        let pinnedIndex =
          typeof undoMeta.pinnedIndex === "number" && pinnedContext[undoMeta.pinnedIndex]?.trim() === pinnedContent
            ? undoMeta.pinnedIndex
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
