// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { createThread } from "../thread.js";
import { ThreadStatus } from "../enums.js";

describe("createThread (M8-B)", () => {
  it("applies defaults: empty description/state, status active, empty timestamps", () => {
    const t = createThread({ id: "t1", title: "为父翻案" });
    expect(t.id).toBe("t1");
    expect(t.title).toBe("为父翻案");
    expect(t.description).toBe("");
    expect(t.state).toBe("");
    expect(t.status).toBe(ThreadStatus.ACTIVE);
    expect(t.created_at).toBe("");
    expect(t.updated_at).toBe("");
  });

  it("partial overrides defaults", () => {
    const t = createThread({
      id: "t2",
      title: "太傅的图谋",
      description: "暗线",
      state: "在追查名录",
      status: ThreadStatus.DORMANT,
      created_at: "2026-06-20T00:00:00Z",
      updated_at: "2026-06-20T00:00:00Z",
    });
    expect(t.description).toBe("暗线");
    expect(t.state).toBe("在追查名录");
    expect(t.status).toBe(ThreadStatus.DORMANT);
    expect(t.created_at).toBe("2026-06-20T00:00:00Z");
  });
});
