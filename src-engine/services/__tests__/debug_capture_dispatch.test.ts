// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 对话路径（dispatchSimpleChat）调试包捕获测试（spec 2026-09-08 v3）：
 * 成功 / LLM 抛错 / harness 直产终态（empty_response）/ 前置解析失败 / 多轮迭代快照 / disabled。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { dispatchSimpleChat, type SimpleChatEvent } from "../simple_chat_dispatch.js";
import { createProject, createLLMConfig } from "../../domain/project.js";
import { createState } from "../../domain/state.js";
import { createSettings } from "../../domain/settings.js";
import { LLMMode } from "../../domain/enums.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileDraftRepository } from "../../repositories/implementations/file_draft.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { LLMError, type LLMProvider } from "../../llm/provider.js";
import { createMockLLMProvider, createScriptedStreamProvider } from "./mock_llm_provider.js";
import { clearDebugBundles, getDebugBundle, listDebugBundles, setDebugCaptureEnabled } from "../../debug/index.js";

function makeBaseParams(adapter: MockAdapter, providerOverride: LLMProvider | undefined, userInput: string) {
  return {
    au_id: "au_test",
    chapter_num: 1,
    user_input: userInput,
    session_llm: null,
    session_params: null,
    project: createProject({
      project_id: "p",
      au_id: "au_test",
      llm: createLLMConfig({ mode: LLMMode.API, model: "test", api_base: "x", api_key: "k" }),
    }),
    state: createState({ au_id: "au_test", current_chapter: 1 }),
    settings: createSettings(),
    chapter_repo: new FileChapterRepository(adapter),
    draft_repo: new FileDraftRepository(adapter),
    adapter,
    _provider_override: providerOverride,
  };
}

async function collect(gen: AsyncGenerator<SimpleChatEvent>): Promise<SimpleChatEvent[]> {
  const events: SimpleChatEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

describe("dispatchSimpleChat 调试包捕获", () => {
  beforeEach(() => {
    setDebugCaptureEnabled(true);
    clearDebugBundles();
  });

  it("成功 text 路径：capture 一次，result 带 generated_with 统计，start === final", async () => {
    const adapter = new MockAdapter();
    const provider = createMockLLMProvider({
      streamChunks: [
        { delta: "正文", is_final: false, input_tokens: 10, output_tokens: null, finish_reason: null },
        { delta: "完", is_final: true, input_tokens: null, output_tokens: 2, finish_reason: "stop" },
      ],
    });
    const events = await collect(dispatchSimpleChat(makeBaseParams(adapter, provider, "写第一章")));
    expect(events.some((e) => e.type === "done_text")).toBe(true);

    const list = listDebugBundles();
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe("chat");
    expect(list[0].status).toBe("ok");
    expect(list[0].iterations).toBe(1);

    const bundle = getDebugBundle(list[0].id)!;
    expect(bundle.model).toBe("test");
    expect(bundle.params?.max_tokens).toBeGreaterThan(0);
    expect(bundle.start_messages.length).toBeGreaterThanOrEqual(2); // system + user
    expect(bundle.final_messages).toEqual(bundle.start_messages);
    expect(bundle.budget_report).not.toBeNull();
    expect(bundle.context_summary).not.toBeNull();
    expect(bundle.result?.output_tokens).toBe(2);
    expect(bundle.result?.draft_label).toBe("A");
  });

  it("LLM 抛错（catch 路径）：error bundle，message 脱敏", async () => {
    const adapter = new MockAdapter();
    const provider = createMockLLMProvider({
      error: new LLMError("AUTH", "401 invalid key sk-livekey999888", ["检查 API Key"]),
    });
    const events = await collect(dispatchSimpleChat(makeBaseParams(adapter, provider, "写第一章")));
    expect(events.at(-1)?.type).toBe("error");

    const list = listDebugBundles();
    expect(list).toHaveLength(1);
    const bundle = getDebugBundle(list[0].id)!;
    expect(bundle.error?.code).toBe("AUTH");
    expect(bundle.error?.message).not.toContain("sk-livekey999888");
    // 失败在 loop 内：解析产物已填
    expect(bundle.start_messages.length).toBeGreaterThanOrEqual(2);
    expect(bundle.budget_report).not.toBeNull();
  });

  it("harness 直产终态（empty_response_terminal）：翻译层捕获 error bundle", async () => {
    const adapter = new MockAdapter();
    // 恒空响应：EMPTY guard 重试耗尽 → empty_response_terminal（不经业务回调）。
    const provider = createMockLLMProvider({
      streamChunks: [{ delta: "", is_final: true, input_tokens: 1, output_tokens: 0, finish_reason: "stop" }],
    });
    const events = await collect(dispatchSimpleChat(makeBaseParams(adapter, provider, "写第一章")));
    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    if (err?.type === "error") expect(err.data.error_code).toBe("EMPTY_RESPONSE");

    const list = listDebugBundles();
    expect(list).toHaveLength(1);
    const bundle = getDebugBundle(list[0].id)!;
    expect(bundle.error?.code).toBe("EMPTY_RESPONSE");
    expect(bundle.iterations).toBeGreaterThanOrEqual(1);
  });

  it("前置解析失败（createProvider 拒 local 模式）：骨架 error bundle，messages 为空", async () => {
    const adapter = new MockAdapter();
    const params = makeBaseParams(adapter, undefined, "写第一章");
    params.project = createProject({
      project_id: "p",
      au_id: "au_test",
      llm: createLLMConfig({ mode: LLMMode.LOCAL, model: "x" }),
    });
    const events = await collect(dispatchSimpleChat(params));
    expect(events.at(-1)?.type).toBe("error");

    const list = listDebugBundles();
    expect(list).toHaveLength(1);
    const bundle = getDebugBundle(list[0].id)!;
    expect(bundle.error?.message).toContain("local");
    expect(bundle.start_messages).toEqual([]);
    expect(bundle.budget_report).toBeNull();
  });

  it("多轮迭代（read tool → text）：final_messages 含 internalHistory 追加，iterations=2", async () => {
    const adapter = new MockAdapter();
    const provider = createScriptedStreamProvider([
      // iter 0：read-only show_chapter tool call
      [
        {
          delta: "",
          tool_call_deltas: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "show_chapter", arguments: '{"chapter_num":1}' },
            },
          ],
          is_final: true,
          input_tokens: 20,
          output_tokens: 1,
          finish_reason: "tool_calls",
        },
      ],
      // iter 1：正文
      [{ delta: "内容", is_final: true, input_tokens: 30, output_tokens: 2, finish_reason: "stop" }],
    ]);
    const events = await collect(dispatchSimpleChat(makeBaseParams(adapter, provider, "写第一章")));
    expect(events.some((e) => e.type === "done_text")).toBe(true);

    const list = listDebugBundles();
    expect(list).toHaveLength(1);
    const bundle = getDebugBundle(list[0].id)!;
    expect(bundle.iterations).toBe(2);
    // 末轮序列 = startMessages + internalHistory（assistant tool_calls + tool result）
    expect(bundle.final_messages.length).toBeGreaterThan(bundle.start_messages.length);
    // 实际发送验证：第二次 generateStream 收到的 messages 与 final_messages 等长
    expect(provider.calls[1].messages.length).toBe(bundle.final_messages.length);
  });

  it("disabled：不 capture", async () => {
    setDebugCaptureEnabled(false);
    const adapter = new MockAdapter();
    const provider = createMockLLMProvider({ content: "正文" });
    const events = await collect(dispatchSimpleChat(makeBaseParams(adapter, provider, "写第一章")));
    expect(events.some((e) => e.type === "done_text")).toBe(true);
    expect(listDebugBundles()).toEqual([]);
  });
});
