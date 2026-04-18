// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 轻量级日志系统。
 *
 * - 同步 push 到内存 buffer（调用方零阻塞）
 * - 定时 / 满量 / visibilitychange 批量 flush 到 JSONL 文件
 * - 自动按日轮转，保留 N 天
 * - ctx 字段自动脱敏（api_key、password 等）
 */

import type { PlatformAdapter } from "../platform/adapter.js";
import { joinPath } from "../repositories/implementations/file_utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  lvl: LogLevel;
  tag: string;
  msg: string;
  ctx?: Record<string, unknown>;
}

export interface LoggerOptions {
  minLevel?: LogLevel;
  flushIntervalMs?: number;
  flushThreshold?: number;
  maxDailyFileBytes?: number;
  retainDays?: number;
}

export interface Logger {
  debug(tag: string, msg: string, ctx?: Record<string, unknown>): void;
  info(tag: string, msg: string, ctx?: Record<string, unknown>): void;
  warn(tag: string, msg: string, ctx?: Record<string, unknown>): void;
  error(tag: string, msg: string, ctx?: Record<string, unknown>): void;
  flush(): Promise<void>;
  readToday(): Promise<string>;
  readFile(filename: string): Promise<string>;
  listLogFiles(): Promise<string[]>;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const REDACT_RE = /api_key|apikey|password|secret|token|authorization|credential/i;
const LOGS_DIR_SUFFIX = ".ficforge/logs";

// ---------------------------------------------------------------------------
// FileLogger
// ---------------------------------------------------------------------------

export class FileLogger implements Logger {
  private adapter: PlatformAdapter;
  private logsDir: string;
  private minLevel: number;
  private flushThreshold: number;
  private maxDailyFileBytes: number;
  private retainDays: number;

  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private visibilityHandler: (() => void) | null = null;
  private destroyed = false;

  constructor(adapter: PlatformAdapter, dataDir: string, options?: LoggerOptions) {
    this.adapter = adapter;
    // dataDir 是数据根目录（可空，Capacitor/Web 约定 "" = 平台 Data 目录）。
    // joinPath 自动过滤空段，与 FileSettingsRepository / TaskStore 的拼接方式一致。
    this.logsDir = joinPath(dataDir, LOGS_DIR_SUFFIX);
    this.minLevel = LEVEL_ORDER[options?.minLevel ?? "debug"];
    this.flushThreshold = options?.flushThreshold ?? 50;
    this.maxDailyFileBytes = options?.maxDailyFileBytes ?? 2 * 1024 * 1024;
    this.retainDays = options?.retainDays ?? 7;

    const interval = options?.flushIntervalMs ?? 5000;
    this.flushTimer = setInterval(() => void this.flush(), interval);

    // visibilitychange flush（移动端后台时保存）
    if (typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (document.visibilityState === "hidden") void this.flush();
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }

    // 启动清理旧日志（fire-and-forget）
    void this.cleanOldLogs();
  }

  // --- Public log methods ---

  debug(tag: string, msg: string, ctx?: Record<string, unknown>): void {
    this.log("debug", tag, msg, ctx);
  }
  info(tag: string, msg: string, ctx?: Record<string, unknown>): void {
    this.log("info", tag, msg, ctx);
  }
  warn(tag: string, msg: string, ctx?: Record<string, unknown>): void {
    this.log("warn", tag, msg, ctx);
  }
  error(tag: string, msg: string, ctx?: Record<string, unknown>): void {
    this.log("error", tag, msg, ctx);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.flushing) return;
    this.flushing = true;
    const batch = this.buffer.splice(0);
    const chunk = batch.join("\n") + "\n";
    try {
      const path = this.todayPath();
      await this.adapter.mkdir(this.logsDir).catch(() => {});
      // 追加写入：读现有内容 + 拼接（PlatformAdapter 只有 writeFile 没有 appendFile）
      let existing = "";
      try {
        existing = await this.adapter.readFile(path);
      } catch {
        // 文件不存在，正常
      }
      const merged = existing + chunk;
      // 超出日限则轮转
      if (new TextEncoder().encode(merged).length > this.maxDailyFileBytes) {
        await this.rotateFile(path, existing);
        await this.adapter.writeFile(path, chunk);
      } else {
        await this.adapter.writeFile(path, merged);
      }
    } catch {
      // 日志写入本身失败不能再抛异常，否则死循环
    } finally {
      this.flushing = false;
    }
  }

  async readToday(): Promise<string> {
    try {
      return await this.adapter.readFile(this.todayPath());
    } catch {
      return "";
    }
  }

  async readFile(filename: string): Promise<string> {
    try {
      return await this.adapter.readFile(`${this.logsDir}/${filename}`);
    } catch {
      return "";
    }
  }

  async listLogFiles(): Promise<string[]> {
    try {
      const files = await this.adapter.listDir(this.logsDir);
      return files.filter((f) => f.endsWith(".jsonl")).sort().reverse();
    } catch {
      return [];
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    // 尽力 flush 剩余
    void this.flush();
  }

  // --- Internal ---

  private log(level: LogLevel, tag: string, msg: string, ctx?: Record<string, unknown>): void {
    if (this.destroyed) return;
    if (LEVEL_ORDER[level] < this.minLevel) return;

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      lvl: level,
      tag,
      msg,
      ...(ctx ? { ctx: redactCtx(ctx) } : {}),
    };
    this.buffer.push(JSON.stringify(entry));

    if (this.buffer.length >= this.flushThreshold) {
      void this.flush();
    }
  }

  private todayPath(): string {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `${this.logsDir}/${date}.jsonl`;
  }

  private async rotateFile(path: string, content: string): Promise<void> {
    // 重命名为 _1, _2, ...
    for (let i = 1; i <= 5; i++) {
      const rotated = path.replace(".jsonl", `_${i}.jsonl`);
      const exists = await this.adapter.exists(rotated).catch(() => false);
      if (!exists) {
        try {
          await this.adapter.writeFile(rotated, content);
        } catch { /* best effort */ }
        return;
      }
    }
    // 超过 5 个轮转文件就放弃旧内容
  }

  private async cleanOldLogs(): Promise<void> {
    try {
      const exists = await this.adapter.exists(this.logsDir);
      if (!exists) return;
      const files = await this.adapter.listDir(this.logsDir);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - this.retainDays);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const dateStr = f.slice(0, 10); // YYYY-MM-DD
        if (dateStr < cutoffStr) {
          await this.adapter.deleteFile(`${this.logsDir}/${f}`).catch(() => {});
        }
      }
    } catch {
      // 清理失败不影响正常使用
    }
  }
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

function redactCtx(ctx: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (REDACT_RE.test(key)) {
      result[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactCtx(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}
