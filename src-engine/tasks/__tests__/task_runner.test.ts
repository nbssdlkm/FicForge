// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TaskRunner / TaskStore 核心行为测试（盲审 2026-07-09 HIGH：此前零测试）。
 * 覆盖：提交→完成、串行队列（并发=1）、失败、排队中取消、运行中取消（abort 协作）、
 * 断点写盘 + resume 路径、completed 上限淘汰、TaskStore round-trip 与损坏容忍。
 */

import { describe, expect, it, vi } from "vitest";
import { TaskRunner } from "../task-runner.js";
import { TaskStore } from "../task-store.js";
import type { TaskCheckpoint, TaskContext, TaskDefinition, TaskEvent } from "../types.js";

// ---------------------------------------------------------------------------
// 内存 adapter（与 PlatformAdapter 文件子集契约一致）
// ---------------------------------------------------------------------------

function memAdapter() {
  const fs = new Map<string, string>();
  return {
    fs,
    async exists(p: string) { return fs.has(p); },
    async readFile(p: string) {
      const v = fs.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    async writeFile(p: string, c: string) { fs.set(p, c); },
    async deleteFile(p: string) {
      if (!fs.has(p)) throw new Error(`ENOENT: ${p}`);
      fs.delete(p);
    },
    async mkdir(_p: string) {},
    async listDir(p: string) {
      const prefix = p.endsWith("/") ? p : p + "/";
      const names = new Set<string>();
      for (const key of fs.keys()) {
        if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0]);
      }
      return [...names];
    },
    async rename(o: string, n: string) {
      const v = fs.get(o);
      if (v === undefined) throw new Error(`rename: source not found: ${o}`);
      fs.set(n, v); fs.delete(o);
    },
  } as any;
}

/** 手动推进的门闩：任务在 gate 上等待，测试端 open() 放行。 */
function makeGate() {
  let openFn!: () => void;
  const opened = new Promise<void>((resolve) => { openFn = resolve; });
  return { wait: () => opened, open: () => openFn() };
}

/** 等待微任务/宏任务队列清空（drain → executeTask 异步启动）。 */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function simpleTask(
  type: string,
  body: (ctx: TaskContext) => AsyncGenerator<TaskEvent, unknown>,
  params: unknown = {},
): TaskDefinition {
  return { type, params, execute: body } as TaskDefinition;
}

// ---------------------------------------------------------------------------
// TaskStore
// ---------------------------------------------------------------------------

describe("TaskStore", () => {
  const cp = (over: Partial<TaskCheckpoint> = {}): TaskCheckpoint => ({
    taskId: "t1",
    taskType: "demo",
    status: "running",
    params: { a: 1 },
    progress: { current: 2, total: 5 },
    data: { done: [1, 2] },
    updatedAt: "2026-07-09T00:00:00Z",
    ...over,
  });

  it("save → load round-trip 保留全部字段", async () => {
    const store = new TaskStore(memAdapter(), "/data");
    await store.save(cp());
    const loaded = await store.load("t1");
    expect(loaded).toEqual(cp());
  });

  it("load 不存在的断点返回 null（不抛）", async () => {
    const store = new TaskStore(memAdapter(), "/data");
    await expect(store.load("nope")).resolves.toBeNull();
  });

  it("remove 后 load 为 null；重复 remove 不抛", async () => {
    const store = new TaskStore(memAdapter(), "/data");
    await store.save(cp());
    await store.remove("t1");
    await expect(store.load("t1")).resolves.toBeNull();
    await expect(store.remove("t1")).resolves.toBeUndefined();
  });

  it("listInterrupted：running 归一为 interrupted；损坏 JSON 跳过不拖垮", async () => {
    const adapter = memAdapter();
    const store = new TaskStore(adapter, "/data");
    await store.save(cp({ taskId: "a", status: "running" }));
    await store.save(cp({ taskId: "b", status: "interrupted" }));
    await store.save(cp({ taskId: "c", status: "paused" }));
    adapter.fs.set("/data/.ficforge/tasks/broken.json", "{truncated");

    const list = await store.listInterrupted();
    const ids = list.map((c) => c.taskId).sort();
    expect(ids).toEqual(["a", "b"]);
    expect(list.every((c) => c.status === "interrupted")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TaskRunner
// ---------------------------------------------------------------------------

describe("TaskRunner", () => {
  function makeRunner() {
    const adapter = memAdapter();
    const runner = new TaskRunner(adapter, "/data");
    return { adapter, runner };
  }

  it("submit → progress 事件 → completed（带 result），断点文件被清理", async () => {
    const { adapter, runner } = makeRunner();
    const events: TaskEvent[] = [];
    runner.onEvent((_id, ev) => events.push(ev));

    const id = runner.submit(simpleTask("demo", async function* (ctx) {
      yield { type: "progress", current: 1, total: 2 };
      await ctx.saveCheckpoint({ upTo: 1 });
      yield { type: "progress", current: 2, total: 2 };
      return { ok: true };
    }));

    await vi.waitFor(() => expect(runner.getTask(id)?.status).toBe("completed"));
    expect(runner.getTask(id)?.result).toEqual({ ok: true });
    expect(runner.getTask(id)?.progress).toEqual({ current: 2, total: 2 });
    expect(events.map((e) => e.type)).toEqual(["progress", "progress", "completed"]);
    // 完成后断点必须清理（否则重启会被误报为 interrupted）
    expect([...adapter.fs.keys()].filter((k) => k.includes("/tasks/"))).toEqual([]);
  });

  it("并发=1：第二个任务等第一个跑完才启动（串行队列）", async () => {
    const { runner } = makeRunner();
    const gate = makeGate();
    const order: string[] = [];

    runner.submit(simpleTask("first", async function* () {
      order.push("first:start");
      await gate.wait();
      order.push("first:end");
      return null;
    }));
    const id2 = runner.submit(simpleTask("second", async function* () {
      order.push("second:start");
      return null;
    }));

    await tick();
    // 第一个挂在 gate 上，第二个必须还在排队
    expect(order).toEqual(["first:start"]);
    expect(runner.getTask(id2)?.status).toBe("pending");

    gate.open();
    await vi.waitFor(() => expect(runner.getTask(id2)?.status).toBe("completed"));
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("execute 抛错 → failed + error 信息，断点清理", async () => {
    const { adapter, runner } = makeRunner();
    const id = runner.submit(simpleTask("boom", async function* (ctx) {
      await ctx.saveCheckpoint({ upTo: 0 });
      throw new Error("disk on fire");
      // eslint-disable-next-line no-unreachable
      yield { type: "progress", current: 0, total: 0 };
    }));

    await vi.waitFor(() => expect(runner.getTask(id)?.status).toBe("failed"));
    expect(runner.getTask(id)?.error).toContain("disk on fire");
    expect([...adapter.fs.keys()].filter((k) => k.includes("/tasks/"))).toEqual([]);
  });

  it("排队中取消：直接出队，状态 cancelled，不会再执行", async () => {
    const { runner } = makeRunner();
    const gate = makeGate();
    const ran: string[] = [];

    runner.submit(simpleTask("blocker", async function* () {
      await gate.wait();
      return null;
    }));
    const id2 = runner.submit(simpleTask("victim", async function* () {
      ran.push("victim");
      return null;
    }));

    await tick();
    runner.cancel(id2);
    expect(runner.getTask(id2)?.status).toBe("cancelled");

    gate.open();
    await tick();
    await tick();
    expect(ran).toEqual([]); // 被取消的任务永不执行
  });

  it("运行中取消：abort 信号协作退出 → cancelled（不是 completed）", async () => {
    const { runner } = makeRunner();
    const gate = makeGate();

    const id = runner.submit(simpleTask("long", async function* (ctx) {
      yield { type: "progress", current: 1, total: 10 };
      await gate.wait();
      if (ctx.signal.aborted) return null; // 协作式取消：观察 signal 提前返回
      yield { type: "progress", current: 10, total: 10 };
      return { finished: true };
    }));

    await tick();
    runner.cancel(id); // running 分支：触发 abort
    gate.open();

    await vi.waitFor(() => expect(runner.getTask(id)?.status).toBe("cancelled"));
    expect(runner.getTask(id)?.result).toBeUndefined();
  });

  it("resume：有断点且定义了 resume 时走 resume（而非 execute）", async () => {
    const { runner } = makeRunner();
    const executeSpy = vi.fn();
    const resumeSpy = vi.fn();

    const checkpoint: TaskCheckpoint = {
      taskId: "resume-me",
      taskType: "demo",
      status: "interrupted",
      params: { from: 3 },
      progress: { current: 3, total: 10 },
      data: { done: [1, 2, 3] },
      updatedAt: "2026-07-09T00:00:00Z",
    };

    const def: TaskDefinition = {
      type: "demo",
      params: { from: 3 },
      execute: async function* () { executeSpy(); return null; },
      resume: async function* (_ctx, cp) { resumeSpy(cp.data); return null; },
    };

    const id = runner.resume(checkpoint, def);
    expect(id).toBe("resume-me"); // 沿用断点 taskId，UI 订阅不断
    await vi.waitFor(() => expect(runner.getTask(id)?.status).toBe("completed"));
    expect(resumeSpy).toHaveBeenCalledWith({ done: [1, 2, 3] });
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("completed 池上限淘汰：超过 50 个后最老的被移除", async () => {
    const { runner } = makeRunner();
    const ids: string[] = [];
    for (let i = 0; i < 52; i++) {
      ids.push(runner.submit(simpleTask(`t${i}`, async function* () { return i; })));
    }
    await vi.waitFor(() => {
      expect(runner.getActiveTasks()).toHaveLength(0);
      expect(runner.getCompletedTasks()).toHaveLength(50);
    });
    // 最早完成的两个已被淘汰（Map 插入序）
    expect(runner.getTask(ids[0])).toBeUndefined();
    expect(runner.getTask(ids[1])).toBeUndefined();
    expect(runner.getTask(ids[51])?.status).toBe("completed");
  });

  it("saveCheckpoint 把断点写进 store；getInterruptedTasks 能在“崩溃”后捞回", async () => {
    const { adapter, runner } = makeRunner();
    const gate = makeGate();

    runner.submit(simpleTask("crashy", async function* (ctx) {
      yield { type: "progress", current: 1, total: 3 };
      await ctx.saveCheckpoint({ upTo: 1 });
      await gate.wait(); // 模拟"进程死在这"——不放行，断点应已在盘上
      return null;
    }, { scope: "au1" }));

    await vi.waitFor(async () => {
      const files = [...adapter.fs.keys()].filter((k) => k.includes("/tasks/") && k.endsWith(".json"));
      expect(files).toHaveLength(1);
    });

    // 新 runner（模拟重启）从同一 adapter 捞断点
    const runner2 = new TaskRunner(adapter, "/data");
    const interrupted = await runner2.getInterruptedTasks();
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].status).toBe("interrupted");
    expect(interrupted[0].data).toEqual({ upTo: 1 });
    expect(interrupted[0].params).toEqual({ scope: "au1" });

    gate.open(); // 收尾，避免悬挂任务泄漏到其它用例
    runner.destroy();
    runner2.destroy();
  });
});
