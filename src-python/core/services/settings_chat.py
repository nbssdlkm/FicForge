"""设定模式 AI 对话服务。参见 D-0024、D-0029。

精简版上下文组装 + LLM tool calling 请求。
AI 只建议不执行：返回 tool_calls 原样交给前端。
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Optional

from core.domain.settings_tools import get_tools_for_mode
from core.domain.tokenizer import count_tokens
from infra.llm.openai_compatible import OpenAICompatibleProvider

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 对话历史截断
# ---------------------------------------------------------------------------

_MAX_HISTORY_MESSAGES = 10  # 5 轮 = 10 条 messages


def _truncate_history(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """保留最近 5 轮（10 条），截断最早的。"""
    if len(messages) <= _MAX_HISTORY_MESSAGES:
        return list(messages)
    return list(messages[-_MAX_HISTORY_MESSAGES:])


# ---------------------------------------------------------------------------
# System Prompt
# ---------------------------------------------------------------------------

_AU_SYSTEM_PROMPT = """\
你是 FicForge 的设定管理助手。用户正在配置 AU "{au_name}"（属于 Fandom "{fandom_name}"）。

你的职责：
1. 理解用户用自然语言描述的设定需求
2. 通过 tool calling 返回具体的操作建议
3. 同时用自然语言向用户解释你的建议

你有以下工具可用（但你不会直接执行，用户需要确认后才会执行）：
- create_character_file / modify_character_file（角色设定）
- create_worldbuilding_file / modify_worldbuilding_file（世界观）
- add_fact / modify_fact（事实表）
- add_pinned_context（铁律）
- update_writing_style（文风）
- update_core_includes（核心绑定）

你不能操作的（需要提示用户去 Fandom 设定库操作）：
- Fandom 核心角色 DNA 档案（core_characters/）
- Fandom 世界观笔记（worldbuilding/）

参考上下文：
- 你可以读取 Fandom 层的角色 DNA 档案，作为理解角色人格内核的参考
- 但你的建议产出的文件保存在 AU 层，不影响 Fandom 层

当用户想基于 Fandom 角色创建 AU 版本时：
- 读取 Fandom 层的人格 DNA
- 保留内核特质（性格底色、行为模式、关系动力学）
- 根据用户描述的 AU 背景重新包装外部设定
- 用 create_character_file 工具输出全新的独立设定文件
- origin_ref 设为 "fandom/{{原始角色名}}"

当用户粘贴大段文本时：
- 提取 frontmatter 元数据（name / aliases / importance）
- 识别并标注"## 核心限制"段落
- 保留原文完整性，不删减用户内容
- 如果 Fandom 层有同名角色 → origin_ref 设为 fandom/{{name}}"""


_FANDOM_SYSTEM_PROMPT = """\
你是 FicForge 的 Fandom 设定管理助手。用户正在整理 Fandom "{fandom_name}" 的角色知识库。

这里存放的是用户对原作角色的人格分析和理解，作为所有 AU 创作的参考素材。

你可以建议的操作：
- 创建/修改核心角色 DNA 档案（core_characters/）
- 创建/修改世界观笔记（worldbuilding/）

当用户粘贴角色分析文本时：
- 提取角色名和别名
- 保留原文完整性
- 标注核心人格特质段落
- 不要尝试"简化"或"结构化"用户的分析——用户的原始理解就是最好的 DNA 档案

当用户描述角色时：
- 帮助补充可能遗漏的维度（如决策模式、隐藏面向、关系模式）
- 但始终以用户的理解为准，不要覆盖用户的判断

你不能操作的：
- 任何 AU 级别的设定
- 章节正文
- 事实表
- 铁律"""


# ---------------------------------------------------------------------------
# Fandom DNA 摘要提取
# ---------------------------------------------------------------------------

_DNA_SECTION_RE = re.compile(
    r"^##\s*(核心本质|核心特质|Core Essence|Core Traits)",
    re.MULTILINE,
)


def _extract_dna_summary(content: str, max_chars: int = 1500) -> str:
    """从角色设定文件中提取核心段落摘要。

    优先提取 ## 核心本质 / ## 核心特质 段落，
    找不到则取前 max_chars 字符。
    每角色最多约 500 token（~1500 中文字符）。
    """
    match = _DNA_SECTION_RE.search(content)
    if match:
        start = match.start()
        # 找下一个 ## 标题或文件末尾
        next_heading = content.find("\n## ", start + 1)
        section = content[start:next_heading] if next_heading != -1 else content[start:]
        if len(section) > max_chars:
            section = section[:max_chars] + "…"
        return section.strip()

    # fallback：取前 max_chars 字符
    if len(content) > max_chars:
        return content[:max_chars] + "…"
    return content.strip()


# ---------------------------------------------------------------------------
# 上下文组装
# ---------------------------------------------------------------------------

def build_settings_context(
    mode: str,
    base_path: str,
    fandom_path: Optional[str],
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """组装设定模式的 messages 数组。

    不走写作模式的 P0-P5 六层组装。
    """
    system_parts: list[str] = []

    if mode == "au":
        # 读取 project 信息
        au_name, fandom_name = _load_au_meta(base_path)
        system_parts.append(
            _AU_SYSTEM_PROMPT.format(au_name=au_name, fandom_name=fandom_name)
        )

        # Fandom DNA 摘要
        if fandom_path:
            dna_summary = _load_fandom_dna_summaries(fandom_path)
            if dna_summary:
                system_parts.append(f"## Fandom 角色 DNA 参考\n{dna_summary}")

        # AU 上下文
        au_context = _load_au_context(base_path)
        if au_context:
            system_parts.append(au_context)

    elif mode == "fandom":
        fandom_name = Path(base_path).name
        system_parts.append(
            _FANDOM_SYSTEM_PROMPT.format(fandom_name=fandom_name)
        )

        # Fandom 现有设定文件全文
        fandom_files = _load_settings_files(
            Path(base_path),
            [("core_characters", "角色 DNA"), ("core_worldbuilding", "世界观")],
        )
        if fandom_files:
            system_parts.append(f"## 当前 Fandom 设定文件\n{fandom_files}")

    system_content = "\n\n".join(system_parts)

    # 截断对话历史
    truncated = _truncate_history(messages)

    result: list[dict[str, Any]] = [
        {"role": "system", "content": system_content},
    ]
    result.extend(truncated)

    return result


# ---------------------------------------------------------------------------
# 辅助：加载 AU 元数据
# ---------------------------------------------------------------------------

def _load_au_meta(au_path: str) -> tuple[str, str]:
    """从 project.yaml 读取 AU 名称和 Fandom 名称。"""
    import yaml

    project_yaml = Path(au_path) / "project.yaml"
    if not project_yaml.is_file():
        au_name = Path(au_path).name
        return au_name, "Unknown"

    try:
        raw = yaml.safe_load(project_yaml.read_text(encoding="utf-8")) or {}
    except Exception:
        return Path(au_path).name, "Unknown"

    return raw.get("name", Path(au_path).name), raw.get("fandom", "Unknown")


_SETTINGS_FILES_TOKEN_LIMIT = 30000


def _load_settings_files(
    base_dir: Path,
    categories: list[tuple[str, str]],
) -> str:
    """读取指定目录下的 .md 设定文件全文。

    Args:
        base_dir: 根目录（AU 或 Fandom 路径）。
        categories: [(子目录名, 标签)] 列表，如 [("characters", "角色设定"), ("worldbuilding", "世界观")]。

    Returns:
        格式化的设定文件全文。超量时截断低 importance 角色。
    """
    entries: list[tuple[str, str, str]] = []  # (label, filename, content)
    total_chars = 0

    for subdir, label in categories:
        dir_path = base_dir / subdir
        if not dir_path.is_dir():
            continue
        for f in sorted(dir_path.iterdir()):
            if f.is_file() and f.suffix == ".md":
                try:
                    content = f.read_text(encoding="utf-8")
                    entries.append((label, f.name, content))
                    total_chars += len(content)
                except Exception:
                    continue

    if not entries:
        return ""

    # 超量保护：>30000 token（~90000 中文字符估算）时截断
    if total_chars > _SETTINGS_FILES_TOKEN_LIMIT * 3:
        logger.warning(
            "设定文件总量 %d 字符，超过阈值，截断低 importance 角色",
            total_chars,
        )
        entries = _truncate_low_importance(entries)

    parts: list[str] = []
    for label, filename, content in entries:
        parts.append(f"[{label}] {filename}:\n{content}")

    return "\n\n".join(parts)


def _truncate_low_importance(
    entries: list[tuple[str, str, str]],
) -> list[tuple[str, str, str]]:
    """截断低 importance 角色：只保留 frontmatter + ## 核心限制 段落。"""
    result: list[tuple[str, str, str]] = []
    for label, filename, content in entries:
        if "importance: low" in content.lower():
            truncated = _extract_frontmatter_and_core(content)
            result.append((label, filename, truncated))
        else:
            result.append((label, filename, content))
    return result


def _extract_frontmatter_and_core(content: str) -> str:
    """提取 frontmatter + ## 核心限制 段落。"""
    parts: list[str] = []

    # frontmatter
    if content.startswith("---"):
        fm_parts = content.split("---", 2)
        if len(fm_parts) >= 3:
            parts.append(f"---{fm_parts[1]}---")
            remaining = fm_parts[2]
        else:
            remaining = content
    else:
        remaining = content

    # ## 核心限制 段落
    core_match = re.search(r"^## 核心限制.*?(?=\n## |\Z)", remaining, re.MULTILINE | re.DOTALL)
    if core_match:
        parts.append(core_match.group().strip())

    if not parts:
        # fallback: 前 500 字符
        return content[:500] + "…（已截断）"

    return "\n\n".join(parts) + "\n\n（其余内容已截断，原文件更完整）"


def _load_fandom_dna_summaries(fandom_path: str) -> str:
    """读取 Fandom core_characters/ 下所有角色的 DNA 摘要。"""
    chars_dir = Path(fandom_path) / "core_characters"
    if not chars_dir.is_dir():
        return ""

    parts: list[str] = []
    for f in sorted(chars_dir.iterdir()):
        if f.is_file() and f.suffix == ".md":
            try:
                content = f.read_text(encoding="utf-8")
                summary = _extract_dna_summary(content)
                if summary:
                    parts.append(f"### {f.stem}\n{summary}")
            except Exception:
                continue

    return "\n\n".join(parts)


def _load_au_context(au_path: str) -> str:
    """加载 AU 级上下文：设定文件全文 + pinned_context + writing_style。"""
    import yaml

    parts: list[str] = []

    # 设定文件全文（characters/ + worldbuilding/）
    files_text = _load_settings_files(
        Path(au_path),
        [("characters", "角色设定"), ("worldbuilding", "世界观")],
    )
    if files_text:
        parts.append(f"## 当前 AU 设定文件\n{files_text}")

    # pinned_context + writing_style 从 project.yaml 读取
    project_yaml = Path(au_path) / "project.yaml"
    if project_yaml.is_file():
        try:
            raw = yaml.safe_load(project_yaml.read_text(encoding="utf-8")) or {}
        except Exception:
            raw = {}

        pinned = raw.get("pinned_context", [])
        if pinned:
            lines = "\n".join(f"- {p}" for p in pinned)
            parts.append(f"## 当前铁律\n{lines}")

        ws = raw.get("writing_style", {})
        if ws:
            ws_parts: list[str] = []
            if ws.get("perspective"):
                ws_parts.append(f"视角: {ws['perspective']}")
            if ws.get("emotion_style"):
                ws_parts.append(f"情感: {ws['emotion_style']}")
            if ws.get("custom_instructions"):
                ws_parts.append(f"自定义文风: {ws['custom_instructions']}")
            if ws_parts:
                parts.append(f"## 当前文风配置\n{'  |  '.join(ws_parts)}")

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# LLM 调用 + 响应解析
# ---------------------------------------------------------------------------

def call_settings_llm(
    assembled_messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    llm_config: dict[str, str],
) -> dict[str, Any]:
    """调用 LLM（非流式 + tool calling），返回解析后的响应。

    Returns:
        {"content": str, "tool_calls": list[dict]}
    """
    provider = OpenAICompatibleProvider(
        api_base=llm_config.get("api_base", ""),
        api_key=llm_config.get("api_key", ""),
        model=llm_config.get("model", ""),
    )

    # 构造请求 body（直接使用 provider 内部方法复用重试逻辑）
    body: dict[str, Any] = {
        "model": provider._model,
        "messages": assembled_messages,
        "tools": tools,
        "tool_choice": "auto",
        "temperature": 0.7,
        "top_p": 0.95,
        "max_tokens": 4096,
        "stream": False,
    }

    data = provider._request_with_retry(body)

    # 解析响应
    content = ""
    tool_calls: list[dict[str, Any]] = []

    choices = data.get("choices", [])
    if choices:
        msg = choices[0].get("message", {})
        content = msg.get("content", "") or ""
        raw_tool_calls = msg.get("tool_calls") or []
        for tc in raw_tool_calls:
            tool_calls.append({
                "id": tc.get("id", ""),
                "type": tc.get("type", "function"),
                "function": {
                    "name": tc.get("function", {}).get("name", ""),
                    "arguments": tc.get("function", {}).get("arguments", "{}"),
                },
            })

    return {"content": content, "tool_calls": tool_calls}
