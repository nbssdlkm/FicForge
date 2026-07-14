// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Generate — generateChapter (async generator).
 */

import {
  generateChapter as engineGenerateChapter,
  resolveLlmConfig,
  logCatch,
  type GenerationEvent,
} from "@ficforge/engine";
import { getEngine, getProjectOrThrow } from "./engine-instance";
import { createEmbeddingProvider } from "./engine-state";

export async function* generateChapter(
  params: {
    au_path: string;
    chapter_num: number;
    user_input: string;
    input_type?: string;
    session_llm?: Record<string, string> | null;
    session_params?: Record<string, number> | null;
  },
  options?: { signal?: AbortSignal },
): AsyncGenerator<
  | { event: "token"; data: { text: string } }
  | { event: "context_summary"; data: Extract<GenerationEvent, { type: "context_summary" }>["data"] }
  | { event: "done"; data: Extract<GenerationEvent, { type: "done" }>["data"] }
  | {
      event: "error";
      data: { error_code: string; message: string; actions: string[]; partial_draft_label?: string | null };
    }
> {
  const e = getEngine();
  const proj = await getProjectOrThrow(params.au_path);
  const st = await e.repos.state.get(params.au_path);
  const allFacts = await e.repos.fact.listAll(params.au_path);
  // M8-B: 活跃剧情线注入。best-effort — 读失败降级 [] 不阻断续写，但记日志（非静默吞错）。
  const threads = await e.repos.thread.list(params.au_path).catch((err) => {
    logCatch("generate", "thread list load failed; degrading to no thread injection", err);
    return [];
  });
  const sett = await e.repos.settings.get();

  // 验证 LLM 模式。api 和 ollama 走 OpenAI 兼容协议，正常放行。
  // local（内置模型加载）随 Python sidecar 退役（D-0040/M7）本版本不支持 —— 在
  // createProvider 里抛错之前提前拦截，给前端友好的 error_code（UI 层 capabilities.ts
  // 已不渲染该选项，此处作为防手改 YAML 的最后防线）。
  const llmConfig = resolveLlmConfig(params.session_llm ?? null, proj, sett);
  if (llmConfig.mode === "local") {
    yield {
      event: "error",
      data: {
        error_code: "UNSUPPORTED_MODE",
        message: "本版本不支持 local 模式（本地模型加载）。请在设置中切换到 API 或 Ollama 模式。",
        actions: ["check_settings"],
      },
    };
    return;
  }

  // Load vector index for RAG retrieval (F7) — delegated to RagManager。
  // TD-017：vectorRepoFor 返回该 AU 独立引擎（per-AU 隔离）；索引损坏/未建时返回空库（搜索得 0
  // 结果而非抛错），等价旧 e.vectorEngine 空态回退。
  const vectorRepo = await e.ragManager.vectorRepoFor(params.au_path);
  // E8：别名表供 RAG 活跃角色过滤（buildActiveChars）—— 正文/输入只出现别名时主名也进 char_filter，
  // 与提取/扫描侧共用同一张表。get 异步且永不抛错（无角色卡 → null，char_filter 逐字节回退现状）。
  const characterAliases = await e.characterAliases.get(params.au_path);

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
    threads,
    chapter_repo: e.repos.chapter,
    draft_repo: e.repos.draft,
    adapter: e.adapter,
    vector_repo: vectorRepo,
    embedding_provider: createEmbeddingProvider(sett, proj),
    character_aliases: characterAliases,
    signal: options?.signal,
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
