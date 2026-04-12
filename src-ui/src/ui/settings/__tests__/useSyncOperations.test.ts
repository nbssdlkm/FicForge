// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useSyncOperations 逻辑契约测试。
 *
 * hook 内部依赖 React useState/useRef，这里提取纯决策逻辑分支单独验证，
 * 不需要 jsdom / testing-library。
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// 1. handleSyncNow 状态分支决策
//    优先级：fileConflicts > errors-only > opsConflicts > success
// ---------------------------------------------------------------------------

type SyncResult = {
  synced: boolean;
  errors: string[];
  fileConflicts: { auPath: string; path: string; localModified: string; remoteModified: string }[];
  opsConflicts?: string[];
};

/**
 * 提取 handleSyncNow 中的状态决策逻辑（line 73-107）。
 * 返回值对应 setSyncResultStatus 应设定的值。
 */
function decideSyncStatus(result: SyncResult): "success" | "error" | "conflicts" {
  if (result.fileConflicts.length > 0) {
    return "conflicts";
  } else if (result.errors.length > 0) {
    return "error";
  } else if (result.opsConflicts && result.opsConflicts.length > 0) {
    return "conflicts";
  } else {
    return "success";
  }
}

describe("useSyncOperations: handleSyncNow status decision", () => {
  it("fileConflicts → conflicts (even with errors)", () => {
    expect(decideSyncStatus({
      synced: true,
      errors: ["AU1 timeout"],
      fileConflicts: [{ auPath: "au1", path: "ch1.md", localModified: "2026-01-01", remoteModified: "2026-01-02" }],
    })).toBe("conflicts");
  });

  it("fileConflicts → conflicts (no errors)", () => {
    expect(decideSyncStatus({
      synced: true,
      errors: [],
      fileConflicts: [{ auPath: "au1", path: "ch1.md", localModified: "2026-01-01", remoteModified: "2026-01-02" }],
    })).toBe("conflicts");
  });

  it("errors only (no conflicts) → error", () => {
    expect(decideSyncStatus({
      synced: false,
      errors: ["network timeout"],
      fileConflicts: [],
    })).toBe("error");
  });

  it("opsConflicts only → conflicts", () => {
    expect(decideSyncStatus({
      synced: true,
      errors: [],
      fileConflicts: [],
      opsConflicts: ["lamport clock diverged"],
    })).toBe("conflicts");
  });

  it("fileConflicts take priority over opsConflicts", () => {
    expect(decideSyncStatus({
      synced: true,
      errors: [],
      fileConflicts: [{ auPath: "au1", path: "ch1.md", localModified: "2026-01-01", remoteModified: "2026-01-02" }],
      opsConflicts: ["lamport diverged"],
    })).toBe("conflicts");
  });

  it("errors take priority over opsConflicts", () => {
    expect(decideSyncStatus({
      synced: false,
      errors: ["write failed"],
      fileConflicts: [],
      opsConflicts: ["lamport diverged"],
    })).toBe("error");
  });

  it("all clear → success", () => {
    expect(decideSyncStatus({
      synced: true,
      errors: [],
      fileConflicts: [],
    })).toBe("success");
  });

  it("empty opsConflicts array → success", () => {
    expect(decideSyncStatus({
      synced: true,
      errors: [],
      fileConflicts: [],
      opsConflicts: [],
    })).toBe("success");
  });
});

// ---------------------------------------------------------------------------
// 2. nonConflictErrors 残留检查
//    冲突全部解决后，如果有非冲突错误 → error，否则 → success
// ---------------------------------------------------------------------------

function decidePostResolutionStatus(nonConflictErrors: string[]): "success" | "error" {
  return nonConflictErrors.length > 0 ? "error" : "success";
}

describe("useSyncOperations: post-resolution nonConflictErrors check", () => {
  it("no residual errors → success", () => {
    expect(decidePostResolutionStatus([])).toBe("success");
  });

  it("residual errors → error", () => {
    expect(decidePostResolutionStatus(["AU2 merge failed"])).toBe("error");
  });

  it("multiple residual errors → error", () => {
    expect(decidePostResolutionStatus(["err1", "err2", "err3", "err4"])).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// 3. 错误消息格式化（与 engine-sync.test.ts 中相同逻辑，但这是 hook 内联的）
// ---------------------------------------------------------------------------

function formatErrorMessage(errors: string[]): string {
  if (errors.length === 0) return "";
  if (errors.length <= 3) return errors.join("; ");
  return `${errors.slice(0, 3).join("; ")} (+${errors.length - 3})`;
}

describe("useSyncOperations: error message formatting", () => {
  it("0 errors → empty", () => {
    expect(formatErrorMessage([])).toBe("");
  });

  it("1 error → single", () => {
    expect(formatErrorMessage(["timeout"])).toBe("timeout");
  });

  it("3 errors → all joined", () => {
    expect(formatErrorMessage(["a", "b", "c"])).toBe("a; b; c");
  });

  it("4 errors → first 3 + count", () => {
    expect(formatErrorMessage(["a", "b", "c", "d"])).toBe("a; b; c (+1)");
  });

  it("10 errors → first 3 + count", () => {
    const errors = Array.from({ length: 10 }, (_, i) => `err${i}`);
    expect(formatErrorMessage(errors)).toBe("err0; err1; err2 (+7)");
  });
});

// ---------------------------------------------------------------------------
// 4. handleTestWebDAV URL 验证
// ---------------------------------------------------------------------------

function isValidWebDAVUrl(url: string): boolean {
  const raw = url.trim();
  return raw.startsWith("http://") || raw.startsWith("https://");
}

describe("useSyncOperations: WebDAV URL validation", () => {
  it("https:// URL passes", () => {
    expect(isValidWebDAVUrl("https://dav.example.com")).toBe(true);
  });

  it("http:// URL passes", () => {
    expect(isValidWebDAVUrl("http://192.168.1.1:5005")).toBe(true);
  });

  it("URL with leading spaces is trimmed and passes", () => {
    expect(isValidWebDAVUrl("  https://dav.example.com  ")).toBe(true);
  });

  it("ftp:// URL fails", () => {
    expect(isValidWebDAVUrl("ftp://example.com")).toBe(false);
  });

  it("empty string fails", () => {
    expect(isValidWebDAVUrl("")).toBe(false);
  });

  it("relative path fails", () => {
    expect(isValidWebDAVUrl("/webdav/data")).toBe(false);
  });

  it("bare domain fails", () => {
    expect(isValidWebDAVUrl("example.com")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. stale request 保护逻辑
// ---------------------------------------------------------------------------

describe("useSyncOperations: stale request guard", () => {
  it("matching requestId → apply result", () => {
    let currentId = 0;
    const syncRequestId = ++currentId;
    // simulate async return
    const shouldApply = syncRequestId === currentId;
    expect(shouldApply).toBe(true);
  });

  it("outdated requestId → discard result", () => {
    let currentId = 0;
    const syncRequestId = ++currentId; // 1
    ++currentId; // 2 — user triggered another sync
    const shouldApply = syncRequestId === currentId;
    expect(shouldApply).toBe(false);
  });

  it("multiple rapid requests → only latest applies", () => {
    let currentId = 0;
    const req1 = ++currentId;
    const req2 = ++currentId;
    const req3 = ++currentId;
    expect(req1 === currentId).toBe(false);
    expect(req2 === currentId).toBe(false);
    expect(req3 === currentId).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. handleSyncNow 冲突+错误并存时的消息拼接
// ---------------------------------------------------------------------------

describe("useSyncOperations: conflict + error coexistence message", () => {
  function buildSyncMessage(_conflictCount: number, allErrorsMsg: string, conflictsFoundMsg: string): string {
    // 模拟 line 84-86 的逻辑
    const msg = conflictsFoundMsg;
    return allErrorsMsg ? `${msg} | ${allErrorsMsg}` : msg;
  }

  it("conflicts only → no pipe separator", () => {
    expect(buildSyncMessage(2, "", "发现 2 个冲突")).toBe("发现 2 个冲突");
  });

  it("conflicts + errors → pipe-separated", () => {
    expect(buildSyncMessage(1, "AU2 timeout", "发现 1 个冲突")).toBe("发现 1 个冲突 | AU2 timeout");
  });

  it("conflicts + multiple errors → pipe-separated with truncation", () => {
    const errMsg = "a; b; c (+2)";
    expect(buildSyncMessage(3, errMsg, "发现 3 个冲突")).toBe("发现 3 个冲突 | a; b; c (+2)");
  });
});

// ---------------------------------------------------------------------------
// 7. handleResolveAllConflicts 部分失败行为
// ---------------------------------------------------------------------------

describe("useSyncOperations: resolveAll partial failure", () => {
  /**
   * 模拟 handleResolveAllConflicts 的逐个解决逻辑。
   * 返回 { resolved, failed, lastError }。
   */
  async function simulateResolveAll(
    items: string[],
    resolveFn: (path: string) => Promise<void>,
  ) {
    const resolved: string[] = [];
    let lastError: string | null = null;

    for (const path of items) {
      try {
        await resolveFn(path);
        resolved.push(path);
      } catch (e: any) {
        lastError = e?.message || "";
      }
    }

    return { resolved, lastError };
  }

  it("all succeed → no lastError", async () => {
    const result = await simulateResolveAll(
      ["a.md", "b.md"],
      async () => {},
    );
    expect(result.resolved).toEqual(["a.md", "b.md"]);
    expect(result.lastError).toBeNull();
  });

  it("middle item fails → continues, reports last error", async () => {
    const result = await simulateResolveAll(
      ["a.md", "b.md", "c.md"],
      async (path) => {
        if (path === "b.md") throw new Error("network error");
      },
    );
    expect(result.resolved).toEqual(["a.md", "c.md"]);
    expect(result.lastError).toBe("network error");
  });

  it("all fail → lastError is from last item", async () => {
    const result = await simulateResolveAll(
      ["a.md", "b.md"],
      async (path) => { throw new Error(`fail:${path}`); },
    );
    expect(result.resolved).toEqual([]);
    expect(result.lastError).toBe("fail:b.md");
  });

  it("post-resolution status with nonConflictErrors after partial failure → error", async () => {
    const result = await simulateResolveAll(
      ["a.md"],
      async () => { throw new Error("fail"); },
    );
    // lastError means status = 'error', nonConflictErrors not even checked
    expect(result.lastError).not.toBeNull();
  });
});
