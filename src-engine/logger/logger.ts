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
import { joinPath } from "../utils/file_utils.js";

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
// 字段名为 key / *_key 的 ctx 值也可能是 secure key 名（内嵌作品/AU 标题）——
// 一并掩码（盲审 2026-07-09）。需要可诊断值时用 key_redacted 字段传
// redactSecureKey() 的结果（"redacted" 后缀不命中此规则）。
const KEY_FIELD_RE = /(^|_)key$/i;
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
  private unsubscribeVisibility: (() => void) | null = null;
  private destroyed = false;
  /** 最近一次 flush 的 Promise，destroy() 用来链式等待。 */
  private _lastFlush: Promise<void> = Promise.resolve();

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

    // visibilitychange flush（移动端后台时保存）—— 收编到 adapter（R4 架构 M5）：
    // 核心引擎不再直连 document。无 DOM 环境（Node 单测）adapter 返回 no-op、订阅永不触发。
    this.unsubscribeVisibility = adapter.onVisibilityChange((visState) => {
      if (visState === "hidden") void this.flush();
    });

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
    if (this.buffer.length === 0 || this.flushing) return this._lastFlush;
    this.flushing = true;
    const batch = this.buffer.splice(0);
    const chunk = batch.join("\n") + "\n";
    this._lastFlush = (async () => {
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
        // 写入失败：把 batch 放回 buffer 头部，下次 flush 重试。
        // 不放回会导致 splice(0) 已清空的日志条目永久丢失。
        this.buffer.unshift(...batch);
      } finally {
        this.flushing = false;
      }
    })();
    return this._lastFlush;
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
      return files
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .reverse();
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
    if (this.unsubscribeVisibility) {
      this.unsubscribeVisibility();
      this.unsubscribeVisibility = null;
    }
    // 等当前 flush（如果有）完成，再 flush 剩余 buffer。
    // 如果不等待直接调 flush()，正在进行的 flush 持有 this.flushing=true
    // 会导致最终 flush 短路，残留 buffer 丢失。
    void this._lastFlush.then(() => this.flush());
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
        } catch {
          /* best effort */
        }
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

// 字符串值级擦洗（盲审 2026-07-11 日志维根治）：redactCtx 旧实现只按字段名匹配，
// err.message 携带的提供商响应体片段 / Bearer 头 / URL query 里的密钥可经 ctx.error
// 等不命中字段名规则的字符串值直通日志（该日志随「导出日志」外发）。按已知敏感形态
// 在值层擦洗 —— 宁可多擦（把无害的 key= 参数也掩掉），不可漏擦。
const STRING_REDACT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Authorization: Bearer <token>
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [REDACTED]"],
  // OpenAI 风格裸 key（sk-xxx / sk-proj-xxx）
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED_KEY]"],
  // URL query 里的 key/token 参数值
  [/([?&](?:api[_-]?key|apikey|key|token|access[_-]?token|secret)=)[^&\s"']+/gi, "$1[REDACTED]"],
  // JSON / kv 形态 "api_key":"xxx"、token=xxx（B2 对抗审：token 并入 —— 网关 4xx 回显常用）
  [
    /(\b(?:api[_-]?key|apikey|access[_-]?token|token|secret|password|authorization)["']?\s*[:=]\s*["']?)[^\s"',;{}]{4,}/gi,
    "$1[REDACTED]",
  ],
  // secure key 名内嵌的作品/AU 标题（Rust/adapter 错误串会拼原始 key 名）。
  // `.+?` 而非 `\S+?`：au_id 路径段白名单允许空格（"Harry Potter" 极常见），\S 遇空格即断导致
  // 整段标题直通（B2 对抗审 MEDIUM，测试曾用无空格标题给了假信心）；后缀锚定保证不跨行贪吃。
  // 负向前瞻跳过 redactSecureKey 已产出的 #<fnv 哈希> 形态 —— 那是刻意保留的诊断关联哈希。
  [/\bproject\.(?!#[0-9a-f]{8}\.)[^\n]+?\.(llm\.api_key|embedding_lock\.api_key)/g, "project.[REDACTED].$1"],
];

/**
 * 已知敏感形态的字符串值擦洗（单一真相源）。日志值层与「提供商错误体透 UI toast」
 * 共用同一套 STRING_REDACT_PATTERNS —— 错误体在 extractErrorDetail 处即经此擦洗，
 * 令同一份 detail 无论进日志还是进 toast 都不携带 Bearer/sk-/key= 明文（盲审 R5 安全 L2 / 日志 L3 同根）。
 */
export function redactString(v: string): string {
  let out = v;
  for (const [re, sub] of STRING_REDACT_PATTERNS) out = out.replace(re, sub);
  return out;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  // 数组逐元素递归（盲审 2026-07-11：旧实现数组值原样保留，内层敏感字段绕过掩码）
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") return redactCtx(value as Record<string, unknown>);
  return value;
}

export function redactCtx(ctx: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (REDACT_RE.test(key) || KEY_FIELD_RE.test(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = redactValue(value);
    }
  }
  return result;
}
