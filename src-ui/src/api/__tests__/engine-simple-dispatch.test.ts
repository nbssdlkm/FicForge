// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * dispatchSimpleChat — 对话路径 RAG 索引加载对称性（审计③）。
 *
 * 对话路径必须像写文路径（engine-generate.ts）那样，在调度前经 ragManager.vectorRepoFor(auPath)
 * 加载该 AU 的向量库（TD-017 后 per-AU 引擎），否则冷启动/切 AU 后该 AU 索引尚未 load，
 * assemble_chat_context 的 P4 RAG 层会静默为空——「对话与写文共用同一记忆栈」的承诺在 RAG 这层漏掉。
 *
 * dispatch_simple_chat 会打真实 LLM，故在此 stub 成不产出事件的空 generator，
 * 只验证 dispatchSimpleChat 在其之前经 vectorRepoFor 加载了该 AU 的向量库。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";
import { getEngine, initEngine } from "../engine-instance";
import { createAu, createFandom } from "../engine-fandoms";

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
  for await (const _ev of gen) {
    /* no-op */
  }
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
  it("调度前经 ragManager.vectorRepoFor(auPath) 加载该 AU 向量库，与写文路径对称", async () => {
    const spy = vi
      .spyOn(getEngine().ragManager, "vectorRepoFor")
      .mockResolvedValue({ search: async () => [] } as never);

    await drain(dispatchSimpleChat({ au_path: auPath, chapter_num: 1, user_input: "hi" }));

    expect(spy).toHaveBeenCalledWith(auPath);
  });

  it("索引未建时 vectorRepoFor 降级为空库、不阻断对话（TD-017：不抛）", async () => {
    // 不 mock —— 真实 vectorRepoFor 对未建索引的 AU 内部吞错、返回空引擎，对话链路照常完成。
    await expect(
      drain(dispatchSimpleChat({ au_path: auPath, chapter_num: 1, user_input: "hi" })),
    ).resolves.toBeUndefined();
  });
});
