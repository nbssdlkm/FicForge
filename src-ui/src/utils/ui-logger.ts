// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { logCatch } from "../api/engine-client";

export function logUiError(tag: string, message: string, error?: unknown): void {
  logCatch(tag, message, error);
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
