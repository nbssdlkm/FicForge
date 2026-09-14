// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * addFactToThread（engine-threads.ts）RMW 读-改-写判别性测试 —— 错误分支优先。
 *
 * 成员关系单一真相源 = fact.thread_ids。addFactToThread 每次先 fresh-read fact，
 * 再算 patch 交给 editFact（防 lost-update）。三条：
 *   1. 正常追加：未挂线 → thread_ids 追加。
 *   2. 幂等：已挂线再调 → 短路 return（thread_ids 不变、revision 不 bump，未走 editFact）。
 *   3. 错误路径：fact 不存在 → RMW 读到 null 后 editFact 抛错（不静默造孤儿引用）。
 *
 * 真引擎 + MockAdapter（内存 fs），不打网络。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";
import { addFact } from "../engine-facts";
import { createAu, createFandom } from "../engine-fandoms";
import { getEngine, initEngine } from "../engine-instance";
import { addFactToThread, addThread, moveFactInThread, removeFactFromThread } from "../engine-threads";

let adapter: MockAdapter;
let auPath: string;

beforeEach(async () => {
  vi.restoreAllMocks();
  adapter = new MockAdapter();
  initEngine(adapter, "/data");
  const fandom = await createFandom("Naruto");
  const au = await createAu(fandom.name, "Canon", fandom.path);
  auPath = au.path;
});

async function seedFact(): Promise<string> {
  const f = await addFact(auPath, 1, {
    content_clean: "Alice 做了某事",
    content_raw: "Alice 做了某事",
    type: "plot_event",
    narrative_weight: "medium",
    status: "active",
    characters: ["Alice"],
  });
  return f.id;
}

describe("addFactToThread — RMW（成员关系 = fact.thread_ids）", () => {
  it("正常追加：fact 未挂线 → thread_ids 追加该线", async () => {
    const factId = await seedFact();
    const thread = await addThread(auPath, { title: "主线" });

    await addFactToThread(auPath, factId, thread.id);

    const fresh = await getEngine().repos.fact.get(auPath, factId);
    expect(fresh?.thread_ids).toEqual([thread.id]);
  });

  it("幂等：已挂线再调 → 短路不重写（thread_ids 不变、revision 不 bump）", async () => {
    const factId = await seedFact();
    const thread = await addThread(auPath, { title: "主线" });

    await addFactToThread(auPath, factId, thread.id);
    const after1 = await getEngine().repos.fact.get(auPath, factId);

    await addFactToThread(auPath, factId, thread.id);
    const after2 = await getEngine().repos.fact.get(auPath, factId);

    expect(after2?.thread_ids).toEqual([thread.id]); // 无重复
    // 短路 return（ids.includes → 未调 editFact）→ revision 与首次追加后一致。
    expect(after2?.revision).toBe(after1?.revision);
  });

  it("多线追加：先挂 A 再挂 B → thread_ids 两条并存（fresh-read 非覆写）", async () => {
    const factId = await seedFact();
    const a = await addThread(auPath, { title: "主线 A" });
    const b = await addThread(auPath, { title: "支线 B" });

    await addFactToThread(auPath, factId, a.id);
    await addFactToThread(auPath, factId, b.id);

    const fresh = await getEngine().repos.fact.get(auPath, factId);
    expect(fresh?.thread_ids).toEqual([a.id, b.id]);
  });

  it("错误路径：fact 不存在 → RMW 读到 null 后 editFact 抛错（不静默造孤儿）", async () => {
    const thread = await addThread(auPath, { title: "主线" });
    await expect(addFactToThread(auPath, "fact_missing", thread.id)).rejects.toThrow();
  });
});

// ===========================================================================
// REQ-140：编排板位置语义（对抗审 blocker 回归——before/after 曾接反，三个缝隙两个落错位）
// 词汇表：UI 侧 beforeFactId=「插到它之前」的后继、afterFactId=「插到它之后」的前驱。
// ===========================================================================

describe("addFactToThread 位置插入（REQ-140）", () => {
  const orderOf = async (factId: string, threadId: string) =>
    (await getEngine().repos.fact.get(auPath, factId))?.thread_order?.[threadId];

  it("尾部追加：空位置对象 → 序号 = 末节点+GAP", async () => {
    const f1 = await seedFact();
    const f2 = await seedFact();
    const t = await addThread(auPath, { title: "线" });
    await addFactToThread(auPath, f1, t.id, {});
    await addFactToThread(auPath, f2, t.id, {});
    const o1 = await orderOf(f1, t.id);
    const o2 = await orderOf(f2, t.id);
    expect(o1).toBe(10);
    expect(o2).toBe(20);
  });

  it("头部缝隙（beforeFactId=首节点）→ 新节点排到首节点之前", async () => {
    const f1 = await seedFact();
    const f2 = await seedFact();
    const fNew = await seedFact();
    const t = await addThread(auPath, { title: "线" });
    await addFactToThread(auPath, f1, t.id, {});
    await addFactToThread(auPath, f2, t.id, {});
    await addFactToThread(auPath, fNew, t.id, { beforeFactId: f1 });
    expect(await orderOf(fNew, t.id)).toBe(0); // 10 - GAP
  });

  it("中间缝隙（beforeFactId=后继 afterFactId=前驱）→ 序号严格居中", async () => {
    const f1 = await seedFact();
    const f2 = await seedFact();
    const fNew = await seedFact();
    const t = await addThread(auPath, { title: "线" });
    await addFactToThread(auPath, f1, t.id, {});
    await addFactToThread(auPath, f2, t.id, {});
    await addFactToThread(auPath, fNew, t.id, { beforeFactId: f2, afterFactId: f1 });
    expect(await orderOf(fNew, t.id)).toBe(15);
  });

  it("尾部缝隙（afterFactId=末节点）→ 落到末节点之后", async () => {
    const f1 = await seedFact();
    const f2 = await seedFact();
    const fNew = await seedFact();
    const t = await addThread(auPath, { title: "线" });
    await addFactToThread(auPath, f1, t.id, {});
    await addFactToThread(auPath, f2, t.id, {});
    await addFactToThread(auPath, fNew, t.id, { afterFactId: f2 });
    expect(await orderOf(fNew, t.id)).toBe(30);
  });

  it("旧线邻居无序号 → 先归一化再插入（legacy 兼容）", async () => {
    const f1 = await seedFact();
    const f2 = await seedFact();
    const fNew = await seedFact();
    const t = await addThread(auPath, { title: "线" });
    // 无位置挂载 = 不写序号（模拟旧线）
    await addFactToThread(auPath, f1, t.id);
    await addFactToThread(auPath, f2, t.id);
    expect(await orderOf(f1, t.id)).toBeUndefined();
    await addFactToThread(auPath, fNew, t.id, { beforeFactId: f2, afterFactId: f1 });
    // 归一化后 f1=10 f2=20，新节点 15
    expect(await orderOf(f1, t.id)).toBe(10);
    expect(await orderOf(f2, t.id)).toBe(20);
    expect(await orderOf(fNew, t.id)).toBe(15);
  });
});

describe("moveFactInThread / removeFactFromThread 序号维护（REQ-140）", () => {
  const orderOf = async (factId: string, threadId: string) =>
    (await getEngine().repos.fact.get(auPath, factId))?.thread_order?.[threadId];

  it("下移交换位置并归一化：f1↓ 后顺序 f2(10), f1(20)", async () => {
    const f1 = await seedFact();
    const f2 = await seedFact();
    const t = await addThread(auPath, { title: "线" });
    await addFactToThread(auPath, f1, t.id, {});
    await addFactToThread(auPath, f2, t.id, {});
    await moveFactInThread(auPath, t.id, f1, "down");
    expect(await orderOf(f2, t.id)).toBe(10);
    expect(await orderOf(f1, t.id)).toBe(20);
  });

  it("端点 no-op：首节点上移不动", async () => {
    const f1 = await seedFact();
    const f2 = await seedFact();
    const t = await addThread(auPath, { title: "线" });
    await addFactToThread(auPath, f1, t.id, {});
    await addFactToThread(auPath, f2, t.id, {});
    await moveFactInThread(auPath, t.id, f1, "up");
    expect(await orderOf(f1, t.id)).toBe(10);
    expect(await orderOf(f2, t.id)).toBe(20);
  });

  it("摘除清 thread_order 本线条目（不留孤儿键）", async () => {
    const f1 = await seedFact();
    const t = await addThread(auPath, { title: "线" });
    await addFactToThread(auPath, f1, t.id, {});
    expect(await orderOf(f1, t.id)).toBe(10);
    await removeFactFromThread(auPath, f1, t.id);
    const fresh = await getEngine().repos.fact.get(auPath, f1);
    expect(fresh?.thread_ids).toEqual([]);
    expect(fresh?.thread_order ?? {}).not.toHaveProperty(t.id);
  });

  it("归一化半写故障（codex R2 修复）：单条写失败不中断其余，聚合抛错，重试自愈收敛", async () => {
    const f1 = await seedFact();
    const f2 = await seedFact();
    const f3 = await seedFact();
    const t = await addThread(auPath, { title: "线" });
    await addFactToThread(auPath, f1, t.id, {});
    await addFactToThread(auPath, f2, t.id, {});
    await addFactToThread(auPath, f3, t.id, {}); // 序号 10/20/30

    // 故障注入：归一化的第一笔 facts 写盘失败（f3→20 写不进去）
    const origWrite = adapter.writeFile.bind(adapter);
    let factsWrites = 0;
    vi.spyOn(adapter, "writeFile").mockImplementation(async (p: string, c: string) => {
      if (p.includes("facts.jsonl")) {
        factsWrites += 1;
        if (factsWrites === 1) throw new Error("injected io failure");
      }
      return origWrite(p, c);
    });

    // f3 上移 → 目标 [f1,f3,f2] = 10/20/30；f1 同值跳过，f3 写失败，f2 应仍写成 30（best-effort 不中断）
    await expect(moveFactInThread(auPath, t.id, f3, "up")).rejects.toThrow(/部分失败/);
    expect(await orderOf(f2, t.id)).toBe(30); // 未受故障影响的那笔已持久化
    expect(await orderOf(f3, t.id)).toBe(30); // 故障笔保持旧值

    // 重试（撤掉故障）：自愈收敛到目标序
    vi.restoreAllMocks();
    await moveFactInThread(auPath, t.id, f3, "up");
    expect(await orderOf(f1, t.id)).toBe(10);
    expect(await orderOf(f3, t.id)).toBe(20);
    expect(await orderOf(f2, t.id)).toBe(30);
  });
});
