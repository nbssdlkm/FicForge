"""RAG 检索服务。参见 PRD §4.1 P4 RAG 召回。

从 ChromaDB 检索相关设定和历史章节片段，格式化后注入上下文组装器 P4 层。
"""

from __future__ import annotations

import math
from typing import Any, Optional

from core.domain.tokenizer import count_tokens


# ---------------------------------------------------------------------------
# build_rag_query
# ---------------------------------------------------------------------------

def build_rag_query(
    focus_texts: list[str],
    last_scene_ending: str,
    user_input: str,
) -> str:
    """组装 RAG 检索 query（PRD §4.1）。

    组装规则：focus_texts + last_scene_ending + user_input。
    user_input < 5 字时优先依赖 focus 和上章结尾。
    """
    parts: list[str] = []

    for ft in focus_texts:
        if ft.strip():
            parts.append(ft.strip())

    if last_scene_ending.strip():
        parts.append(last_scene_ending.strip())

    if user_input.strip() and len(user_input.strip()) >= 5:
        parts.append(user_input.strip())
    elif user_input.strip():
        # < 5 字仍追加但权重低（放在末尾）
        parts.append(user_input.strip())

    return " ".join(parts)


# ---------------------------------------------------------------------------
# build_active_chars
# ---------------------------------------------------------------------------

def build_active_chars(
    state: Any,
    user_input: str,
    project: Any,
    facts: list[Any],
    cast_registry: dict[str, Any],
    character_aliases: Optional[dict[str, list[str]]] = None,
) -> Optional[list[str]]:
    """构建活跃角色列表（PRD §4.1）。

    活跃角色 = 最近 3 章出场角色 ∪ user_input 中角色 ∪ chapter_focus 涉及角色。
    空时降级为 core_always_include，仍空则返回 None（不带过滤）。
    """
    chars: set[str] = set()

    # 最近 3 章出场角色
    current = getattr(state, "current_chapter", 1)
    last_seen: dict[str, int] = getattr(state, "characters_last_seen", {}) or {}
    for name, ch_num in last_seen.items():
        if current - ch_num <= 3:
            chars.add(name)

    # user_input 中提取已知角色名（D-0022: 统一 characters 列表）
    all_names: set[str] = set()
    names = cast_registry.get("characters")
    if isinstance(names, list):
        all_names.update(names)

    alias_map: dict[str, str] = {}
    if character_aliases:
        for main_name, aliases in character_aliases.items():
            for alias in aliases:
                alias_map[alias] = main_name

    for name in all_names:
        if name in user_input:
            chars.add(name)
    for alias, main_name in alias_map.items():
        if alias in user_input:
            chars.add(main_name)

    # chapter_focus 涉及角色
    focus_ids = getattr(state, "chapter_focus", []) or []
    for fact in facts:
        if fact.id in focus_ids:
            for ch_name in (getattr(fact, "characters", []) or []):
                chars.add(ch_name)

    # 降级链
    if not chars:
        core = getattr(project, "core_always_include", []) or []
        chars = set(core)

    if not chars:
        return None  # 全局检索

    return sorted(chars)


# ---------------------------------------------------------------------------
# retrieve_rag
# ---------------------------------------------------------------------------

def retrieve_rag(
    vector_repo: Any,
    au_id: str,
    query: str,
    budget_remaining: int,
    char_filter: Optional[list[str]],
    llm_config: Any,
    rag_decay_coefficient: float = 0.05,
    current_chapter: int = 1,
) -> tuple[str, int]:
    """RAG 检索（PRD §4.1）。

    Returns:
        (格式化 RAG 文本, 消耗 token 数)
    """
    if not query.strip():
        return "", 0

    # --- 多 collection 检索 ---
    # D-0022: OC 合并入 characters，不再有独立 oc collection
    collections = ["characters", "worldbuilding"]
    all_chunks: list[dict[str, Any]] = []

    for coll_name in collections:
        chunks = _search_collection(
            vector_repo, au_id, query, coll_name, 3, char_filter
        )
        for c in chunks:
            c["_collection"] = coll_name
        all_chunks.extend(chunks)

    # chapters collection（带时间衰减）
    ch_chunks = _search_collection(
        vector_repo, au_id, query, "chapters", 3, char_filter
    )
    for c in ch_chunks:
        c["_collection"] = "chapters"
        # 时间衰减重排序
        ch_num = c.get("chapter_num", 0)
        raw_score = c.get("score", 0.0)
        decay = math.exp(-rag_decay_coefficient * max(0, current_chapter - ch_num))
        c["score"] = raw_score * decay
    ch_chunks.sort(key=lambda x: x.get("score", 0), reverse=True)
    all_chunks.extend(ch_chunks)

    # --- 去重（按 content） ---
    seen_content: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for c in all_chunks:
        content = c.get("content", "")
        if content not in seen_content:
            seen_content.add(content)
            deduped.append(c)

    # --- 超预算处理：降低 top_k ---
    text = _format_rag_chunks(deduped)
    tokens = count_tokens(text, llm_config).count

    if tokens > budget_remaining and budget_remaining > 0:
        # 逐步减少
        for reduced_k in [2, 1]:
            deduped = _reduce_top_k(deduped, reduced_k)
            text = _format_rag_chunks(deduped)
            tokens = count_tokens(text, llm_config).count
            if tokens <= budget_remaining:
                break

    # 仍超预算：按 collection 优先级丢弃
    if tokens > budget_remaining and budget_remaining > 0:
        priority = ["characters", "chapters", "worldbuilding"]
        kept: list[dict[str, Any]] = []
        used = 0
        for prio_coll in priority:
            for c in deduped:
                if c.get("_collection") == prio_coll:
                    c_tokens = count_tokens(c.get("content", ""), llm_config).count
                    if used + c_tokens <= budget_remaining:
                        kept.append(c)
                        used += c_tokens
        deduped = kept
        text = _format_rag_chunks(deduped)
        tokens = count_tokens(text, llm_config).count

    return text, tokens


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

def _search_collection(
    vector_repo: Any,
    au_id: str,
    query: str,
    collection_name: str,
    top_k: int,
    char_filter: Optional[list[str]],
) -> list[dict[str, Any]]:
    """检索单个 collection，含 fallback。"""
    try:
        results = vector_repo.search(
            au_id, query, collection_name=collection_name,
            top_k=top_k, char_filter=char_filter,
        )
    except Exception:
        results = []

    chunks = [
        {
            "content": r.content,
            "chapter_num": r.chapter_num,
            "score": r.score,
            "metadata": r.metadata,
        }
        for r in results
    ]

    # 过滤 fallback：召回 < 2 条时放宽为全局查询
    if len(chunks) < 2 and char_filter:
        try:
            fallback = vector_repo.search(
                au_id, query, collection_name=collection_name,
                top_k=top_k, char_filter=None,
            )
            for r in fallback:
                fb = {
                    "content": r.content,
                    "chapter_num": r.chapter_num,
                    "score": r.score,
                    "metadata": r.metadata,
                }
                if fb["content"] not in {c["content"] for c in chunks}:
                    chunks.append(fb)
        except Exception:
            pass

    return chunks[:top_k]


def _reduce_top_k(
    chunks: list[dict[str, Any]], max_per_collection: int
) -> list[dict[str, Any]]:
    """按 collection 限制每组最多 max_per_collection 条。"""
    counts: dict[str, int] = {}
    result: list[dict[str, Any]] = []
    for c in chunks:
        coll = c.get("_collection", "")
        counts[coll] = counts.get(coll, 0) + 1
        if counts[coll] <= max_per_collection:
            result.append(c)
    return result


def _format_rag_chunks(chunks: list[dict[str, Any]]) -> str:
    """将 chunks 按 collection 分组格式化。"""
    if not chunks:
        return ""

    groups: dict[str, list[str]] = {}
    for c in chunks:
        coll = c.get("_collection", "other")
        groups.setdefault(coll, []).append(c.get("content", ""))

    parts: list[str] = []
    label_map = {
        "characters": "角色设定",
        "worldbuilding": "世界观",
        "chapters": "历史章节片段",
    }
    for coll in ["characters", "worldbuilding", "chapters"]:
        items = groups.get(coll, [])
        if items:
            label = label_map.get(coll, coll)
            parts.append(f"### {label}")
            for item in items:
                parts.append(item)

    return "\n\n".join(parts)
