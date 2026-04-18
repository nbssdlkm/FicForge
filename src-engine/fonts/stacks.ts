// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * CSS font-family 栈解析。
 *
 * 把 FontsConfig 里的两个 font id（Latin + CJK）合成 CSS 可用的 font-family 值，
 * 交给 UI 写入 --font-ui / --font-reading CSS 变量。
 *
 * 核心机制：CSS font-family 是有序 fallback 列表，浏览器对**每个字符**按顺序尝试，
 * 命中（字体含该字符）即用。我们把 Latin-only 字体放在前（它渲染西文、对 CJK 无能为力
 * 自动 skip），CJK 字体在后（承担中文渲染），最后是系统 fallback 兜底。
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
 * 阅读/编辑角色的 fallback：传统 serif 链 + 系统 CJK serif。
 * 用户选中的具体字体放在 stack 最前，这里的 fallback 作为最后兜底。
 */
const READING_FALLBACK =
  'Charter, Georgia, "Noto Serif CJK SC", "PingFang SC", SimSun, serif';

/**
 * 把 Latin + CJK 两个 font id 合成 CSS font-family 值（可写入 `--font-*` CSS 变量）。
 *
 * - 两者都是 `"system"` → 纯 SYSTEM_FONT_STACK（最干净的系统字体体验）
 * - 只要有一个是具体字体：该字体 family 进 stack；另一个是 system 则跳过该位置
 * - 顺序：Latin 字体优先（让西文得到 Latin-only 字体的渲染质量）、CJK 字体次之
 *   （兜底中文字符）、最后是角色 fallback
 * - 未知 id 视作 system（防御，避免写入非法值）
 * - 去重：两个 id 指向同一字体时只在 stack 出现一次
 */
export function resolveFontStack(
  latinId: string,
  cjkId: string,
  role: FontRole,
): string {
  const fallback = role === "reading" ? READING_FALLBACK : UI_FALLBACK;

  if (latinId === SYSTEM_FONT_ID && cjkId === SYSTEM_FONT_ID) {
    return SYSTEM_FONT_STACK;
  }

  const parts: string[] = [];
  if (latinId !== SYSTEM_FONT_ID) {
    const entry = getFontById(latinId);
    if (entry) parts.push(`"${entry.family}"`);
  }
  if (cjkId !== SYSTEM_FONT_ID) {
    const entry = getFontById(cjkId);
    if (entry) {
      const token = `"${entry.family}"`;
      if (!parts.includes(token)) parts.push(token);
    }
  }

  if (parts.length === 0) return fallback;
  return `${parts.join(", ")}, ${fallback}`;
}
