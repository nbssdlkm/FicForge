// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 全局错误兜底测试：window error / unhandledrejection 事件 → report → 日志。
 * 上报走动态 import @ficforge/engine（异步微任务），断言一律 vi.waitFor。
 * 两段：logger 未初始化（降级 console.warn）+ logger 已初始化（落 FileLogger 文件）。
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
// 副作用 import 即自安装（生产同款路径）
import "../global-error-handler";
import { getLogger, initLogger } from "@ficforge/engine";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";

function dispatchError(message: string, error?: Error) {
  window.dispatchEvent(new ErrorEvent("error", { error: error ?? null, message }));
}

function dispatchRejection(reason: unknown) {
  const event = new Event("unhandledrejection") as PromiseRejectionEvent;
  Object.defineProperty(event, "reason", { value: reason });
  window.dispatchEvent(event);
}

describe("global-error-handler（logger 未初始化 → console 降级）", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("未捕获异常被接住，落 [global] 日志（Error 带 stack）", async () => {
    dispatchError("sync boom", new Error("sync boom"));
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    // warnAlways console 降级形态：console.warn(`[tag] msg`, redactCtx(ctx))
    const [head, ctx] = warnSpy.mock.calls[0];
    expect(head).toBe("[global] 未捕获异常");
    expect(String(ctx.error)).toContain("sync boom");
    expect(String(ctx.error)).toContain("at "); // stack 随行（排障需要）
  });

  it("error.error 为 null 时退化用 message", async () => {
    dispatchError("script error.");
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(warnSpy.mock.calls[0][1]).toEqual({ error: "script error." });
  });

  it("unhandledrejection 被接住，reason 进日志", async () => {
    dispatchRejection(new Error("async boom"));
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    const [head, ctx] = warnSpy.mock.calls[0];
    expect(head).toBe("[global] 未处理的 Promise rejection");
    expect(String(ctx.error)).toContain("async boom");
  });

  it("非 Error 的 rejection reason（字符串）也接得住", async () => {
    dispatchRejection("plain string rejection");
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(warnSpy.mock.calls[0][1]).toEqual({ error: "plain string rejection" });
  });
});

describe("global-error-handler（logger 已初始化 → 落日志文件）", () => {
  it("事件进 FileLogger 当日 JSONL", async () => {
    const adapter = new MockAdapter();
    initLogger(adapter, "");
    dispatchError("file sink boom", new Error("file sink boom"));
    await vi.waitFor(async () => {
      await getLogger().flush();
      const text = await getLogger().readToday();
      expect(text).toContain("file sink boom");
      expect(text).toContain('"tag":"global"');
    });
  });
});
