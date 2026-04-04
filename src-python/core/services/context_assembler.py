"""上下文组装器。参见 PRD §4.1。

六层结构 P0-P5，按优先级截断，reversed 后注入。
收集顺序 P1→P3→P2→P4→P5，reversed 后 P5→P4→P2→P3→P1。
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

from core.domain.budget_report import BudgetReport
from core.domain.context_summary import ContextSummary
from core.domain.enums import FactStatus, NarrativeWeight
from core.domain.fact import Fact
from core.domain.model_context_map import get_context_window, get_model_max_output
from core.domain.tokenizer import TokenCount, count_tokens
from core.prompts import get_prompts


# ---------------------------------------------------------------------------
# 辅助：token 计数（简化调用）
# ---------------------------------------------------------------------------

def _count(text: str, llm_config: Any) -> TokenCount:
    return count_tokens(text, llm_config)


# ===========================================================================
# build_system_prompt（P0 + 规则）
# ===========================================================================

def build_system_prompt(
    project: Any,
    trim_custom: bool = False,
    language: str = "zh",
) -> str:
    """构建 System Role 消息。

    Args:
        project: Project 领域对象。
        trim_custom: 若为 True，裁剪 custom_instructions（budget 不够时）。
        language: 界面语言，决定 prompt 使用中文还是英文。
    """
    P = get_prompts(language)
    parts: list[str] = [P.SYSTEM_NOVELIST]

    # --- P0 Pinned Context ---
    pinned = getattr(project, "pinned_context", None) or []
    if pinned:
        lines = "\n".join(f"- {p}" for p in pinned)
        parts.append(P.PINNED_CONTEXT_HEADER.format(lines=lines))

    # --- 冲突解决规则 ---
    parts.append(P.CONFLICT_RESOLUTION_RULES)

    # --- 叙事视角 ---
    ws = getattr(project, "writing_style", None)
    perspective = getattr(ws, "perspective", None)
    p_val: str = perspective.value if perspective is not None and hasattr(perspective, "value") else str(perspective or "third_person")

    if p_val == "first_person":
        pov = getattr(ws, "pov_character", "") or ("主角" if language == "zh" else "protagonist")
        parts.append(P.PERSPECTIVE_FIRST_PERSON.format(pov=pov))
    else:
        parts.append(P.PERSPECTIVE_THIRD_PERSON)

    # --- 情感风格 ---
    emotion = getattr(ws, "emotion_style", None)
    e_val: str = emotion.value if emotion is not None and hasattr(emotion, "value") else str(emotion or "implicit")

    if e_val == "explicit":
        parts.append(P.EMOTION_EXPLICIT)
    else:
        parts.append(P.EMOTION_IMPLICIT)

    # --- 伏笔规约 ---
    parts.append(P.FORESHADOWING_RULES)

    # --- 通用规则 ---
    chapter_length = getattr(project, "chapter_length", 1500)
    chapter_length_max = int(chapter_length * 1.3)
    parts.append(P.GENERIC_RULES.format(chapter_length=chapter_length, chapter_length_max=chapter_length_max))

    # --- custom_instructions ---
    if not trim_custom:
        custom = getattr(ws, "custom_instructions", "") if ws else ""
        if custom:
            parts.append(P.CUSTOM_INSTRUCTIONS_HEADER.format(custom=custom))

    return "\n\n".join(parts)


# ===========================================================================
# build_instruction（P1 当前指令）
# ===========================================================================

def build_instruction(
    state: Any,
    user_input: str,
    facts: list[Fact],
    language: str = "zh",
    chapter_length: int = 0,
) -> str:
    """构建 P1 当前指令层。"""
    P = get_prompts(language)
    parts: list[str] = []

    # 当前状态行
    current_ch = getattr(state, "current_chapter", 1)
    last_ending = getattr(state, "last_scene_ending", "")
    parts.append(P.CURRENT_STATUS.format(current_ch=current_ch))
    if last_ending:
        parts.append(P.LAST_ENDING_INLINE.format(last_ending=last_ending))

    # chapter_focus 分支
    focus_ids = getattr(state, "chapter_focus", []) or []
    focus_facts = [f for f in facts if f.id in focus_ids] if focus_ids else []

    if focus_facts:
        # 推进目标块
        focus_lines = "\n".join(f"- {f.content_clean}" for f in focus_facts)
        parts.append(P.FOCUS_GOAL_HEADER)
        parts.append(P.FOCUS_GOAL_DEFINITION.format(focus_lines=focus_lines))

        # 本章特别注意（非 focus 的高权重 unresolved，最多 2 条）
        non_focus_unresolved = [
            f for f in facts
            if f.id not in focus_ids
            and f.status == FactStatus.UNRESOLVED
            and (f.narrative_weight == NarrativeWeight.HIGH
                 if isinstance(f.narrative_weight, NarrativeWeight)
                 else f.narrative_weight == "high")
        ]
        if non_focus_unresolved:
            caution_lines = "\n".join(
                f"- {f.content_clean}" for f in non_focus_unresolved[:2]
            )
            parts.append(P.ATTENTION_HEADER)
            parts.append(P.ATTENTION_BODY.format(caution_lines=caution_lines))

        # 背景信息使用规则
        parts.append(P.BG_RULES)

    elif any(f.status == FactStatus.UNRESOLVED for f in facts):
        # 铺陈指令
        parts.append(P.PACING_INSTRUCTION)

    # 用户输入
    parts.append(P.CONTINUE_WRITING.format(user_input=user_input))

    # 字数提醒（在 P1 末尾重复，提高遵守率）
    if chapter_length:
        parts.append(P.WORD_COUNT_REMINDER.format(chapter_length=chapter_length))

    return "\n\n".join(parts)


# ===========================================================================
# build_facts_layer（P3 事实表）
# ===========================================================================

def build_facts_layer(
    facts: list[Fact],
    focus_ids: list[str],
    budget_tokens: int,
    llm_config: Any,
    language: str = "zh",
) -> tuple[str, bool]:
    """构建 P3 事实层。

    Returns:
        (text, unresolved_soft_degraded)
    """
    # 过滤：active + unresolved，排除 chapter_focus 已在 P1 注入的
    eligible = [
        f for f in facts
        if f.status in (FactStatus.ACTIVE, FactStatus.UNRESOLVED)
        and f.id not in focus_ids
    ]

    if not eligible:
        return "", False

    unresolved = [f for f in eligible if f.status == FactStatus.UNRESOLVED]
    active = [f for f in eligible if f.status == FactStatus.ACTIVE]

    soft_degraded = False

    # --- unresolved 软降级（独立处理）---
    unresolved_text_parts: list[str] = []
    unresolved_kept: list[Fact] = []
    unresolved_dropped = 0

    if unresolved:
        # 排序：narrative_weight 降序 + chapter 倒序
        sorted_unresolved = _sort_by_weight_and_recency(unresolved)
        total_ur_tokens = sum(_count(f.content_clean, llm_config).count for f in sorted_unresolved)

        if total_ur_tokens <= budget_tokens:
            unresolved_kept = sorted_unresolved
        else:
            # 软降级：保留 top N
            soft_degraded = True
            used = 0
            for f in sorted_unresolved:
                t = _count(f.content_clean, llm_config).count
                if used + t > budget_tokens:
                    unresolved_dropped += 1
                else:
                    unresolved_kept.append(f)
                    used += t

    remaining_budget = budget_tokens - sum(
        _count(f.content_clean, llm_config).count for f in unresolved_kept
    )

    # --- active 截断 ---
    active_kept: list[Fact] = []
    if active and remaining_budget > 0:
        sorted_active = _sort_by_weight_and_recency(active)
        used = 0
        for f in sorted_active:
            t = _count(f.content_clean, llm_config).count
            if used + t > remaining_budget:
                break
            active_kept.append(f)
            used += t

    # --- 合并并按 chapter 正序注入 ---
    all_kept = unresolved_kept + active_kept
    all_kept.sort(key=lambda f: f.chapter)

    lines = [f"- [{f.status.value if isinstance(f.status, FactStatus) else f.status}] {f.content_clean}"
             for f in all_kept]

    if unresolved_dropped > 0:
        P = get_prompts(language)
        lines.append(P.UNRESOLVED_DROPPED_HINT.format(count=unresolved_dropped))

    if not lines:
        return "", soft_degraded

    P = get_prompts(language)
    return P.SECTION_PLOT_STATE + "\n" + "\n".join(lines), soft_degraded


def _sort_by_weight_and_recency(facts: list[Fact]) -> list[Fact]:
    """按 narrative_weight 降序 + chapter 倒序排序。"""
    weight_order = {"high": 0, "medium": 1, "low": 2}

    def sort_key(f: Fact) -> tuple[int, int]:
        w = f.narrative_weight.value if isinstance(f.narrative_weight, NarrativeWeight) else str(f.narrative_weight)
        return (weight_order.get(w, 1), -f.chapter)

    return sorted(facts, key=sort_key)


# ===========================================================================
# build_recent_chapter_layer（P2 最近章节）
# ===========================================================================

def build_recent_chapter_layer(
    state: Any,
    chapter_repo: Any,
    au_path: Path,
    budget_tokens: int,
    llm_config: Any,
    language: str = "zh",
) -> str:
    """构建 P2 最近章节层。"""
    P = get_prompts(language)
    current = getattr(state, "current_chapter", 1)
    if current <= 1:
        return ""

    try:
        content = chapter_repo.get_content_only(str(au_path), current - 1)
    except FileNotFoundError:
        return ""

    if not content:
        return ""

    # 截断：保留末尾，最少 500 字
    tokens = _count(content, llm_config).count
    if tokens <= budget_tokens:
        return P.SECTION_LAST_ENDING.format(content=content)

    # 从末尾截取
    min_chars = 500
    if len(content) <= min_chars:
        return P.SECTION_LAST_ENDING.format(content=content)

    # 二分查找合适的截断点
    end_text = content[-min_chars:]
    while _count(end_text, llm_config).count < budget_tokens and len(end_text) < len(content):
        end_text = content[-(len(end_text) + 200):]
    # 最终确保不超 budget
    while _count(end_text, llm_config).count > budget_tokens and len(end_text) > min_chars:
        end_text = end_text[200:]

    return P.SECTION_LAST_ENDING_TRUNCATED.format(end_text=end_text)


# ===========================================================================
# build_core_settings_layer（P5 核心设定）
# ===========================================================================

def build_core_settings_layer(
    project: Any,
    character_files: Optional[dict[str, str]],
    budget_tokens: int,
    llm_config: Any,
    language: str = "zh",
    worldbuilding_files: Optional[dict[str, str]] = None,
) -> tuple[str, list[str], list[str], list[str]]:
    """构建 P5 核心设定层。

    core_guarantee_budget 低保机制：为 core_always_include 预留 400 token。

    Returns:
        (text, injected_character_names, truncated_character_names, injected_worldbuilding_names)
    """
    if not character_files and not worldbuilding_files:
        return "", [], [], []

    core_names = set(getattr(project, "core_always_include", []) or [])
    guarantee = getattr(project, "core_guarantee_budget", 400)

    char_parts: list[str] = []
    injected: list[str] = []
    truncated: list[str] = []
    used = 0

    if character_files:
        # 先注入 core_always_include 角色（低保保护）
        for name in sorted(core_names):
            if name in character_files:
                text = character_files[name]
                t = _count(text, llm_config).count
                if used + t <= max(budget_tokens, guarantee):
                    char_parts.append(f"### {name}\n{text}")
                    used += t
                    injected.append(name)
                else:
                    truncated.append(name)

        # 再注入其他角色（用剩余 budget）
        for name, text in character_files.items():
            if name in core_names:
                continue
            t = _count(text, llm_config).count
            if used + t <= budget_tokens:
                char_parts.append(f"### {name}\n{text}")
                used += t
                injected.append(name)
            else:
                truncated.append(name)

    # 世界观注入（用剩余 budget）
    wb_parts: list[str] = []
    wb_injected: list[str] = []
    if worldbuilding_files:
        for name, text in worldbuilding_files.items():
            t = _count(text, llm_config).count
            if used + t <= budget_tokens:
                wb_parts.append(f"### {name}\n{text}")
                used += t
                wb_injected.append(name)
            # 世界观超预算则静默跳过（不报 truncated，优先级低于角色）

    all_parts: list[str] = []
    P = get_prompts(language)
    if char_parts:
        all_parts.append(P.SECTION_CHARACTERS + "\n" + "\n\n".join(char_parts))
    if wb_parts:
        all_parts.append(P.SECTION_WORLDBUILDING + "\n" + "\n\n".join(wb_parts))

    if not all_parts:
        return "", injected, truncated, wb_injected

    return "\n\n".join(all_parts), injected, truncated, wb_injected


# ===========================================================================
# assemble_context 主函数
# ===========================================================================

def assemble_context(
    project: Any,
    state: Any,
    user_input: str,
    facts: list[Fact],
    chapter_repo: Any,
    au_path: Path,
    rag_results: Optional[str] = None,
    character_files: Optional[dict[str, str]] = None,
    worldbuilding_files: Optional[dict[str, str]] = None,
    language: str = "zh",
) -> dict[str, Any]:
    """上下文组装器主函数（PRD §4.1）。

    Returns:
        {"messages": [...], "max_tokens": int, "budget_report": BudgetReport}
    """
    llm = getattr(project, "llm", None)
    report = BudgetReport()

    # --- context_window ---
    context_window = get_context_window(project)
    report.context_window = context_window

    # --- System prompt ---
    system_prompt = build_system_prompt(project, language=language)
    sys_tc = _count(system_prompt, llm)
    system_tokens = sys_tc.count
    report.is_fallback_estimate = sys_tc.is_estimate

    budget = int(context_window * 0.60) - system_tokens

    # fail-safe：budget 不够 → 裁剪 custom_instructions
    if budget <= 0:
        system_prompt = build_system_prompt(project, trim_custom=True, language=language)
        sys_tc = _count(system_prompt, llm)
        system_tokens = sys_tc.count
        budget = int(context_window * 0.60) - system_tokens

    if budget <= 0:
        raise ValueError("system_prompt_exceeds_budget")

    report.system_tokens = system_tokens

    # --- max_tokens ---
    model_name = getattr(llm, "model", "") if llm else ""
    chapter_length = getattr(project, "chapter_length", 1500)
    # 安全网：chapter_length 的 2 倍作为硬上限（主要靠 prompt 约束，这里防极端情况）
    chapter_token_cap = int(chapter_length * 2) if chapter_length else None
    max_tokens = min(
        get_model_max_output(model_name),
        int(context_window * 0.40),
        *([chapter_token_cap] if chapter_token_cap else []),
    )
    report.max_output_tokens = max_tokens

    # --- core_guarantee_budget 预留 ---
    guarantee = getattr(project, "core_guarantee_budget", 400)

    used = 0
    truncated: list[str] = []

    # === P1：当前指令（必须完整保留）===
    focus_ids = list(getattr(state, "chapter_focus", []) or [])
    p1_text = build_instruction(state, user_input, facts, language=language, chapter_length=chapter_length)
    p1_tc = _count(p1_text, llm)
    p1_tokens = p1_tc.count
    used += p1_tokens
    report.p1_tokens = p1_tokens

    # === P3：事实表 ===
    p3_budget = max(0, budget - used - guarantee)  # 预留 core_guarantee
    p3_text, soft_degraded = build_facts_layer(facts, focus_ids, p3_budget, llm, language=language)
    p3_tc = _count(p3_text, llm)
    p3_tokens = p3_tc.count
    used += p3_tokens
    report.p3_tokens = p3_tokens
    report.unresolved_soft_degraded = soft_degraded
    if soft_degraded:
        truncated.append("P3")

    # === P2：最近章节 ===
    p2_budget = max(0, budget - used - guarantee)
    p2_text = build_recent_chapter_layer(state, chapter_repo, au_path, p2_budget, llm, language=language)
    p2_tc = _count(p2_text, llm)
    p2_tokens = p2_tc.count
    if p2_tokens > p2_budget and p2_budget > 0:
        truncated.append("P2")
    used += p2_tokens
    report.p2_tokens = p2_tokens

    # === P4：RAG ===
    p4_text = rag_results or ""
    if p4_text:
        p4_tc = _count(p4_text, llm)
        p4_tokens = p4_tc.count
        p4_budget = max(0, budget - used - guarantee)
        if p4_tokens > p4_budget:
            p4_text = ""  # 超预算则丢弃 RAG
            p4_tokens = 0
            truncated.append("P4")
        used += p4_tokens
    else:
        p4_tokens = 0
    report.p4_tokens = p4_tokens

    # === P5：核心设定（用剩余 budget，含低保） ===
    p5_budget = max(guarantee, budget - used)
    p5_text, p5_injected, p5_truncated, p5_wb_injected = build_core_settings_layer(
        project, character_files, p5_budget, llm, language=language,
        worldbuilding_files=worldbuilding_files,
    )
    p5_tc = _count(p5_text, llm)
    p5_tokens = p5_tc.count
    used += p5_tokens
    report.p5_tokens = p5_tokens
    if p5_truncated:
        truncated.append("P5_core_settings")

    # --- 汇总 ---
    report.total_input_tokens = system_tokens + used
    report.budget_remaining = budget - used
    report.truncated_layers = truncated

    # --- ContextSummary 旁路收集（D-0031）---
    # 全部包裹在 try/except 中，收集失败不影响组装结果
    summary = ContextSummary()
    try:
        pinned = getattr(project, "pinned_context", None) or []
        summary.pinned_count = len(pinned)

        # focus facts 前 20 字
        for f in facts:
            if f.id in focus_ids:
                summary.facts_as_focus.append(f.content_clean[:20])

        # P3 注入的 facts 条数
        summary.facts_injected = sum(
            1 for line in p3_text.splitlines() if line.startswith("- [")
        )

        # P4 RAG chunk 数（按非空内容行计数，排除分组标题）
        if p4_text:
            rag_content_lines = [
                line for line in p4_text.splitlines()
                if line.strip() and not line.startswith("### ")
            ]
            summary.rag_chunks_retrieved = len(rag_content_lines)

        # P5 角色注入/截断
        summary.characters_used = p5_injected
        summary.truncated_characters = p5_truncated
        summary.worldbuilding_used = p5_wb_injected

        # 汇总
        summary.total_input_tokens = system_tokens + used
        summary.truncated_layers = list(truncated)
    except Exception:
        # D-0031: 收集失败不影响生成流程，返回部分填充的 summary
        logger.warning("ContextSummary 收集异常，返回部分数据", exc_info=True)

    # --- 组装 messages ---
    # 收集顺序 P1→P3→P2→P4→P5
    # reversed 后 P5→P4→P2→P3→P1
    layers = [p1_text, p3_text, p2_text, p4_text, p5_text]
    user_parts = [layer for layer in reversed(layers) if layer]
    user_content = "\n\n".join(user_parts)

    messages: list[dict[str, str]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    return {
        "messages": messages,
        "max_tokens": max_tokens,
        "budget_report": report,
        "context_summary": summary,
    }
