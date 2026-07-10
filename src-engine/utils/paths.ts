// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 纯字符串路径工具（无 adapter / logger 依赖，任何层可安全 import）。
 * 原属 repositories/implementations/file_utils.ts —— 2026-07 架构治本上移：
 * 通用工具不属于 repository 实现层，service/logger 依赖它不应穿透实现层。
 */

/** 拼接路径（简单字符串拼接，确保单个 /）。 */
export function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, "")))
    .filter(Boolean)
    .join("/");
}

/**
 * 基础路径安全验证：拒绝空路径、空字节和 '..' 遍历序列。
 * 允许绝对路径和反斜杠，用于系统级路径如 au_id、fandom_path。
 * Windows 桌面端 appDataDir() 返回带反斜杠的路径（如 C:\Users\...），必须允许。
 * '..' 遍历检查同时覆盖正斜杠和反斜杠分隔符。
 *
 * ⚠️ 不要对"数据根目录"（dataDir）调用此函数 —— Capacitor/Web 平台约定
 * 空字符串表示平台 Data 根，此处会被误拒。使用 joinPath(dataDir, ...)
 * 来拼接子路径，joinPath 自动过滤空段。
 */
export function validateBasePath(value: string, name: string): void {
  if (!value) {
    throw new Error(`Path validation failed: ${name} must not be empty`);
  }
  if (value.includes("\0")) {
    throw new Error(`Path validation failed: ${name} contains null byte`);
  }
  // Split on both / and \ to catch traversal on all platforms
  const segments = value.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === "..") {
      throw new Error(`Path validation failed: ${name} contains '..' traversal`);
    }
  }
}

/**
 * 严格路径段验证：除基础检查外，还拒绝绝对路径和反斜杠。
 * 仅用于纯用户输入的相对段名（如 variant 名称），不用于可能为绝对路径的参数。
 */
export function validatePathSegment(value: string, name: string): void {
  validateBasePath(value, name);
  if (value.startsWith("/")) {
    throw new Error(`Path validation failed: ${name} must be a relative path`);
  }
  if (value.includes("\\")) {
    throw new Error(`Path validation failed: ${name} contains backslash`);
  }
}
