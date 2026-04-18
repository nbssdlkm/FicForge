// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * AU 锁核心契约测试。
 *
 * 覆盖本轮审计 P0-2 的修复：确保所有 AU 级写 service 共享同一把锁，
 * 并发时相同 AU 串行、不同 AU 并行。
 */

import { describe, it, expect } from "vitest";
import { withAuLock } from "../au_lock.js";

describe("withAuLock", () => {
  it("同一 au_id 的并发调用严格串行", async () => {
    const timeline: string[] = [];

    async function task(label: string, delay: number) {
      return withAuLock("au1", async () => {
        timeline.push(`${label}:enter`);
        await new Promise((r) => setTimeout(r, delay));
        timeline.push(`${label}:exit`);
      });
    }

    await Promise.all([task("A", 30), task("B", 10), task("C", 5)]);

    // 同一 AU 串行 → 必须是成对的 enter/exit（不交错）
    expect(timeline).toEqual([
      "A:enter", "A:exit",
      "B:enter", "B:exit",
      "C:enter", "C:exit",
    ]);
  });

  it("不同 au_id 可以并行执行（不互相阻塞）", async () => {
    const timeline: string[] = [];

    async function task(auId: string, label: string) {
      return withAuLock(auId, async () => {
        timeline.push(`${label}:enter`);
        await new Promise((r) => setTimeout(r, 20));
        timeline.push(`${label}:exit`);
      });
    }

    const start = Date.now();
    await Promise.all([task("auA", "A"), task("auB", "B"), task("auC", "C")]);
    const elapsed = Date.now() - start;

    // 三个不同 AU 如果串行会 ≥ 60ms；并行应该 < 50ms
    expect(elapsed).toBeLessThan(50);
    // 由于并行 + setTimeout 抖动，严格顺序不确定；但 enter 集中在前半段
    const firstThree = timeline.slice(0, 3).sort();
    expect(firstThree).toEqual(["A:enter", "B:enter", "C:enter"]);
  });

  it("前序失败不阻塞后续（错误隔离）", async () => {
    const results: string[] = [];

    const failing = withAuLock("au1", async () => {
      throw new Error("boom");
    }).catch((e) => results.push(`fail:${e.message}`));

    const succeeding = withAuLock("au1", async () => {
      results.push("success");
    });

    await Promise.all([failing, succeeding]);

    expect(results).toContain("fail:boom");
    expect(results).toContain("success");
  });

  it("命名空间隔离：au_lock 的 key 不与裸文件路径碰撞", async () => {
    // withAuLock("foo/bar") 应该不与 withWriteLock("foo/bar") 同队列。
    // 通过观察：两个不同命名空间的任务应该并行跑完。
    const { withWriteLock } = await import("../../repositories/implementations/file_utils.js");

    const timeline: string[] = [];
    const t1 = withAuLock("foo/bar", async () => {
      timeline.push("au:enter");
      await new Promise((r) => setTimeout(r, 20));
      timeline.push("au:exit");
    });
    const t2 = withWriteLock("foo/bar", async () => {
      timeline.push("file:enter");
      await new Promise((r) => setTimeout(r, 20));
      timeline.push("file:exit");
    });

    const start = Date.now();
    await Promise.all([t1, t2]);
    const elapsed = Date.now() - start;

    // 如果 key 碰撞会串行 ≥ 40ms；命名空间隔离则 < 35ms
    expect(elapsed).toBeLessThan(35);
  });
});
