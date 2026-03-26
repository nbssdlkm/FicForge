"""文本处理辅助函数。"""

from __future__ import annotations

import re


def extract_last_scene_ending(content: str, max_chars: int = 50) -> str:
    """从纯正文末尾提取约 max_chars 个字，按句子边界截断。

    用于 state.yaml.last_scene_ending 更新（PRD §4.3）。

    截断策略：
    1. 若正文 <= max_chars，返回全部
    2. 从末尾向前多取 30 字作为搜索范围
    3. 在搜索范围内找最近的句子结束标点
    4. 返回该标点之后到末尾的内容
    5. 找不到标点则直接截取末尾 max_chars
    """
    text = content.rstrip()
    if not text:
        return ""
    if len(text) <= max_chars:
        return text

    # 多取一些以找到断句点
    search_start = max(0, len(text) - max_chars - 30)
    tail = text[search_start:]

    # 找所有句子结束标点（中文 + 英文）
    sentence_end = re.compile(r"[。！？….!?\n]")
    matches = list(sentence_end.finditer(tail))

    # 从前往后找第一个使剩余部分 <= max_chars 的断句点
    for m in matches:
        remaining = tail[m.end() :].strip()
        if 0 < len(remaining) <= max_chars:
            return remaining

    # 没有合适的断句点，直接截取末尾
    return text[-max_chars:]
