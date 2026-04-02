"""Facts 轻量提取。参见 PRD §6.7。

用户确认章节后，可选让 AI 从新章节中提取事实条目。
Phase 1 是半自动流程：AI 提取建议 → 用户审阅 → 确认保存。
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import frontmatter as fm

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
你是一个专业的同人小说设定分析助手。请从章节正文中提取关键的剧情事实和设定信息。

【提取规则】

1. 合并瞬时过程：如果一个事件在本章内已经完成（如被困→脱困、受伤→治愈、被抓→逃跑），\
将整个过程合并为一条结果性事实，描述最终状态和关键过程。\
不要把中间步骤拆成多条独立事实。

2. 数量控制：每章只提取 3-5 条最重要的事实变化，绝不超过 5 条。优先提取：
   - 角色关系发生实质变化的事件
   - 留下伏笔或悬念的事件（标记为 unresolved）
   - 关键行动和决策
   - 新出现的角色或势力
   忽略：
   - 纯情绪描写（"他感到不安"）
   - 环境氛围描写
   - 章节内已完成且无后续影响的临时状态

3. 只提取章末仍成立的状态：如果这条事实在本章结束时已经不再成立，不要提取。

4. 角色内心想法：只在对后续剧情有实质影响时才提取（如"怀疑X是幕后黑手"），\
纯粹的情绪感受不提取。

5. 区分事实类型（fact_type）：
   - character_detail：角色特征、习惯、外貌等
   - relationship：角色间关系变化
   - plot_event：已发生的剧情事件
   - foreshadowing：伏笔、悬念、未解之谜
   - backstory：背景故事、回忆
   - world_rule：世界观规则

6. 判断叙事权重（narrative_weight）：
   - high：影响主线剧情走向的关键信息
   - medium：重要但非决定性的信息
   - low：氛围细节、次要信息

7. 判断状态（status）：
   - unresolved：伏笔/悬念尚未揭晓
   - active：已确认的事实，当前有效

8. content_raw 保留章节引用（如"第N章中..."）
9. content_clean 用纯粹的第三人称客观描述，去掉章节编号引用
10. characters 列出涉及的角色名（使用主名，不要用别名）

输出格式：JSON 数组，每个元素包含以上字段。只输出 JSON，不要输出其他内容。"""

_BATCH_SYSTEM_PROMPT = """\
你是一个专业的同人小说设定分析助手。请从以下多个连续章节中提取关键的剧情事实和设定信息。

【提取规则】

1. 合并瞬时过程：如果一个事件在某章内已经完成（如被困→脱困），\
将整个过程合并为一条结果性事实。不要把中间步骤拆成多条。

2. 跨章事件：如果某个事件跨越多章（如第3章开始、第5章结束），\
只在结束的章节提取一条结果性事实。

3. 数量控制：每章只提取 3-5 条最重要的事实变化，绝不超过 5 条。忽略纯情绪、氛围描写。

4. 只提取章末仍成立的状态。

5. 每条事实必须包含 chapter 字段（章节号），表明属于哪一章。

6. 区分事实类型（fact_type）：
   - character_detail / relationship / plot_event / foreshadowing / backstory / world_rule

7. 判断叙事权重（narrative_weight）：high / medium / low

8. 判断状态（status）：unresolved（伏笔）或 active（已确认事实）

9. content_raw 保留章节引用，content_clean 用纯粹的第三人称客观描述
10. characters 列出涉及的角色名（使用主名，不要用别名）

输出格式：JSON 数组。只输出 JSON，不要输出其他内容。"""


# ---------------------------------------------------------------------------
# 角色名 + 别名列表注入
# ---------------------------------------------------------------------------

def _build_character_info_block(
    cast_registry: dict[str, Any],
    character_aliases: Optional[dict[str, list[str]]],
) -> str:
    """构造角色名+别名注入段，追加到 user message 末尾。"""
    char_names = cast_registry.get("characters") or []
    if not char_names and not character_aliases:
        return ""

    lines = ["\n\n【已知角色名和别名】"]
    for name in char_names:
        if isinstance(name, str):
            aliases = (character_aliases or {}).get(name, [])
            if aliases:
                lines.append(f"- {name}（别名：{', '.join(aliases)}）")
            else:
                lines.append(f"- {name}")
    lines.append("输出时统一使用主名（横线后第一个名字），不使用别名。")
    return "\n".join(lines)


def load_character_aliases(au_path: Path) -> dict[str, list[str]]:
    """从角色 .md 文件的 frontmatter 中读取别名映射。"""
    aliases: dict[str, list[str]] = {}
    chars_dir = au_path / "characters"
    if not chars_dir.is_dir():
        return aliases
    for md_file in chars_dir.glob("*.md"):
        try:
            post = fm.load(str(md_file))
            name = post.metadata.get("name", md_file.stem)
            file_aliases = post.metadata.get("aliases", [])
            if isinstance(file_aliases, list) and file_aliases:
                aliases[name] = [str(a) for a in file_aliases]
        except Exception:
            continue
    return aliases


# ---------------------------------------------------------------------------
# 构建 user message
# ---------------------------------------------------------------------------

def _build_user_message(
    chapter_text: str,
    chapter_num: int,
    existing_facts: list[Any],
    cast_registry: dict[str, Any],
    character_aliases: Optional[dict[str, list[str]]],
) -> str:
    """构建单章提取的 user message。"""
    existing_summary = ""
    if existing_facts:
        items = [getattr(f, "content_clean", str(f)) for f in existing_facts[:20]]
        existing_summary = "\n".join(f"- {item}" for item in items)

    parts = [f"以下是第 {chapter_num} 章的正文：\n\n{chapter_text}"]

    if existing_summary:
        parts.append(f"\n\n已有的事实条目（避免重复提取）：\n{existing_summary}")

    parts.append(_build_character_info_block(cast_registry, character_aliases))
    parts.append("\n\n请提取本章新增的事实条目。")

    return "".join(parts)


def _build_batch_user_message(
    chapters: list[dict[str, Any]],
    existing_facts: list[Any],
    cast_registry: dict[str, Any],
    character_aliases: Optional[dict[str, list[str]]],
) -> str:
    """构建多章合并提取的 user message。"""
    existing_summary = ""
    if existing_facts:
        items = [getattr(f, "content_clean", str(f)) for f in existing_facts[:20]]
        existing_summary = "\n".join(f"- {item}" for item in items)

    parts = ["以下是连续的多个章节：\n"]
    for ch in chapters:
        parts.append(f"\n=== 第 {ch['chapter_num']} 章 ===\n{ch['content']}\n")

    if existing_summary:
        parts.append(f"\n\n已有的事实条目（避免重复提取）：\n{existing_summary}")

    parts.append(_build_character_info_block(cast_registry, character_aliases))
    parts.append("\n\n请为每个章节分别提取事实，在每条事实中标明 chapter 字段。")

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
        pass

    # Fallback: 剥离开头的 ```json 和结尾的 ```（即使不完整）
    cleaned = re.sub(r"^```(?:json)?\s*\n?", "", text).strip()
    cleaned = re.sub(r"\n?```\s*$", "", cleaned).strip()
    try:
        result = json.loads(cleaned)
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
    """别名归一化：将别名映射回主名，去重。"""
    if not character_aliases:
        return characters

    alias_map: dict[str, str] = {}
    for main_name, aliases in character_aliases.items():
        alias_map[main_name.lower()] = main_name
        for alias in aliases:
            alias_map[alias.lower()] = main_name

    result: list[str] = []
    seen: set[str] = set()
    for name in characters:
        main = alias_map.get(name.lower(), alias_map.get(name, name))
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
# 后处理：raw dict → ExtractedFact
# ---------------------------------------------------------------------------

def _raw_to_extracted(
    raw: dict[str, Any],
    chapter_num: int,
    cast_registry: dict[str, Any],
    character_aliases: Optional[dict[str, list[str]]],
) -> Optional[ExtractedFact]:
    """将一条原始 dict 转为 ExtractedFact，过滤无效条目。"""
    content_clean = raw.get("content_clean", "")
    if not content_clean or len(content_clean) < 5:
        return None

    characters = raw.get("characters", [])
    if isinstance(characters, list):
        characters = _normalize_characters(characters, cast_registry, character_aliases)

    return ExtractedFact(
        content_raw=raw.get("content_raw", content_clean),
        content_clean=content_clean,
        characters=characters,
        fact_type=raw.get("type", raw.get("fact_type", "plot_event")),
        narrative_weight=raw.get("narrative_weight", "medium"),
        status=raw.get("status", "active"),
        chapter=raw.get("chapter", chapter_num),
        timeline=raw.get("timeline", "现在线"),
        source="extract_auto",
    )


# ---------------------------------------------------------------------------
# 主函数：单章提取
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
                cast_registry, character_aliases,
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
        fact = _raw_to_extracted(raw, chapter_num, cast_registry, character_aliases)
        if fact:
            results.append(fact)

    return results


# ---------------------------------------------------------------------------
# 批量提取：多章合并
# ---------------------------------------------------------------------------

def extract_facts_batch(
    chapters: list[dict[str, Any]],
    existing_facts: list[Any],
    cast_registry: dict[str, Any],
    character_aliases: Optional[dict[str, list[str]]],
    llm_provider: Any,
    llm_config: Any,
) -> list[ExtractedFact]:
    """批量提取多章 facts（合并为一个 LLM 调用）。

    chapters: [{"chapter_num": int, "content": str}, ...]
    """
    if not chapters:
        return []

    messages = [
        {"role": "system", "content": _BATCH_SYSTEM_PROMPT},
        {"role": "user", "content": _build_batch_user_message(
            chapters, existing_facts, cast_registry, character_aliases,
        )},
    ]

    try:
        response = llm_provider.generate(
            messages=messages,
            max_tokens=4000,
            temperature=0.3,
            top_p=0.95,
            stream=False,
        )
        all_raw = _parse_llm_output(response.content)
    except Exception as e:
        logger.error("Facts 批量提取 LLM 调用失败: %s", e)
        return []

    # 后处理：归一化 + 填充 chapter
    chapter_nums = {ch["chapter_num"] for ch in chapters}
    results: list[ExtractedFact] = []
    for raw in all_raw:
        ch_num = raw.get("chapter", 0)
        if ch_num not in chapter_nums:
            ch_num = chapters[-1]["chapter_num"]
        fact = _raw_to_extracted(raw, ch_num, cast_registry, character_aliases)
        if fact:
            results.append(fact)

    return results
