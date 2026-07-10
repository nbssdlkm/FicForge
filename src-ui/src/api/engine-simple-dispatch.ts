// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Simple Dispatch — FicForge Lite 简版统一对话调度入口。
 *
 * 单次 LLM streaming + tools 调用：可能流式输出章节正文，也可能 emit tool calls
 * （show_chapter / show_setting / modify_*_file 等）。SimpleChatPanel 据 event 类型
 * 路由到对应的 message kind 渲染。
 */

import {
  dispatch_simple_chat,
  resolve_llm_config,
  type Message,
  type SimpleChatEvent,
} from "@ficforge/engine";
import { getEngine, getProjectOrThrow } from "./engine-instance";
import { createEmbeddingProvider } from "./engine-state";

export type {
  SimpleChatEvent,
};

export interface DispatchSimpleChatParams {
  au_path: string;
  chapter_num: number;
  user_input: string;
  /**
   * 多轮对话历史（OpenAI 格式 user/assistant alternating）。前端用
   * chatToOpenAIMessages helper 把 SimpleChatMessage[] 转过来传过来。
   * 简版"全塞"哲学：不截取不简化，让 LLM 看到完整对话连续性。空数组 = 首轮。
   *
   * agent MVP 后支持 tool_calls / tool_call_id（OpenAI 协议）；dispatch 把 history
   * 直接拼到 messages 数组发给 provider。Message 是 engine 单一真相源类型，UI 端
   * `chat-to-llm.OpenAIChatMessage` 是它的 type alias（v4-pro C2 review P1-1）。
   */
  history?: Message[];
  session_llm?: Record<string, string> | null;
  session_params?: Record<string, number> | null;
}

export async function* dispatchSimpleChat(
  params: DispatchSimpleChatParams,
  options?: { signal?: AbortSignal },
): AsyncGenerator<SimpleChatEvent> {
  const e = getEngine();
  const proj = await getProjectOrThrow(params.au_path);
  const st = await e.repos.state.get(params.au_path);
  const sett = await e.repos.settings.get();

  // local 模式拦截（同 generateChapter 防手改 YAML）
  const llmConfig = resolve_llm_config(params.session_llm ?? null, proj, sett);
  if (llmConfig.mode === "local") {
    yield {
      type: "error",
      data: {
        error_code: "UNSUPPORTED_MODE",
        message: "本版本不支持 local 模式（本地模型加载）。请切换到 API 或 Ollama 模式。",
        actions: ["check_settings"],
        partial_draft_label: null,
      },
    };
    return;
  }

  const lang = (sett.app?.language === "en" ? "en" : "zh") as "zh" | "en";

  // 记忆栈注入(融合 plan §1.1,与 generate_chapter 同源):facts / threads / 向量 / embedding,
  // 供 assemble_chat_context(§1.2)分层组装。threads 取失败不致命,回退空。
  const allFacts = await e.repos.fact.list_all(params.au_path);
  const threads = await e.repos.thread.list(params.au_path).catch(() => []);

  // 加载当前 AU 的向量索引供 RAG 检索（与 generateChapter engine-generate.ts 对称，审计③修复）。
  // TD-017：vectorRepoFor 返回该 AU 独立引擎；缺此步时对话的 P4 RAG 层会静默返回空，
  // 「对话与写文共用同一记忆栈」的承诺在 RAG 这层会漏。索引未建 → 返回空库、不阻断对话。
  const vectorRepo = await e.ragManager.vectorRepoFor(params.au_path);

  for await (const ev of dispatch_simple_chat({
    au_id: params.au_path,
    chapter_num: params.chapter_num,
    user_input: params.user_input,
    history: params.history ?? [],
    session_llm: params.session_llm ?? null,
    session_params: params.session_params ?? null,
    project: proj,
    state: st,
    settings: sett,
    facts: allFacts,
    threads,
    vector_repo: vectorRepo,
    embedding_provider: createEmbeddingProvider(sett, proj),
    chapter_repo: e.repos.chapter,
    draft_repo: e.repos.draft,
    adapter: e.adapter,
    language: lang,
    signal: options?.signal,
  })) {
    yield ev;
  }
}
