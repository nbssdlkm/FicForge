// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 核心领域枚举定义。 */

/** 事实状态。参见 PRD §3.6。 */
export enum FactStatus {
  ACTIVE = "active",
  UNRESOLVED = "unresolved",
  RESOLVED = "resolved",
  DEPRECATED = "deprecated",
}
export const FACT_STATUS_VALUES = Object.values(FactStatus) as [FactStatus, ...FactStatus[]];

/** 事实类型。参见 PRD §3.6。 */
export enum FactType {
  CHARACTER_DETAIL = "character_detail",
  RELATIONSHIP = "relationship",
  BACKSTORY = "backstory",
  PLOT_EVENT = "plot_event",
  FORESHADOWING = "foreshadowing",
  WORLD_RULE = "world_rule",
}
export const FACT_TYPE_VALUES = Object.values(FactType) as [FactType, ...FactType[]];

/** 叙事权重。参见 PRD §3.6。 */
export enum NarrativeWeight {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}
export const NARRATIVE_WEIGHT_VALUES = Object.values(NarrativeWeight) as [NarrativeWeight, ...NarrativeWeight[]];

/** 事实来源。参见 PRD §3.6。 */
export enum FactSource {
  MANUAL = "manual",
  EXTRACT_AUTO = "extract_auto",
  IMPORT_AUTO = "import_auto",
}
export const FACT_SOURCE_VALUES = Object.values(FactSource) as [FactSource, ...FactSource[]];

/** LLM 运行模式。参见 PRD §3.3。 */
export enum LLMMode {
  API = "api",
  LOCAL = "local",
  OLLAMA = "ollama",
}

/** 向量索引状态。参见 PRD §3.5。 */
export enum IndexStatus {
  READY = "ready",
  STALE = "stale",
  REBUILDING = "rebuilding",
  INTERRUPTED = "interrupted",
}

/** 叙事人称。参见 PRD §3.4。 */
export enum Perspective {
  THIRD_PERSON = "third_person",
  FIRST_PERSON = "first_person",
}

/** 情感表达风格。参见 PRD §3.4。 */
export enum EmotionStyle {
  IMPLICIT = "implicit",
  EXPLICIT = "explicit",
}

/** 许可证等级。参见 PRD §3.3。 */
export enum LicenseTier {
  FREE = "free",
  PRO = "pro",
}

/** API 模式。参见 PRD §3.3。 */
export enum APIMode {
  SELF_HOSTED = "self_hosted",
  MANAGED = "managed",
}

/** 章节来源标记。 */
export enum Provenance {
  AI = "ai",
  MANUAL = "manual",
  MIXED = "mixed",
  IMPORTED = "imported",
}

/** 操作日志类型。参见 PRD §2.6.5。 */
export enum OpType {
  CONFIRM_CHAPTER = "confirm_chapter",
  UNDO_CHAPTER = "undo_chapter",
  IMPORT_PROJECT = "import_project",
  ADD_FACT = "add_fact",
  EDIT_FACT = "edit_fact",
  UPDATE_FACT_STATUS = "update_fact_status",
  SET_CHAPTER_FOCUS = "set_chapter_focus",
  RESOLVE_DIRTY_CHAPTER = "resolve_dirty_chapter",
  REBUILD_INDEX = "rebuild_index",
  RECALC_GLOBAL_STATE = "recalc_global_state",
  UPDATE_PINNED = "update_pinned",
}
