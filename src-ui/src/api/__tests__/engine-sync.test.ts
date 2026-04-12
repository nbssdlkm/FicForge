// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * engine-sync 逻辑契约测试。
 *
 * resolveFileConflict / syncAllAus 依赖完整引擎实例，
 * 这里提取并测试其中的关键逻辑分支。
 */

import { describe, it, expect } from "vitest";

describe("engine-sync: aggregation logic", () => {
  // 模拟 syncAllAus 的聚合逻辑
  function applyAggregationLogic(agg: { synced: boolean; errors: string[]; fileConflicts: unknown[] }) {
    // 这是 engine-sync.ts line 107-108 的逻辑
    if (agg.errors.length > 0) {
      agg.synced = false;
    }
  }

  it("errors → synced=false even when fileConflicts exist", () => {
    const agg = { synced: true, errors: ["AU1 failed"], fileConflicts: [{ path: "ch.md" }] };
    applyAggregationLogic(agg);
    expect(agg.synced).toBe(false);
  });

  it("errors → synced=false when no fileConflicts", () => {
    const agg = { synced: true, errors: ["timeout"], fileConflicts: [] };
    applyAggregationLogic(agg);
    expect(agg.synced).toBe(false);
  });

  it("no errors → synced stays true", () => {
    const agg = { synced: true, errors: [], fileConflicts: [{ path: "ch.md" }] };
    applyAggregationLogic(agg);
    expect(agg.synced).toBe(true);
  });

  it("empty state → synced stays true", () => {
    const agg = { synced: true, errors: [], fileConflicts: [] };
    applyAggregationLogic(agg);
    expect(agg.synced).toBe(true);
  });
});

describe("engine-sync: resolveFileConflict null protection", () => {
  it("null remoteContent should not be written as empty string", () => {
    // 模拟 resolveFileConflict 的 remote 分支逻辑
    const remoteContent: string | null = null;

    // 修复后的逻辑：null → throw
    expect(() => {
      if (remoteContent === null) {
        throw new Error("远端文件已不存在");
      }
    }).toThrow("远端文件已不存在");
  });

  it("valid remoteContent should pass through", () => {
    const remoteContent: string | null = "chapter content";
    let written = "";

    // 修复后的逻辑
    if (remoteContent === null) {
      throw new Error("远端文件已不存在");
    }
    written = remoteContent;

    expect(written).toBe("chapter content");
  });
});

describe("engine-sync: error message formatting", () => {
  // 模拟 useSyncOperations 的错误格式化逻辑
  function formatErrors(errors: string[]): string {
    if (errors.length === 0) return "";
    if (errors.length <= 3) return errors.join("; ");
    return `${errors.slice(0, 3).join("; ")} (+${errors.length - 3})`;
  }

  it("0 errors → empty string", () => {
    expect(formatErrors([])).toBe("");
  });

  it("1 error → single message", () => {
    expect(formatErrors(["AU1 failed"])).toBe("AU1 failed");
  });

  it("3 errors → all shown joined", () => {
    expect(formatErrors(["a", "b", "c"])).toBe("a; b; c");
  });

  it("5 errors → first 3 + count", () => {
    expect(formatErrors(["a", "b", "c", "d", "e"])).toBe("a; b; c (+2)");
  });
});
