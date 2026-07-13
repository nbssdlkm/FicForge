// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 正则字面量转义的单一真相源（R3 低危清扫：此前 tool_stream_buffer /
 * chapter_splitter / chat_parser 三处各自手写同一字符类，属双处手工同步的字面量）。
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
