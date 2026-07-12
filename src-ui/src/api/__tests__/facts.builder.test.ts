// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * buildFactDataFromCandidate —— 候选→入库 payload 的单一映射（盲审 2026-07-11 重复维）。
 * 锁两处曾在 DirtyModal 漂移的兜底口径：content_raw 空回退 content_clean、timeline 无值不带键。
 */

import { describe, expect, it } from "vitest";
import { buildFactDataFromCandidate, type ExtractedFactCandidate } from "../facts";

function candidate(over: Partial<ExtractedFactCandidate> = {}): ExtractedFactCandidate {
  return {
    content_raw: "原文片段",
    content_clean: "沈砚取出残角",
    characters: ["沈砚"],
    narrative_weight: "high",
    status: "active",
    chapter: 5,
    ...over,
  };
}

describe("buildFactDataFromCandidate", () => {
  it("content_raw 为空时回退 content_clean（DirtyModal 曾漂移缺此兜底）", () => {
    const data = buildFactDataFromCandidate(candidate({ content_raw: "" }));
    expect(data.content_raw).toBe("沈砚取出残角");
  });

  it("timeline 无值不带键（曾漂移为落空串）", () => {
    expect("timeline" in buildFactDataFromCandidate(candidate())).toBe(false);
    expect(buildFactDataFromCandidate(candidate({ timeline: "三日后" })).timeline).toBe("三日后");
  });

  it("type/weight/status 兜底链与富化字段透传", () => {
    const data = buildFactDataFromCandidate(
      candidate({
        narrative_weight: undefined,
        status: undefined,
        caused_by: ["f_ch3"],
        thread_ids: ["t1"],
      } as Partial<ExtractedFactCandidate>),
    );
    expect(data.type).toBe("plot_event");
    expect(data.narrative_weight).toBe("medium");
    expect(data.status).toBe("active");
    expect(data.caused_by).toEqual(["f_ch3"]);
    expect(data.thread_ids).toEqual(["t1"]);
  });
});
