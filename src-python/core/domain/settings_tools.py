"""设定模式 Tool Schema 定义。参见 D-0029、补充 PRD v2 §1.5。

AU 模式 9 个 tool，Fandom 模式 4 个 tool。
格式为 OpenAI function calling 兼容格式。
AI 没有 delete 类 tool（D-0029）。
"""

from __future__ import annotations

from typing import Any

# ===========================================================================
# AU 设定模式 — 9 个 tool
# ===========================================================================

_AU_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "create_character_file",
            "description": "在当前 AU 中创建角色设定文件。如果 Fandom 层有同名角色，自动标记 origin_ref。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "角色名（如 Connor Ellis）"},
                    "aliases": {"type": "array", "items": {"type": "string"}, "description": "别名列表"},
                    "importance": {"type": "string", "enum": ["high", "medium", "low"]},
                    "origin_ref": {"type": "string", "description": "fandom/角色名（来自Fandom）或 original（原创）"},
                    "content": {"type": "string", "description": "完整 Markdown 设定内容（含核心人格、核心限制等段落）"},
                },
                "required": ["name", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "modify_character_file",
            "description": "修改当前 AU 中已有的角色设定文件",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string", "description": "要修改的文件名（如 Connor.md）"},
                    "new_content": {"type": "string", "description": "修改后的完整 Markdown 内容"},
                    "change_summary": {"type": "string", "description": "本次修改的简要说明"},
                },
                "required": ["filename", "new_content", "change_summary"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_worldbuilding_file",
            "description": "在当前 AU 中创建世界观设定文件",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "世界观名称"},
                    "content": {"type": "string", "description": "完整 Markdown 内容"},
                },
                "required": ["name", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "modify_worldbuilding_file",
            "description": "修改当前 AU 中已有的世界观设定文件",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string"},
                    "new_content": {"type": "string"},
                    "change_summary": {"type": "string"},
                },
                "required": ["filename", "new_content", "change_summary"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_fact",
            "description": "添加事实表条目",
            "parameters": {
                "type": "object",
                "properties": {
                    "content_raw": {"type": "string", "description": "原文引用"},
                    "content_clean": {"type": "string", "description": "用第三人称客观描述的逻辑抽提"},
                    "characters": {"type": "array", "items": {"type": "string"}, "description": "关联角色名"},
                    "fact_type": {"type": "string", "enum": ["plot_event", "character_detail", "relationship", "worldbuilding", "foreshadowing"]},
                    "narrative_weight": {"type": "string", "enum": ["low", "medium", "high"]},
                    "status": {"type": "string", "enum": ["active", "unresolved"]},
                },
                "required": ["content_raw", "content_clean", "fact_type", "status"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "modify_fact",
            "description": "修改已有的事实表条目",
            "parameters": {
                "type": "object",
                "properties": {
                    "fact_id": {"type": "string"},
                    "content_clean": {"type": "string"},
                    "narrative_weight": {"type": "string", "enum": ["low", "medium", "high"]},
                    "status": {"type": "string", "enum": ["active", "unresolved", "resolved", "deprecated"]},
                },
                "required": ["fact_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_pinned_context",
            "description": "添加一条铁律（P0 层，每次续写无条件注入 prompt 顶部）",
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "铁律内容，请保持精简"},
                },
                "required": ["content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_writing_style",
            "description": "修改文风配置",
            "parameters": {
                "type": "object",
                "properties": {
                    "field": {"type": "string", "enum": ["perspective", "emotion_style", "custom_instructions"]},
                    "value": {"type": "string"},
                },
                "required": ["field", "value"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_core_includes",
            "description": "修改核心绑定列表（P5 低保设定，每次续写必定完整注入的文件）",
            "parameters": {
                "type": "object",
                "properties": {
                    "filenames": {"type": "array", "items": {"type": "string"}, "description": "要绑定的设定文件名列表"},
                },
                "required": ["filenames"],
            },
        },
    },
]

# ===========================================================================
# Fandom 设定模式 — 4 个 tool
# ===========================================================================

_FANDOM_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "create_core_character_file",
            "description": "创建 Fandom 角色 DNA 档案（core_characters/）",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "角色名"},
                    "content": {"type": "string", "description": "完整 Markdown 设定内容"},
                },
                "required": ["name", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "modify_core_character_file",
            "description": "修改已有的 Fandom 角色 DNA 档案",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string"},
                    "new_content": {"type": "string"},
                    "change_summary": {"type": "string"},
                },
                "required": ["filename", "new_content", "change_summary"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_worldbuilding_file",
            "description": "创建 Fandom 世界观设定文件",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "世界观名称"},
                    "content": {"type": "string", "description": "完整 Markdown 内容"},
                },
                "required": ["name", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "modify_worldbuilding_file",
            "description": "修改已有的 Fandom 世界观设定文件",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string"},
                    "new_content": {"type": "string"},
                    "change_summary": {"type": "string"},
                },
                "required": ["filename", "new_content", "change_summary"],
            },
        },
    },
]


# ===========================================================================
# 公共接口
# ===========================================================================

def get_tools_for_mode(mode: str) -> list[dict[str, Any]]:
    """根据模式返回对应的 tool 集合。

    Args:
        mode: "au" 或 "fandom"

    Returns:
        OpenAI function calling 格式的 tool 列表。
    """
    if mode == "au":
        return list(_AU_TOOLS)
    elif mode == "fandom":
        return list(_FANDOM_TOOLS)
    else:
        raise ValueError(f"不支持的设定模式: {mode}")
