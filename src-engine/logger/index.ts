// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** Logger 单例管理。初始化后全局可用，模式同 getEngine()。 */

import type { PlatformAdapter } from "../platform/adapter.js";
import { FileLogger, redactCtx } from "./logger.js";
import type { Logger, LoggerOptions } from "./logger.js";

export type { Logger, LogEntry, LogLevel, LoggerOptions } from "./logger.js";
export { FileLogger, redactCtx } from "./logger.js";

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

/**
 * 告警必达：logger 就绪时落日志文件（ctx 经脱敏，条目可随「导出日志」带走），
 * 未就绪（引导早期）降级 console.warn 保证诊断不丢。
 * 生产代码的告警一律用它，不允许裸 console.warn（console 输出无法随导出带走）。
 */
export function warnAlways(tag: string, msg: string, ctx?: Record<string, unknown>): void {
  if (_logger) {
    _logger.warn(tag, msg, ctx);
    return;
  }
  /* eslint-disable no-console */
  // console 降级同样过脱敏（B2 对抗审）：logger 就绪前传入敏感 ctx 的未来调用方不该明文入 console
  if (ctx) console.warn(`[${tag}] ${msg}`, redactCtx(ctx));
  else console.warn(`[${tag}] ${msg}`);
  /* eslint-enable no-console */
}
