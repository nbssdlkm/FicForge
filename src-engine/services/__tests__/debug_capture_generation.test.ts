// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 写文路径（generateChapter）调试包捕获测试（spec 2026-09-08）：
 * done / error / assemble 前失败 / disabled / abort 五路断言。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { generateChapter, type GenerationEvent } from "../generation.js";
import { createProject, createLLMConfig } from "../../domain/project.js";
import { createState } from "../../domain/state.js";
import { createSettings } from "../../domain/settings.js";
import { LLMMode } from "../../domain/enums.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileDraftRepository } from "../../repositories/implementations/file_draft.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { LLMError, type LLMProvider } from "../../llm/provider.js";
import { createMockLLMProvider } from "./mock_llm_provider.js";
import { createAbortError } from "../../utils/abort_error.js";
import { clearDebugBundles, getDebugBundle, listDebugBundles, setDebugCaptureEnabled } from "../../debug/index.js";

function makeParams(adapter: MockAdapter, overrides: Partial<Parameters<typeof generateChapter>[0]> = {}) {
  return {
    au_id: "au_test",
    chapter_num: 1,
    user_input: "开始写第一章",
    session_llm: null,
    session_params: null,
    project: createProject({
      project_id: "p1",
      au_id: "au_test",
      llm: createLLMConfig({ mode: LLMMode.API, model: "test-model", api_base: "http://localhost", api_key: "key" }),
    }),
    state: createState({ au_id: "au_test" }),
    settings: createSettings(),
    facts: [],
    chapter_repo: new FileChapterRepository(adapter),
    draft_repo: new FileDraftRepository(adapter),
    _provider_override: createMockLLMProvider({ content: "正文内容" }),
    ...overrides,
  };
}

async function collect(gen: AsyncGenerator<GenerationEvent>): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe("generateChapter 调试包捕获", () => {
  beforeEach(() => {
    setDebugCaptureEnabled(true);
    clearDebugBundles();
  });

  it("成功路径：capture 一次且字段齐全", async () => {
    const adapter = new MockAdapter();
    const events = await collect(generateChapter(makeParams(adapter)));
    expect(events.at(-1)?.type).toBe("done");

    const list = listDebugBundles();
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe("write");
    expect(list[0].au_id).toBe("au_test");
    expect(list[0].chapter_num).toBe(1);
    expect(list[0].model).toBe("test-model");
    expect(list[0].status).toBe("ok");
    expect(list[0].iterations).toBe(1);

    const bundle = getDebugBundle(list[0].id)!;
    expect(bundle.params?.max_tokens).toBeGreaterThan(0);
    expect(bundle.start_messages.length).toBeGreaterThan(0);
    expect(bundle.final_messages).toEqual(bundle.start_messages);
    expect(bundle.budget_report).not.toBeNull();
    expect(bundle.context_summary).not.toBeNull();
    expect(bundle.result?.draft_label).toBeTruthy();
    expect(bundle.result?.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("LLM 抛错：error bundle，message 过 redactString", async () => {
    const adapter = new MockAdapter();
    const err = new LLMError("RATE_LIMIT", "429 too many requests, key sk-abcdef123456789 rejected", []);
    const events = await collect(
      generateChapter(makeParams(adapter, { _provider_override: createMockLLMProvider({ error: err }) })),
    );
    expect(events.at(-1)?.type).toBe("error");

    const list = listDebugBundles();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("error");
    const bundle = getDebugBundle(list[0].id)!;
    expect(bundle.error?.code).toBe("RATE_LIMIT");
    expect(bundle.error?.message).not.toContain("sk-abcdef123456789");
    // 失败发生在流式阶段：组装产物已填充
    expect(bundle.budget_report).not.toBeNull();
  });

  it("assemble 前失败（createProvider 拒 local 模式）：骨架有什么填什么，仍产 error bundle", async () => {
    const adapter = new MockAdapter();
    // local 模式被 createProvider 直接拒（不传 _provider_override，走真实 createProvider）。
    // resolveLlmConfig 已通过 → model/params 已填；assemble 未跑 → messages/budget 未填。
    const badProject = createProject({
      project_id: "p1",
      au_id: "au_test",
      llm: createLLMConfig({ mode: LLMMode.LOCAL, model: "x" }),
    });
    const events = await collect(
      generateChapter(makeParams(adapter, { project: badProject, _provider_override: undefined })),
    );
    expect(events.at(-1)?.type).toBe("error");

    const list = listDebugBundles();
    expect(list).toHaveLength(1);
    const bundle = getDebugBundle(list[0].id)!;
    expect(bundle.error?.code).toBe("INTERNAL_ERROR");
    expect(bundle.error?.message).toContain("local");
    expect(bundle.model).toBe("x");
    expect(bundle.params).not.toBeNull();
    expect(bundle.start_messages).toEqual([]);
    expect(bundle.budget_report).toBeNull();
  });

  it("assemble 中失败（预算耗尽抛 system_prompt_exceeds_budget）：model/params 已填，messages/budget 未填", async () => {
    const adapter = new MockAdapter();
    // 极小 context_window 使 input budget 为负，assembleContext 两次试算后抛错。
    // （cascade/P2 等读取层均为容错设计不抛错，预算是 assemble 唯一确定性抛点。）
    const tinyWindowProject = createProject({
      project_id: "p1",
      au_id: "au_test",
      llm: createLLMConfig({
        mode: LLMMode.API,
        model: "test-model",
        api_base: "http://localhost",
        api_key: "key",
        context_window: 100,
      }),
    });
    const events = await collect(generateChapter(makeParams(adapter, { project: tinyWindowProject })));
    expect(events.at(-1)?.type).toBe("error");

    const list = listDebugBundles();
    expect(list).toHaveLength(1);
    const bundle = getDebugBundle(list[0].id)!;
    expect(bundle.error?.code).toBe("INTERNAL_ERROR");
    expect(bundle.error?.message).toContain("system_prompt_exceeds_budget");
    expect(bundle.model).toBe("test-model");
    expect(bundle.params).not.toBeNull();
    expect(bundle.start_messages).toEqual([]);
    expect(bundle.budget_report).toBeNull();
  });

  it("abort（用户取消）：不 capture", async () => {
    const adapter = new MockAdapter();
    const abortChunks: LLMChunk[] = [];
    const abortProvider: LLMProvider = {
      async generate() {
        throw createAbortError();
      },
      async *generateStream() {
        yield* abortChunks;
        throw createAbortError();
      },
    };
    await expect(
      collect(generateChapter(makeParams(adapter, { _provider_override: abortProvider }))),
    ).rejects.toThrow();
    expect(listDebugBundles()).toEqual([]);
  });

  it("disabled：不 capture", async () => {
    setDebugCaptureEnabled(false);
    const adapter = new MockAdapter();
    const events = await collect(generateChapter(makeParams(adapter)));
    expect(events.at(-1)?.type).toBe("done");
    expect(listDebugBundles()).toEqual([]);
  });
});
