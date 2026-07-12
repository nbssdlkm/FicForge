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
import { addFactToThread, addThread } from "../engine-threads";

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
