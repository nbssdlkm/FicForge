"""Facts 轻量提取。参见 PRD §6.7。

用户确认章节后，可选让 AI 从新章节中提取事实条目。
Phase 1 是半自动流程：AI 提取建议 → 用户审阅 → 确认保存。
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from core.domain.tokenizer import count_tokens

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------

@dataclass
class ExtractedFact:
    """提取出的 fact 候选（还未保存到 facts.jsonl）。"""

    content_raw: str
    content_clean: str
    characters: list[str] = field(default_factory=list)
    fact_type: str = "plot_event"
    narrative_weight: str = "medium"
    status: str = "active"
    chapter: int = 0
    timeline: str = "现在线"
    source: str = "extract_auto"


# ---------------------------------------------------------------------------
# 提取 Prompt 模板
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
你是一个专业的同人小说设定分析助手。请从以下章节正文中提取关键的剧情事实和设定信息。

提取规则：
1. 每条事实必须是独立的、原子化的信息点（不要合并多个信息）
2. 区分事实类型：
   - character_detail：角色特征、习惯、外貌等
   - relationship：角色间关系变化
   - plot_event：已发生的剧情事件
   - foreshadowing：伏笔、悬念、未解之谜
   - backstory：背景故事、回忆
   - world_rule：世界观规则
3. 判断叙事权重（narrative_weight）：
   - high：影响主线剧情走向的关键信息
   - medium：重要但非决定性的信息
   - low：氛围细节、次要信息
4. 判断状态（status）：
   - unresolved：伏笔/悬念尚未揭晓
   - active：已确认的事实，当前有效
5. content_raw 保留章节引用（如"第N章中..."）
6. content_clean 用纯粹的第三人称客观描述，去掉章节编号引用
7. characters 列出涉及的角色名（使用主名，不要用别名）

输出格式：JSON 数组，每个元素包含以上字段。只输出 JSON，不要输出其他内容。"""


def _build_user_message(
    chapter_text: str,
    chapter_num: int,
    existing_facts: list[Any],
) -> str:
    """构建 user message。"""
    existing_summary = ""
    if existing_facts:
        items = [getattr(f, "content_clean", str(f)) for f in existing_facts[:20]]
        existing_summary = "\n".join(f"- {item}" for item in items)

    parts = [f"以下是第 {chapter_num} 章的正文：\n\n{chapter_text}"]

    if existing_summary:
        parts.append(f"\n\n已有的事实条目（避免重复提取）：\n{existing_summary}")

    parts.append("\n\n请提取本章新增的事实条目。")

    return "".join(parts)


# ---------------------------------------------------------------------------
# 解析 LLM 输出
# ---------------------------------------------------------------------------

def _parse_llm_output(text: str) -> list[dict[str, Any]]:
    """解析 LLM 返回的 JSON。支持 ```json 包裹。"""
    text = text.strip()

    # 剥离 markdown 代码块
    code_block = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if code_block:
        text = code_block.group(1).strip()

    try:
        result = json.loads(text)
        if isinstance(result, list):
            return result
        return []
    except json.JSONDecodeError:
        logger.warning("Facts 提取结果解析失败: %s...", text[:100])
        return []


# ---------------------------------------------------------------------------
# 别名归一化
# ---------------------------------------------------------------------------

def _normalize_characters(
    characters: list[str],
    cast_registry: dict[str, Any],
    character_aliases: Optional[dict[str, list[str]]],
) -> list[str]:
    """别名归一化（复用逻辑，不依赖 facts_lifecycle 避免循环导入）。"""
    if not character_aliases:
        return characters

    alias_map: dict[str, str] = {}
    for main_name, aliases in character_aliases.items():
        for alias in aliases:
            alias_map[alias] = main_name

    result: list[str] = []
    seen: set[str] = set()
    for name in characters:
        main = alias_map.get(name, name)
        if main not in seen:
            result.append(main)
            seen.add(main)
    return result


# ---------------------------------------------------------------------------
# 分块
# ---------------------------------------------------------------------------

def _split_text_for_extraction(
    text: str,
    max_tokens: int,
    llm_config: Any,
) -> list[str]:
    """章节过长时按段落等分为两块（保留 2 句 overlap）。"""
    tc = count_tokens(text, llm_config)
    if tc.count <= max_tokens:
        return [text]

    # 按段落切分
    paragraphs = text.split("\n")
    mid = len(paragraphs) // 2

    chunk1_paras = paragraphs[: mid + 2]  # +2 句 overlap
    chunk2_paras = paragraphs[max(0, mid - 2) :]  # -2 句 overlap

    return ["\n".join(chunk1_paras), "\n".join(chunk2_paras)]


# ---------------------------------------------------------------------------
# 主函数
# ---------------------------------------------------------------------------

def extract_facts_from_chapter(
    chapter_text: str,
    chapter_num: int,
    existing_facts: list[Any],
    cast_registry: dict[str, Any],
    character_aliases: Optional[dict[str, list[str]]],
    llm_provider: Any,
    llm_config: Any,
    max_chunk_tokens: int = 4000,
) -> list[ExtractedFact]:
    """从章节文本中提取 facts 候选列表。

    返回 ExtractedFact 列表，前端审阅后通过 add_fact 保存。
    """
    if not chapter_text.strip():
        return []

    # 步骤 1-2：分块（如需要）
    chunks = _split_text_for_extraction(chapter_text, max_chunk_tokens, llm_config)

    all_raw: list[dict[str, Any]] = []
    for chunk_text in chunks:
        # 构建 messages
        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_message(
                chunk_text, chapter_num, existing_facts,
            )},
        ]

        # 调用 LLM（非流式）
        try:
            response = llm_provider.generate(
                messages=messages,
                max_tokens=2000,
                temperature=0.3,  # 低温度提高结构化输出质量
                top_p=0.95,
                stream=False,
            )
            parsed = _parse_llm_output(response.content)
            all_raw.extend(parsed)
        except Exception as e:
            logger.error("Facts 提取 LLM 调用失败: %s", e)

    # 步骤 4：后处理
    results: list[ExtractedFact] = []
    for raw in all_raw:
        content_clean = raw.get("content_clean", "")
        if not content_clean or len(content_clean) < 5:
            continue

        characters = raw.get("characters", [])
        if isinstance(characters, list):
            characters = _normalize_characters(
                characters, cast_registry, character_aliases,
            )

        results.append(ExtractedFact(
            content_raw=raw.get("content_raw", content_clean),
            content_clean=content_clean,
            characters=characters,
            fact_type=raw.get("type", raw.get("fact_type", "plot_event")),
            narrative_weight=raw.get("narrative_weight", "medium"),
            status=raw.get("status", "active"),
            chapter=chapter_num,
            timeline=raw.get("timeline", "现在线"),
            source="extract_auto",
        ))

    return results
