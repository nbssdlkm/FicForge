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

/** 章节来源标记。 */
export enum Provenance {
  AI = "ai",
  MANUAL = "manual",
  MIXED = "mixed",
  IMPORTED = "imported",
}

/** 叙事时间种类（M8-A）。 */
export enum TimeKind {
  NORMAL = "normal", // 正常叙事时序
  FLASHBACK = "flashback", // 闪回
  INSERT = "insert", // 插叙（非闪回的非线性片段）
  DREAM = "dream", // 梦境/幻觉
  PARALLEL = "parallel", // 平行时间线
  IMAGINED = "imagined", // 想象/假设
}
export const TIME_KIND_VALUES = Object.values(TimeKind) as [TimeKind, ...TimeKind[]];

/** 悬念类型（M8-A）。 */
export enum SuspenseType {
  FORESHADOW = "foreshadow", // 铺垫/预示
  SECRET = "secret", // 秘密（读者已知角色不知）
  MISUNDERSTANDING = "misunderstanding", // 误解
  SETUP = "setup", // 铺设（待 payoff 的前置条件）
}
export const SUSPENSE_TYPE_VALUES = Object.values(SuspenseType) as [SuspenseType, ...SuspenseType[]];

/** 剧情线状态（M8-B）。 */
export enum ThreadStatus {
  ACTIVE = "active", // 进行中的剧情线（注入续写上下文）
  RESOLVED = "resolved", // 已收束
  DORMANT = "dormant", // 暂时搁置
}
export const THREAD_STATUS_VALUES = Object.values(ThreadStatus) as [ThreadStatus, ...ThreadStatus[]];

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
  ARCHIVE_FACT = "archive_fact", // M10-B: 冷 fact 固化
  UNARCHIVE_FACT = "unarchive_fact", // M10-B: 冷 fact 解除固化
}
