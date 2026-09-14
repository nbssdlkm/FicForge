// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * AppErrorBoundary 测试：子树渲染抛错 → 兜底页（不白屏）+ 错误落日志 + 复制诊断按钮。
 * 测试环境不初始化 logger → logCatch 降级 console.warn，用 spy 断言。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AppErrorBoundary } from "../AppErrorBoundary";

function Bomb(): never {
  throw new Error("render boom");
}

describe("AppErrorBoundary", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React 会把被 boundary 接住的错误打进 console.error——压掉噪音，不影响行为断言
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it("子树正常时不干预渲染", () => {
    render(
      <AppErrorBoundary>
        <p>正常内容</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("正常内容")).toBeTruthy();
  });

  it("子树抛错：渲染兜底页（错误消息可见）且错误落日志", () => {
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    // 兜底页（i18n defaultValue 兜底，zh 文案）
    expect(screen.getByText("应用遇到错误")).toBeTruthy();
    expect(screen.getByText("render boom")).toBeTruthy();
    expect(screen.getByText("复制诊断信息")).toBeTruthy();
    expect(screen.getByText("重载应用")).toBeTruthy();

    // componentDidCatch 落了两条日志（错误 + 组件栈）；warnAlways console 降级首参为 `[tag] msg` 拼串
    const heads = consoleWarnSpy.mock.calls.map((c) => String(c[0]));
    expect(heads.filter((h) => h.startsWith("[ErrorBoundary]")).length).toBeGreaterThanOrEqual(2);
  });

  it("复制诊断信息：内容进剪贴板", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    fireEvent.click(screen.getByText("复制诊断信息"));
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain("render boom");
    expect(text).toContain("FicForge crash report");
    expect(text).toContain("componentStack");
  });
});
