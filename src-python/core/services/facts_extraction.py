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

# Prompt 常量已迁移到 core/prompts/zh.py 和 en.py，通过 get_prompts(language) 获取。


# ---------------------------------------------------------------------------
# 角色名 + 别名列表注入
# ---------------------------------------------------------------------------

def _build_character_info_block(
    cast_registry: dict[str, Any],
    character_aliases: Optional[dict[str, list[str]]],
    language: str = "zh",
) -> str:
    """构造角色名+别名注入段，追加到 user message 末尾。"""
    from core.prompts import get_prompts
    P = get_prompts(language)

    char_names = cast_registry.get("characters") or []
    if not char_names and not character_aliases:
        return ""

    lines = [P.FACTS_KNOWN_CHARS_HEADER]
    for name in char_names:
        if isinstance(name, str):
            aliases = (character_aliases or {}).get(name, [])
            if aliases:
                lines.append(P.FACTS_ALIAS_FORMAT.format(name=name, aliases=", ".join(aliases)))
            else:
                lines.append(f"- {name}")
    lines.append(P.FACTS_USE_MAIN_NAME)
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
    language: str = "zh",
) -> str:
    """构建单章提取的 user message。"""
    from core.prompts import get_prompts
    P = get_prompts(language)

    existing_summary = ""
    if existing_facts:
        items = [getattr(f, "content_clean", str(f)) for f in existing_facts[:20]]
        existing_summary = "\n".join(f"- {item}" for item in items)

    parts = [P.FACTS_USER_CHAPTER_INTRO.format(chapter_num=chapter_num, chapter_text=chapter_text)]

    if existing_summary:
        parts.append(P.FACTS_USER_EXISTING_HINT.format(existing_summary=existing_summary))

    parts.append(_build_character_info_block(cast_registry, character_aliases, language=language))
    parts.append(P.FACTS_USER_EXTRACT_COMMAND)

    return "".join(parts)


def _build_batch_user_message(
    chapters: list[dict[str, Any]],
    existing_facts: list[Any],
    cast_registry: dict[str, Any],
    character_aliases: Optional[dict[str, list[str]]],
    language: str = "zh",
) -> str:
    """构建多章合并提取的 user message。"""
    from core.prompts import get_prompts
    P = get_prompts(language)

    existing_summary = ""
    if existing_facts:
        items = [getattr(f, "content_clean", str(f)) for f in existing_facts[:20]]
        existing_summary = "\n".join(f"- {item}" for item in items)

    parts = [P.FACTS_USER_BATCH_INTRO]
    for ch in chapters:
        parts.append(P.FACTS_USER_BATCH_CHAPTER.format(chapter_num=ch['chapter_num'], content=ch['content']))

    if existing_summary:
        parts.append(P.FACTS_USER_BATCH_EXISTING_HINT.format(existing_summary=existing_summary))

    parts.append(_build_character_info_block(cast_registry, character_aliases, language=language))
    parts.append(P.FACTS_USER_BATCH_COMMAND)

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
    language: str = "zh",
) -> list[ExtractedFact]:
    """从章节文本中提取 facts 候选列表。

    返回 ExtractedFact 列表，前端审阅后通过 add_fact 保存。
    """
    from core.prompts import get_prompts
    P = get_prompts(language)

    if not chapter_text.strip():
        return []

    # 步骤 1-2：分块（如需要）
    chunks = _split_text_for_extraction(chapter_text, max_chunk_tokens, llm_config)

    all_raw: list[dict[str, Any]] = []
    for chunk_text in chunks:
        # 构建 messages
        messages = [
            {"role": "system", "content": P.FACTS_SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_message(
                chunk_text, chapter_num, existing_facts,
                cast_registry, character_aliases, language=language,
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
    language: str = "zh",
) -> list[ExtractedFact]:
    """批量提取多章 facts（合并为一个 LLM 调用）。

    chapters: [{"chapter_num": int, "content": str}, ...]
    """
    from core.prompts import get_prompts
    P = get_prompts(language)

    if not chapters:
        return []

    messages = [
        {"role": "system", "content": P.FACTS_BATCH_SYSTEM_PROMPT},
        {"role": "user", "content": _build_batch_user_message(
            chapters, existing_facts, cast_registry, character_aliases, language=language,
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
