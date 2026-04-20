// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 生成引擎。参见 PRD §4.2、§4.3。
 * 串联上下文组装器 + LLM Provider，输出草稿文件。
 * 返回 AsyncGenerator，前端直接消费。
 */

import type { BudgetReport } from "../domain/budget_report.js";
import type { ContextSummary } from "../domain/context_summary.js";
import { FactStatus, IndexStatus } from "../domain/enums.js";
import type { Fact } from "../domain/fact.js";
import type { GeneratedWith } from "../domain/generated_with.js";
import { createGeneratedWith } from "../domain/generated_with.js";
import type { Project } from "../domain/project.js";
import type { Settings } from "../domain/settings.js";
import type { State } from "../domain/state.js";
import { createDraft } from "../domain/draft.js";
import type { PlatformAdapter } from "../platform/adapter.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { DraftRepository } from "../repositories/interfaces/draft.js";
import type { VectorRepository } from "../repositories/interfaces/vector.js";
import type { LLMProvider } from "../llm/provider.js";
import { LLMError } from "../llm/provider.js";
import type { EmbeddingProvider } from "../llm/embedding_provider.js";
import type { ResolvedLLMConfig, ResolvedLLMParams } from "../llm/config_resolver.js";
import { create_provider, resolve_llm_config, resolve_llm_params } from "../llm/config_resolver.js";
import { assemble_context } from "./context_assembler.js";
import type { ChunkWithCollection } from "./rag_retrieval.js";
import { build_active_chars, build_rag_query, retrieve_rag, toRagChunkDetail } from "./rag_retrieval.js";
import { now_utc, joinPath } from "../repositories/implementations/file_utils.js";
import { withAuLock } from "./au_lock.js";

// ---------------------------------------------------------------------------
// 事件类型
// ---------------------------------------------------------------------------

export type GenerationEvent =
  | { type: "context_summary"; data: ContextSummary }
  | { type: "token"; data: string }
  | { type: "done"; data: GenerationDoneData }
  | { type: "error"; data: GenerationErrorData };

export interface GenerationDoneData {
  draft_label: string;
  full_text: string;
  budget_report: BudgetReport;
  generated_with: GeneratedWith;
}

export interface GenerationErrorData {
  error_code: string;
  message: string;
  actions: string[];
  partial_draft_label: string | null;
}

// ---------------------------------------------------------------------------
// 幂等控制
// ---------------------------------------------------------------------------

const _generating = new Map<string, boolean>();

function genKey(au_id: string, chapter_num: number): string {
  return `${au_id}:${chapter_num}`;
}

// ---------------------------------------------------------------------------
// 草稿标签分配
// ---------------------------------------------------------------------------

export class DraftLabelExhaustedError extends Error {
  constructor() {
    super("草稿标签已用尽（A-Z），请先定稿或删除部分草稿");
    this.name = "DraftLabelExhaustedError";
  }
}

function nextDraftLabel(existingLabels: string[]): string {
  if (existingLabels.length === 0) return "A";
  const used = new Set(existingLabels);
  for (let i = 0; i < 26; i++) {
    const label = String.fromCharCode(65 + i);
    if (!used.has(label)) return label;
  }
  throw new DraftLabelExhaustedError();
}

// ---------------------------------------------------------------------------
// 空意图识别
// ---------------------------------------------------------------------------

const EMPTY_PATTERNS = new Set([
  "继续", "然后呢", "然后", "接着写", "接着", "continue", "go on", "",
]);

export function is_empty_intent(user_input: string): boolean {
  const stripped = user_input.trim().toLowerCase();
  return EMPTY_PATTERNS.has(stripped) || stripped.length < 3;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 设定文件加载（对应 Python _load_md_files）
// ---------------------------------------------------------------------------

async function loadMdFiles(
  adapter: PlatformAdapter,
  dirPath: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const exists = await adapter.exists(dirPath);
  if (!exists) return result;

  const files = await adapter.listDir(dirPath);
  for (const f of files.sort()) {
    if (!f.endsWith(".md")) continue;
    try {
      const content = await adapter.readFile(joinPath(dirPath, f));
      const stem = f.replace(/\.md$/, "");
      result[stem] = content;
    } catch {
      continue;
    }
  }
  return result;
}

export interface GenerateChapterParams {
  au_id: string;
  chapter_num: number;
  user_input: string;
  session_llm: Record<string, string> | null;
  session_params: Record<string, number> | null;
  project: Project;
  state: State;
  settings: Settings;
  facts: Fact[];
  chapter_repo: ChapterRepository;
  draft_repo: DraftRepository;
  /** 文件系统适配器（用于加载角色/世界观设定文件）。 */
  adapter?: PlatformAdapter;
  /** 预加载的角色设定文件，传入则跳过磁盘加载。 */
  character_files?: Record<string, string> | null;
  /** 预加载的世界观设定文件，传入则跳过磁盘加载。 */
  worldbuilding_files?: Record<string, string> | null;
  /** 向量仓库（用于 RAG 检索）。 */
  vector_repo?: VectorRepository;
  /** Embedding 提供者（RAG 检索用）。 */
  embedding_provider?: EmbeddingProvider;
  /** 预计算的 RAG 文本，传入则跳过内部 RAG。 */
  rag_text?: string | null;
  language?: string;
  signal?: AbortSignal;
  /** 测试用：注入 mock provider，跳过 create_provider。 */
  _provider_override?: LLMProvider;
}

export async function* generate_chapter(
  params: GenerateChapterParams,
): AsyncGenerator<GenerationEvent> {
  const {
    au_id, chapter_num, user_input,
    session_llm, session_params,
    project, state, settings,
    facts, chapter_repo, draft_repo,
    adapter,
    vector_repo,
    embedding_provider,
    language = "zh",
  } = params;
  let { character_files = null, worldbuilding_files = null, rag_text = null } = params;

  const key = genKey(au_id, chapter_num);

  // --- 幂等 409 ---
  if (_generating.get(key)) {
    yield {
      type: "error",
      data: {
        error_code: "GENERATION_IN_PROGRESS",
        message: "该章节正在生成中，请等待完成",
        actions: [],
        partial_draft_label: null,
      },
    };
    return;
  }

  _generating.set(key, true);
  let label = "";
  let fullText = "";
  const startTime = performance.now();

  try {
    // === 步骤 1：解析配置和参数 ===
    const llmConfig: ResolvedLLMConfig = resolve_llm_config(session_llm, project, settings);
    const modelName = llmConfig.model;
    const llmParams: ResolvedLLMParams = resolve_llm_params(modelName, session_params, project, settings);
    const provider: LLMProvider = params._provider_override ?? create_provider(llmConfig);

    // === 步骤 1.5：加载角色与世界观设定文件（P5 核心设定用）===
    if (character_files === null && adapter) {
      character_files = await loadMdFiles(adapter, joinPath(au_id, "characters"));
    }
    if (worldbuilding_files === null && adapter) {
      worldbuilding_files = await loadMdFiles(adapter, joinPath(au_id, "worldbuilding"));
    }

    // === 步骤 1.8：RAG 检索（STALE 索引时跳过，避免旧 chunk 污染上下文）===
    const indexReady = state.index_status === IndexStatus.READY;
    let ragChunksDetail: ChunkWithCollection[] = [];
    if (rag_text === null && vector_repo && embedding_provider && indexReady) {
      try {
        const castReg = project.cast_registry ?? { characters: [] };
        const activeChars = build_active_chars(state, user_input, project, facts, castReg);
        const focusTexts = facts.filter((f) => f.status === FactStatus.ACTIVE).map((f) => f.content_clean);
        const lastEnding = state.last_scene_ending ?? "";
        const query = build_rag_query(focusTexts, lastEnding, user_input);
        if (query) {
          const ragBudget = Math.max(0, Math.trunc((project.llm?.context_window || 128000) / 4));
          const [ragResult, , chunks] = await retrieve_rag(
            vector_repo, embedding_provider, au_id, query,
            ragBudget, activeChars, llmConfig,
            project.rag_decay_coefficient ?? 0.05,
            state.current_chapter ?? 1, language,
          );
          if (ragResult) {
            rag_text = ragResult;
            ragChunksDetail = chunks;
          }
        }
      } catch {
        // RAG 失败不中断生成
      }
    }

    // === 步骤 2：组装上下文 ===
    const ctx = await assemble_context(
      project, state, user_input, facts,
      chapter_repo, au_id,
      rag_text,
      character_files,
      worldbuilding_files,
      language,
    );
    const { messages, max_tokens, budget_report, context_summary } = ctx;

    // 把结构化 RAG 片段挂到 summary（assemble_context 只看纯文本，这里外挂 detail）
    context_summary.rag_chunks = ragChunksDetail
      .map(toRagChunkDetail)
      .filter((d): d is NonNullable<typeof d> => d !== null);
    // 用 chunks 数覆盖原按行统计，保证 UI 数字与展示条数一致。
    // 仅在走了内部 RAG（即拿到结构化 chunks）时覆盖；外部传入 rag_text 场景保留 context_assembler 按行算的值。
    if (ragChunksDetail.length > 0) {
      context_summary.rag_chunks_retrieved = context_summary.rag_chunks.length;
    }

    // === 步骤 2.5：yield context_summary ===
    yield { type: "context_summary", data: context_summary };

    // === 步骤 3：分配草稿标签 ===
    const existingDrafts = await draft_repo.list_by_chapter(au_id, chapter_num);
    const existingLabels = existingDrafts.map((d) => d.variant);
    label = nextDraftLabel(existingLabels);

    // === 步骤 4：调用 LLM（流式）===
    let outputTokens: number | null = null;

    for await (const chunk of provider.generateStream({
      messages,
      max_tokens,
      temperature: llmParams.temperature,
      top_p: llmParams.top_p,
      signal: params.signal,
    })) {
      if (chunk.delta) {
        fullText += chunk.delta;
        yield { type: "token", data: chunk.delta };
      }
      if (chunk.output_tokens !== null) outputTokens = chunk.output_tokens;
      if (chunk.input_tokens !== null) budget_report.total_input_tokens = chunk.input_tokens;
    }

    // === 步骤 5：写入草稿 ===
    const elapsedMs = Math.trunc(performance.now() - startTime);
    const ts = now_utc();

    const gw = createGeneratedWith({
      mode: llmConfig.mode,
      model: modelName,
      temperature: llmParams.temperature,
      top_p: llmParams.top_p,
      input_tokens: budget_report.total_input_tokens,
      output_tokens: outputTokens ?? 0,
      char_count: fullText.length,
      duration_ms: elapsedMs,
      generated_at: ts,
    });

    const draft = createDraft({
      au_id,
      chapter_num,
      variant: label,
      content: fullText,
      generated_with: gw,
    });
    // 只对"写 draft"这一小段持 AU 锁，不锁整个生成流程 —— 否则 30 秒的
    // 流式生成会阻塞 UI 对同 AU 的所有其它写操作（confirm / undo / editFact 等）。
    await withAuLock(au_id, async () => {
      await draft_repo.save(draft);
    });

    // === 步骤 6：yield done ===
    yield {
      type: "done",
      data: {
        draft_label: label,
        full_text: fullText,
        budget_report,
        generated_with: gw,
      },
    };
  } catch (e) {
    if (e instanceof DOMException ? e.name === "AbortError" : e instanceof Error && e.name === "AbortError") {
      throw e;
    }

    // === 错误处理：保留部分文本为草稿 ===
    if (fullText && label) {
      const draft = createDraft({
        au_id,
        chapter_num,
        variant: label,
        content: fullText,
      });
      await withAuLock(au_id, async () => {
        await draft_repo.save(draft);
      });
    }

    if (e instanceof LLMError) {
      yield {
        type: "error",
        data: {
          error_code: e.error_code,
          message: e.message,
          actions: e.actions,
          partial_draft_label: fullText ? label : null,
        },
      };
    } else {
      yield {
        type: "error",
        data: {
          error_code: "INTERNAL_ERROR",
          message: String(e),
          actions: [],
          partial_draft_label: fullText ? label : null,
        },
      };
    }
  } finally {
    _generating.delete(key);
  }
}
