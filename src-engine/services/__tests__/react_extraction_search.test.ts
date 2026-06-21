// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * M9 executeSearchExistingFacts 测试 — 纯过滤逻辑（不依赖 repo）。
 */

import { describe, expect, it } from "vitest";
import { executeSearchExistingFacts } from "../react_extraction_search.js";
import { createFact } from "../../domain/fact.js";

const F = (over: Partial<ReturnType<typeof createFact>>) =>
  createFact({ id: "f0", content_raw: "r", content_clean: "c", ...over });

const FACTS = [
  F({ id: "f1", content_clean: "林晚月在炼气期修炼失败，灵力枯竭", characters: ["林晚月"], chapter: 3 }),
  F({ id: "f2", content_clean: "沈砚拿到名录证据", characters: ["沈砚"], chapter: 2 }),
  F({ id: "f3", content_clean: "林晚月与沈砚结盟", characters: ["林晚月", "沈砚"], chapter: 4 }),
];

describe("executeSearchExistingFacts", () => {
  it("空数组输入 → 空结果", () => {
    expect(executeSearchExistingFacts([], { query: "x" }, 5)).toEqual([]);
  });

  it("只检索更早章节（chapter < current）", () => {
    // current=4：f3(ch4) 排除，f1(ch3)/f2(ch2) 命中
    const hits = executeSearchExistingFacts(FACTS, { query: "" }, 4);
    expect(hits.map((h) => h.fact_id).sort()).toEqual(["f1", "f2"]);
  });

  it("关键词命中 content_clean", () => {
    const hits = executeSearchExistingFacts(FACTS, { query: "灵力" }, 5);
    expect(hits.map((h) => h.fact_id)).toEqual(["f1"]);
  });

  it("角色过滤取交集 + 受章节窗口约束", () => {
    // current=3：只有 ch<3 的 f2 在窗口内；沈砚 → f2（f3 是 ch4，被窗口排除）
    const hits = executeSearchExistingFacts(FACTS, { query: "", characters: ["沈砚"] }, 3);
    expect(hits.map((h) => h.fact_id).sort()).toEqual(["f2"]);
  });

  it("角色过滤命中多条（窗口放宽到 6）", () => {
    const hits = executeSearchExistingFacts(FACTS, { query: "", characters: ["沈砚"] }, 6);
    expect(hits.map((h) => h.fact_id).sort()).toEqual(["f2", "f3"]);
  });

  it("limit 截断", () => {
    const hits = executeSearchExistingFacts(FACTS, { query: "", limit: 1 }, 6);
    expect(hits).toHaveLength(1);
  });

  it("只返回精简字段（不泄露完整 Fact）", () => {
    const hits = executeSearchExistingFacts(FACTS, { query: "灵力" }, 5);
    expect(Object.keys(hits[0]).sort()).toEqual(["chapter", "characters", "content_clean", "fact_id"]);
  });
});
