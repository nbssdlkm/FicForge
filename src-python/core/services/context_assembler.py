"""上下文组装器。参见 PRD §4.1。

六层结构 P0-P5，按优先级截断，reversed 后注入。
收集顺序 P1→P3→P2→P4→P5，reversed 后 P5→P4→P2→P3→P1。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from core.domain.budget_report import BudgetReport
from core.domain.enums import FactStatus, NarrativeWeight
from core.domain.fact import Fact
from core.domain.model_context_map import get_context_window, get_model_max_output
from core.domain.tokenizer import TokenCount, count_tokens


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
) -> str:
    """构建 System Role 消息。

    Args:
        project: Project 领域对象。
        trim_custom: 若为 True，裁剪 custom_instructions（budget 不够时）。
    """
    parts: list[str] = ["你是一位专业的小说作者。"]

    # --- P0 Pinned Context ---
    pinned = getattr(project, "pinned_context", None) or []
    if pinned:
        lines = "\n".join(f"- {p}" for p in pinned)
        parts.append(
            "# 后台核心铁律——通过行为自然体现，绝不直接陈述\n"
            "以下是不可逾越的叙事底线。请通过人物行为、对话、细节自然体现（Show, don't tell），\n"
            "绝对不要将这些规则直接写成旁白或心理活动陈述：\n"
            f"{lines}"
        )

    # --- 冲突解决规则 ---
    parts.append(
        '# 冲突解决规则（重要）\n'
        '当\u201c上一章结尾\u201d、\u201c召回的历史设定片段\u201d与\u201c当前剧情状态（事实表）\u201d发生语义冲突时，\n'
        '必须且只能以\u201c当前剧情状态（事实表）\u201d为绝对事实依据，忽视其他冲突信息。\n\n'
        '若发现\u201c后台核心铁律（pinned_context）\u201d与\u201c当前剧情状态\u201d存在矛盾，请照常执行任务，\n'
        '系统将在外部提示用户更新过期的铁律条目。'
    )

    # --- 叙事视角 ---
    ws = getattr(project, "writing_style", None)
    perspective = getattr(ws, "perspective", None)
    p_val: str = perspective.value if perspective is not None and hasattr(perspective, "value") else str(perspective or "third_person")

    if p_val == "first_person":
        pov = getattr(ws, "pov_character", "") or "主角"
        parts.append(
            f"# 叙事视角\n"
            f"以{pov}的第一人称视角写作。以下\u201c客观事实\u201d描述的是{pov}所处的世界状态，\n"
            f"请将其转化为{pov}的主观感知、心理活动和第一人称动作描写。"
        )
    else:
        parts.append("# 叙事视角\n以第三人称叙事视角写作。")

    # --- 情感风格 ---
    emotion = getattr(ws, "emotion_style", None)
    e_val: str = emotion.value if emotion is not None and hasattr(emotion, "value") else str(emotion or "implicit")

    if e_val == "explicit":
        parts.append("# 情感表达风格\n可以直接描写人物心理和情绪。")
    else:
        parts.append("# 情感表达风格\n偏好用行为和细节暗示情绪，避免直接陈述心理状态。")

    # --- 伏笔规约 ---
    parts.append(
        "# 伏笔使用规约（重要）\n"
        "\u201c当前剧情状态\u201d中标注为 unresolved 的内容，是当前世界中成立的背景约束。\n"
        "除非指令中明确要求推进，否则请保持其悬而未决，仅作氛围点缀。\n"
        "不要强行解释或解决任何 unresolved 伏笔，也不要只是顺手\u201c提一句\u201d来刷存在感。"
    )

    # --- 通用规则 ---
    chapter_length = getattr(project, "chapter_length", 1500)
    parts.append(
        "# 通用规则\n"
        "不要出现任何章节编号或叙事外的结构性标注。\n"
        "所有背景信息通过人物行为、心理、对话自然呈现。\n"
        f"本章目标字数约 {chapter_length} 字。"
    )

    # --- custom_instructions ---
    if not trim_custom:
        custom = getattr(ws, "custom_instructions", "") if ws else ""
        if custom:
            parts.append(f"# 用户自定义文风\n{custom}")

    return "\n\n".join(parts)


# ===========================================================================
# build_instruction（P1 当前指令）
# ===========================================================================

def build_instruction(
    state: Any,
    user_input: str,
    facts: list[Fact],
) -> str:
    """构建 P1 当前指令层。"""
    parts: list[str] = []

    # 当前状态行
    current_ch = getattr(state, "current_chapter", 1)
    last_ending = getattr(state, "last_scene_ending", "")
    parts.append(f"## 当前状态\n现在是第{current_ch}章。")
    if last_ending:
        parts.append(f"上一章结尾：{last_ending}")

    # chapter_focus 分支
    focus_ids = getattr(state, "chapter_focus", []) or []
    focus_facts = [f for f in facts if f.id in focus_ids] if focus_ids else []

    if focus_facts:
        # 推进目标块
        focus_lines = "\n".join(f"- {f.content_clean}" for f in focus_facts)
        parts.append(
            '## 本章核心推进目标（必须执行）\n'
            '请在本章剧情中，对以下悬念给出实质性推进。\n'
            '\u201c推进\u201d的定义：信息有新增、关系发生变化、或冲突更激化/更接近解决。\n'
            '\u201c只是顺口提到\u201d或\u201c只是描写氛围/情绪\u201d不算推进。\n'
            '推进必须带来可感知的新信息或状态变化，使读者阅读后明确感觉剧情比之前更接近某种结果。\n'
            '如果本章结束后该节点仍无任何实质变化，视为未完成推进。\n'
            f'{focus_lines}'
        )

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
            parts.append(
                "## 本章特别注意（仅列最易被触发的1-2个高权重悬念，勿主动推进）\n"
                "以下悬念极易被顺带提及，请特别克制，本章保持悬而未决：\n"
                f"{caution_lines}"
            )

        # 背景信息使用规则
        parts.append(
            '## 背景信息使用规则\n'
            '\u201c当前剧情状态\u201d中其余 unresolved 事项仅作为世界背景。\n'
            '除非当前指令明确要求，否则保持悬而未决，不要主动解释或解决它们。'
        )

    elif any(f.status == FactStatus.UNRESOLVED for f in facts):
        # 铺陈指令
        parts.append(
            "## 本章叙事节奏\n"
            "本章以延续当前剧情和铺陈氛围为主。\n"
            "除非用户的具体指令中明确要求推进或解决某项事件，否则保持所有已有伏笔悬而未决，"
            "不要急于解决任何悬念，也不要随意挑选 unresolved 事项填坑。"
        )

    # 用户输入
    parts.append(f"## 请续写\n{user_input}")

    return "\n\n".join(parts)


# ===========================================================================
# build_facts_layer（P3 事实表）
# ===========================================================================

def build_facts_layer(
    facts: list[Fact],
    focus_ids: list[str],
    budget_tokens: int,
    llm_config: Any,
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
        lines.append(f"（另有 {unresolved_dropped} 条未解决伏笔暂未展示，详见事实表）")

    if not lines:
        return "", soft_degraded

    return "## 当前剧情状态\n" + "\n".join(lines), soft_degraded


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
) -> str:
    """构建 P2 最近章节层。"""
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
        return f"## 上一章结尾\n{content}"

    # 从末尾截取
    min_chars = 500
    if len(content) <= min_chars:
        return f"## 上一章结尾\n{content}"

    # 二分查找合适的截断点
    end_text = content[-min_chars:]
    while _count(end_text, llm_config).count < budget_tokens and len(end_text) < len(content):
        end_text = content[-(len(end_text) + 200):]
    # 最终确保不超 budget
    while _count(end_text, llm_config).count > budget_tokens and len(end_text) > min_chars:
        end_text = end_text[200:]

    return f"## 上一章结尾\n（前文略）…{end_text}"


# ===========================================================================
# build_core_settings_layer（P5 核心设定）
# ===========================================================================

def build_core_settings_layer(
    project: Any,
    character_files: Optional[dict[str, str]],
    budget_tokens: int,
    llm_config: Any,
) -> str:
    """构建 P5 核心设定层。

    core_guarantee_budget 低保机制：为 core_always_include 预留 400 token。
    """
    if not character_files:
        return ""

    core_names = set(getattr(project, "core_always_include", []) or [])
    guarantee = getattr(project, "core_guarantee_budget", 400)

    parts: list[str] = []
    used = 0

    # 先注入 core_always_include 角色（低保保护）
    for name in sorted(core_names):
        if name in character_files:
            text = character_files[name]
            t = _count(text, llm_config).count
            if used + t <= max(budget_tokens, guarantee):
                parts.append(f"### {name}\n{text}")
                used += t

    # 再注入其他角色（用剩余 budget）
    for name, text in character_files.items():
        if name in core_names:
            continue
        t = _count(text, llm_config).count
        if used + t <= budget_tokens:
            parts.append(f"### {name}\n{text}")
            used += t

    if not parts:
        return ""

    return "## 人物设定\n" + "\n\n".join(parts)


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
    system_prompt = build_system_prompt(project)
    sys_tc = _count(system_prompt, llm)
    system_tokens = sys_tc.count
    report.is_fallback_estimate = sys_tc.is_estimate

    budget = int(context_window * 0.60) - system_tokens

    # fail-safe：budget 不够 → 裁剪 custom_instructions
    if budget <= 0:
        system_prompt = build_system_prompt(project, trim_custom=True)
        sys_tc = _count(system_prompt, llm)
        system_tokens = sys_tc.count
        budget = int(context_window * 0.60) - system_tokens

    if budget <= 0:
        raise ValueError("system_prompt_exceeds_budget")

    report.system_tokens = system_tokens

    # --- max_tokens ---
    model_name = getattr(llm, "model", "") if llm else ""
    max_tokens = min(
        get_model_max_output(model_name),
        int(context_window * 0.40),
    )
    report.max_output_tokens = max_tokens

    # --- core_guarantee_budget 预留 ---
    guarantee = getattr(project, "core_guarantee_budget", 400)

    used = 0
    truncated: list[str] = []

    # === P1：当前指令（必须完整保留）===
    focus_ids = list(getattr(state, "chapter_focus", []) or [])
    p1_text = build_instruction(state, user_input, facts)
    p1_tc = _count(p1_text, llm)
    p1_tokens = p1_tc.count
    used += p1_tokens
    report.p1_tokens = p1_tokens

    # === P3：事实表 ===
    p3_budget = max(0, budget - used - guarantee)  # 预留 core_guarantee
    p3_text, soft_degraded = build_facts_layer(facts, focus_ids, p3_budget, llm)
    p3_tc = _count(p3_text, llm)
    p3_tokens = p3_tc.count
    used += p3_tokens
    report.p3_tokens = p3_tokens
    report.unresolved_soft_degraded = soft_degraded
    if soft_degraded:
        truncated.append("P3")

    # === P2：最近章节 ===
    p2_budget = max(0, budget - used - guarantee)
    p2_text = build_recent_chapter_layer(state, chapter_repo, au_path, p2_budget, llm)
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
    p5_text = build_core_settings_layer(project, character_files, p5_budget, llm)
    p5_tc = _count(p5_text, llm)
    p5_tokens = p5_tc.count
    used += p5_tokens
    report.p5_tokens = p5_tokens

    # --- 汇总 ---
    report.total_input_tokens = system_tokens + used
    report.budget_remaining = budget - used
    report.truncated_layers = truncated

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
    }
