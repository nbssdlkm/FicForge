"""核心领域枚举定义。"""

from enum import Enum


class FactStatus(str, Enum):
    """事实状态。参见 PRD §3.6。"""
    ACTIVE = "active"
    UNRESOLVED = "unresolved"
    RESOLVED = "resolved"
    DEPRECATED = "deprecated"


class FactType(str, Enum):
    """事实类型。参见 PRD §3.6。"""
    CHARACTER_DETAIL = "character_detail"
    RELATIONSHIP = "relationship"
    BACKSTORY = "backstory"
    PLOT_EVENT = "plot_event"
    FORESHADOWING = "foreshadowing"
    WORLD_RULE = "world_rule"


class NarrativeWeight(str, Enum):
    """叙事权重。参见 PRD §3.6。"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class FactSource(str, Enum):
    """事实来源。参见 PRD §3.6。"""
    MANUAL = "manual"
    EXTRACT_AUTO = "extract_auto"
    IMPORT_AUTO = "import_auto"


class LLMMode(str, Enum):
    """LLM 运行模式。参见 PRD §3.3。"""
    API = "api"
    LOCAL = "local"
    OLLAMA = "ollama"


class IndexStatus(str, Enum):
    """向量索引状态。参见 PRD §3.5。"""
    READY = "ready"
    STALE = "stale"
    REBUILDING = "rebuilding"
    INTERRUPTED = "interrupted"


class Perspective(str, Enum):
    """叙事人称。参见 PRD §3.4。"""
    THIRD_PERSON = "third_person"
    FIRST_PERSON = "first_person"


class EmotionStyle(str, Enum):
    """情感表达风格。参见 PRD §3.4。"""
    IMPLICIT = "implicit"
    EXPLICIT = "explicit"


class LicenseTier(str, Enum):
    """许可证等级。参见 PRD §3.3。"""
    FREE = "free"
    PRO = "pro"


class APIMode(str, Enum):
    """API 模式。参见 PRD §3.3。"""
    SELF_HOSTED = "self_hosted"
    MANAGED = "managed"


class Provenance(str, Enum):
    """章节来源标记。"""
    AI = "ai"
    MANUAL = "manual"
    MIXED = "mixed"
    IMPORTED = "imported"
