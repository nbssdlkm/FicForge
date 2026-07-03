// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * dispatchSimpleChat — 对话路径 RAG 索引加载对称性（审计③）。
 *
 * 对话路径必须像写文路径（engine-generate.ts）那样，在调度前 ragManager.ensureLoaded(auPath)，
 * 否则冷启动/切 AU 后 vectorEngine 尚未 load 该 AU 索引，assemble_chat_context 的 P4 RAG 层
 * 会静默为空——「对话与写文共用同一记忆栈」的承诺在 RAG 这层漏掉。
 *
 * dispatch_simple_chat 会打真实 LLM，故在此 stub 成不产出事件的空 generator，
 * 只验证 dispatchSimpleChat 在其之前调用了 ensureLoaded。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";
import { getEngine, initEngine } from "../engine-instance";
import { createAu, createFandom } from "../engine-fandom";

vi.mock("@ficforge/engine", async () => {
  const actual = await vi.importActual<typeof import("@ficforge/engine")>("@ficforge/engine");
  // 用普通 async generator（非 vi.fn）替换调度，免受 restoreAllMocks 影响；不产出事件。
  async function* noopDispatch(): AsyncGenerator<never> {
    // 空调度：dispatchSimpleChat 的 for-await 立即结束，不触发任何网络请求。
  }
  return { ...actual, dispatch_simple_chat: noopDispatch };
});

import { dispatchSimpleChat } from "../engine-simple-dispatch";

let adapter: MockAdapter;
let auPath: string;

async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ev of gen) { /* no-op */ }
}

beforeEach(async () => {
  vi.restoreAllMocks();
  adapter = new MockAdapter();
  initEngine(adapter, "/data");
  const fandom = await createFandom("Naruto");
  const au = await createAu(fandom.name, "Canon", fandom.path);
  auPath = au.path;
});

describe("dispatchSimpleChat — RAG 索引加载对称性（审计③）", () => {
  it("调度前调用 ragManager.ensureLoaded(auPath)，与写文路径对称", async () => {
    const spy = vi
      .spyOn(getEngine().ragManager, "ensureLoaded")
      .mockResolvedValue(undefined as never);

    await drain(dispatchSimpleChat({ au_path: auPath, chapter_num: 1, user_input: "hi" }));

    expect(spy).toHaveBeenCalledWith(auPath);
  });

  it("ensureLoaded 抛错时降级为空索引、不阻断对话", async () => {
    vi.spyOn(getEngine().ragManager, "ensureLoaded").mockRejectedValue(new Error("no index"));

    // 索引未建 → ensureLoaded reject，但对话链路必须继续（不抛出）
    await expect(
      drain(dispatchSimpleChat({ au_path: auPath, chapter_num: 1, user_input: "hi" })),
    ).resolves.toBeUndefined();
  });
});
