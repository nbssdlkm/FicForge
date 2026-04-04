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

# System prompt 常量已迁移到 core/prompts/zh.py 和 en.py，通过 get_prompts(language) 获取。


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
    language: str = "zh",
) -> list[dict[str, Any]]:
    """组装设定模式的 messages 数组。

    不走写作模式的 P0-P5 六层组装。
    """
    from core.prompts import get_prompts
    P = get_prompts(language)

    system_parts: list[str] = []

    if mode == "au":
        # 读取 project 信息
        au_name, fandom_name = _load_au_meta(base_path)
        system_parts.append(
            P.SETTINGS_AU_SYSTEM_PROMPT.format(au_name=au_name, fandom_name=fandom_name)
        )

        # Fandom DNA 摘要
        if fandom_path:
            dna_summary = _load_fandom_dna_summaries(fandom_path)
            if dna_summary:
                system_parts.append(f"{P.SETTINGS_FANDOM_DNA_HEADER}\n{dna_summary}")

        # AU 上下文
        au_context = _load_au_context(base_path, language=language)
        if au_context:
            system_parts.append(au_context)

    elif mode == "fandom":
        fandom_name = Path(base_path).name
        system_parts.append(
            P.SETTINGS_FANDOM_SYSTEM_PROMPT.format(fandom_name=fandom_name)
        )

        # Fandom 现有设定文件全文
        fandom_files = _load_settings_files(
            Path(base_path),
            [("core_characters", P.SETTINGS_LABEL_CORE_CHARACTERS), ("core_worldbuilding", P.SETTINGS_LABEL_CORE_WORLDBUILDING)],
            language=language,
        )
        if fandom_files:
            system_parts.append(f"{P.SETTINGS_CURRENT_FANDOM_FILES_HEADER}\n{fandom_files}")

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
    language: str = "zh",
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

    # 超量保护：>30000 token 时截断（tokenizer 估算 1 token ≈ 0.67 字符）
    if total_chars > _SETTINGS_FILES_TOKEN_LIMIT // 1.5:
        logger.warning(
            "设定文件总量 %d 字符，超过阈值，截断低 importance 角色",
            total_chars,
        )
        entries = _truncate_low_importance(entries, language=language)

    parts: list[str] = []
    for label, filename, content in entries:
        parts.append(f"[{label}] {filename}:\n{content}")

    return "\n\n".join(parts)


def _truncate_low_importance(
    entries: list[tuple[str, str, str]],
    language: str = "zh",
) -> list[tuple[str, str, str]]:
    """截断低 importance 角色：只保留 frontmatter + ## 核心限制 段落。"""
    result: list[tuple[str, str, str]] = []
    for label, filename, content in entries:
        if _has_low_importance(content):
            truncated = _extract_frontmatter_and_core(content, language=language)
            result.append((label, filename, truncated))
        else:
            result.append((label, filename, content))
    return result


def _has_low_importance(content: str) -> bool:
    """检查 YAML frontmatter 中 importance 是否为 low（仅检查 frontmatter）。"""
    if not content.startswith("---"):
        return False
    try:
        import yaml
        fm_parts = content.split("---", 2)
        if len(fm_parts) < 3:
            return False
        fm = yaml.safe_load(fm_parts[1]) or {}
        return fm.get("importance") == "low"
    except Exception:
        return False


def _extract_frontmatter_and_core(content: str, language: str = "zh") -> str:
    """提取 frontmatter + ## 核心限制 段落。"""
    from core.prompts import get_prompts
    P = get_prompts(language)

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
    core_match = re.search(r"^## (?:核心限制|Core Constraints).*?(?=\n## |\Z)", remaining, re.MULTILINE | re.DOTALL)
    if core_match:
        parts.append(core_match.group().strip())

    if not parts:
        return content[:500] + P.SETTINGS_TRUNCATED_SUFFIX

    return "\n\n".join(parts) + P.SETTINGS_TRUNCATED_FULL_SUFFIX


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


def _load_au_context(au_path: str, language: str = "zh") -> str:
    """加载 AU 级上下文：设定文件全文 + pinned_context + writing_style。"""
    import yaml
    from core.prompts import get_prompts
    P = get_prompts(language)

    parts: list[str] = []

    # 设定文件全文（characters/ + worldbuilding/）
    files_text = _load_settings_files(
        Path(au_path),
        [("characters", P.SETTINGS_LABEL_CHARACTERS), ("worldbuilding", P.SETTINGS_LABEL_WORLDBUILDING)],
        language=language,
    )
    if files_text:
        parts.append(f"{P.SETTINGS_CURRENT_AU_FILES_HEADER}\n{files_text}")

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
            parts.append(f"{P.SETTINGS_CURRENT_PINNED_HEADER}\n{lines}")

        ws = raw.get("writing_style", {})
        if ws:
            ws_parts: list[str] = []
            if ws.get("perspective"):
                ws_parts.append(f"perspective: {ws['perspective']}")
            if ws.get("emotion_style"):
                ws_parts.append(f"emotion: {ws['emotion_style']}")
            if ws.get("custom_instructions"):
                ws_parts.append(f"custom: {ws['custom_instructions']}")
            if ws_parts:
                parts.append(f"{P.SETTINGS_CURRENT_STYLE_HEADER}\n{'  |  '.join(ws_parts)}")

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
