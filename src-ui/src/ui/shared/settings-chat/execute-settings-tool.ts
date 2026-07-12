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
import {
  addFact,
  addPinned,
  deleteLore,
  deletePinned,
  editFact,
  getProjectForEditing,
  listLoreFiles,
  readLoreWithLegacyFallback,
  saveLore,
  sanitizePathSegment,
  saveProjectCastRegistryCharacters,
  saveProjectCoreIncludes,
  saveProjectWritingStyle,
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
  CHARACTER_FRONTMATTER_KEYS,
  CORE_CHARACTER_FRONTMATTER_KEYS,
  coerceTrimmedString,
  normalizeDisplayName,
  applyManagedFrontmatter,
  preserveManagedFrontmatter,
} from "./frontmatter-utils";

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

  if (toolName === "create_character_file") {
    const currentProject = requireAuProject();
    const name = normalizeDisplayName(args.name) || t("common.unknownAu");
    const filename = normalizeMarkdownFilename(name);
    const content = applyManagedFrontmatter(coerceString(args.content), { ...args, name }, CHARACTER_FRONTMATTER_KEYS);
    // M28/F2：saveLore 会对 filename 做白名单清洗（全角标点 → _），磁盘名可能 ≠ 传入名。
    // 回滚 / undoMeta / 展示一律用返回的实际落盘名，否则 undo 报「源不存在」、回滚失败留孤儿。
    const saved = await saveLore({ au_path: basePath, category: "characters", filename, content });

    try {
      const nextCharacters = Array.from(new Set([...(currentProject.cast_registry.characters || []), name]));
      await saveProjectCastRegistryCharacters(basePath, nextCharacters);
    } catch (error) {
      try {
        await deleteLore({ au_path: basePath, category: "characters", filename: saved.filename });
      } catch {
        throw new Error(t("settingsMode.error.createCharacterRollbackFailed", { name: saved.filename }));
      }
      throw error;
    }

    return {
      resultNote: t("settingsMode.executedWithTarget", { target: saved.filename }),
      undoMeta: { kind: "lore", category: "characters", filename: saved.filename },
      warningMessage: null,
    };
  }

  if (toolName === "modify_character_file") {
    // M28/F2：先按写路径同款白名单清洗再读 —— LLM 给的名字含全角标点时磁盘名是清洗后的，
    // 用原名读必 miss → frontmatter 守护静默失效（与 useSimpleToolExecutor 同口径）。
    const requestedFilename = normalizeMarkdownFilename(coerceString(args.filename));
    const filename = sanitizePathSegment(requestedFilename);
    // 读旧文件，保留受管 frontmatter（name, aliases, importance, origin_ref）。
    // F9：sanitize 名 read miss 时回退用原名（legacy 磁盘名）再读，早期未清洗即落盘的
    // 含全角标点文件才不丢守护；写仍统一落 sanitize 名（迁移语义）。
    let finalContent = coerceString(args.new_content);
    const oldContent = await readLoreWithLegacyFallback({
      au_path: basePath,
      category: "characters",
      diskFilename: filename,
      legacyFilename: requestedFilename,
    });
    if (oldContent !== null) {
      finalContent = preserveManagedFrontmatter(oldContent, finalContent, CHARACTER_FRONTMATTER_KEYS);
    }
    const saved = await saveLore({
      au_path: basePath,
      category: "characters",
      filename,
      content: finalContent,
    });
    return {
      resultNote: t("settingsMode.executedWithTarget", { target: saved.filename }),
      undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
      warningMessage: null,
    };
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
    const name = coerceTrimmedString(args.name) || t("common.none");
    const filename = normalizeMarkdownFilename(name);
    const request =
      mode === "au"
        ? { au_path: basePath, category: "worldbuilding", filename, content: coerceString(args.content) }
        : { fandom_path: basePath, category: "core_worldbuilding", filename, content: coerceString(args.content) };
    // M28/F2：undoMeta 用实际落盘名
    const saved = await saveLore(request);
    return {
      resultNote: t("settingsMode.executedWithTarget", { target: saved.filename }),
      undoMeta: {
        kind: "lore",
        category: mode === "au" ? "worldbuilding" : "core_worldbuilding",
        filename: saved.filename,
      },
      warningMessage: null,
    };
  }

  if (toolName === "modify_worldbuilding_file") {
    // M28/F2：写路径同款清洗（worldbuilding 无 frontmatter 守护，但磁盘名对齐避免重名分裂）
    const filename = sanitizePathSegment(normalizeMarkdownFilename(coerceString(args.filename)));
    const request =
      mode === "au"
        ? { au_path: basePath, category: "worldbuilding", filename, content: coerceString(args.new_content) }
        : { fandom_path: basePath, category: "core_worldbuilding", filename, content: coerceString(args.new_content) };
    const saved = await saveLore(request);
    return {
      resultNote: t("settingsMode.executedWithTarget", { target: saved.filename }),
      undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
      warningMessage: null,
    };
  }

  if (toolName === "add_fact") {
    const response = await addFact(basePath, currentChapter, {
      content_raw: coerceString(args.content_raw) || coerceString(args.content_clean),
      content_clean: coerceString(args.content_clean),
      characters: coerceStringArray(args.characters),
      type: coerceString(args.fact_type) || coerceString(args.type) || "plot_event",
      narrative_weight: coerceString(args.narrative_weight) || "medium",
      status: coerceString(args.status) || "active",
    });
    return {
      resultNote: t("settingsMode.executedWithTarget", { target: response.fact_id || t("settingsMode.card.addFact") }),
      undoMeta: {
        kind: "fact",
        factId: response.fact_id,
        chapterNum: currentChapter,
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

    if (Object.prototype.hasOwnProperty.call(args, "content_raw")) updatedFields.content_raw = contentRaw;
    if (Object.prototype.hasOwnProperty.call(args, "content_clean")) updatedFields.content_clean = contentClean;
    if (Object.prototype.hasOwnProperty.call(args, "characters")) updatedFields.characters = characters;
    if (Object.prototype.hasOwnProperty.call(args, "fact_type") || Object.prototype.hasOwnProperty.call(args, "type")) {
      if (type) updatedFields.type = type;
    }
    if (Object.prototype.hasOwnProperty.call(args, "narrative_weight") && weight)
      updatedFields.narrative_weight = weight;
    if (Object.prototype.hasOwnProperty.call(args, "status") && status) updatedFields.status = status;

    await editFact(basePath, factId, updatedFields);
    return {
      resultNote: t("settingsMode.executedWithTarget", { target: factId }),
      undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
      warningMessage: null,
    };
  }

  if (toolName === "add_pinned_context") {
    const content = coerceString(args.content).trim();
    const index = ensuredProject?.pinned_context.length || 0;
    await addPinned(basePath, content);
    return {
      resultNote: t("settingsMode.executedWithTarget", { target: t("common.labels.pinnedContext") }),
      undoMeta: {
        kind: "pinned",
        pinnedIndex: index,
        pinnedContent: content,
      },
      warningMessage: null,
    };
  }

  if (toolName === "update_writing_style") {
    const currentProject = requireAuProject();
    const field = coerceString(args.field);
    const value = coerceString(args.value);
    const writingStyle = {
      ...(currentProject.writing_style || {}),
      [field]: value,
    };
    await saveProjectWritingStyle(basePath, writingStyle);
    return {
      resultNote: t("settingsMode.executedWithTarget", { target: t("common.labels.writingStyle") }),
      undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
      warningMessage: null,
    };
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

  if (undoMeta.kind === "fact" && undoMeta.factId) {
    await updateFactStatus(basePath, undoMeta.factId, "deprecated", undoMeta.chapterNum || currentChapter);
    return;
  }

  if (undoMeta.kind === "pinned") {
    const latestProject = await getProjectForEditing(basePath);
    const pinnedContext = latestProject.pinned_context || [];
    const pinnedContent = (undoMeta.pinnedContent || "").trim();
    let pinnedIndex =
      typeof undoMeta.pinnedIndex === "number" && pinnedContext[undoMeta.pinnedIndex]?.trim() === pinnedContent
        ? undoMeta.pinnedIndex
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
