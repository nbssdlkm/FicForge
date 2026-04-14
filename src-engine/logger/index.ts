// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** Logger 单例管理。初始化后全局可用，模式同 getEngine()。 */

import type { PlatformAdapter } from "../platform/adapter.js";
import { FileLogger } from "./logger.js";
import type { Logger, LoggerOptions } from "./logger.js";

export type { Logger, LogEntry, LogLevel, LoggerOptions } from "./logger.js";
export { FileLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _logger: Logger | null = null;

export function initLogger(adapter: PlatformAdapter, dataDir: string, options?: LoggerOptions): Logger {
  if (_logger) _logger.destroy();
  _logger = new FileLogger(adapter, dataDir, options);
  return _logger;
}

export function getLogger(): Logger {
  if (!_logger) throw new Error("Logger not initialized — call initLogger() first");
  return _logger;
}

export function hasLogger(): boolean {
  return _logger !== null;
}

/**
 * 便捷函数：在 silent catch 块中记录被吞掉的错误。
 * Logger 未初始化时静默降级（不抛异常），保证不影响原有流程。
 */
export function logCatch(tag: string, msg: string, err?: unknown): void {
  if (!_logger) return;
  const errMsg = err instanceof Error ? err.message : err != null ? String(err) : undefined;
  _logger.warn(tag, msg, errMsg ? { error: errMsg } : undefined);
}
