# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""AU 项目配置领域对象。参见 PRD §3.4 project.yaml。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from core.domain.enums import EmotionStyle, LLMMode, Perspective


@dataclass
class LLMConfig:
    """LLM 配置。参见 PRD §3.3 / §3.4。"""

    mode: LLMMode = LLMMode.API
    model: str = ""
    api_base: str = ""
    api_key: str = ""
    local_model_path: str = ""
    ollama_model: str = ""
    context_window: int = 0    # 0 = 自动推断


@dataclass
class WritingStyle:
    """文风配置。参见 PRD §3.4。"""

    perspective: Perspective = Perspective.THIRD_PERSON
    pov_character: str = ""        # first_person 时必填
    emotion_style: EmotionStyle = EmotionStyle.IMPLICIT
    custom_instructions: str = ""


@dataclass
class CastRegistry:
    """出场人物注册表。参见 PRD §3.4 / D-0022。

    D-0022: 取消 from_core/au_specific/oc 分组，统一为 characters 列表。
    角色来源通过设定文件 frontmatter 的 origin_ref 字段标记。
    """

    characters: list[str] = field(default_factory=list)


@dataclass
class EmbeddingLock:
    """Embedding 模型锁定配置。参见 PRD §3.4。"""

    mode: str = ""
    model: str = ""
    api_base: str = ""
    api_key: str = ""


@dataclass
class Project:
    """AU 项目配置。

    字段名与 PRD §3.4 project.yaml 一致。
    存放 AU 长期配置。
    """

    project_id: str
    au_id: str
    name: str = ""
    fandom: str = ""
    schema_version: str = "1.0.0"
    revision: int = 0                              # 每次长期配置变更 +1（save 自动递增）
    created_at: str = ""                           # ISO 8601
    updated_at: str = ""                           # ISO 8601

    llm: LLMConfig = field(default_factory=LLMConfig)
    model_params_override: dict[str, dict[str, Any]] = field(default_factory=dict)

    chapter_length: int = 1500
    writing_style: WritingStyle = field(default_factory=WritingStyle)
    ignore_core_worldbuilding: bool = False
    agent_pipeline_enabled: bool = False

    cast_registry: CastRegistry = field(default_factory=CastRegistry)
    core_always_include: list[str] = field(default_factory=list)
    pinned_context: list[str] = field(default_factory=list)

    rag_decay_coefficient: float = 0.05
    embedding_lock: EmbeddingLock = field(default_factory=EmbeddingLock)
    core_guarantee_budget: int = 400               # D-0015

    current_branch: str = "main"
