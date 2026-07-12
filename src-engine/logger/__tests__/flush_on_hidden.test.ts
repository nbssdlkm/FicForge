// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FileLogger 切后台(visibilitychange→hidden) flush 正向路径（E4 审：此前只测 redact，
 * 未测「切后台落盘」这条触发路径本身）。页面可见性收编到 adapter 后（R4 架构 M5），
 * FileLogger 构造期订阅 adapter.onVisibilityChange，hidden 时 flush 缓冲日志到 JSONL。
 *
 * 这里用捕获 cb 的 mock adapter 驱动「切后台」，钉住：① hidden 触发 writeFile 且落盘含日志内容；
 * ② destroy() 退订后旧 cb 失活、不再产生新写（退订生效，防订阅泄漏）。
 */

import { describe, expect, it, vi } from "vitest";
import { FileLogger } from "../logger.js";

/** 等待微任务/宏任务队列清空（flush 是 fire-and-forget 异步）。 */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** 捕获 onVisibilityChange cb + 记录 writeFile 调用的最小 adapter（FileLogger 只用这几个方法）。 */
function loggerMockAdapter() {
  const fs = new Map<string, string>();
  const writes: Array<{ path: string; content: string }> = [];
  const vis: { cb: ((s: "visible" | "hidden") => void) | null; unsubscribed: number } = {
    cb: null,
    unsubscribed: 0,
  };
  return {
    fs,
    writes,
    vis,
    async mkdir(_p: string) {},
    async exists(p: string) {
      return fs.has(p);
    },
    async listDir(_p: string) {
      return [] as string[];
    },
    async readFile(p: string) {
      const v = fs.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    async writeFile(p: string, c: string) {
      fs.set(p, c);
      writes.push({ path: p, content: c });
    },
    async deleteFile(p: string) {
      fs.delete(p);
    },
    onVisibilityChange(cb: (s: "visible" | "hidden") => void) {
      vis.cb = cb;
      return () => {
        vis.cb = null;
        vis.unsubscribed++;
      };
    },
  } as any;
}

describe("FileLogger — 切后台 flush（visibilitychange→hidden）", () => {
  it("hidden 触发 flush：缓冲日志落盘（writeFile 被调用且含日志内容）", async () => {
    const adapter = loggerMockAdapter();
    // flushIntervalMs 设极大避免定时器抢先 flush；threshold 保持默认 50（写 2 条不触发阈值）
    // —— 只留「切后台」这一条触发路径可观测。
    const logger = new FileLogger(adapter, "/data", { flushIntervalMs: 1_000_000, flushThreshold: 50 });

    logger.info("tagA", "第一条日志内容");
    logger.warn("tagB", "第二条日志内容");
    // 阈值未达 + 定时器未到 → 此刻缓冲仍在内存，未落盘
    expect(adapter.writes).toHaveLength(0);

    adapter.vis.cb?.("hidden");

    await vi.waitFor(() => expect(adapter.writes.length).toBeGreaterThan(0));
    const written = adapter.writes.map((w: { content: string }) => w.content).join("");
    expect(written).toContain("第一条日志内容");
    expect(written).toContain("第二条日志内容");
    // 落盘到当日 JSONL 路径
    expect(adapter.writes.every((w: { path: string }) => w.path.endsWith(".jsonl"))).toBe(true);

    logger.destroy();
  });

  it("destroy() 退订 visibility：旧 cb 失活，后续切后台不再产生新写", async () => {
    const adapter = loggerMockAdapter();
    const logger = new FileLogger(adapter, "/data", { flushIntervalMs: 1_000_000, flushThreshold: 50 });

    logger.info("tag", "destroy 前的日志");
    const capturedCb = adapter.vis.cb; // 订阅时捕获的回调引用
    expect(capturedCb).toBeTypeOf("function");

    logger.destroy(); // 退订 visibility + flush 残留 buffer
    await vi.waitFor(() => expect(adapter.writes.length).toBeGreaterThan(0)); // destroy 的收尾 flush
    const writesAfterDestroy = adapter.writes.length;

    // 退订生效：adapter 侧 cb 已被清空、退订计数 +1
    expect(adapter.vis.cb).toBeNull();
    expect(adapter.vis.unsubscribed).toBe(1);

    // 即便持有旧 cb 引用手动再触发「切后台」，也不产生新写：
    // ① logger 已 destroyed，log() 直接 return（buffer 不增长）；② flush() 对空 buffer 短路。
    logger.info("tag", "destroy 后应被丢弃");
    capturedCb?.("hidden");
    await tick();
    await tick();
    expect(adapter.writes.length).toBe(writesAfterDestroy);
  });
});
