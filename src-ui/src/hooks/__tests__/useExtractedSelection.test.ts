// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * getCandidateKey（useExtractedSelection.ts 导出的纯函数）单测（R4 测试 L4：此前零测试）。
 *
 * 键 = `${content_clean}-${chapter}-${index}`。selectAll / filterSelected 用它做提取候选的
 * 选中集判等，故：同输入必同键（确定性）、内容或章节不同必不同键（唯一性）、内容+章节
 * 完全相同的重复候选靠 index 兜底区分（否则重复事实会被当成同一条勾选，漏选/多选）。
 */

import { describe, expect, it } from "vitest";
import { getCandidateKey } from "../useExtractedSelection";
import type { ExtractedFactCandidate } from "../../api/engine-client";

function candidate(partial: Partial<ExtractedFactCandidate>): ExtractedFactCandidate {
  return {
    content_raw: "raw",
    content_clean: "clean",
    characters: [],
    narrative_weight: "medium",
    status: "active",
    chapter: 1,
    ...partial,
  };
}

describe("getCandidateKey", () => {
  it("确定性：同 candidate + 同 index → 同 key", () => {
    const c = candidate({ content_clean: "Alice 登场", chapter: 3 });
    expect(getCandidateKey(c, 0)).toBe(getCandidateKey(c, 0));
    expect(getCandidateKey(c, 0)).toBe("Alice 登场-3-0");
  });

  it("唯一性：content_clean / chapter 任一不同 → key 不同", () => {
    const a = candidate({ content_clean: "Alice 登场", chapter: 3 });
    const b = candidate({ content_clean: "Bob 登场", chapter: 3 });
    const c = candidate({ content_clean: "Alice 登场", chapter: 4 });
    expect(getCandidateKey(a, 0)).not.toBe(getCandidateKey(b, 0));
    expect(getCandidateKey(a, 0)).not.toBe(getCandidateKey(c, 0));
  });

  it("回退：content_clean+chapter 完全相同（重复候选）→ index 兜底区分", () => {
    const dup = candidate({ content_clean: "重复事实", chapter: 2 });
    expect(getCandidateKey(dup, 0)).not.toBe(getCandidateKey(dup, 1));
    expect(getCandidateKey(dup, 0)).toBe("重复事实-2-0");
    expect(getCandidateKey(dup, 1)).toBe("重复事实-2-1");
  });

  it("回退：content_clean 为空串 → 仍靠 chapter-index 稳定成键", () => {
    const empty = candidate({ content_clean: "", chapter: 5 });
    expect(getCandidateKey(empty, 0)).toBe("-5-0");
    expect(getCandidateKey(empty, 0)).not.toBe(getCandidateKey(empty, 1));
  });
});
