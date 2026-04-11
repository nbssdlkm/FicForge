// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Client — 前端直接调用 TS 引擎替代 REST API。
 *
 * 每个函数签名与原 API 模块兼容，前端组件切换 import 来源即可。
 * 按模块组织，与 settings.ts / state.ts / facts.ts 等一一对应。
 */

import type { PlatformAdapter } from "@ficforge/engine";
import {
  FileChapterRepository,
  FileDraftRepository,
  FileFactRepository,
  FileFandomRepository,
  FileOpsRepository,
  FileProjectRepository,
  FileSettingsRepository,
  FileStateRepository,
  TrashService,
  // Services
  add_fact,
  edit_fact,
  update_fact_status,
  set_chapter_focus,
  confirm_chapter as engineConfirmChapter,
  undo_latest_chapter,
  resolve_dirty_chapter,
  recalc_state,
  export_chapters as engineExportChapters,
  split_into_chapters,
  parse_html,
  import_chapters as engineImportChapters,
  // Import v2 types (values loaded dynamically)
  type FileAnalysis,
  type ImportPlan,
  type ImportConflictOptions,
  type NewImportResult,
  type ImportProgress,
  type AnalysisOptions,
  generate_chapter as engineGenerateChapter,
  build_settings_context,
  call_settings_llm,
  // LLM
  create_provider,
  resolve_llm_config,
  OpenAICompatibleProvider,
  RemoteEmbeddingProvider,
  // Vector
  JsonVectorEngine,
  // Sync types (values loaded dynamically)
  type SyncResult,
} from "@ficforge/engine";

// Re-export types from original API modules for compatibility
export type { StateInfo } from "./state";
export type { FactInfo, ExtractedFactCandidate, ExtractFactsResponse } from "./facts";
export type { ChapterInfo } from "./chapters";
export type { DraftListItem, DraftDetail, DraftGeneratedWith, DeleteDraftsResult } from "./drafts";
export type { ProjectInfo, WritingStyle, CastRegistry, EmbeddingLock } from "./project";
export type { SettingsInfo, LlmSettingsInfo, TestConnectionRequest, TestConnectionResponse } from "./settings";
export type { FandomInfo, FandomFileEntry, FandomFilesResponse } from "./fandoms";
export type { TrashEntry, TrashScope } from "./trash";
export type { GenerateParams, ContextSummary } from "./generate";
export type { SettingsChatMode, SettingsChatMessagePayload, SettingsChatSessionLlm, SettingsChatToolCall, SettingsChatResponse } from "./settingsChat";
export type { ChapterPreview, ImportUploadResponse, ImportConfirmResponse } from "./importExport";

// Re-export ApiError for compatibility with components that use it for error handling
export { ApiError, getFriendlyErrorMessage } from "./client";

// ---------------------------------------------------------------------------
// Engine 实例管理
// ---------------------------------------------------------------------------

export interface EngineInstance {
  adapter: PlatformAdapter;
  dataDir: string;
  repos: {
    chapter: FileChapterRepository;
    draft: FileDraftRepository;
    fact: FileFactRepository;
    fandom: FileFandomRepository;
    ops: FileOpsRepository;
    project: FileProjectRepository;
    settings: FileSettingsRepository;
    state: FileStateRepository;
  };
  trash: TrashService;
  vectorEngine: JsonVectorEngine;
}

let _engine: EngineInstance | null = null;

export function initEngine(adapter: PlatformAdapter, dataDir: string): void {
  _engine = {
    adapter,
    dataDir,
    repos: {
      chapter: new FileChapterRepository(adapter),
      draft: new FileDraftRepository(adapter),
      fact: new FileFactRepository(adapter),
      fandom: new FileFandomRepository(adapter),
      ops: new FileOpsRepository(adapter),
      project: new FileProjectRepository(adapter),
      settings: new FileSettingsRepository(adapter, dataDir),
      state: new FileStateRepository(adapter),
    },
    trash: new TrashService(adapter),
    vectorEngine: new JsonVectorEngine(adapter),
  };
}

export function getEngine(): EngineInstance {
  if (!_engine) throw new Error("Engine not initialized. Call initEngine() first.");
  return _engine;
}

export function isEngineReady(): boolean {
  return _engine !== null;
}

/** 获取数据根目录（所有 fandom 操作的基础路径）。 */
export function getDataDir(): string {
  return getEngine().dataDir;
}

// ===========================================================================
// Settings
// ===========================================================================

export async function getSettings() {
  const { settings } = getEngine().repos;
  const s = await settings.get();
  return s as unknown as import("./settings").SettingsInfo;
}

export async function updateSettings(updates: Record<string, unknown>) {
  const { settings } = getEngine().repos;
  const current = await settings.get();
  Object.assign(current, updates);
  await settings.save(current);
  return current as unknown as import("./settings").SettingsInfo;
}

export async function testConnection(params: { mode: string; model?: string; api_base?: string; api_key?: string; local_model_path?: string; ollama_model?: string }) {
  try {
    if (params.mode === "local") {
      // 本地模式通过 sidecar embedding 验证（如果 sidecar 运行中）
      return { success: true, model: params.local_model_path ?? "local", message: "本地模式需要通过 sidecar 验证" };
    }
    if (params.mode === "ollama") {
      // Ollama 模式：尝试连接 Ollama API
      const base = params.api_base || "http://localhost:11434";
      const resp = await fetch(`${base}/api/tags`);
      if (resp.ok) {
        return { success: true, model: params.ollama_model ?? "ollama" };
      }
      return { success: false, message: "无法连接 Ollama 服务", error_code: "connection_failed" };
    }
    // API 模式：发送测试请求
    const provider = new OpenAICompatibleProvider(
      params.api_base ?? "",
      params.api_key ?? "",
      params.model ?? "",
    );
    const resp = await provider.generate({
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1,
      temperature: 0,
      top_p: 1,
    });
    return { success: true, model: resp.model };
  } catch (e: unknown) {
    const err = e as { message?: string; error_code?: string };
    return { success: false, message: err.message, error_code: err.error_code };
  }
}

// ===========================================================================
// State
// ===========================================================================

export async function getState(auPath: string) {
  const { state } = getEngine().repos;
  return await state.get(auPath) as unknown as import("./state").StateInfo;
}

export async function setChapterFocus(auPath: string, focusIds: string[]) {
  const { fact, ops, state } = getEngine().repos;
  return await set_chapter_focus(auPath, focusIds, fact, ops, state);
}

export async function rebuildIndex(auPath: string) {
  // 标记索引为 stale，触发重建
  const { state } = getEngine().repos;
  const st = await state.get(auPath);
  const { IndexStatus } = await import("@ficforge/engine");
  st.index_status = IndexStatus.STALE;
  await state.save(st);
  return { task_id: "rebuild_" + Date.now(), message: "index marked stale, will rebuild on next retrieval" };
}

export { recalcState };
async function recalcState(auPath: string) {
  const { state, chapter, project, fact } = getEngine().repos;
  return await recalc_state(auPath, state, chapter, project, fact);
}

// ===========================================================================
// Facts
// ===========================================================================

export async function listFacts(auPath: string, status?: string) {
  const { fact } = getEngine().repos;
  if (status) {
    return (await fact.list_by_status(auPath, status as import("@ficforge/engine").FactStatus)) as unknown as import("./facts").FactInfo[];
  }
  return (await fact.list_all(auPath)) as unknown as import("./facts").FactInfo[];
}

export async function addFact(auPath: string, chapterNum: number, factData: Record<string, unknown>) {
  const { fact, ops } = getEngine().repos;
  const result = await add_fact(auPath, chapterNum, factData, fact, ops);
  // Return with fact_id alias for frontend compatibility (Python API returns fact_id, domain uses id)
  return { ...result, fact_id: result.id };
}

export async function editFact(auPath: string, factId: string, updatedFields: Record<string, unknown>) {
  const { fact, ops, state } = getEngine().repos;
  return await edit_fact(auPath, factId, updatedFields, fact, ops, state);
}

export async function updateFactStatus(auPath: string, factId: string, newStatus: string, chapterNum: number) {
  const { fact, ops, state } = getEngine().repos;
  return await update_fact_status(auPath, factId, newStatus, chapterNum, fact, ops, state);
}

// ===========================================================================
// Project
// ===========================================================================

export async function getProject(auPath: string) {
  const { project } = getEngine().repos;
  return (await project.get(auPath)) as unknown as import("./project").ProjectInfo;
}

export async function updateProject(auPath: string, updates: Record<string, unknown>) {
  const { project } = getEngine().repos;
  const current = await project.get(auPath);
  Object.assign(current, updates);
  await project.save(current);
  return current as unknown as import("./project").ProjectInfo;
}

// ===========================================================================
// Chapters
// ===========================================================================

export async function listChapters(auPath: string) {
  const { chapter, state } = getEngine().repos;
  const chapters = await chapter.list_main(auPath);
  const st = await state.get(auPath);
  return chapters.map((ch) => ({
    chapter_num: ch.chapter_num,
    chapter_id: ch.chapter_id,
    content: ch.content,
    revision: ch.revision,
    confirmed_at: ch.confirmed_at,
    provenance: ch.provenance,
    title: st.chapter_titles[ch.chapter_num] ?? undefined,
  }));
}

export async function getChapter(auPath: string, chapterNum: number) {
  const { chapter } = getEngine().repos;
  const ch = await chapter.get(auPath, chapterNum);
  return ch as unknown as import("./chapters").ChapterInfo;
}

export async function getChapterContent(auPath: string, chapterNum: number) {
  const { chapter } = getEngine().repos;
  return await chapter.get_content_only(auPath, chapterNum);
}

export async function confirmChapter(
  auPath: string, chapterNum: number, draftId: string,
  generatedWith?: object, content?: string | null, title?: string | null,
) {
  const { chapter, draft, state, ops, project } = getEngine().repos;
  const proj = await project.get(auPath);
  const result = await engineConfirmChapter({
    au_id: auPath, chapter_num: chapterNum, draft_id: draftId,
    generated_with: generatedWith as import("@ficforge/engine").GeneratedWith | undefined,
    cast_registry: proj.cast_registry,
    content_override: content,
    chapter_repo: chapter, draft_repo: draft, state_repo: state, ops_repo: ops,
  });
  // Update title: use provided title, or auto-generate via LLM
  let finalTitle = title;
  if (!finalTitle) {
    try {
      const { generateChapterTitle } = await import("@ficforge/engine");
      const sett = await getEngine().repos.settings.get();
      const llmConfig = resolve_llm_config(null, proj as unknown as Record<string, unknown>, sett as { default_llm?: { mode?: string; model?: string; api_base?: string; api_key?: string } });
      if (llmConfig.mode === "api" && llmConfig.api_key) {
        const provider = create_provider(llmConfig);
        const chContent = await chapter.get_content_only(auPath, chapterNum);
        const lang = sett.app?.language || "zh";
        finalTitle = await generateChapterTitle(chContent, lang, provider);
      }
    } catch {
      // AI title generation failed — silent fallback
    }
  }
  if (finalTitle) {
    const st = await state.get(auPath);
    st.chapter_titles[chapterNum] = finalTitle;
    await state.save(st);
  }
  return result;
}

export async function undoChapter(auPath: string) {
  const { chapter, draft, state, ops, fact, project } = getEngine().repos;
  const proj = await project.get(auPath);
  return await undo_latest_chapter({
    au_id: auPath, cast_registry: proj.cast_registry,
    chapter_repo: chapter, draft_repo: draft, state_repo: state, ops_repo: ops, fact_repo: fact,
  });
}

export async function updateChapterTitle(auPath: string, chapterNum: number, title: string) {
  const { state } = getEngine().repos;
  const st = await state.get(auPath);
  st.chapter_titles[chapterNum] = title;
  await state.save(st);
  return { chapter_num: chapterNum, title };
}

export async function resolveDirtyChapter(auPath: string, chapterNum: number, confirmedFactChanges: any[] = []) {
  const { chapter, state, ops, fact, project } = getEngine().repos;
  const proj = await project.get(auPath);
  return await resolve_dirty_chapter({
    au_id: auPath, chapter_num: chapterNum, confirmed_fact_changes: confirmedFactChanges,
    cast_registry: proj.cast_registry,
    chapter_repo: chapter, state_repo: state, ops_repo: ops, fact_repo: fact,
  });
}

// ===========================================================================
// Drafts
// ===========================================================================

export async function listDrafts(auPath: string, chapterNum: number) {
  const { draft } = getEngine().repos;
  const drafts = await draft.list_by_chapter(auPath, chapterNum);
  return drafts.map((d) => ({
    draft_label: d.variant,
    filename: `ch${String(d.chapter_num).padStart(4, "0")}_draft_${d.variant}.md`,
  }));
}

export async function getDraft(auPath: string, chapterNum: number, label: string) {
  const { draft } = getEngine().repos;
  return (await draft.get(auPath, chapterNum, label)) as unknown as import("./drafts").DraftDetail;
}

export async function deleteDrafts(auPath: string, chapterNum: number, _label?: string) {
  const { draft } = getEngine().repos;
  await draft.delete_by_chapter(auPath, chapterNum);
  return { deleted_count: 1 };
}

// ===========================================================================
// Generate (replaces SSE — E.5)
// ===========================================================================

export async function* generateChapter(params: {
  au_path: string;
  chapter_num: number;
  user_input: string;
  input_type?: string;
  session_llm?: Record<string, string> | null;
  session_params?: Record<string, number> | null;
}): AsyncGenerator<{ event: string; data: any }> {
  const e = getEngine();
  const proj = await e.repos.project.get(params.au_path);
  const st = await e.repos.state.get(params.au_path);
  const allFacts = await e.repos.fact.list_all(params.au_path);
  const sett = await e.repos.settings.get();

  // 验证 LLM 模式：local/ollama 在 TS 引擎中不支持流式生成
  const llmConfig = resolve_llm_config(
    params.session_llm ?? null,
    proj as { llm?: { mode?: string; model?: string; api_base?: string; api_key?: string } },
    sett as { default_llm?: { mode?: string; model?: string; api_base?: string; api_key?: string } },
  );
  if (llmConfig.mode !== "api") {
    yield { event: "error", data: { error_code: "UNSUPPORTED_MODE", message: "续写功能需要 API 模式的 LLM 配置（local/ollama 模式暂不支持）", actions: ["check_settings"] } };
    return;
  }

  for await (const event of engineGenerateChapter({
    au_id: params.au_path,
    chapter_num: params.chapter_num,
    user_input: params.user_input,
    session_llm: params.session_llm ?? null,
    session_params: params.session_params ?? null,
    project: proj,
    state: st,
    settings: sett,
    facts: allFacts,
    chapter_repo: e.repos.chapter,
    draft_repo: e.repos.draft,
    adapter: e.adapter,
    vector_repo: e.vectorEngine,
    embedding_provider: sett.embedding?.api_key
      ? new RemoteEmbeddingProvider(sett.embedding.api_base || sett.default_llm?.api_base || "", sett.embedding.api_key, sett.embedding.model || "")
      : undefined,
  })) {
    // Yield parsed objects (matching old sseStream format)
    if (event.type === "token") {
      yield { event: "token", data: { text: event.data } };
    } else if (event.type === "context_summary") {
      yield { event: "context_summary", data: event.data };
    } else if (event.type === "done") {
      yield { event: "done", data: event.data };
    } else if (event.type === "error") {
      yield { event: "error", data: event.data };
    }
  }
}

// ===========================================================================
// Trash
// ===========================================================================

export async function listTrash(_scope: string, path: string) {
  return getEngine().trash.list_trash(path);
}

export async function restoreTrash(_scope: string, path: string, trashId: string) {
  await getEngine().trash.restore(path, trashId);
}

export async function permanentDeleteTrash(_scope: string, path: string, trashId: string) {
  await getEngine().trash.permanent_delete(path, trashId);
}

export async function purgeTrash(_scope: string, path: string, maxAgeDays?: number) {
  const purged = await getEngine().trash.purge_expired(path, maxAgeDays);
  return { purged_count: purged.length };
}

// ===========================================================================
// Import / Export
// ===========================================================================

export async function exportChapters(params: {
  au_path: string;
  format?: string;
  start_chapter?: number;
  end_chapter?: number;
  include_title?: boolean;
}) {
  const { chapter, state } = getEngine().repos;
  const st = await state.get(params.au_path);
  const text = await engineExportChapters({
    au_id: params.au_path,
    chapter_repo: chapter,
    format: (params.format ?? "txt") as "txt" | "md",
    start_chapter: params.start_chapter,
    end_chapter: params.end_chapter,
    chapter_titles: st.chapter_titles,
  });
  const blob = new Blob([text], { type: "text/plain" });
  const filename = `export.${params.format ?? "txt"}`;
  return { blob, filename };
}

export async function importChaptersFromText(auPath: string, text: string, splitMethod?: string) {
  const chapters = split_into_chapters(text);
  const { chapter, state, ops } = getEngine().repos;
  return await engineImportChapters({
    au_id: auPath,
    chapters,
    chapter_repo: chapter,
    state_repo: state,
    ops_repo: ops,
    split_method: splitMethod,
  });
}

// ===========================================================================
// Lore (file read/write via PlatformAdapter)
// ===========================================================================

/** 防止路径穿越：去除 / \ .. 和开头的点 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\/\\]/g, "")
    .replace(/\.\./g, "")
    .replace(/^\.+/, "")
    .trim();
}

export async function saveLore(req: { au_path?: string; fandom_path?: string; category: string; filename: string; content: string }) {
  const { adapter } = getEngine();
  const basePath = req.au_path ?? req.fandom_path ?? "";
  const safeFilename = sanitizeFilename(req.filename);
  if (!safeFilename) throw new Error("Invalid filename");
  const filePath = `${basePath}/${req.category}/${safeFilename}`;
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  await adapter.mkdir(dir);
  await adapter.writeFile(filePath, req.content);
  return { status: "ok", path: filePath };
}

export async function readLore(req: { au_path?: string; fandom_path?: string; category: string; filename: string }) {
  const { adapter } = getEngine();
  const basePath = req.au_path ?? req.fandom_path ?? "";
  const safeFilename = sanitizeFilename(req.filename);
  if (!safeFilename) throw new Error("Invalid filename");
  const filePath = `${basePath}/${req.category}/${safeFilename}`;
  const content = await adapter.readFile(filePath);
  return { content };
}

export async function deleteLore(req: { au_path?: string; fandom_path?: string; category: string; filename: string }) {
  const basePath = req.au_path ?? req.fandom_path ?? "";
  const safeFilename = sanitizeFilename(req.filename);
  if (!safeFilename) throw new Error("Invalid filename");
  const relativePath = `${req.category}/${safeFilename}`;
  const entry = await getEngine().trash.move_to_trash(basePath, relativePath, "lore_file", req.filename);
  return { status: "ok", trash_id: entry.trash_id, deleted: relativePath };
}

export async function listLoreFiles(params: { category: string; au_path?: string; fandom_path?: string }) {
  const { adapter } = getEngine();
  const basePath = params.au_path ?? params.fandom_path ?? "";
  const dirPath = `${basePath}/${params.category}`;
  const exists = await adapter.exists(dirPath);
  if (!exists) return { files: [] };
  const files = await adapter.listDir(dirPath);
  return {
    files: files.filter((f) => f.endsWith(".md")).sort().map((f) => ({
      name: f.replace(/\.md$/, ""),
      filename: f,
    })),
  };
}

// ===========================================================================
// Settings Chat
// ===========================================================================

export async function sendSettingsChat(params: {
  mode: string;
  base_path: string;
  fandom_path?: string;
  messages: any[];
  session_llm?: { api_base?: string; api_key?: string; model?: string };
}) {
  const { adapter } = getEngine();
  const { settings } = getEngine().repos;
  const sett = await settings.get();

  const lang = sett.app?.language || "zh";
  const assembled = await build_settings_context({
    mode: params.mode as "au" | "fandom",
    base_path: params.base_path,
    fandom_path: params.fandom_path,
    messages: params.messages,
    adapter,
    language: lang,
  });

  const llmConfig = resolve_llm_config(
    params.session_llm as Record<string, string> | null,
    {} as Record<string, string>,
    sett as { default_llm?: { mode?: string; model?: string; api_base?: string; api_key?: string } },
  );
  // Settings chat 需要 API 模式（tool calling 只有 API 支持）
  if (llmConfig.mode !== "api") {
    throw new Error("设定模式对话需要 API 模式的 LLM 配置（local/ollama 不支持 tool calling）");
  }
  const provider = create_provider(llmConfig);
  const result = await call_settings_llm(assembled, params.mode as "au" | "fandom", provider);

  return {
    content: result.content,
    tool_calls: result.tool_calls,
  };
}

// ===========================================================================
// Fandoms (filesystem operations)
// ===========================================================================

export async function listFandoms(dataDir?: string) {
  const dd = dataDir ?? getDataDir();
  const { fandom } = getEngine().repos;
  const names = await fandom.list_fandoms(dd);
  const result = [];
  for (const name of names) {
    // 复用 listAus 的过滤逻辑（排除已删除的 AU）
    const aus = await listAus(name, dd);
    result.push({ name, dir_name: name, aus });
  }
  return result;
}

/** 路径安全检查：拒绝含 /, .., 或平台非法字符的名称 */
function sanitizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("名称不能为空");
  if (/[/\\]|\.\./.test(trimmed)) throw new Error(`名称含非法字符: ${trimmed}`);
  return trimmed;
}

export async function createFandom(name: string, dataDir?: string) {
  const safeName = sanitizeName(name);
  const dd = dataDir ?? getDataDir();
  const { fandom } = getEngine().repos;
  const { adapter } = getEngine();
  const path = `${dd}/fandoms/${safeName}`;
  if (await adapter.exists(`${path}/fandom.yaml`)) {
    throw new Error(`Fandom "${safeName}" already exists`);
  }
  await adapter.mkdir(path);
  await fandom.save(path, { name: safeName, created_at: new Date().toISOString(), core_characters: [], wiki_source: "" });
  return { name: safeName, path };
}

export async function listAus(fandomName: string, dataDir?: string) {
  const dd = dataDir ?? getDataDir();
  const { fandom } = getEngine().repos;
  const { adapter } = getEngine();
  const auDirs = await fandom.list_aus(`${dd}/fandoms/${fandomName}`);
  // 过滤掉 project.yaml 已被 trash 的 AU（deleteAu 只 trash project.yaml）
  const validAus: string[] = [];
  for (const au of auDirs) {
    if (await adapter.exists(`${dd}/fandoms/${fandomName}/aus/${au}/project.yaml`)) {
      validAus.push(au);
    }
  }
  return validAus;
}

export async function createAu(fandomName: string, auName: string, fandomPath: string) {
  const safeName = sanitizeName(auName);
  const { adapter } = getEngine();
  const auPath = `${fandomPath}/aus/${safeName}`;
  // 检查 AU 是否已存在
  if (await adapter.exists(`${auPath}/project.yaml`)) {
    throw new Error(`AU "${safeName}" already exists`);
  }
  await adapter.mkdir(auPath);
  // Initialize project.yaml
  const { project } = getEngine().repos;
  const { createProject } = await import("@ficforge/engine");
  const proj = createProject({ project_id: crypto.randomUUID(), au_id: auPath, name: auName, fandom: fandomName });
  await project.save(proj);
  return { name: auName, path: auPath };
}

export async function deleteFandom(fandomDirName: string, dataDir?: string) {
  const dd = dataDir ?? getDataDir();
  const { adapter } = getEngine();
  const fandomRoot = `${dd}/fandoms/${fandomDirName}`;

  // 先 trash 所有 AU 的 project.yaml（使 listAus 不再列出它们）
  const ausDir = `${fandomRoot}/aus`;
  if (await adapter.exists(ausDir)) {
    const auDirs = await adapter.listDir(ausDir);
    for (const au of auDirs) {
      try {
        await getEngine().trash.move_to_trash(fandomRoot, `aus/${au}/project.yaml`, "au", au);
      } catch { /* 可能已删或不存在 */ }
    }
  }

  // 再 trash fandom.yaml（使 listFandoms 不再列出此 fandom）
  const entry = await getEngine().trash.move_to_trash(fandomRoot, "fandom.yaml", "fandom", fandomDirName);
  return { status: "ok", trash_id: entry.trash_id };
}

export async function deleteAu(fandomDirName: string, auName: string, dataDir?: string) {
  const dd = dataDir ?? getDataDir();
  // AU 是目录——在 fandom 级别的 .trash/ 创建记录（这样 Library 的 TrashPanel 能看到）
  const fandomRoot = `${dd}/fandoms/${fandomDirName}`;
  const entry = await getEngine().trash.move_to_trash(
    fandomRoot, `aus/${auName}/project.yaml`, "au", auName,
  );
  return { status: "ok", trash_id: entry.trash_id };
}

export async function listFandomFiles(fandomName: string, dataDir?: string) {
  const dd = dataDir ?? getDataDir();
  const { adapter } = getEngine();
  const base = `${dd}/fandoms/${fandomName}`;
  const readDir = async (sub: string) => {
    const dir = `${base}/${sub}`;
    if (!(await adapter.exists(dir))) return [];
    const files = await adapter.listDir(dir);
    return files.filter((f) => f.endsWith(".md")).sort().map((f) => ({ name: f.replace(/\.md$/, ""), filename: f }));
  };
  return { characters: await readDir("core_characters"), worldbuilding: await readDir("core_worldbuilding") };
}

export async function readFandomFile(fandomName: string, category: string, filename: string, dataDir?: string) {
  const dd = dataDir ?? getDataDir();
  const { adapter } = getEngine();
  const content = await adapter.readFile(`${dd}/fandoms/${fandomName}/${category}/${filename}`);
  return { filename, category, content };
}

export async function renameFandom(_fandomDirName: string, _newName: string, _dataDir?: string) {
  // Filesystem rename not directly supported by PlatformAdapter. Requires read+write+delete.
  throw new Error("renameFandom not yet implemented in engine-client");
}

export async function renameAu(_fandomDirName: string, _auName: string, _newName: string, _dataDir?: string) {
  throw new Error("renameAu not yet implemented in engine-client");
}

// ===========================================================================
// Missing Facts functions
// ===========================================================================

export async function batchUpdateFactStatus(auPath: string, factIds: string[], newStatus: string) {
  const { fact, ops, state } = getEngine().repos;
  let updated = 0;
  let failed = 0;
  for (const fid of factIds) {
    try {
      await update_fact_status(auPath, fid, newStatus, 0, fact, ops, state);
      updated++;
    } catch {
      failed++;
    }
  }
  return { updated, failed };
}

export async function extractFacts(auPath: string, chapterNum: number) {
  // This requires LLM call — delegate to the engine's extract function
  const { extract_facts_from_chapter } = await import("@ficforge/engine");
  const e = getEngine();
  const chapterContent = await e.repos.chapter.get_content_only(auPath, chapterNum);
  const existingFacts = await e.repos.fact.list_all(auPath);
  const proj = await e.repos.project.get(auPath);
  const sett = await e.repos.settings.get();
  const llmConfig = resolve_llm_config(null, proj as { llm?: { mode?: string; model?: string; api_base?: string; api_key?: string } }, sett as { default_llm?: { mode?: string; model?: string; api_base?: string; api_key?: string } });
  if (llmConfig.mode !== "api") throw new Error("Facts 提取需要 API 模式的 LLM 配置");
  const provider = create_provider(llmConfig);
  const lang = sett.app?.language || "zh";
  const facts = await extract_facts_from_chapter(
    chapterContent, chapterNum, existingFacts,
    proj.cast_registry, null, provider, llmConfig, undefined, lang,
  );
  return { facts };
}

export async function extractFactsBatch(auPath: string, chapterNums: number[]) {
  const { extract_facts_batch } = await import("@ficforge/engine");
  const e = getEngine();
  const chapters = [];
  for (const num of chapterNums) {
    const content = await e.repos.chapter.get_content_only(auPath, num);
    chapters.push({ chapter_num: num, content });
  }
  const existingFacts = await e.repos.fact.list_all(auPath);
  const proj = await e.repos.project.get(auPath);
  const sett = await e.repos.settings.get();
  const llmConfig = resolve_llm_config(null, proj as { llm?: { mode?: string; model?: string; api_base?: string; api_key?: string } }, sett as { default_llm?: { mode?: string; model?: string; api_base?: string; api_key?: string } });
  if (llmConfig.mode !== "api") throw new Error("Facts 批量提取需要 API 模式的 LLM 配置");
  const provider = create_provider(llmConfig);
  const facts = await extract_facts_batch(chapters, existingFacts, proj.cast_registry, null, provider);
  return { facts };
}

// ===========================================================================
// Missing Project functions
// ===========================================================================

export async function addPinned(auPath: string, text: string) {
  const { project } = getEngine().repos;
  const proj = await project.get(auPath);
  proj.pinned_context.push(text);
  await project.save(proj);
  return { status: "ok", revision: proj.revision };
}

export async function deletePinned(auPath: string, index: number) {
  const { project } = getEngine().repos;
  const proj = await project.get(auPath);
  if (index >= 0 && index < proj.pinned_context.length) {
    proj.pinned_context.splice(index, 1);
    await project.save(proj);
  }
  return { status: "ok", revision: proj.revision };
}

// ===========================================================================
// Missing Chapter functions
// ===========================================================================

export async function updateChapterContent(auPath: string, chapterNum: number, content: string) {
  const { chapter, state } = getEngine().repos;
  const ch = await chapter.get(auPath, chapterNum);
  ch.content = content;
  const { compute_content_hash } = await import("@ficforge/engine");
  ch.content_hash = await compute_content_hash(content);
  ch.provenance = "mixed";
  ch.revision += 1;
  await chapter.save(ch);
  // Mark dirty
  const st = await state.get(auPath);
  if (!st.chapters_dirty.includes(chapterNum)) {
    st.chapters_dirty.push(chapterNum);
    await state.save(st);
  }
  return { chapter_num: chapterNum, content_hash: ch.content_hash, provenance: ch.provenance, revision: ch.revision };
}

// ===========================================================================
// Import v2 API
// ===========================================================================

export type { FileAnalysis, ImportPlan, ImportConflictOptions, NewImportResult, ImportProgress, AnalysisOptions };

/**
 * 分析单个文件——检测对话格式 or 纯正文，返回分析结果。
 * 前端负责文件读取和格式转换（docx/html → 纯文本）。
 */
export async function analyzeImportFile(
  text: string,
  filename: string,
  options: AnalysisOptions = {},
): Promise<FileAnalysis> {
  // 如果用户开启了 AI 辅助但没传 provider，自动构建一个
  if (options.useAiAssist && !options.llmProvider) {
    try {
      const { settings } = getEngine().repos;
      const sett = await settings.get();
      const llmConfig = resolve_llm_config(null, {}, sett as unknown as Record<string, unknown>);
      if (llmConfig.mode === "api" && llmConfig.api_key) {
        options = { ...options, llmProvider: create_provider(llmConfig) };
      }
    } catch {
      // 无法构建 provider，禁用 AI 辅助
      options = { ...options, useAiAssist: false };
    }
  }
  const { analyzeFile } = await import("@ficforge/engine");
  return analyzeFile(text, filename, options);
}

/**
 * 从分析结果构建导入计划（多文件接续、"续"合并、设定收集）。
 */
export async function buildImportPlanFromAnalyses(
  analyses: FileAnalysis[],
  conflictOptions: ImportConflictOptions,
): Promise<ImportPlan> {
  const { buildImportPlan } = await import("@ficforge/engine");
  return buildImportPlan(analyses, conflictOptions);
}

/**
 * 执行导入计划——写入章节、设定、ops，更新 state。
 */
export async function executeImportPlan(
  plan: ImportPlan,
  auPath: string,
  onProgress?: (progress: ImportProgress) => void,
  locale?: "zh" | "en",
): Promise<NewImportResult> {
  const { executeImport } = await import("@ficforge/engine");
  const { adapter, repos, trash } = getEngine();
  return executeImport(plan, {
    auId: auPath,
    chapterRepo: repos.chapter,
    stateRepo: repos.state,
    opsRepo: repos.ops,
    adapter,
    trashService: trash,
    onProgress,
    locale,
  });
}

/**
 * 获取 AU 已有章节数（用于冲突检测）。
 */
export async function getExistingChapterNums(auPath: string): Promise<number[]> {
  const { chapter } = getEngine().repos;
  const chapters = await chapter.list_main(auPath);
  return chapters.map(c => c.chapter_num).sort((a, b) => a - b);
}

// ===========================================================================
// Legacy Import functions (backward-compatible)
// ===========================================================================

export async function uploadImportFile(file: File): Promise<import("./importExport").ImportUploadResponse> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "docx") {
    throw Object.assign(new Error("DOCX import is not supported in the local app yet."), {
      error_code: "UNSUPPORTED_IMPORT_FORMAT",
    });
  }

  const rawText = await file.text();
  const text = ext === "html" || ext === "htm" ? parse_html(rawText) : rawText;
  const chapters = split_into_chapters(text);
  const { get_split_method } = await import("@ficforge/engine");
  return {
    chapters: chapters.map((c) => ({ chapter_num: c.chapter_num, title: c.title, preview: c.content.slice(0, 100) })),
    split_method: get_split_method(text),
    total_chapters: chapters.length,
  };
}

export async function confirmImport(params: {
  au_path: string;
  chapters: { chapter_num: number; title: string; content: string }[];
  split_method?: string;
}) {
  const { chapter, state, ops } = getEngine().repos;
  const result = await engineImportChapters({
    au_id: params.au_path,
    chapters: params.chapters.map((c) => ({ chapter_num: c.chapter_num, title: c.title, content: c.content })),
    chapter_repo: chapter,
    state_repo: state,
    ops_repo: ops,
    split_method: params.split_method,
  });
  return result;
}

// ===========================================================================
// Lore: importFromFandom
// ===========================================================================

export async function importFromFandom(req: {
  fandom_path: string;
  au_path: string;
  filenames: string[];
  source_category?: string;
}) {
  const { adapter } = getEngine();
  const imported: string[] = [];
  const skipped: string[] = [];
  const srcCat = req.source_category ?? "core_characters";

  for (const filename of req.filenames) {
    const srcPath = `${req.fandom_path}/${srcCat}/${filename}`;
    const destCat = srcCat === "core_characters" ? "characters" : "worldbuilding";
    const destPath = `${req.au_path}/${destCat}/${filename}`;

    if (await adapter.exists(destPath)) {
      skipped.push(filename);
      continue;
    }

    try {
      const content = await adapter.readFile(srcPath);
      const dir = destPath.substring(0, destPath.lastIndexOf("/"));
      await adapter.mkdir(dir);
      await adapter.writeFile(destPath, content);
      imported.push(filename);
    } catch {
      skipped.push(filename);
    }
  }

  return { status: "ok", imported, skipped };
}

// ===========================================================================
// Lore: getLoreContent (alias for readLore)
// ===========================================================================

export async function getLoreContent(params: { category: string; filename: string; au_path?: string; fandom_path?: string }) {
  return readLore(params);
}

// ===========================================================================
// Sync
// ===========================================================================

export interface WebDAVConfig {
  url: string;
  username: string;
  password: string;
  remote_dir: string;
}

export interface AggregatedSyncResult {
  synced: boolean;
  fileConflicts: { path: string; auPath: string; localModified?: string; remoteModified?: string }[];
  opsConflicts: string[];
  opsAdded: number;
  filesPushed: number;
  filesPulled: number;
  errors: string[];
}

/** 从本地绝对路径提取远端相对路径。去掉 dataDir 前缀，只保留 fandoms/xxx/aus/yyy */
function toRemoteAuPath(localAuPath: string, dataDir: string): string {
  let rel = localAuPath;
  if (dataDir && rel.startsWith(dataDir)) {
    rel = rel.slice(dataDir.length);
  }
  // 去掉开头的 / 或 \
  return rel.replace(/^[/\\]+/, "").replace(/\\/g, "/");
}

export async function syncAllAus(webdavConfig: WebDAVConfig): Promise<AggregatedSyncResult> {
  const { SyncManager, WebDAVSyncAdapter } = await import("@ficforge/engine");
  const { adapter, repos } = getEngine();
  const dd = getDataDir();
  const baseUrl = webdavConfig.url.replace(/\/+$/, '') + webdavConfig.remote_dir;
  const syncAdapter = new WebDAVSyncAdapter(baseUrl, webdavConfig.username, webdavConfig.password);
  const syncManager = new SyncManager(adapter, repos.ops, repos.state, syncAdapter);

  const agg: AggregatedSyncResult = {
    synced: true, fileConflicts: [], opsConflicts: [],
    opsAdded: 0, filesPushed: 0, filesPulled: 0, errors: [],
  };

  try {
    const fandoms = await listFandoms(dd);
    for (const fandom of fandoms) {
      for (const auName of fandom.aus) {
        const localPath = `${dd}/fandoms/${fandom.dir_name}/aus/${auName}`;
        const remotePath = toRemoteAuPath(localPath, dd);
        try {
          const result: SyncResult = await syncManager.sync(localPath, remotePath);
          if (!result.synced) {
            agg.errors.push(`${fandom.name}/${auName}: ${result.conflicts.map(c => c.description).join('; ')}`);
          }
          // S4: 收集 ops 冲突（非 sync_error 类型的 conflicts）
          for (const c of result.conflicts) {
            if (c.type !== "sync_error") {
              agg.opsConflicts.push(`${fandom.name}/${auName}: ${c.description}`);
            }
          }
          agg.opsAdded += result.opsAdded;
          agg.filesPushed += result.filesPushed;
          agg.filesPulled += result.filesPulled;
          for (const fc of result.fileConflicts) {
            agg.fileConflicts.push({ ...fc, auPath: localPath });
          }
        } catch (e) {
          agg.errors.push(`${fandom.name}/${auName}: ${String(e)}`);
        }
      }
    }
    if (agg.errors.length > 0 && agg.fileConflicts.length === 0) {
      agg.synced = false;
    }
  } catch (e) {
    agg.synced = false;
    agg.errors.push(String(e));
  }

  return agg;
}

export async function resolveFileConflict(
  auPath: string,
  filePath: string,
  choice: "local" | "remote",
  webdavConfig: WebDAVConfig,
): Promise<void> {
  const { WebDAVSyncAdapter } = await import("@ficforge/engine");
  const { adapter } = getEngine();
  const dd = getDataDir();
  const baseUrl = webdavConfig.url.replace(/\/+$/, '') + webdavConfig.remote_dir;
  const syncAdapter = new WebDAVSyncAdapter(baseUrl, webdavConfig.username, webdavConfig.password);

  const localFullPath = `${auPath}/${filePath}`;
  // 远端路径用相对路径
  const remoteAuPath = toRemoteAuPath(auPath, dd);
  const remotePath = `${remoteAuPath}/${filePath}`;

  if (choice === "local") {
    const localContent = await adapter.readFile(localFullPath);
    await syncAdapter.pushFile(remotePath, localContent);
  } else {
    const remoteContent = await syncAdapter.pullFile(remotePath);
    await adapter.writeFile(localFullPath, remoteContent);
  }
}
