// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * tool-runners — 设定对话 / 简版对话共用的 6 个 mutation 工具执行体（单一真相源）。
 *
 * 背景（R4 架构 M2 重复 / R3-M6 翻案已获授权）：execute-settings-tool.ts 与
 * useSimpleToolExecutor.ts 各有 6 个同名工具的执行体近乎逐行相同，差异只在
 * basePath↔auPath / project↔currentProject 的变量名。此处把执行体抽成纯 async
 * 函数 `runXxxTool(ctx, args)`：ctx 显式携带 basePath / mode / project / t，
 * 两个执行器薄化为「pre-check + 各自工具子集 dispatch + 各自 React 状态收尾」。
 *
 * **纯函数**：只做 validation-free 的 IO dispatch（validation 由各执行器的 pre-check
 * 完成），throw on error，不碰任何 React 状态。回滚 / undoMeta 语义逐字段保持
 *（M28/F2/F9 注释随函数走）。
 *
 * 合流裁决（差异对照）：唯一真实漂移在 modify_worldbuilding_file —— 简版旧实现漏了
 * `sanitizePathSegment` 包裹（saveLore 内部仍会清洗，落盘结果一致但中间名不对齐）。
 * 统一取设定侧的显式清洗为准（见 runModifyWorldbuildingFile 注释）。其余差异仅为
 * 变量命名 / 防御性可选链写法，语义等价。
 */

import {
  addPinned,
  deleteLore,
  readLoreWithLegacyFallback,
  saveLore,
  sanitizePathSegment,
  saveProjectCastRegistryCharacters,
  saveProjectWritingStyle,
  type ProjectInfo,
} from "../../../api/engine-client";
import { coerceString, normalizeMarkdownFilename, type SettingsMode, type ToolUndoMeta } from "./types";
import {
  CHARACTER_FRONTMATTER_KEYS,
  applyManagedFrontmatter,
  coerceTrimmedString,
  normalizeDisplayName,
  preserveManagedFrontmatter,
} from "./frontmatter-utils";

/**
 * 工具执行上下文：把两个执行器的差异（basePath / project 变量名、au↔fandom 目标）
 * 收敛成显式字段。依赖的 IO 函数走模块 import（两执行器共用同一 engine-client，
 * 单一真相源，无需经 ctx 注入）；t 因两侧来源不同（settings 由 caller 传入 /
 * simple 走 useTranslation）必须经 ctx。
 */
export interface ToolRunnerContext {
  /** 目标路径：mode="au" 时是 au_path，mode="fandom" 时是 fandom_path。 */
  basePath: string;
  /** "au" → characters/worldbuilding + au_path；"fandom" → core_worldbuilding + fandom_path。 */
  mode: SettingsMode;
  /** 当前 project 快照（cast_registry / writing_style / pinned 计数）。fandom 模式可能为 null。 */
  project: ProjectInfo | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export interface ToolRunnerResult {
  resultNote: string;
  undoMeta: ToolUndoMeta | null;
  warningMessage: string | null;
}

/**
 * 需要非空 project 的工具（create_character_file / update_writing_style）统一守卫。
 * 复刻设定侧的 requireAuProject：null 时抛 projectUnavailable（简版永远传非空 project，
 * 故永不触发；设定侧 fandom 误派此工具时兜底报错）。
 */
function requireProject(ctx: ToolRunnerContext): ProjectInfo {
  if (!ctx.project) {
    throw new Error(ctx.t("settingsMode.error.projectUnavailable"));
  }
  return ctx.project;
}

export async function runCreateCharacterFile(
  ctx: ToolRunnerContext,
  args: Record<string, unknown>,
): Promise<ToolRunnerResult> {
  // 防误派（E4 审 codex LOW）：本 runner 硬编码 characters/au_path 语义，仅 au 模式合法。
  // fandom 模式暴露的是 create_core_character_file，dispatcher 永不把 create_character_file 派到
  // 这里，故当前不可达；断言为未来独立复用（如新执行器直连本函数）时的误派兜底。
  if (ctx.mode === "fandom") throw new Error("create_character_file: fandom mode not supported");
  const { basePath, t } = ctx;
  const currentProject = requireProject(ctx);
  const name = normalizeDisplayName(args.name) || t("common.unknownAu");
  const filename = normalizeMarkdownFilename(name);
  const content = applyManagedFrontmatter(coerceString(args.content), { ...args, name }, CHARACTER_FRONTMATTER_KEYS);
  // M28/F2：saveLore 会对 filename 做白名单清洗（全角标点 → _），磁盘名可能 ≠ 传入名。
  // 回滚 / undoMeta / 展示一律用返回的实际落盘名，否则 undo 报「源不存在」、回滚失败留孤儿。
  const saved = await saveLore({ au_path: basePath, category: "characters", filename, content });

  // cast_registry 同步失败要 rollback lore（D-0029 防原子性破坏）
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

export async function runModifyCharacterFile(
  ctx: ToolRunnerContext,
  args: Record<string, unknown>,
): Promise<ToolRunnerResult> {
  // 防误派（E4 审 codex LOW）：仅 au 模式合法（fandom 走 modify_core_character_file）。当前不可达，
  // 见 runCreateCharacterFile 注释。
  if (ctx.mode === "fandom") throw new Error("modify_character_file: fandom mode not supported");
  const { basePath, t } = ctx;
  // M28/F2：先按写路径同款白名单清洗再读 —— LLM 给的名字含全角标点时磁盘名是清洗后的，
  // 用原名读必 miss → frontmatter 守护静默失效。
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

export async function runCreateWorldbuildingFile(
  ctx: ToolRunnerContext,
  args: Record<string, unknown>,
): Promise<ToolRunnerResult> {
  const { basePath, mode, t } = ctx;
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

export async function runModifyWorldbuildingFile(
  ctx: ToolRunnerContext,
  args: Record<string, unknown>,
): Promise<ToolRunnerResult> {
  const { basePath, mode, t } = ctx;
  // M28/F2：写路径同款清洗（worldbuilding 无 frontmatter 守护，但磁盘名对齐避免重名分裂）。
  // 合流裁决：简版旧实现漏了 sanitizePathSegment —— 本处显式清洗后 saveLore 内部会再 sanitize 一次
  //（双清洗）。二者落盘名在无内嵌控制字符输入下等价（sanitize 对 normalizeMarkdownFilename 的输出
  // 幂等，见 utils/paths sanitize 幂等测试）；「控制符+空白+点前缀」（如 "\x01 .foo"：首遍剥控制符后
  // 残留的前导空白被 trim 才暴露点前缀，二遍才剥掉）是唯一非幂等边界，该边界属向设定侧既有行为收敛
  //（设定侧本就双清洗）。统一取设定侧显式清洗为准。
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

export async function runAddPinnedContext(
  ctx: ToolRunnerContext,
  args: Record<string, unknown>,
): Promise<ToolRunnerResult> {
  const { basePath, project, t } = ctx;
  const content = coerceString(args.content).trim();
  // 当前 pinned 条数即新条目落位 index（防御性可选链：兼容设定侧 fandom 无 project 场景）。
  const index = project?.pinned_context?.length ?? 0;
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

export async function runUpdateWritingStyle(
  ctx: ToolRunnerContext,
  args: Record<string, unknown>,
): Promise<ToolRunnerResult> {
  // 防误派（E4 审 codex LOW）：writing_style 是 au 级配置，仅 au 模式合法。当前不可达（fandom
  // 工具集不含 update_writing_style），见 runCreateCharacterFile 注释。
  if (ctx.mode === "fandom") throw new Error("update_writing_style: fandom mode not supported");
  const { basePath, t } = ctx;
  const currentProject = requireProject(ctx);
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
