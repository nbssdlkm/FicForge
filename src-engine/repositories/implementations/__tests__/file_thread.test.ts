// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect } from "vitest";
import { FileThreadRepository } from "../file_thread.js";
import { createThread } from "../../../domain/thread.js";
import { ThreadStatus } from "../../../domain/enums.js";

// 内存 adapter（mirror file_chapter_summary.test.ts）
function memAdapter() {
  const fs = new Map<string, string>();
  return {
    files: fs,
    async exists(p: string) {
      return fs.has(p);
    },
    async readFile(p: string) {
      const v = fs.get(p);
      if (v === undefined) throw new Error("ENOENT");
      return v;
    },
    async writeFile(p: string, c: string) {
      fs.set(p, c);
    },
    async mkdir(_p: string) {},
    async deleteFile(p: string) {
      fs.delete(p);
    },
    async rename(from: string, to: string) {
      const v = fs.get(from);
      if (v === undefined) throw new Error("ENOENT");
      fs.set(to, v);
      fs.delete(from);
    },
  } as any;
}

describe("FileThreadRepository (M8-B)", () => {
  it("add + list + get round-trip", async () => {
    const repo = new FileThreadRepository(memAdapter());
    const t = createThread({
      id: "t1",
      title: "为父翻案",
      description: "主线",
      state: "确认名录被篡改",
      status: ThreadStatus.ACTIVE,
      created_at: "t",
      updated_at: "t",
    });
    await repo.add("/au", t);
    const all = await repo.list("/au");
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("为父翻案");
    expect(all[0].state).toBe("确认名录被篡改");
    expect((await repo.get("/au", "t1"))?.id).toBe("t1");
  });

  it("list on missing file → []", async () => {
    const repo = new FileThreadRepository(memAdapter());
    expect(await repo.list("/au")).toEqual([]);
    expect(await repo.get("/au", "nope")).toBeNull();
  });

  it("update replaces by id and refreshes updated_at", async () => {
    const repo = new FileThreadRepository(memAdapter());
    await repo.add("/au", createThread({ id: "t1", title: "x", state: "v1", created_at: "t", updated_at: "t" }));
    const t = await repo.get("/au", "t1");
    await repo.update("/au", { ...t!, state: "v2", status: ThreadStatus.RESOLVED });
    const got = await repo.get("/au", "t1");
    expect(got?.state).toBe("v2");
    expect(got?.status).toBe(ThreadStatus.RESOLVED);
    expect(got?.updated_at).not.toBe("t"); // refreshed
  });

  it("remove deletes by id", async () => {
    const repo = new FileThreadRepository(memAdapter());
    await repo.add("/au", createThread({ id: "t1", title: "a" }));
    await repo.add("/au", createThread({ id: "t2", title: "b" }));
    await repo.remove("/au", "t1");
    const all = await repo.list("/au");
    expect(all.map((t) => t.id)).toEqual(["t2"]);
  });

  it("invalid status on disk → falls back to active (enum guard)", async () => {
    const adapter = memAdapter();
    adapter.files.set("/au/threads.jsonl", `${JSON.stringify({ id: "t1", title: "x", status: "bogus" })}\n`);
    const repo = new FileThreadRepository(adapter);
    const got = await repo.get("/au", "t1");
    expect(got?.status).toBe(ThreadStatus.ACTIVE);
  });
});
