// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 文本处理辅助函数。 */

/**
 * 从纯正文末尾提取约 max_chars 个字，按句子边界截断。
 * 用于 state.yaml.last_scene_ending 更新（PRD §4.3）。
 */
export function extract_last_scene_ending(content: string, max_chars = 50): string {
  const text = content.trimEnd();
  if (!text) {
    return "";
  }
  if (text.length <= max_chars) {
    return text;
  }

  // 多取一些以找到断句点
  const searchStart = Math.max(0, text.length - max_chars - 30);
  const tail = text.slice(searchStart);

  // 找所有句子结束标点（中文 + 英文）
  const sentenceEnd = /[。！？….!?\n]/g;
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = sentenceEnd.exec(tail)) !== null) {
    matches.push(m);
  }

  // 从前往后找第一个使剩余部分 <= max_chars 的断句点
  for (const match of matches) {
    const remaining = tail.slice(match.index + match[0].length).trim();
    if (remaining.length > 0 && remaining.length <= max_chars) {
      return remaining;
    }
  }

  // 没有合适的断句点，直接截取末尾
  return text.slice(-max_chars);
}
