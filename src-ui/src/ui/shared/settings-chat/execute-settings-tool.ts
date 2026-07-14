// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * execute-settings-tool — 设定对话工具执行 / 撤销的纯 async 模块。
 *
 * 从 SettingsChatPanel 外科式搬出（长期债②第三块）：只做 validation + I/O
 * dispatch，throw on error；不碰任何 React 状态。UI 侧的 loading 标记 /
 * 卡片状态更新 / busy 编排在 useSettingsChatToolActions。
 *
 * 与简版 useSimpleToolExecutor 平行不合并：两边共用 types.ts /
 * frontmatter-utils 这层 helper 栈，但简版 tool list 是物理收紧后的子集
 * （无 fact / core_includes / core_character 工具），演进节奏不同。
 */

import { assertNever, isSettingsMutatingToolName, type SettingsMutatingToolName } from "@ficforge/engine";
import { FactType, NarrativeWeight } from "@ficforge/engine";
import {
  addFact,
  deleteLore,
  deletePinned,
  editFact,
  getProjectForEditing,
  listLoreFiles,
  readLoreWithLegacyFallback,
  saveLore,
  sanitizePathSegment,
  saveProjectCoreIncludes,
  updateFactStatus,
  type ProjectInfo,
} from "../../../api/engine-client";
import {
  coerceString,
  coerceStringArray,
  getToolCallName,
  getToolDuplicateWarning,
  getToolMissingTargetError,
  getToolOverwriteWarning,
  getToolValidationError,
  normalizeMarkdownFilename,
  type LoreFileOption,
  type SettingsMode,
  type ToolCallCardState,
  type ToolUndoMeta,
} from "./types";
import {
  CORE_CHARACTER_FRONTMATTER_KEYS,
  normalizeDisplayName,
  applyManagedFrontmatter,
  preserveManagedFrontmatter,
} from "./frontmatter-utils";
import {
  runAddPinnedContext,
  runCreateCharacterFile,
  runCreateWorldbuildingFile,
  runModifyCharacterFile,
  runModifyWorldbuildingFile,
  runUpdateWritingStyle,
  type ToolRunnerContext,
} from "./tool-runners";

/** 执行中途发现面板已切上下文时抛出的哨兵（caller 静默中止，不弹错误）。 */
export const STALE_CONTEXT_ERROR = "STALE_CONTEXT";

export interface SettingsToolExecutionContext {
  basePath?: string;
  mode: SettingsMode;
  currentChapter: number;
  t: (key: string, options?: Record<string, unknown>) => string;
  /** panelContextGuard.isKeyStale 注入口 —— true 表示面板已切上下文，必须中止。 */
  isContextStale: (contextKey: string) => boolean;
  /**
   * 语义化回写（hook 规则 3）：执行前刚重拉的最新 lore 清单 / project 缓存回
   * useSettingsChatSupportData 的 freshness ref，供 confirmAll 预检等同步读。
   * 状态本身随执行后的 loadSupportData 刷新，这里不 setState。
   */
  cacheLatestLoreFiles: (characters: LoreFileOption[], worldbuilding: LoreFileOption[]) => void;
  cacheLatestProject: (project: ProjectInfo) => void;
  getLatestProject: () => ProjectInfo | null;
}

export interface SettingsToolExecutionResult {
  resultNote: string;
  undoMeta: ToolUndoMeta | null;
  warningMessage?: string | null;
}

function normalizeCoreIncludes(value: unknown): string[] {
  return Array.from(
    new Set(
      coerceStringArray(value)
        .map((item) => item.trim().replace(/\.md$/i, ""))
        .filter(Boolean),
    ),
  );
}

function normalizeAvailableCharacterNames(files: LoreFileOption[]): Set<string> {
  return new Set(files.map((file) => file.name.trim()).filter(Boolean));
}

export async function executeSettingsTool(
  ctx: SettingsToolExecutionContext,
  card: ToolCallCardState,
  nextArgs: Record<string, unknown> | undefined,
  executionContextKey: string,
): Promise<SettingsToolExecutionResult> {
  const { basePath, mode, currentChapter, t } = ctx;
  if (!basePath) {
    throw new Error(t("error_messages.unknown"));
  }

  const args = nextArgs || card.parsedArgs;
  const rawToolName = getToolCallName(card);
  // 工具名契约单源（盲审 2026-07-11）：入口即校验并窄化为引擎导出的联合类型。
  // 未知工具提前失败（旧实现走完 listLoreFiles/ensureProject 才在链尾抛，白做支撑 IO）；
  // 链尾 assertNever 保证引擎侧改名/增删工具时这里编译红，不再可能静默落空。
  if (!isSettingsMutatingToolName(rawToolName)) {
    throw new Error(t("settingsMode.error.unsupportedTool", { name: rawToolName }));
  }
  const toolName: SettingsMutatingToolName = rawToolName;
  let latestCharacterFiles: { files: LoreFileOption[] };
  let latestWorldbuildingFiles: { files: LoreFileOption[] };
  try {
    [latestCharacterFiles, latestWorldbuildingFiles] = await Promise.all(
      mode === "au"
        ? [
            listLoreFiles({ au_path: basePath, category: "characters" }),
            listLoreFiles({ au_path: basePath, category: "worldbuilding" }),
          ]
        : [
            listLoreFiles({ fandom_path: basePath, category: "core_characters" }),
            listLoreFiles({ fandom_path: basePath, category: "core_worldbuilding" }),
          ],
    );
  } catch {
    throw new Error(t("settingsMode.error.supportDataUnavailable"));
  }
  if (ctx.isContextStale(executionContextKey)) {
    throw new Error(STALE_CONTEXT_ERROR);
  }
  ctx.cacheLatestLoreFiles(latestCharacterFiles.files, latestWorldbuildingFiles.files);
  const latestCharacterFileNames = new Set(latestCharacterFiles.files.map((file) => file.filename));
  const latestWorldbuildingFileNames = new Set(latestWorldbuildingFiles.files.map((file) => file.filename));
  const availableCharacterNames = normalizeAvailableCharacterNames(latestCharacterFiles.files);
  const validationError = getToolValidationError(card, args, t, availableCharacterNames);
  if (validationError) {
    throw new Error(validationError);
  }
  const missingTargetError = getToolMissingTargetError(
    card,
    args,
    latestCharacterFileNames,
    latestWorldbuildingFileNames,
    t,
  );
  if (missingTargetError) {
    throw new Error(missingTargetError);
  }
  const overwriteWarning = getToolOverwriteWarning(
    card,
    args,
    latestCharacterFileNames,
    latestWorldbuildingFileNames,
    t,
  );
  if (overwriteWarning) {
    throw new Error(overwriteWarning);
  }
  let ensuredProject: ProjectInfo | null = null;
  if (mode === "au") {
    try {
      ensuredProject = await getProjectForEditing(basePath);
    } catch {
      throw new Error(t("settingsMode.error.projectUnavailable"));
    }
  }
  if (ctx.isContextStale(executionContextKey)) {
    throw new Error(STALE_CONTEXT_ERROR);
  }
  if (ensuredProject) {
    ctx.cacheLatestProject(ensuredProject);
  }
  const duplicateWarning = getToolDuplicateWarning(
    card,
    args,
    ensuredProject?.pinned_context || ctx.getLatestProject()?.pinned_context || [],
    t,
  );
  if (duplicateWarning) {
    throw new Error(duplicateWarning);
  }
  const requireAuProject = (): ProjectInfo => {
    if (!ensuredProject) {
      throw new Error(t("settingsMode.error.projectUnavailable"));
    }
    return ensuredProject;
  };

  // 6 个 au/fandom 共有工具的执行体走共享 tool-runners（单一真相源，与 useSimpleToolExecutor 合流）。
  // create_character_file / update_writing_style 需非空 project——runner 内 requireProject 兜底
  // （ensuredProject 仅 au 模式非空，等价于旧 requireAuProject）。
  const runnerCtx: ToolRunnerContext = { basePath, mode, project: ensuredProject, t };

  if (toolName === "create_character_file") {
    return runCreateCharacterFile(runnerCtx, args);
  }

  if (toolName === "modify_character_file") {
    return runModifyCharacterFile(runnerCtx, args);
  }

  if (toolName === "create_core_character_file") {
    const name = normalizeDisplayName(args.name) || t("common.unknownFandom");
    const filename = normalizeMarkdownFilename(name);
    // M28/F2：undoMeta 用实际落盘名（清洗后），否则含全角标点时 undo 报「源不存在」
    const saved = await saveLore({
      fandom_path: basePath,
      category: "core_characters",
      filename,
      content: applyManagedFrontmatter(coerceString(args.content), { ...args, name }, CORE_CHARACTER_FRONTMATTER_KEYS),
    });
    return {
      resultNote: t("settingsMode.executedWithTarget", { target: saved.filename }),
      undoMeta: { kind: "lore", category: "core_characters", filename: saved.filename },
      warningMessage: null,
    };
  }

  if (toolName === "modify_core_character_file") {
    // M28/F2：写路径同款清洗后再读，保住 frontmatter 守护（同 modify_character_file）
    const requestedFilename = normalizeMarkdownFilename(coerceString(args.filename));
    const filename = sanitizePathSegment(requestedFilename);
    // 读旧文件，保留受管 frontmatter（name）。
    // F9：sanitize 名 read miss 时回退用原名（legacy 磁盘名）再读（同 modify_character_file）。
    let finalContent = coerceString(args.new_content);
    const oldContent = await readLoreWithLegacyFallback({
      fandom_path: basePath,
      category: "core_characters",
      diskFilename: filename,
      legacyFilename: requestedFilename,
    });
    if (oldContent !== null) {
      finalContent = preserveManagedFrontmatter(oldContent, finalContent, CORE_CHARACTER_FRONTMATTER_KEYS);
    }
    const saved = await saveLore({
      fandom_path: basePath,
      category: "core_characters",
      filename,
      content: finalContent,
    });
    return {
      resultNote: t("settingsMode.executedWithTarget", { target: saved.filename }),
      undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
      warningMessage: null,
    };
  }

  if (toolName === "create_worldbuilding_file") {
    return runCreateWorldbuildingFile(runnerCtx, args);
  }

  if (toolName === "modify_worldbuilding_file") {
    return runModifyWorldbuildingFile(runnerCtx, args);
  }

  if (toolName === "add_fact") {
    const response = await addFact(basePath, currentChapter, {
      content_raw: coerceString(args.content_raw) || coerceString(args.content_clean),
      content_clean: coerceString(args.content_clean),
      characters: coerceStringArray(args.characters),
      type: coerceString(args.fact_type) || coerceString(args.type) || FactType.PLOT_EVENT,
      narrative_weight: coerceString(args.narrative_weight) || NarrativeWeight.MEDIUM,
      status: coerceString(args.status) || "active",
    });
    return {
      resultNote: t("settingsMode.executedWithTarget", { target: response.fact_id || t("settingsMode.card.addFact") }),
      undoMeta: {
        kind: "fact",
        fact_id: response.fact_id,
        chapter_num: currentChapter,
      },
      warningMessage: null,
    };
  }

  if (toolName === "modify_fact") {
    const factId = coerceString(args.fact_id);
    if (!factId) {
      throw new Error(t("settingsMode.error.missingFactId"));
    }

    const updatedFields: Record<string, unknown> = {};
    const contentRaw = coerceString(args.content_raw);
    const contentClean = coerceString(args.content_clean);
    const characters = coerceStringArray(args.characters);
    const type = coerceString(args.fact_type) || coerceString(args.type);
    const weight = coerceString(args.narrative_weight);
    const status = coerceString(args.status);

    if (Object.hasOwn(args, "content_raw")) updatedFields.content_raw = contentRaw;
    if (Object.hasOwn(args, "content_clean")) updatedFields.content_clean = contentClean;
    if (Object.hasOwn(args, "characters")) updatedFields.characters = characters;
    if (Object.hasOwn(args, "fact_type") || Object.hasOwn(args, "type")) {
      if (type) updatedFields.type = type;
    }
    if (Object.hasOwn(args, "narrative_weight") && weight) updatedFields.narrative_weight = weight;
    if (Object.hasOwn(args, "status") && status) updatedFields.status = status;

    await editFact(basePath, factId, updatedFields);
    return {
      resultNote: t("settingsMode.executedWithTarget", { target: factId }),
      undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
      warningMessage: null,
    };
  }

  if (toolName === "add_pinned_context") {
    return runAddPinnedContext(runnerCtx, args);
  }

  if (toolName === "update_writing_style") {
    return runUpdateWritingStyle(runnerCtx, args);
  }

  if (toolName === "update_core_includes") {
    const currentProject = requireAuProject();
    const requestedNames = normalizeCoreIncludes(args.filenames);
    const availableNames = new Set([
      ...latestCharacterFiles.files.map((file) => file.name),
      ...(currentProject.cast_registry.characters || []),
    ]);
    const validNames = requestedNames.filter((name) => availableNames.has(name));
    const missingNames = requestedNames.filter((name) => !availableNames.has(name));

    if (validNames.length === 0) {
      throw new Error(t("settingsMode.error.coreIncludesMissingAll"));
    }

    await saveProjectCoreIncludes(basePath, validNames);
    return {
      resultNote: t("settingsMode.executedWithTarget", { target: t("common.labels.coreAlwaysInclude") }),
      undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
      warningMessage:
        missingNames.length > 0
          ? t("settingsMode.warning.coreIncludesPartialMissing", {
              names: missingNames.join(t("common.listSeparator")),
            })
          : null,
    };
  }

  // 全部联合成员均已在上方分支 return —— toolName 在此收窄为 never；
  // 引擎新增修改类工具而这里没接分支时，这行就是编译错误的落点。
  return assertNever(toolName, "unhandled settings tool");
}

/** 按 undoMeta 撤销一次已执行的工具；不支持 / 找不到目标时 throw。 */
export async function undoSettingsTool(ctx: SettingsToolExecutionContext, undoMeta: ToolUndoMeta): Promise<void> {
  const { basePath, mode, currentChapter, t } = ctx;
  if (!basePath) {
    throw new Error(t("error_messages.unknown"));
  }

  if (undoMeta.kind === "lore" && undoMeta.category && undoMeta.filename) {
    if (mode === "au") {
      await deleteLore({
        au_path: basePath,
        category: undoMeta.category,
        filename: undoMeta.filename,
      });
    } else {
      await deleteLore({
        fandom_path: basePath,
        category: undoMeta.category,
        filename: undoMeta.filename,
      });
    }
    return;
  }

  if (undoMeta.kind === "fact" && undoMeta.fact_id) {
    await updateFactStatus(basePath, undoMeta.fact_id, "deprecated", undoMeta.chapter_num || currentChapter);
    return;
  }

  if (undoMeta.kind === "pinned") {
    const latestProject = await getProjectForEditing(basePath);
    const pinnedContext = latestProject.pinned_context || [];
    const pinnedContent = (undoMeta.pinned_content || "").trim();
    let pinnedIndex =
      typeof undoMeta.pinned_index === "number" && pinnedContext[undoMeta.pinned_index]?.trim() === pinnedContent
        ? undoMeta.pinned_index
        : -1;

    if (pinnedIndex < 0 && pinnedContent) {
      pinnedIndex = pinnedContext.map((item: string) => item.trim()).lastIndexOf(pinnedContent);
    }

    if (pinnedIndex < 0) {
      throw new Error(t("settingsMode.error.pinnedUndoNotFound"));
    }

    await deletePinned(basePath, pinnedIndex);
    return;
  }

  throw new Error(t("settingsMode.undoNotSupported"));
}
