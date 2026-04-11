// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 导入流水线 v2。
 * 支持多文件导入、AI 对话格式解析、冲突处理、设定提取。
 *
 * 新 API：analyzeFile → buildImportPlan → executeImport
 * 旧 API（向后兼容）：split_into_chapters / import_chapters / parse_html
 */

import { createChapter } from "../domain/chapter.js";
import { scan_characters_in_chapter } from "../domain/character_scanner.js";
import { IndexStatus } from "../domain/enums.js";
import { createOpsEntry } from "../domain/ops_entry.js";
import { createState } from "../domain/state.js";
import { extract_last_scene_ending } from "../domain/text_utils.js";
import type { PlatformAdapter } from "../platform/adapter.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";
import { compute_content_hash, generate_op_id, now_utc } from "../repositories/implementations/file_utils.js";

import {
  detectChatFormat,
  splitByRole,
  classifyTurns,
  isJsonChatExport,
  parseChatExport,
  type ChatTurn,
  type ClassifiedTurn,
  type ClassificationThresholds,
  DEFAULT_THRESHOLDS,
} from "./chat_parser.js";
import {
  splitChapters,
  splitByCharCount,
  trySplitByStandardHeaders,
  trySplitByNumericHeaders,
  type SplitChapter,
  type SplitOptions,
} from "./chapter_splitter.js";
import type { TrashService } from "./trash_service.js";

// Re-export for backward compat
export type { SplitChapter } from "./chapter_splitter.js";

// ---------------------------------------------------------------------------
// New API: Types
// ---------------------------------------------------------------------------

export interface AnalysisOptions {
  useAiAssist?: boolean;
  llmProvider?: import("../llm/provider.js").LLMProvider;
  thresholds?: ClassificationThresholds;
}

export interface FileAnalysis {
  filename: string;
  fileFormat: string;
  mode: "chat" | "text";
  chatFormat?: string;
  turns?: ClassifiedTurn[];
  chapters?: SplitChapter[];
  splitMethod?: string;
  stats: {
    totalChars: number;
    estimatedChapters: number;
    settingsCount: number;
    skippedCount: number;
  };
}

export interface ImportChapter {
  chapterNum: number;
  content: string;
  sourceFile: string;
  sourceTurns: number[];
  title?: string;
}

export interface ImportSetting {
  content: string;
  sourceFile: string;
  sourceTurnIndex: number;
}

export interface ImportConflictOptions {
  mode: "append" | "overwrite" | "custom";
  startChapter?: number;
  settingsMode: "merge" | "separate";
}

export interface ImportPlan {
  chapters: ImportChapter[];
  settings: ImportSetting[];
  conflictOptions: ImportConflictOptions;
}

export interface NewImportResult {
  chaptersImported: number;
  settingsImported: number;
  trashedChapters: number[];
}

export interface ImportProgress {
  currentFile: string;
  chaptersTotal: number;
  chaptersDone: number;
  settingsTotal: number;
  settingsDone: number;
}

export interface ExecuteImportParams {
  auId: string;
  chapterRepo: ChapterRepository;
  stateRepo: StateRepository;
  opsRepo: OpsRepository;
  adapter: PlatformAdapter;
  trashService?: TrashService;
  castRegistry?: { characters?: string[] };
  characterAliases?: Record<string, string[]> | null;
  onProgress?: (progress: ImportProgress) => void;
}

// ---------------------------------------------------------------------------
// New API: analyzeFile
// ---------------------------------------------------------------------------

/**
 * 分析单个文件内容，检测格式（对话 or 纯正文），返回分析结果。
 * text 应为已提取的纯文本（前端负责 docx/html 转换）。
 */
export async function analyzeFile(
  text: string,
  filename: string,
  options: AnalysisOptions = {},
): Promise<FileAnalysis> {
  const totalChars = text.length;
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "txt";

  // JSON / JSONL 对话格式检测
  if (ext === "json" || ext === "jsonl") {
    try {
      const data = JSON.parse(text);
      if (isJsonChatExport(data)) {
        const turns = parseChatExport(data);
        const classified = classifyTurns(turns, thresholds);
        return buildChatAnalysis(filename, "json", "JSON", classified, totalChars);
      }
    } catch {
      // JSON 解析失败，尝试 JSONL（每行一个 JSON 对象）
      const jsonlTurns = tryParseJsonl(text);
      if (jsonlTurns.length > 0) {
        const classified = classifyTurns(jsonlTurns, thresholds);
        return buildChatAnalysis(filename, ext, "JSONL", classified, totalChars);
      }
    }
  }

  // 文本对话格式检测
  const chatFormat = detectChatFormat(text);
  if (chatFormat) {
    const turns = splitByRole(text, chatFormat);
    const classified = classifyTurns(turns, thresholds);
    return buildChatAnalysis(filename, ext, chatFormat.name, classified, totalChars);
  }

  // 纯正文模式
  const splitOptions: SplitOptions = {
    useAiAssist: options.useAiAssist,
    llmProvider: options.llmProvider,
  };
  const { chapters, method } = await splitChapters(text, splitOptions);

  return {
    filename,
    fileFormat: ext,
    mode: "text",
    chapters,
    splitMethod: method,
    stats: {
      totalChars,
      estimatedChapters: chapters.length,
      settingsCount: 0,
      skippedCount: 0,
    },
  };
}

function buildChatAnalysis(
  filename: string,
  ext: string,
  chatFormatName: string,
  classified: ClassifiedTurn[],
  totalChars: number,
): FileAnalysis {
  const chapters = classified.filter((t) => t.classification === "chapter").length;
  const settings = classified.filter((t) => t.assignedType === "setting").length;
  const skipped = classified.filter(
    (t) => t.classification === "skip" || t.classification === "uncertain",
  ).length;

  return {
    filename,
    fileFormat: ext,
    mode: "chat",
    chatFormat: chatFormatName,
    turns: classified,
    stats: {
      totalChars,
      estimatedChapters: chapters,
      settingsCount: settings,
      skippedCount: skipped,
    },
  };
}

/**
 * 尝试按 JSONL 格式解析（每行一个 JSON 对象）。
 * 用于 SillyTavern 等导出格式。
 */
function tryParseJsonl(text: string): ChatTurn[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const turns: ChatTurn[] = [];
  let index = 0;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (typeof obj !== "object" || obj === null) continue;
      const role = obj.role as string;
      const content = (obj.content as string ?? "").trim();
      if (!role || !content) continue;

      const normalizedRole: "user" | "assistant" =
        role === "user" || role === "human" ? "user" : "assistant";
      turns.push({ index: index++, role: normalizedRole, content, charCount: content.length });
    } catch {
      // 某行解析失败 → 整个文件不是 JSONL
      return [];
    }
  }

  // 至少需要 2 个合法轮次才认定为 JSONL
  return turns.length >= 2 ? turns : [];
}

// ---------------------------------------------------------------------------
// New API: buildImportPlan
// ---------------------------------------------------------------------------

/**
 * 从多个文件分析结果构建导入计划。
 * 处理多文件章节号接续、"续"合并、设定收集。
 * analyses 中的 ClassifiedTurn 可能已被前端用户修改过 assignedType/assignedChapter。
 */
export function buildImportPlan(
  analyses: FileAnalysis[],
  conflictOptions: ImportConflictOptions,
): ImportPlan {
  const chapters: ImportChapter[] = [];
  const settings: ImportSetting[] = [];

  // 确定起始章节号
  let nextChapter: number;
  switch (conflictOptions.mode) {
    case "overwrite":
      nextChapter = conflictOptions.startChapter ?? 1;
      break;
    case "custom":
      nextChapter = conflictOptions.startChapter ?? 1;
      break;
    case "append":
    default:
      // append 模式下 startChapter 由调用方（前端）传入（已有章节 max + 1）
      nextChapter = conflictOptions.startChapter ?? 1;
      break;
  }

  for (const analysis of analyses) {
    if (analysis.mode === "chat" && analysis.turns) {
      // 对话模式：从 ClassifiedTurn 中提取
      const result = extractFromTurns(analysis.turns, analysis.filename, nextChapter);
      chapters.push(...result.chapters);
      settings.push(...result.settings);
      nextChapter = result.nextChapter;
    } else if (analysis.mode === "text" && analysis.chapters) {
      // 纯正文模式：从 SplitChapter 中提取
      for (const ch of analysis.chapters) {
        chapters.push({
          chapterNum: nextChapter++,
          content: ch.content,
          sourceFile: analysis.filename,
          sourceTurns: [],
          title: ch.title,
        });
      }
    }
  }

  return { chapters, settings, conflictOptions };
}

function extractFromTurns(
  turns: ClassifiedTurn[],
  filename: string,
  startChapter: number,
): { chapters: ImportChapter[]; settings: ImportSetting[]; nextChapter: number } {
  const chapters: ImportChapter[] = [];
  const settings: ImportSetting[] = [];
  let nextChapter = startChapter;
  let lastChapterIndex = -1; // index into chapters array for "续" merging

  for (const turn of turns) {
    switch (turn.assignedType) {
      case "chapter": {
        const ch: ImportChapter = {
          chapterNum: nextChapter++,
          content: turn.content,
          sourceFile: filename,
          sourceTurns: [turn.index],
          title: undefined,
        };
        chapters.push(ch);
        lastChapterIndex = chapters.length - 1;
        break;
      }
      case "chapter_continue": {
        // 追加到上一个 chapter
        if (lastChapterIndex >= 0) {
          chapters[lastChapterIndex].content += "\n\n" + turn.content;
          chapters[lastChapterIndex].sourceTurns.push(turn.index);
        } else {
          // 没有前一章可追加，升级为独立章节
          chapters.push({
            chapterNum: nextChapter++,
            content: turn.content,
            sourceFile: filename,
            sourceTurns: [turn.index],
          });
          lastChapterIndex = chapters.length - 1;
        }
        break;
      }
      case "setting": {
        settings.push({
          content: turn.content,
          sourceFile: filename,
          sourceTurnIndex: turn.index,
        });
        break;
      }
      case "skip":
      default:
        // 跳过
        break;
    }
  }

  return { chapters, settings, nextChapter };
}

// ---------------------------------------------------------------------------
// New API: executeImport
// ---------------------------------------------------------------------------

/**
 * 执行导入计划。写入章节、设定、ops，更新 state。
 */
export async function executeImport(
  plan: ImportPlan,
  params: ExecuteImportParams,
): Promise<NewImportResult> {
  const {
    auId, chapterRepo, stateRepo, opsRepo, adapter,
    trashService, castRegistry = { characters: [] },
    characterAliases = null, onProgress,
  } = params;

  const result: NewImportResult = {
    chaptersImported: 0,
    settingsImported: 0,
    trashedChapters: [],
  };

  const timestamp = now_utc();

  // 1. 覆盖/自定义模式：被覆盖的章节移入垃圾桶
  if (plan.conflictOptions.mode !== "append" && trashService) {
    const importedNums = new Set(plan.chapters.map((c) => c.chapterNum));
    for (const num of importedNums) {
      const exists = await chapterRepo.exists(auId, num);
      if (exists) {
        const chPath = `chapters/main/ch${String(num).padStart(4, "0")}.md`;
        try {
          await trashService.move_to_trash(auId, chPath, "chapter", String(num));
          result.trashedChapters.push(num);
        } catch {
          // trash 失败不阻断导入
        }
      }
    }
  }

  // 2. 逐章写入
  const allCharactersLastSeen: Record<string, number> = {};
  for (const ch of plan.chapters) {
    const contentHash = await compute_content_hash(ch.content);
    const chapter = createChapter({
      au_id: auId,
      chapter_num: ch.chapterNum,
      content: ch.content,
      chapter_id: `ch_${crypto.randomUUID().slice(0, 8)}`,
      revision: 1,
      confirmed_at: timestamp,
      content_hash: contentHash,
      provenance: "imported",
    });
    await chapterRepo.save(chapter);

    // 角色扫描
    const scanned = scan_characters_in_chapter(
      ch.content, castRegistry, characterAliases, ch.chapterNum,
    );
    for (const [name, chNum] of Object.entries(scanned)) {
      if (!(name in allCharactersLastSeen) || chNum > allCharactersLastSeen[name]) {
        allCharactersLastSeen[name] = chNum;
      }
    }

    result.chaptersImported++;
    onProgress?.({
      currentFile: ch.sourceFile,
      chaptersTotal: plan.chapters.length,
      chaptersDone: result.chaptersImported,
      settingsTotal: plan.settings.length,
      settingsDone: result.settingsImported,
    });
  }

  // 3. 写入设定文件
  if (plan.settings.length > 0) {
    if (plan.conflictOptions.settingsMode === "merge") {
      const merged = plan.settings.map((s) => s.content).join("\n\n---\n\n");
      const settingsPath = `${auId}/worldbuilding/导入设定.md`;
      const dir = settingsPath.substring(0, settingsPath.lastIndexOf("/"));
      await adapter.mkdir(dir);
      await adapter.writeFile(settingsPath, `---\ntitle: 导入设定\n---\n\n${merged}`);
    } else {
      const dir = `${auId}/worldbuilding`;
      await adapter.mkdir(dir);
      for (let i = 0; i < plan.settings.length; i++) {
        await adapter.writeFile(
          `${dir}/导入设定_${i + 1}.md`,
          `---\ntitle: 导入设定 ${i + 1}\n---\n\n${plan.settings[i].content}`,
        );
      }
    }
    result.settingsImported = plan.settings.length;
  }

  // 4. 更新 state
  if (plan.chapters.length > 0) {
    const maxChapterNum = Math.max(...plan.chapters.map((c) => c.chapterNum));
    const lastContent = plan.chapters[plan.chapters.length - 1].content;
    const lastSceneEnding = extract_last_scene_ending(lastContent, 50);

    let existingState;
    try {
      existingState = await stateRepo.get(auId);
    } catch {
      existingState = null;
    }

    const state = existingState
      ? {
          ...existingState,
          current_chapter: Math.max(existingState.current_chapter, maxChapterNum + 1),
          last_scene_ending: lastSceneEnding,
          characters_last_seen: {
            ...existingState.characters_last_seen,
            ...allCharactersLastSeen,
          },
          index_status: IndexStatus.STALE,
          updated_at: timestamp,
        }
      : createState({
          au_id: auId,
          current_chapter: maxChapterNum + 1,
          last_scene_ending: lastSceneEnding,
          characters_last_seen: allCharactersLastSeen,
          index_status: IndexStatus.STALE,
        });
    await stateRepo.save(state);
  }

  // 5. 写入 ops
  await opsRepo.append(auId, createOpsEntry({
    op_id: generate_op_id(),
    op_type: "import_chapters",
    target_id: auId,
    timestamp,
    payload: {
      total_chapters: result.chaptersImported,
      total_settings: result.settingsImported,
      trashed_chapters: result.trashedChapters,
      source_files: [...new Set(plan.chapters.map((c) => c.sourceFile))],
      characters_found: Object.keys(allCharactersLastSeen),
    },
  }));

  return result;
}

// ---------------------------------------------------------------------------
// Backward-compatible API (旧接口，内部转调新代码)
// ---------------------------------------------------------------------------

/**
 * 旧接口：三级切分。内部转调 chapter_splitter。
 * @deprecated 使用 splitChapters() 替代
 */
export function split_into_chapters(text: string): SplitChapter[] {
  if (!text.trim()) return [];
  const standard = trySplitByStandardHeaders(text);
  if (standard) return standard;
  const numeric = trySplitByNumericHeaders(text);
  if (numeric) return numeric;
  return splitByCharCount(text);
}

/**
 * 旧接口：获取切分方法名。
 * @deprecated 使用 splitChapters() 的 method 字段替代
 */
export function get_split_method(text: string): string {
  if (!text.trim()) return "auto_3000";
  if (trySplitByStandardHeaders(text) !== null) return "title";
  if (trySplitByNumericHeaders(text) !== null) return "integer";
  return "auto_3000";
}

// ---------------------------------------------------------------------------
// HTML 解析器（保留）
// ---------------------------------------------------------------------------

export function parse_html(raw: string): string {
  let text = raw.replace(/<(script|style)[^>]*>.*?<\/\1>/gis, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n\n");
  text = text.replace(/<(p|div|h[1-6]|li|tr|blockquote)[^>]*>/gi, "");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

// ---------------------------------------------------------------------------
// 旧版导入函数（向后兼容）
// ---------------------------------------------------------------------------

export interface ImportResult {
  total_chapters: number;
  split_method: string;
  characters_found: string[];
  state_initialized: boolean;
}

export interface ImportChaptersParams {
  au_id: string;
  chapters: SplitChapter[];
  chapter_repo: ChapterRepository;
  state_repo: StateRepository;
  ops_repo: OpsRepository;
  cast_registry?: { characters?: string[] };
  character_aliases?: Record<string, string[]> | null;
  split_method?: string;
}

/**
 * 旧接口：导入章节并初始化 state。
 * @deprecated 使用 executeImport() 替代
 */
export async function import_chapters(params: ImportChaptersParams): Promise<ImportResult> {
  const {
    au_id, chapters,
    chapter_repo, state_repo, ops_repo,
    cast_registry = { characters: [] },
    character_aliases = null,
    split_method = "auto_3000",
  } = params;

  const timestamp = now_utc();

  // 写入章节文件
  for (const chData of chapters) {
    const contentHash = await compute_content_hash(chData.content);
    const chapter = createChapter({
      au_id,
      chapter_num: chData.chapter_num,
      content: chData.content,
      chapter_id: `ch_${crypto.randomUUID().slice(0, 8)}`,
      revision: 1,
      confirmed_at: timestamp,
      content_hash: contentHash,
      provenance: "imported",
    });
    await chapter_repo.save(chapter);
  }

  // 角色扫描
  const charactersLastSeen: Record<string, number> = {};
  for (const chData of chapters) {
    const scanned = scan_characters_in_chapter(chData.content, cast_registry, character_aliases, chData.chapter_num);
    for (const [name, chNum] of Object.entries(scanned)) {
      if (!(name in charactersLastSeen) || chNum > charactersLastSeen[name]) {
        charactersLastSeen[name] = chNum;
      }
    }
  }

  // 初始化 state
  const lastChapterNum = chapters.length > 0 ? Math.max(...chapters.map((c) => c.chapter_num)) : 0;
  const lastContent = chapters.length > 0 ? chapters[chapters.length - 1].content : "";
  const lastSceneEnding = extract_last_scene_ending(lastContent, 50);

  const state = createState({
    au_id,
    current_chapter: lastChapterNum + 1,
    last_scene_ending: lastSceneEnding,
    characters_last_seen: charactersLastSeen,
    index_status: IndexStatus.STALE,
  });
  await state_repo.save(state);

  // ops
  await ops_repo.append(au_id, createOpsEntry({
    op_id: generate_op_id(),
    op_type: "import_project",
    target_id: au_id,
    timestamp,
    payload: {
      chapter_range: chapters.length > 0
        ? [Math.min(...chapters.map((c) => c.chapter_num)), lastChapterNum]
        : [0, 0],
      total_chapters: chapters.length,
      characters_found: Object.keys(charactersLastSeen),
      state_snapshot: {
        current_chapter: state.current_chapter,
        last_scene_ending: state.last_scene_ending,
        characters_last_seen: state.characters_last_seen,
      },
    },
  }));

  return {
    total_chapters: chapters.length,
    split_method,
    characters_found: Object.keys(charactersLastSeen),
    state_initialized: true,
  };
}
