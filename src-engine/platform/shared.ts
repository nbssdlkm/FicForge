// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 平台适配器共享工具 —— Tauri / Capacitor / Web 三个适配器原本各自复制维护的
 * 判据与转换集中于此：base64 分块转换、legacy secure key 前缀三件套、
 * localStorage→内存回退的 KV 实现、os_keyring 能力对象、secure key 脱敏。
 * 任何一处行为调整必须三端同时生效，故只允许改本文件。
 */

import type { SecretStorageCapabilities } from "./adapter.js";
import { getLogger, hasLogger, redactCtx } from "../logger/index.js";

// ---------------------------------------------------------------------------
// 日志
// ---------------------------------------------------------------------------

/**
 * 适配器层告警：logger 就绪时走 FileLogger（落文件 + ctx 脱敏），
 * 未就绪（引导早期，logger 依赖 adapter 完成初始化）降级 console.warn 保证诊断不丢。
 * 与 logger/index 的 warnAlways 同口径（此处不直接复用，保持 platform 命名空间入口）。
 */
export function platformWarn(tag: string, msg: string, ctx?: Record<string, unknown>): void {
  if (hasLogger()) {
    getLogger().warn(tag, msg, ctx);
    return;
  }
  // console 降级同样过脱敏（B2 对抗审）—— 与 warnAlways 同口径
  // biome-ignore lint/suspicious/noConsole: sanctioned 降级出口——logger 未就绪时保诊断不丢
  if (ctx) console.warn(`[${tag}] ${msg}`, redactCtx(ctx));
  // biome-ignore lint/suspicious/noConsole: 同上
  else console.warn(`[${tag}] ${msg}`);
}

// ---------------------------------------------------------------------------
// Uint8Array ↔ base64
// ---------------------------------------------------------------------------

/**
 * 直接 `String.fromCharCode(...u8)` 在数组长度 ≥ 约 65535 时触发
 * "Maximum call stack size exceeded"。按 32KB 分块处理，对 ~10MB 字体文件安全。
 */
const BASE64_CHUNK = 0x8000; // 32 KiB

export function uint8ToBase64(data: Uint8Array): string {
  // 数组收集 + 末端 join("")：O(n)。比 `binary += ...` 累加字符串
  // （在某些 JS 引擎实现下是 O(n²)）更稳，对 7MB 字体数据差异显著。
  const parts: string[] = [];
  for (let i = 0; i < data.length; i += BASE64_CHUNK) {
    parts.push(String.fromCharCode(...data.subarray(i, i + BASE64_CHUNK)));
  }
  return btoa(parts.join(""));
}

export function base64ToUint8(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Legacy secure storage（`__secure__:` 前缀的旧版明文条目）
// ---------------------------------------------------------------------------

export const LEGACY_SECURE_KEY_PREFIX = "__secure__:";

export function legacySecureStorageKey(key: string): string {
  return `${LEGACY_SECURE_KEY_PREFIX}${key}`;
}

// ---------------------------------------------------------------------------
// Secure key 脱敏（日志用）
// ---------------------------------------------------------------------------

/** FNV-1a 32 位哈希（非加密用途，仅日志内关联同一 key 的多条记录）。 */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * secure key 名脱敏后再进日志/console。key 形态（见 file_settings / file_project）：
 *   - `settings.*` 全静态段（自定义供应商 id 为机器生成、不含用户内容）→ 原样输出；
 *   - `project.{au_id}.llm.api_key` / `project.{au_id}.embedding_lock.api_key` 的
 *     au_id 是含作品/AU 名的路径 → 替换为定长哈希，保留可诊断的键类型后缀；
 *   - 未知形态整体哈希 —— 宁可少信息，不可泄用户内容。
 */
/**
 * 把错误消息里出现的原始 secure key（内嵌作品/AU 标题）替换成脱敏形态。
 * keyring/插件的错误串常拼原始 key 名 —— 必须在源头擦掉，不依赖 logger
 * 字段名规则兜底（盲审 2026-07-11 安全维；四个适配器泄漏位点共用）。
 */
export function scrubKeyFromError(err: unknown, key: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  return key ? msg.split(key).join(redactSecureKey(key)) : msg;
}

export function redactSecureKey(key: string): string {
  if (key.startsWith("settings.")) return key;
  const m = key.match(/^project\.(.+)\.(llm\.api_key|embedding_lock\.api_key)$/);
  if (m) return `project.#${fnv1aHex(m[1])}.${m[2]}`;
  return `#${fnv1aHex(key)}`;
}

// ---------------------------------------------------------------------------
// KV 存储：localStorage + 内存回退（iOS Safari 隐私模式 / WebView 受限环境安全）
// ---------------------------------------------------------------------------

export function kvGetWithFallback(tag: string, fallback: Map<string, string>, key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    platformWarn(tag, "kvGet: localStorage 不可用，使用内存回退（数据不持久化）");
    return fallback.get(key) ?? null;
  }
}

export function kvSetWithFallback(tag: string, fallback: Map<string, string>, key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    platformWarn(tag, "kvSet: localStorage 不可用，使用内存回退（数据不持久化）");
    fallback.set(key, value);
  }
}

export function kvRemoveWithFallback(tag: string, fallback: Map<string, string>, key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    platformWarn(tag, "kvRemove: localStorage 不可用，使用内存回退");
    fallback.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Secret storage 能力
// ---------------------------------------------------------------------------

/** Tauri（OS keyring）与 Capacitor（Keystore/Keychain）共用的能力对象。 */
export const OS_KEYRING_CAPABILITIES: SecretStorageCapabilities = Object.freeze({
  backend: "os_keyring",
  encrypted_at_rest: true,
  persistence: "persistent",
});
