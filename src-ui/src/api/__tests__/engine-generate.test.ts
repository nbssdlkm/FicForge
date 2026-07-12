// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * generateChapter（engine-generate.ts）编排层判别性测试 —— 错误分支优先。
 *
 * 覆盖两条本 API 层特有的分支（非引擎内部逻辑）：
 *   1. local 模式提前拦截 → yield UNSUPPORTED_MODE 且**不触达**引擎 generateChapter
 *      （UI capabilities 已不渲染 local，此拦截是防手改 YAML 的最后防线）。
 *   2. thread 读失败降级 → threads=[] 继续生成（best-effort）+ logCatch 记日志（非静默吞错）。
 *
 * 引擎 generateChapter 会打真实 LLM，故经 vi.mock 注入一个捕获入参的空 generator；
 * resolveLlmConfig / logCatch 保留 actual（logCatch 单独换成捕获实现以断言非静默）。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LLMMode } from "@ficforge/engine";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";
import { createAu, createFandom } from "../engine-fandoms";
import { getEngine, initEngine } from "../engine-instance";

// 注入 mock 观测：generateChapter 收到的 threads、调用次数、logCatch 记录。
const captured = vi.hoisted(() => ({
  threads: undefined as unknown,
  generateCalls: 0,
  logCatchCalls: [] as Array<{ tag: string; msg: string }>,
}));

vi.mock("@ficforge/engine", async () => {
  const actual = await vi.importActual<typeof import("@ficforge/engine")>("@ficforge/engine");
  // 用普通 async generator（非 vi.fn）替换引擎生成，免受 restoreAllMocks 影响；捕获 threads 后立即收尾。
  async function* mockGenerateChapter(params: { threads: unknown }): AsyncGenerator<{ type: string; data: unknown }> {
    captured.generateCalls += 1;
    captured.threads = params.threads;
    yield { type: "done", data: { draft_label: "A", full_text: "正文", budget_report: {}, generated_with: {} } };
  }
  return {
    ...actual,
    generateChapter: mockGenerateChapter,
    // 换成捕获实现（非 vi.fn，restoreAllMocks 无碍）以断言降级非静默。
    logCatch: (tag: string, msg: string) => {
      captured.logCatchCalls.push({ tag, msg });
    },
  };
});

import { generateChapter } from "../engine-generate";

type GenEvent = { event: string; data: Record<string, unknown> };

async function collect(gen: AsyncGenerator<unknown>): Promise<GenEvent[]> {
  const out: GenEvent[] = [];
  for await (const ev of gen) out.push(ev as GenEvent);
  return out;
}

let adapter: MockAdapter;
let auPath: string;

beforeEach(async () => {
  vi.restoreAllMocks();
  captured.threads = undefined;
  captured.generateCalls = 0;
  captured.logCatchCalls = [];
  adapter = new MockAdapter();
  initEngine(adapter, "/data");
  const fandom = await createFandom("Naruto");
  const au = await createAu(fandom.name, "Canon", fandom.path);
  auPath = au.path;
});

describe("generateChapter — 编排层错误分支", () => {
  it("local 模式 → 只 yield UNSUPPORTED_MODE，且不进入引擎 generateChapter", async () => {
    // project.llm 配 local + model（让 project 层被 resolve 选中，而非回退全局 settings 层）。
    const proj = await getEngine().repos.project.get(auPath);
    proj.llm.mode = LLMMode.LOCAL;
    proj.llm.model = "llama-local";
    await getEngine().repos.project.save(proj);

    const events = await collect(generateChapter({ au_path: auPath, chapter_num: 1, user_input: "写下一章" }));

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("error");
    expect(events[0].data.error_code).toBe("UNSUPPORTED_MODE");
    expect(events[0].data.actions).toEqual(["check_settings"]);
    // 提前 return，引擎生成从未触达。
    expect(captured.generateCalls).toBe(0);
  });

  it("thread 读失败 → 降级 threads=[] 继续生成 + logCatch 记日志（非静默吞错）", async () => {
    // api 模式（避免落入 local 拦截）。
    const proj = await getEngine().repos.project.get(auPath);
    proj.llm.mode = LLMMode.API;
    proj.llm.model = "gpt-x";
    await getEngine().repos.project.save(proj);

    // 注入 thread.list 抛错，模拟索引损坏 / 读盘失败。
    vi.spyOn(getEngine().repos.thread, "list").mockRejectedValue(new Error("thread 读盘失败"));

    const events = await collect(generateChapter({ au_path: auPath, chapter_num: 1, user_input: "写下一章" }));

    // 生成照常完成（done 透传），而不是因 thread 读失败中断。
    expect(captured.generateCalls).toBe(1);
    expect(events.some((e) => e.event === "done")).toBe(true);
    // 关键：注入引擎的上下文不带 thread（降级空数组）。
    expect(captured.threads).toEqual([]);
    // 非静默：降级路径调了 logCatch（tag=generate），错误被记录而非吞掉。
    expect(captured.logCatchCalls.some((c) => c.tag === "generate")).toBe(true);
  });

  it("thread 读正常 → 注入引擎的 threads 原样透传（对照组，证明降级非误伤）", async () => {
    const proj = await getEngine().repos.project.get(auPath);
    proj.llm.mode = LLMMode.API;
    proj.llm.model = "gpt-x";
    await getEngine().repos.project.save(proj);

    await collect(generateChapter({ au_path: auPath, chapter_num: 1, user_input: "写下一章" }));

    // 正常路径：threads 为数组（本 AU 无剧情线时为空数组，但走的是 thread.list 成功分支）。
    expect(captured.generateCalls).toBe(1);
    expect(Array.isArray(captured.threads)).toBe(true);
    // 且未触发降级日志。
    expect(captured.logCatchCalls.some((c) => c.tag === "generate")).toBe(false);
  });
});
