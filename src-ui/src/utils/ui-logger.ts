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
  /* eslint-disable no-console */
  if (error !== undefined) console.warn(`[${tag}] ${message}`, error);
  else console.warn(`[${tag}] ${message}`);
  /* eslint-enable no-console */
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
