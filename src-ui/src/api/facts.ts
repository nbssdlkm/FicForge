// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/** Facts API */

import { FactType, NarrativeWeight } from "@ficforge/engine";

// 注：本文件不定义 FactInfo。UI 用的 FactInfo 真相源 = engine-client.ts 的
// `export type { Fact as FactInfo } from "@ficforge/engine"`（引擎完整 Fact，含全部富化字段）。
// 此处曾有一个 10 字段的窄版影子 interface（无人 import 的死类型），因其长得极像"该扩展的地方"
// 而屡次误导实施者，M3 批一删除（实施前调查·第一路发现附录①）。

export interface ExtractedFactCandidate {
  content_raw: string;
  content_clean: string;
  characters: string[];
  fact_type?: string;
  type?: string;
  narrative_weight: string;
  status: string;
  chapter: number;
  timeline?: string;
  // M8-A 富化 + 因果（提取已产出、运行时挂在候选对象上）。此前 UI 类型不声明 → 确认提取的
  // addFact 取不到 → 落库前丢（M9 spec §3.2 / 双审 BLOCKER）。声明出来才能转发。
  location?: string | null;
  story_time_tag?: string | null;
  story_time_order?: number | null;
  time_kind?: string | null;
  action_verb?: string | null;
  caused_by?: string[];
  known_to?: "all" | "reader_only" | string[] | null;
  hidden_from?: string[];
  suspense_type?: string | null;
  _confidence?: unknown; // 引擎侧 FactFieldConfidence；UI 不解释、只透传给 addFact，故用 unknown
  thread_ids?: string[]; // M8-B/M9：提取暂不产出，M9 自动挂线后经此转发（present 才带）
}

export interface ExtractFactsResponse {
  facts: ExtractedFactCandidate[];
}

/**
 * 「提取候选 → 事实入库 payload」的单一映射（盲审 2026-07-11 重复维：此前在
 * DirtyModal / useWriterFactsExtraction / useFactsExtraction / engine-chapters 四处
 * 手写并已实际漂移 —— DirtyModal 缺 content_raw 兜底、timeline 落空串）。
 * 兜底口径：content_raw 为空回退 content_clean；timeline 无值不带键。
 */
export function buildFactDataFromCandidate(c: ExtractedFactCandidate): Record<string, unknown> {
  return {
    content_raw: c.content_raw || c.content_clean,
    content_clean: c.content_clean,
    type: c.fact_type || c.type || FactType.PLOT_EVENT,
    narrative_weight: c.narrative_weight || NarrativeWeight.MEDIUM,
    status: c.status || "active",
    characters: c.characters || [],
    ...(c.timeline ? { timeline: c.timeline } : {}),
    ...extractedEnrichment(c), // caused_by + M8-A 富化
  };
}

/**
 * 从提取候选里抽出「确认落库时该一并带上」的富化/因果字段，供 addFact spread。
 * 单一真相源：三处确认路径（writer / FactsPage / DirtyModal）都用它，避免各自手维字段清单漂移。
 * 仅带「有值」的键（null/空数组/undefined 跳过），保持 addFact payload 干净。
 */
export function extractedEnrichment(c: ExtractedFactCandidate): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (c.location != null) out.location = c.location;
  if (c.story_time_tag != null) out.story_time_tag = c.story_time_tag;
  // known_to 用 != null 判据（与 hidden_from 的 length 判据不对称）是有意的：'all'/'reader_only'
  // 字符串态必须过；[] 空数组过了也无害 —— 引擎 addFact 的消毒器（domain/fact_sanitize）会把
  // [] 折叠为 null，落库口径单一，UI 不重复消毒（M3 批一）。
  if (typeof c.story_time_order === "number") out.story_time_order = c.story_time_order;
  if (c.time_kind != null) out.time_kind = c.time_kind;
  if (c.action_verb != null) out.action_verb = c.action_verb;
  if (c.caused_by?.length) out.caused_by = c.caused_by;
  if (c.known_to != null) out.known_to = c.known_to;
  if (c.hidden_from?.length) out.hidden_from = c.hidden_from;
  if (c.suspense_type != null) out.suspense_type = c.suspense_type;
  if (c._confidence != null) out._confidence = c._confidence;
  if (c.thread_ids?.length) out.thread_ids = c.thread_ids;
  return out;
}
