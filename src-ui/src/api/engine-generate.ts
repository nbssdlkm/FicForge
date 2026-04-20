// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Generate — generateChapter (async generator).
 */

import {
  generate_chapter as engineGenerateChapter,
  resolve_llm_config,
} from "@ficforge/engine";
import { getEngine } from "./engine-instance";
import { createEmbeddingProvider } from "./engine-state";

export async function* generateChapter(params: {
  au_path: string;
  chapter_num: number;
  user_input: string;
  input_type?: string;
  session_llm?: Record<string, string> | null;
  session_params?: Record<string, number> | null;
}, options?: { signal?: AbortSignal }): AsyncGenerator<{ event: string; data: any }> {
  const e = getEngine();
  const proj = await e.repos.project.get(params.au_path);
  const st = await e.repos.state.get(params.au_path);
  const allFacts = await e.repos.fact.list_all(params.au_path);
  const sett = await e.repos.settings.get();

  // 验证 LLM 模式。api 和 ollama 走 OpenAI 兼容协议，正常放行。
  // local 需要 Python sidecar 扩展，当前未实现 —— 在 create_provider 里抛错之前
  // 提前拦截，给前端友好的 error_code（UI 层 capabilities.ts 已禁用选项，
  // 此处作为防手改 YAML 的最后防线）。
  const llmConfig = resolve_llm_config(
    params.session_llm ?? null,
    proj,
    sett,
  );
  if (llmConfig.mode === "local") {
    yield {
      event: "error",
      data: {
        error_code: "UNSUPPORTED_MODE",
        message: "local 模式需要 Python sidecar 扩展支持，当前版本暂未实现。请在设置中切换到 API 或 Ollama 模式。",
        actions: ["check_settings"],
      },
    };
    return;
  }

  // Load vector index for RAG retrieval (F7) — delegated to RagManager
  try {
    await e.ragManager.ensureLoaded(params.au_path);
  } catch {
    // Vector index not yet created — search will return empty results
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
    embedding_provider: createEmbeddingProvider(sett),
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
