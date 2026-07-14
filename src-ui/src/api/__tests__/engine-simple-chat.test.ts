// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * markSimpleChatDraftAccepted（engine-simple-chat.ts）状态机判别性测试 —— 错误分支优先。
 *
 * 该函数在仓储锁内 read-modify-write：只把「id 命中 + kind==='writing-draft'」的那条草稿
 * 置 accepted、写 accepted_at、按需写 accepted_revision，并清 error_message。语义按实现实测：
 *   1. draft→accepted 置位 + accepted_revision 写入 + error_message 清除。
 *   2. revision=null（标记恢复场景）→ 只置 status/accepted_at，不写 accepted_revision。
 *   3. 已 accepted 再调（同 revision）→ 幂等收敛（status/accepted_revision 不变）。
 *   4. 非法状态拒绝：id 命中但 kind≠writing-draft（如 user 消息）→ 原样不动（kind 守卫）。
 *   5. id 不命中 → 其它消息不受影响。
 *
 * 真引擎 + MockAdapter（simple-chat.yaml 内存读写）。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SimpleChatMessageEnvelope } from "@ficforge/engine";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";
import { createAu, createFandom } from "../engine-fandoms";
import { getSimpleChat, markSimpleChatDraftAccepted, saveSimpleChat } from "../engine-simple-chat";
import { initEngine } from "../engine-instance";

let adapter: MockAdapter;
let auPath: string;

function draft(id: string, extra: Partial<SimpleChatMessageEnvelope> = {}): SimpleChatMessageEnvelope {
  return {
    id,
    timestamp: "2026-05-05T00:00:00Z",
    kind: "writing-draft",
    chapter_num: 1,
    draft_label: "A",
    content: "草稿正文",
    status: "pending",
    ...extra,
  };
}

async function readMessages(): Promise<SimpleChatMessageEnvelope[]> {
  return (await getSimpleChat(auPath)).messages;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  adapter = new MockAdapter();
  initEngine(adapter, "/data");
  const fandom = await createFandom("Naruto");
  const au = await createAu(fandom.name, "Canon", fandom.path);
  auPath = au.path;
});

describe("markSimpleChatDraftAccepted — 草稿接受状态机", () => {
  it("draft→accepted：置 status/accepted_at/accepted_revision + 清 error_message", async () => {
    await saveSimpleChat(auPath, [draft("m1", { status: "error", error_message: "上次失败" })]);

    await markSimpleChatDraftAccepted(auPath, "m1", 7);

    const [m] = await readMessages();
    expect(m.status).toBe("accepted");
    expect(typeof m.accepted_at).toBe("string");
    expect(m.accepted_revision).toBe(7);
    // 终态清掉历史错误文案，避免「accepted 却挂着 error」的矛盾展示。
    expect(m.error_message).toBeUndefined();
  });

  it("revision=null（标记恢复）→ 只置 accepted/accepted_at，不写 accepted_revision", async () => {
    await saveSimpleChat(auPath, [draft("m1")]);

    await markSimpleChatDraftAccepted(auPath, "m1", null);

    const [m] = await readMessages();
    expect(m.status).toBe("accepted");
    expect(typeof m.accepted_at).toBe("string");
    expect(m.accepted_revision).toBeUndefined();
  });

  it("已 accepted 再调（同 revision）→ 幂等收敛（status/accepted_revision 不变）", async () => {
    await saveSimpleChat(auPath, [draft("m1")]);

    await markSimpleChatDraftAccepted(auPath, "m1", 3);
    await markSimpleChatDraftAccepted(auPath, "m1", 3);

    const [m] = await readMessages();
    expect(m.status).toBe("accepted");
    expect(m.accepted_revision).toBe(3);
  });

  it("非法状态拒绝：id 命中但 kind≠writing-draft（user 消息）→ 原样不动", async () => {
    await saveSimpleChat(auPath, [{ id: "m1", timestamp: "2026-05-05T00:00:00Z", kind: "user", content: "写一章" }]);

    await markSimpleChatDraftAccepted(auPath, "m1", 1);

    const [m] = await readMessages();
    // kind 守卫：非 writing-draft 一律跳过，不被误置 accepted。
    expect(m.kind).toBe("user");
    expect(m.status).toBeUndefined();
    expect(m.accepted_revision).toBeUndefined();
  });

  it("id 不命中 → 其它草稿不受影响", async () => {
    await saveSimpleChat(auPath, [draft("m1"), draft("m2")]);

    await markSimpleChatDraftAccepted(auPath, "m2", 5);

    const msgs = await readMessages();
    const m1 = msgs.find((m) => m.id === "m1");
    const m2 = msgs.find((m) => m.id === "m2");
    expect(m1?.status).toBe("pending"); // 未被触碰
    expect(m1?.accepted_revision).toBeUndefined();
    expect(m2?.status).toBe("accepted");
    expect(m2?.accepted_revision).toBe(5);
  });
});
