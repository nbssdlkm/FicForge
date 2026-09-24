// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * 应用根 ErrorBoundary（2026-09-08，补「React 渲染崩溃白屏无痕」盲区）。
 *
 * 子树渲染抛错时：componentDidCatch 落日志（错误 + 组件栈），渲染友好兜底页
 * （复制诊断信息 / 重载应用）而不是白屏。
 *
 * 注意：ErrorBoundary 必须是 class 组件（React 无 hooks 等价物）。
 * 兜底 UI 不依赖 i18n 以外的运行时状态——i18n 键带 defaultValue，即使
 * i18n 自身受损也能渲出可读文案。
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { logCatch, redactString } from "@ficforge/engine";
import i18n from "../../i18n";

/** React 运行时允许抛非 Error 值（null/字符串/对象）——不归一的话 state.error 为 falsy，
 *  render 会回退渲染子树再次抛错，兜底页失效。统一包成 Error。 */
function normalizeThrown(value: unknown): Error {
  if (value instanceof Error) return value;
  try {
    return new Error(typeof value === "object" ? JSON.stringify(value) : String(value));
  } catch {
    return new Error("Unknown non-Error thrown value");
  }
}

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string;
  /** 复制诊断信息的瞬态反馈（1.5s 复位）。 */
  copied: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: "", copied: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: normalizeThrown(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const normalized = normalizeThrown(error);
    logCatch("ErrorBoundary", "React 渲染崩溃", normalized);
    // 组件栈单独落一条（error.message 不含它；ctx 过脱敏）
    logCatch("ErrorBoundary", "组件栈", info.componentStack ?? "");
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  // 复制外发面同样过 redactString（与日志同口径）——stack/componentStack 可能含
  // 带密钥的 URL / 供应商错误回显，诊断信息是要发给别人的。
  private diagnosticsText(): string {
    const { error, componentStack } = this.state;
    return [
      `FicForge crash report`,
      `time: ${new Date().toISOString()}`,
      `ua: ${navigator.userAgent}`,
      `error: ${redactString(error?.message ?? "unknown")}`,
      `stack: ${redactString(error?.stack ?? "-")}`,
      `componentStack: ${redactString(componentStack || "-")}`,
    ].join("\n");
  }

  private copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly handleCopy = () => {
    navigator.clipboard
      .writeText(this.diagnosticsText())
      .then(() => {
        // 重复点击先清旧定时器再复位计时（防多次点击堆叠导致反馈提前消失）。
        // 不挂 unmount 清理：根 boundary 生命周期 = 页面生命周期。
        if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
        this.setState({ copied: true });
        this.copyResetTimer = setTimeout(() => this.setState({ copied: false }), 1500);
      })
      .catch((err) => logCatch("ErrorBoundary", "复制诊断信息失败", err));
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-4 rounded-lg border border-rule bg-surface p-6 text-center">
          <p className="text-lg font-bold text-text">
            {i18n.t("errorBoundary.title", { defaultValue: "应用遇到错误" })}
          </p>
          <p className="text-sm text-text/70">
            {i18n.t("errorBoundary.description", {
              defaultValue: "界面渲染时发生异常。你可以复制诊断信息发给开发者，或重载应用重试。",
            })}
          </p>
          <p className="rounded-sm bg-black/5 p-2 text-left font-mono text-xs break-all text-error dark:bg-white/5">
            {redactString(error.message)}
          </p>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              className="rounded-sm border border-rule px-4 py-2 text-sm text-text/80 hover:bg-black/5 dark:hover:bg-white/5"
              onClick={this.handleCopy}
            >
              {this.state.copied
                ? i18n.t("errorBoundary.copied", { defaultValue: "已复制" })
                : i18n.t("errorBoundary.copyDiagnostics", { defaultValue: "复制诊断信息" })}
            </button>
            <button
              type="button"
              className="rounded-sm bg-accent px-4 py-2 text-sm text-inv-text hover:brightness-110"
              onClick={() => window.location.reload()}
            >
              {i18n.t("errorBoundary.reload", { defaultValue: "重载应用" })}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
