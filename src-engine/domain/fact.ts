// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 事实领域对象。参见 PRD §3.6 facts.jsonl 字段定义。 */

import { FactSource, FactStatus, FactType, NarrativeWeight, type TimeKind, type SuspenseType } from "./enums.js";

export interface Fact {
  id: string; // 格式: f_{时间戳}_{4位随机}
  content_raw: string; // 带章节编号，用于管理和追溯
  content_clean: string; // 纯叙事描述，注入 prompt 时使用
  characters: string[]; // 涉及角色
  timeline: string; // 所属时间线标签
  story_time: string; // 故事内时间（可选）
  chapter: number; // 产生于第几章
  status: FactStatus;
  type: FactType;
  resolves: string | null; // 被解决的 fact id
  narrative_weight: NarrativeWeight;
  source: FactSource; // Phase 1 写入，Phase 2 消费
  revision: number; // 每次编辑 +1
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601

  // ---------- Layer 2: 叙事定位（M8-A）----------
  location?: string | null; // 场景地点（如"御书房"）
  story_time_tag?: string | null; // 人类可读时间标签（如"Y1 冬末"）
  story_time_order?: number | null; // 机器排序整数（叙事内时序，与 timeline 正交）
  time_kind?: TimeKind | null; // 叙事时间种类
  action_verb?: string | null; // 核心动作一词（如"决裂"）
  caused_by?: string[]; // 直接因果的 fact_id 列表

  // ---------- Layer 3: 信息不对称（M8-A；thread 字段留位不实现）----------
  known_to?: "all" | "reader_only" | string[] | null; // 谁知道这件事
  hidden_from?: string[]; // 明确不知情的角色
  suspense_type?: SuspenseType | null; // 悬念类型
  thread_ids?: string[]; // 【留位，M8-B 实现】故事线 ID 列表
  thread_roles?: Record<string, string>; // 【留位，M8-B 实现】故事线角色

  // ---------- 置信度旁路（M8-A）----------
  _confidence?: FactFieldConfidence; // per-field LLM 置信度，非叙事内容不注入 prompt

  // ---------- 冷热分层（M10-B）----------
  archived?: boolean; // 冷 fact 标志；默认 false；undefined 视同 false（向后兼容）
  archived_at?: string; // ISO 8601；仅 archived=true 时写入
}

/**
 * 该 fact 是否为「冷」（M10-B 冷热分层已归档）。archived=true 即冷；旧 fact 无 archived
 * 字段时 undefined → 非冷（向后兼容）。单一真相源：所有「排除已归档 fact」的判据都走此谓词，
 * 避免 `f.archived === true` / `!== true` 散落在生成各读路径而漂移（审计⑥）。
 */
export function isColdFact(f: Pick<Fact, "archived">): boolean {
  return f.archived === true;
}

export type ConfidenceLevel = "high" | "medium" | "low";

/** LLM 对每个新字段的置信度。字段不存在 = 未生成（等同 null 字段未评估）。 */
export interface FactFieldConfidence {
  location?: ConfidenceLevel;
  story_time_tag?: ConfidenceLevel;
  story_time_order?: ConfidenceLevel;
  time_kind?: ConfidenceLevel;
  action_verb?: ConfidenceLevel;
  caused_by?: ConfidenceLevel;
  known_to?: ConfidenceLevel;
  hidden_from?: ConfidenceLevel;
  suspense_type?: ConfidenceLevel;
}

export function createFact(partial: Pick<Fact, "id" | "content_raw" | "content_clean"> & Partial<Fact>): Fact {
  return {
    characters: [],
    timeline: "",
    story_time: "",
    chapter: 0,
    status: FactStatus.ACTIVE,
    type: FactType.PLOT_EVENT,
    resolves: null,
    narrative_weight: NarrativeWeight.MEDIUM,
    source: FactSource.MANUAL,
    revision: 1,
    created_at: "",
    updated_at: "",
    archived: false, // M10-B: default false; undefined on old facts treated as false
    ...partial,
  };
}
