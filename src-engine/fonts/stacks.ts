// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * CSS font-family 栈解析。
 *
 * 把 FontsConfig 里的 font id 转换为 CSS 可用的 font-family 值字符串，交给 UI
 * 写入 --font-ui / --font-reading CSS 变量。
 *
 * 特殊 id `"system"` 对应 SYSTEM_FONT_STACK（跟随系统）。
 */

import { SYSTEM_FONT_STACK, getFontById } from "./manifest.js";

export type FontRole = "ui" | "reading";

/** 特殊 font id：跟随系统。不进 manifest，是 UI / settings 的哨兵值。 */
export const SYSTEM_FONT_ID = "system";

/**
 * UI 角色的 fallback：完全等于 SYSTEM_FONT_STACK（浏览器/OS 默认 sans）。
 * 若用户选具体字体，该字体追加在 stack 最前，剩余部分仍是系统 fallback。
 */
const UI_FALLBACK = SYSTEM_FONT_STACK;

/**
 * 阅读/编辑角色的 fallback：两个内置字体在前，保证中英混排下西文走 Source Serif 4、
 * 中文走 LXGW WenKai Screen；之后是传统 serif 链与系统 CJK serif。
 */
const READING_FALLBACK =
  '"Source Serif 4", "LXGW WenKai Screen", Charter, Georgia, "Noto Serif CJK SC", "PingFang SC", SimSun, serif';

/**
 * 把一个 font id 解析为 CSS font-family 值（可写入 `--font-*` CSS 变量）。
 *
 * - `"system"` → 跟随系统完整 stack
 * - manifest 中已知 id → 该字体 family 为首选 + 角色 fallback
 * - 未知 id → 回退到角色 fallback（防御，避免写入非法值）
 */
export function resolveFontStack(fontId: string, role: FontRole): string {
  const fallback = role === "reading" ? READING_FALLBACK : UI_FALLBACK;
  if (fontId === SYSTEM_FONT_ID) return SYSTEM_FONT_STACK;
  const entry = getFontById(fontId);
  if (!entry) return fallback;
  return `"${entry.family}", ${fallback}`;
}
