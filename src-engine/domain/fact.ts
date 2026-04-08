// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 事实领域对象。参见 PRD §3.6 facts.jsonl 字段定义。 */

import { FactSource, FactStatus, FactType, NarrativeWeight } from "./enums.js";

export interface Fact {
  id: string;                                        // 格式: f_{时间戳}_{4位随机}
  content_raw: string;                               // 带章节编号，用于管理和追溯
  content_clean: string;                             // 纯叙事描述，注入 prompt 时使用
  characters: string[];                              // 涉及角色
  timeline: string;                                  // 所属时间线标签
  story_time: string;                                // 故事内时间（可选）
  chapter: number;                                   // 产生于第几章
  status: FactStatus;
  type: FactType;
  resolves: string | null;                           // 被解决的 fact id
  narrative_weight: NarrativeWeight;
  source: FactSource;                                // Phase 1 写入，Phase 2 消费
  revision: number;                                  // 每次编辑 +1
  created_at: string;                                // ISO 8601
  updated_at: string;                                // ISO 8601
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
    ...partial,
  };
}
