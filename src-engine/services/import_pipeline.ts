// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 导入流水线 v2。
 * 支持多文件导入、AI 对话格式解析、冲突处理、设定提取。
 *
 * 新 API：analyzeFile → buildImportPlan → executeImport
 * 旧 API（向后兼容）：splitIntoChapters / importChapters / parseHtml
 */

import { createChapter } from "../domain/chapter.js";
import { mergeCharactersLastSeen, scanCharactersInChapter } from "../domain/character_scanner.js";
import { IndexStatus } from "../domain/enums.js";
import { createOpsEntry } from "../domain/ops_entry.js";
import { chapterMainPath } from "../domain/paths.js";
import { createState } from "../domain/state.js";
import { extractLastSceneEnding } from "../domain/text_utils.js";
import type { PlatformAdapter } from "../platform/adapter.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";
import { atomicWrite, computeContentHash, generateOpId, nowUtc } from "../utils/file_utils.js";
import { warnAlways } from "../logger/index.js";
import { withAuLock } from "./au_lock.js";
import { PartialCommitError, WriteTransaction } from "./write_transaction.js";

import {
  detectChatFormat,
  splitByRole,
  classifyTurns,
  isJsonChatExport,
  parseChatExport,
  validateChatFormat,
  llmDetectChatStructure,
  buildChatFormatFromSamples,
  findKnownChatFormat,
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

/**
 * analyzeFile 进度阶段。
 * - "llm-chat-detect": 正要调 LLM 识别对话结构（UI 应显示"AI 正在识别..."）
 * - "llm-chat-failed": LLM 调用出错或 sample 幻觉被 validate 拦截（UI 应 toast "AI 识别失败"）；LLM 合理判断"非对话"不触发此阶段。
 */
export type AnalysisStage = "llm-chat-detect" | "llm-chat-failed";

export interface AnalysisOptions {
  useAiAssist?: boolean;
  llmProvider?: import("../llm/provider.js").LLMProvider;
  thresholds?: ClassificationThresholds;
  /** 阶段回调，用于 UI 显示当前在做什么。 */
  onStage?: (stage: AnalysisStage) => void;
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
  nextChapterNum: number;
  /**
   * 覆盖模式下「旧章既进不了回收站、也备份失败」而被跳过覆盖的章节号（审计 M29）。
   * 这些章的旧内容原样保留、新内容未写入；UI 应以警告形式展示。
   */
  overwriteSkippedChapters: number[];
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
  locale?: "zh" | "en";
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
  let chatFormat = detectChatFormat(text);

  // 规则失败 + AI 辅助开启 + 有 provider → 让 LLM 兜底识别对话结构
  if (!chatFormat && options.useAiAssist && options.llmProvider) {
    options.onStage?.("llm-chat-detect");
    const llmResult = await llmDetectChatStructure(text, options.llmProvider);
    if (llmResult.error) {
      // LLM 调用/响应解析出错 → UI 提示 + 关闭下游 LLM 避免 splitChapters 重复浪费一次 API 调用
      // (幻觉场景不关闭：LLM 能正常返回，只是 chat 判断不准；对 chapter pattern detect 可能仍有效)
      options.onStage?.("llm-chat-failed");
      options = { ...options, useAiAssist: false };
    } else if (llmResult.isChat) {
      // 首选：LLM 选了已知格式 → 直接查 KNOWN_CHAT_FORMATS 用预定义 pattern（零幻觉路径）
      let candidate: ReturnType<typeof buildChatFormatFromSamples> = null;
      if (llmResult.matchKnownFormat) {
        const known = findKnownChatFormat(llmResult.matchKnownFormat);
        if (known) candidate = known;
      } else if (llmResult.customUserSample && llmResult.customAssistantSample) {
        // 兜底：非标格式，从 custom sample 构造 pattern
        candidate = buildChatFormatFromSamples(llmResult.customUserSample, llmResult.customAssistantSample);
      }
      // 二次验证：pattern（不论来自已知还是 custom）在全文必须各命中 ≥ 2 次
      if (candidate && validateChatFormat(text, candidate)) {
        chatFormat = candidate;
      } else {
        // LLM 声称是对话但识别结果在原文验证不过 → 幻觉 / LLM 判断错误
        // 脱敏：customUserSample / customAssistantSample 是用户导入正文的片段，不进日志；
        // 只留结构性诊断信号（是否命中已知格式 / 样本是否存在及长度 / candidate 是否构造成功）。
        warnAlways("import", "LLM chat detection failed validation, falling back to text mode", {
          matchKnownFormat: llmResult.matchKnownFormat,
          customUserSampleLen: llmResult.customUserSample?.length ?? 0,
          customAssistantSampleLen: llmResult.customAssistantSample?.length ?? 0,
          candidateNull: !candidate,
        });
        options.onStage?.("llm-chat-failed");
      }
    }
    // LLM 合理判断 isChat=false（非对话）→ 静默走纯正文，不算失败
  }

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
  const skipped = classified.filter((t) => t.classification === "skip" || t.classification === "uncertain").length;

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
      const content = ((obj.content as string) ?? "").trim();
      if (!role || !content) continue;

      const lower = role.toLowerCase();
      const skipRoles = ["system", "tool", "function"];
      if (skipRoles.includes(lower)) continue;
      const normalizedRole: "user" | "assistant" = lower === "user" || lower === "human" ? "user" : "assistant";
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
export function buildImportPlan(analyses: FileAnalysis[], conflictOptions: ImportConflictOptions): ImportPlan {
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

  // 跨文件维护"续"合并上下文
  let lastChapterIndex = -1;

  for (const analysis of analyses) {
    if (analysis.mode === "chat" && analysis.turns) {
      // 对话模式：从 ClassifiedTurn 中提取
      const result = extractFromTurns(analysis.turns, analysis.filename, nextChapter, lastChapterIndex, chapters);
      settings.push(...result.settings);
      nextChapter = result.nextChapter;
      lastChapterIndex = result.lastChapterIndex;
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
        lastChapterIndex = chapters.length - 1;
      }
    }
  }

  return { chapters, settings, conflictOptions };
}

function extractFromTurns(
  turns: ClassifiedTurn[],
  filename: string,
  startChapter: number,
  globalLastChapterIndex: number,
  globalChapters: ImportChapter[],
): { settings: ImportSetting[]; nextChapter: number; lastChapterIndex: number } {
  const settings: ImportSetting[] = [];
  let nextChapter = startChapter;
  let lastChapterIndex = globalLastChapterIndex;

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
        globalChapters.push(ch);
        lastChapterIndex = globalChapters.length - 1;
        break;
      }
      case "chapter_continue": {
        // 追加到上一个 chapter（支持跨文件续接）
        if (lastChapterIndex >= 0 && lastChapterIndex < globalChapters.length) {
          globalChapters[lastChapterIndex].content += "\n\n" + turn.content;
          globalChapters[lastChapterIndex].sourceTurns.push(turn.index);
        } else {
          // 没有前一章可追加，升级为独立章节
          globalChapters.push({
            chapterNum: nextChapter++,
            content: turn.content,
            sourceFile: filename,
            sourceTurns: [turn.index],
          });
          lastChapterIndex = globalChapters.length - 1;
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

  return { settings, nextChapter, lastChapterIndex };
}

async function rollbackImportedSettings(adapter: PlatformAdapter, writtenPaths: string[]): Promise<void> {
  for (const path of [...writtenPaths].reverse()) {
    try {
      await adapter.deleteFile(path);
    } catch (err) {
      // best-effort rollback：单个删除失败不中断其余回滚，但要留痕——否则导入失败后
      // 残留的半成品设定文件会无声堆在 AU 里、零诊断（盲审 R5 日志 L4）。
      warnAlways("import", "导入回滚：删除已写入的设定文件失败，可能残留半成品", {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function writeImportedSettings(
  plan: ImportPlan,
  params: {
    auId: string;
    adapter: PlatformAdapter;
    locale: "zh" | "en";
    chaptersImported: number;
    onProgress?: (progress: ImportProgress) => void;
  },
): Promise<{ count: number; writtenPaths: string[] }> {
  if (plan.settings.length === 0) return { count: 0, writtenPaths: [] };

  const { auId, adapter, locale, chaptersImported, onProgress } = params;
  const settingsName = locale === "zh" ? "导入设定" : "imported_settings";
  const writtenPaths: string[] = [];

  try {
    if (plan.conflictOptions.settingsMode === "merge") {
      const merged = plan.settings.map((s) => s.content).join("\n\n---\n\n");
      let settingsPath = `${auId}/worldbuilding/${settingsName}.md`;
      if (await adapter.exists(settingsPath)) {
        const ts = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        settingsPath = `${auId}/worldbuilding/${settingsName}_${ts}.md`;
      }
      const dir = settingsPath.substring(0, settingsPath.lastIndexOf("/"));
      await adapter.mkdir(dir);
      await atomicWrite(adapter, settingsPath, `---\ntitle: ${settingsName}\n---\n\n${merged}`);
      writtenPaths.push(settingsPath);
      onProgress?.({
        currentFile: plan.settings[plan.settings.length - 1]?.sourceFile ?? "",
        chaptersTotal: plan.chapters.length,
        chaptersDone: chaptersImported,
        settingsTotal: plan.settings.length,
        settingsDone: plan.settings.length,
      });
      return { count: plan.settings.length, writtenPaths };
    }

    const dir = `${auId}/worldbuilding`;
    await adapter.mkdir(dir);
    for (let i = 0; i < plan.settings.length; i++) {
      let filePath = `${dir}/${settingsName}_${i + 1}.md`;
      if (await adapter.exists(filePath)) {
        const ts = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        filePath = `${dir}/${settingsName}_${i + 1}_${ts}.md`;
      }
      await atomicWrite(adapter, filePath, `---\ntitle: ${settingsName} ${i + 1}\n---\n\n${plan.settings[i].content}`);
      writtenPaths.push(filePath);
      onProgress?.({
        currentFile: plan.settings[i].sourceFile,
        chaptersTotal: plan.chapters.length,
        chaptersDone: chaptersImported,
        settingsTotal: plan.settings.length,
        settingsDone: i + 1,
      });
    }
    return { count: plan.settings.length, writtenPaths };
  } catch (error) {
    await rollbackImportedSettings(adapter, writtenPaths);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// New API: executeImport
// ---------------------------------------------------------------------------

/**
 * 执行导入计划。写入章节、设定、ops，更新 state。
 * AU 级锁：整个导入流程期间阻止其它 service 对同一 AU 的并发写入。
 */
export async function executeImport(plan: ImportPlan, params: ExecuteImportParams): Promise<NewImportResult> {
  return withAuLock(params.auId, () => doExecuteImport(plan, params));
}

async function doExecuteImport(plan: ImportPlan, params: ExecuteImportParams): Promise<NewImportResult> {
  const {
    auId,
    chapterRepo,
    stateRepo,
    opsRepo,
    adapter,
    trashService,
    castRegistry = { characters: [] },
    characterAliases = null,
    onProgress,
    locale = "zh",
  } = params;

  const result: NewImportResult = {
    chaptersImported: 0,
    settingsImported: 0,
    trashedChapters: [],
    nextChapterNum: 1,
    overwriteSkippedChapters: [],
  };
  const importedChapterTitles: Record<number, string> = {};

  const timestamp = nowUtc();

  // 1. 设定文件先行落盘（writeImportedSettings 内部失败会回滚已写部分并抛出）。
  // 必须在移旧章入回收站**之前**：若放在其后，设定写盘失败会把导入中止在
  // 「旧章已进回收站、新章未提交」的中间态，作品章节凭空变少（盲审 2026-07-09 中危）。
  // 先写设定则失败时整个导入原地中止、章节区零触碰。progress 的 chaptersDone
  // 此阶段恒为 0（章节尚未构建），如实反映顺序。
  const settingsResult = await writeImportedSettings(plan, {
    auId,
    adapter,
    locale,
    chaptersImported: 0,
    onProgress,
  });
  result.settingsImported = settingsResult.count;
  const writtenSettingsPaths = settingsResult.writtenPaths;

  // 2. 覆盖/自定义模式：被覆盖的章节移入垃圾桶。
  // trash 失败不能再静默放行覆盖（审计 M29：旧章会被 tx.saveChapter 覆盖 → 永失且不在回收站）：
  // 降级用 backup_chapter 兜底（chapters/backups/ 目录）；备份也失败则跳过该章覆盖，
  // 旧章原样保留并记入 overwriteSkippedChapters 让 UI 警告。
  const overwriteSkipped = new Set<number>();
  // 记录成功移入回收站的旧章（含 trash_id）：commit 失败且新章未落盘时据此还原，
  // 否则旧章仅存于回收站、新章又没写成 → 用户看到凭空缺章（盲审 R3 M2）。
  const trashedEntries: Array<{ num: number; trashId: string }> = [];
  if (plan.conflictOptions.mode !== "append" && trashService) {
    const importedNums = new Set(plan.chapters.map((c) => c.chapterNum));
    for (const num of importedNums) {
      const exists = await chapterRepo.exists(auId, num);
      if (exists) {
        const chPath = chapterMainPath(num);
        try {
          const trashedEntry = await trashService.move_to_trash(auId, chPath, "chapter", String(num));
          result.trashedChapters.push(num);
          trashedEntries.push({ num, trashId: trashedEntry.trash_id });
        } catch {
          try {
            await chapterRepo.backup_chapter(auId, num);
          } catch (backupErr) {
            overwriteSkipped.add(num);
            warnAlways("import", `ch${num} 旧章无法移入回收站且备份失败，跳过覆盖以保留旧章`, {
              error: (backupErr as Error).message,
            });
          }
        }
      }
    }
  }
  result.overwriteSkippedChapters = [...overwriteSkipped].sort((a, b) => a - b);

  // 被跳过覆盖的章不进事务：后续 state / ops 也只反映真正落盘的章
  const chaptersToWrite = plan.chapters.filter((ch) => !overwriteSkipped.has(ch.chapterNum));

  // 3. 逐章构建（收集到 tx，不立即写入）
  const tx = new WriteTransaction();
  const allCharactersLastSeen: Record<string, number> = {};
  for (const ch of chaptersToWrite) {
    const contentHash = await computeContentHash(ch.content);
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
    tx.saveChapter(auId, chapter);
    if (typeof ch.title === "string" && ch.title.trim()) {
      importedChapterTitles[ch.chapterNum] = ch.title.trim();
    }

    // 角色扫描（proto 安全 max-merge 单源，见 mergeCharactersLastSeen）
    const scanned = scanCharactersInChapter(ch.content, castRegistry, characterAliases, ch.chapterNum);
    mergeCharactersLastSeen(allCharactersLastSeen, scanned);

    result.chaptersImported++;
    onProgress?.({
      currentFile: ch.sourceFile,
      chaptersTotal: plan.chapters.length,
      chaptersDone: result.chaptersImported,
      settingsTotal: plan.settings.length,
      settingsDone: result.settingsImported,
    });
  }

  // 4. 更新 state（仅在有真正落盘的章节时需要；跳过覆盖的章不参与，其旧章数据未变）
  let importState: ReturnType<typeof createState> | null = null;
  // L24：last_scene_ending 是「续写衔接锚点」，只应反映进度末尾章的结尾。仅当本次导入触及
  // 「当前进度末章及之后」才更新它 —— current_chapter 是「下一章指针」，现末章 = 指针−1，
  // 判据为 maxChapterNum + 1 >= 指针（重导当前末章 maxCh=指针−1 也必须刷新锚点，F-2）；
  // 低章号补导（如补 3~5 章到已写到 20 章的作品）不动锚点，否则续写会从旧章结尾接、剧情错位。
  // reachedTail 同口径喂 ops。
  let reachedTail = false;
  let tailSceneEnding = "";
  if (chaptersToWrite.length > 0) {
    const maxChapterNum = Math.max(...chaptersToWrite.map((c) => c.chapterNum));
    // 结尾取「最大章号」那一章的正文（chaptersToWrite 顺序不保证有序，不能取数组末位）。
    const maxChapter = chaptersToWrite.reduce((a, b) => (b.chapterNum > a.chapterNum ? b : a));

    let existingState: Awaited<ReturnType<typeof stateRepo.get>> | null;
    try {
      existingState = await stateRepo.get(auId);
    } catch {
      existingState = null;
    }

    // 无既有进度 ⇒ 本次导入即是全部进度，总是更新锚点；有既有进度 ⇒ 仅当导入触及/越过现末章
    // （含重导当前末章：maxCh = 指针−1）。
    reachedTail = !existingState || maxChapterNum + 1 >= existingState.current_chapter;
    tailSceneEnding = reachedTail ? extractLastSceneEnding(maxChapter.content, 50) : "";

    importState = existingState
      ? {
          ...existingState,
          current_chapter: Math.max(existingState.current_chapter, maxChapterNum + 1),
          // 未触及末尾的低章号补导：保留旧锚点不动。
          last_scene_ending: reachedTail ? tailSceneEnding : existingState.last_scene_ending,
          characters_last_seen: {
            ...existingState.characters_last_seen,
            ...allCharactersLastSeen,
          },
          chapter_titles: {
            ...existingState.chapter_titles,
            ...importedChapterTitles,
          },
          index_status: IndexStatus.STALE,
          updated_at: timestamp,
        }
      : createState({
          au_id: auId,
          current_chapter: maxChapterNum + 1,
          last_scene_ending: tailSceneEnding,
          characters_last_seen: allCharactersLastSeen,
          chapter_titles: importedChapterTitles,
          index_status: IndexStatus.STALE,
        });
    result.nextChapterNum = importState.current_chapter;
  }

  // 5. 事务提交 — 只要有章节或设定就写 ops（D-0036：ops 是 sync truth）
  // payload 一律取 chaptersToWrite：ops 审计与重建投影只应反映真正落盘的章（审计 M29）
  if (chaptersToWrite.length > 0 || plan.settings.length > 0) {
    tx.appendOp(
      auId,
      createOpsEntry({
        op_id: generateOpId(),
        op_type: "import_chapters",
        target_id: auId,
        timestamp,
        payload: {
          total_chapters: result.chaptersImported,
          total_settings: result.settingsImported,
          trashed_chapters: result.trashedChapters,
          source_files: [...new Set(chaptersToWrite.map((c) => c.sourceFile))],
          characters_found: Object.keys(allCharactersLastSeen),
          // 供 rebuildStateFromOps 使用（跨设备同步时重建 state）
          last_chapter_num: chaptersToWrite.length > 0 ? Math.max(...chaptersToWrite.map((c) => c.chapterNum)) : 0,
          // L24：仅在导入触及进度末尾时带 last_scene_ending（否则空串，projection 端不覆盖旧锚点）。
          last_scene_ending: tailSceneEnding,
          characters_last_seen: allCharactersLastSeen,
          chapter_titles: importedChapterTitles,
        },
      }),
    );
    if (importState) tx.setState(importState);

    try {
      await tx.commit(opsRepo, null, stateRepo, chapterRepo, null);
    } catch (commitError) {
      // 新章是否真正落盘：仅当 PartialCommitError 且 chapters 块未在 failed 里，才算落盘成功。
      // 其它情形（ops 先行失败 / chapters 块失败）新章都没写成 → 必须把旧章从回收站还原，
      // 否则覆盖导入把旧章移进回收站后就永久缺章（盲审 R3 M2）。chapters 已落盘时不还原，
      // 否则旧章会与新章重复。
      const chaptersLanded = commitError instanceof PartialCommitError && !commitError.failed.includes("chapters");
      if (!chaptersLanded && trashService) {
        for (const { num, trashId } of trashedEntries) {
          try {
            // overwrite：防御 chapters 块中途失败时某些新章已部分落盘，强制以旧章还原。
            await trashService.restore(auId, trashId, "overwrite");
          } catch (restoreErr) {
            warnAlways("import", `覆盖导入回滚：ch${num} 从回收站还原失败，旧章仍在回收站可手动恢复`, {
              error: (restoreErr as Error).message,
            });
          }
        }
      }
      await rollbackImportedSettings(adapter, writtenSettingsPaths);
      throw commitError;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Backward-compatible API (旧接口，内部转调新代码)
// ---------------------------------------------------------------------------

/**
 * 旧接口：三级切分。内部转调 chapter_splitter。
 * @deprecated 使用 splitChapters() 替代
 */
export function splitIntoChapters(text: string): SplitChapter[] {
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
export function getSplitMethod(text: string): string {
  if (!text.trim()) return "auto_3000";
  if (trySplitByStandardHeaders(text) !== null) return "title";
  if (trySplitByNumericHeaders(text) !== null) return "integer";
  return "auto_3000";
}

// ---------------------------------------------------------------------------
// HTML 解析器（保留）
// ---------------------------------------------------------------------------

export function parseHtml(raw: string): string {
  let text = raw.replace(/<(script|style)[^>]*>.*?<\/\1>/gis, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n\n");
  text = text.replace(/<(p|div|h[1-6]|li|tr|blockquote)[^>]*>/gi, "");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
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
export async function importChapters(params: ImportChaptersParams): Promise<ImportResult> {
  return withAuLock(params.au_id, () => doImportChapters(params));
}

async function doImportChapters(params: ImportChaptersParams): Promise<ImportResult> {
  const {
    au_id,
    chapters,
    chapter_repo,
    state_repo,
    ops_repo,
    cast_registry = { characters: [] },
    character_aliases = null,
    split_method = "auto_3000",
  } = params;

  const timestamp = nowUtc();
  const tx = new WriteTransaction();

  // 收集章节 + 角色扫描
  const charactersLastSeen: Record<string, number> = {};
  const chapterTitles: Record<number, string> = {};
  for (const chData of chapters) {
    const contentHash = await computeContentHash(chData.content);
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
    tx.saveChapter(au_id, chapter);
    if (typeof chData.title === "string" && chData.title.trim()) {
      chapterTitles[chData.chapter_num] = chData.title.trim();
    }

    const scanned = scanCharactersInChapter(chData.content, cast_registry, character_aliases, chData.chapter_num);
    mergeCharactersLastSeen(charactersLastSeen, scanned);
  }

  // 初始化 state
  const lastChapterNum = chapters.length > 0 ? Math.max(...chapters.map((c) => c.chapter_num)) : 0;
  const lastContent = chapters.length > 0 ? chapters[chapters.length - 1].content : "";
  const lastSceneEnding = extractLastSceneEnding(lastContent, 50);

  const state = createState({
    au_id,
    current_chapter: lastChapterNum + 1,
    last_scene_ending: lastSceneEnding,
    characters_last_seen: charactersLastSeen,
    chapter_titles: chapterTitles,
    index_status: IndexStatus.STALE,
  });

  // 事务提交（D-0036：ops → chapters → state）
  tx.appendOp(
    au_id,
    createOpsEntry({
      op_id: generateOpId(),
      op_type: "import_project",
      target_id: au_id,
      timestamp,
      payload: {
        chapter_range: chapters.length > 0 ? [Math.min(...chapters.map((c) => c.chapter_num)), lastChapterNum] : [0, 0],
        total_chapters: chapters.length,
        characters_found: Object.keys(charactersLastSeen),
        state_snapshot: {
          current_chapter: state.current_chapter,
          last_scene_ending: state.last_scene_ending,
          characters_last_seen: state.characters_last_seen,
          chapter_titles: state.chapter_titles,
        },
      },
    }),
  );
  tx.setState(state);
  await tx.commit(ops_repo, null, state_repo, chapter_repo, null);

  return {
    total_chapters: chapters.length,
    split_method,
    characters_found: Object.keys(charactersLastSeen),
    state_initialized: true,
  };
}
