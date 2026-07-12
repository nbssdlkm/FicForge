// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { hasLogger, logCatch } from "../api/engine-client";

export function logUiError(tag: string, message: string, error?: unknown): void {
  logCatch(tag, message, error);
}

/**
 * 后台路径告警（与引擎 platformWarn 同口径）：logger 就绪时进日志文件——
 * 只有文件里的条目能随「导出日志」带走诊断，console 输出带不走；
 * logger 未就绪（引导早期）降级 console.warn 保证诊断不丢。
 * 用它替代 UI 生产代码里的裸 console.warn。
 */
export function warnUi(tag: string, message: string, error?: unknown): void {
  if (hasLogger()) {
    logCatch(tag, message, error);
    return;
  }
  // 脱敏口径与引擎 logCatch 对齐（logger/index.ts）：只取 Error.message，不把整个 error 对象丢进
  // console——它可能带堆栈 / 请求体 / 密钥。不引引擎 redactCtx（跨层 import），此档提取够用。
  const redacted = error instanceof Error ? error.message : error != null ? String(error) : undefined;
  // biome-ignore lint/suspicious/noConsole: sanctioned 降级出口——logger 未就绪时保诊断不丢
  if (redacted !== undefined) console.warn(`[${tag}] ${message}`, redacted);
  // biome-ignore lint/suspicious/noConsole: 同上
  else console.warn(`[${tag}] ${message}`);
}

/**
 * 工厂函数：生成和 `() => {}` 一样短但至少落日志的 catch handler。
 * 用法：`.catch(catchAndLog('Component', 'op failed'))`
 *
 * 不替代 `useFeedback().showError`（用户触发操作需要可见反馈），
 * 只替代裸 `.catch(() => {})` 的后台数据加载/刷新路径。
 */
export function catchAndLog(tag: string, message: string): (err: unknown) => void {
  return (err) => logUiError(tag, message, err);
}

/**
 * 工厂函数：给「失败则兜底返回 null」的后台加载路径用的 catch handler——
 * 先 logUiError 留痕（等级同 logCatch），再返回 null 兜底。
 * 取代散落的 `.catch(() => null)`：兜底值（null）不变，但失败开始留痕（可随「导出日志」带走）。
 * 用法：`getX(...).catch(swallowToNull('Component', 'load X failed'))`
 */
export function swallowToNull(tag: string, message: string): (err: unknown) => null {
  return (err) => {
    logUiError(tag, message, err);
    return null;
  };
}
