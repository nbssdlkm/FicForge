// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Fact 字段消毒 —— known_to / hidden_from / _confidence 的**单一真相源**判据（M3 批一）。
 *
 * 为什么放 domain：写路径（services/facts_lifecycle 的 addFact/editFact、
 * services/facts_extraction 的 rawToExtracted）与 ops 回放（ops/ops_projection 的
 * rebuildFactsFromOps）必须共用同一份判据，否则灾难恢复重建结果与磁盘漂移
 * （ops_projection「与写路径对称」是成文契约）；ops 层只依赖 domain，故判据下沉至此。
 *
 * 返回值约定：`{ ok: false }` = 形状非法（调用方按「拒绝 + warn + 不落库」处理，
 * 与 editFact 既有的枚举校验语义一致）；`{ ok: true, value }` = 已消毒可落库。
 */

import type { FactFieldConfidence, ConfidenceLevel } from "./fact.js";

// ---------------------------------------------------------------------------
// 别名归一化（大小写不敏感。LLM 输出和手动编辑都可能大小写不一致。）
// 原住 services/facts_lifecycle，随消毒判据一并下沉 domain（facts_lifecycle 保留 re-export）。
// ---------------------------------------------------------------------------

/**
 * 将角色名按别名表归一化为正式名。大小写不敏感。
 * 同时被 facts_lifecycle（手动编辑路径）和 facts_extraction（LLM 提取路径）使用。
 */
export function normalizeCharacters(
  characters: string[],
  character_aliases: Record<string, string[]> | null,
): string[] {
  if (!character_aliases || Object.keys(character_aliases).length === 0) {
    return characters;
  }

  const aliasMap = new Map<string, string>();
  for (const [mainName, aliases] of Object.entries(character_aliases)) {
    aliasMap.set(mainName.toLowerCase(), mainName);
    for (const alias of aliases) {
      aliasMap.set(alias.toLowerCase(), mainName);
    }
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const name of characters) {
    const main = aliasMap.get(name.toLowerCase()) ?? name;
    if (!seen.has(main)) {
      result.push(main);
      seen.add(main);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// known_to / hidden_from
// ---------------------------------------------------------------------------

export type SanitizeResult<T> = { ok: true; value: T } | { ok: false };

/** 名单公共清洗：只留字符串元素 → trim → 去空 → 别名归一化 → 去重。 */
function cleanNameList(raw: unknown[], aliases: Record<string, string[]> | null): string[] {
  const names = raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return [...new Set(normalizeCharacters(names, aliases))];
}

/**
 * known_to 消毒。口径：
 * - null/undefined → null（未标注）；
 * - "all" / "reader_only" → 原样；
 * - 其余非空字符串 → 折叠为单人名单（历史上 LLM 会吐裸角色名，语义即「仅此人知道」）；
 * - 数组 → 清洗名单；**空结果折叠为 null**（消除 [] 与 null 的双重「无信息」表示，
 *   注入端与 UI 对 [] 各自解释会漂移——第四路调查发现④）；
 * - 其它类型（数字/对象/布尔）→ 形状非法。
 */
export function sanitizeKnownTo(
  raw: unknown,
  aliases: Record<string, string[]> | null = null,
): SanitizeResult<"all" | "reader_only" | string[] | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === "string") {
    // 保留字识别在 trim 之后（对抗审 LOW-2：LLM 输出 " all " 带空白时不该被误当角色名）
    const t = raw.trim();
    if (t === "") return { ok: true, value: null };
    if (t === "all" || t === "reader_only") return { ok: true, value: t };
    return { ok: true, value: cleanNameList([t], aliases) };
  }
  if (Array.isArray(raw)) {
    const names = cleanNameList(raw, aliases);
    return { ok: true, value: names.length > 0 ? names : null };
  }
  return { ok: false };
}

/**
 * hidden_from 消毒。口径：
 * - null/undefined → []（domain 缺省即 []，「清空」与「未标注」同一表示）；
 * - 数组 → 清洗名单（可为 []）；
 * - 其它类型 → 形状非法。
 */
export function sanitizeHiddenFrom(
  raw: unknown,
  aliases: Record<string, string[]> | null = null,
): SanitizeResult<string[]> {
  if (raw === null || raw === undefined) return { ok: true, value: [] };
  if (Array.isArray(raw)) return { ok: true, value: cleanNameList(raw, aliases) };
  return { ok: false };
}

/**
 * 跨字段一致性（对抗审 MED-3）：known_to 与 hidden_from 的矛盾在写入口统一化解，
 * 不让「仅王爷知道；瞒着王爷」这类自相矛盾的标注进材料包指挥写作。规则：
 * - 同名同时出现在 known_to 名单与 hidden_from → **hidden_from 胜**（「明确不知情」是更强、
 *   通常更晚出现的信号），从 known_to 名单剔除；剔空 → null；
 * - known_to='all' 且 hidden_from 非空 → 'all' 退位为 null（「除X外都知道」的信息量
 *   已由 hidden_from 完整承载，'all' 本就不渲染）；
 * - known_to='reader_only' 与 hidden_from 并存不矛盾（角色全不知情，hidden_from 是子集强调），保留。
 * 消费点：addFact / rawToExtracted / editFact（知情字段被编辑时）。
 */
export function reconcileKnowledge(
  knownTo: "all" | "reader_only" | string[] | null,
  hiddenFrom: string[],
): { known_to: "all" | "reader_only" | string[] | null; hidden_from: string[] } {
  if (hiddenFrom.length === 0) return { known_to: knownTo, hidden_from: hiddenFrom };
  if (Array.isArray(knownTo)) {
    const filtered = knownTo.filter((n) => !hiddenFrom.includes(n));
    return { known_to: filtered.length > 0 ? filtered : null, hidden_from: hiddenFrom };
  }
  if (knownTo === "all") return { known_to: null, hidden_from: hiddenFrom };
  return { known_to: knownTo, hidden_from: hiddenFrom };
}

// ---------------------------------------------------------------------------
// _confidence
// ---------------------------------------------------------------------------

/** FactFieldConfidence 的键集（运行时可枚举版本；与 domain/fact.ts 接口保持一致）。 */
export const CONFIDENCE_FIELD_KEYS = [
  "location",
  "story_time_tag",
  "story_time_order",
  "time_kind",
  "action_verb",
  "caused_by",
  "known_to",
  "hidden_from",
  "suspense_type",
] as const satisfies readonly (keyof FactFieldConfidence)[];

const CONFIDENCE_LEVELS: ReadonlySet<string> = new Set(["high", "medium", "low"]);

/**
 * _confidence 消毒：plain object，且仅保留已知键 + 合法档位的条目；
 * 全部条目非法/为空 → value=undefined（与「无 _confidence」同表示，门控 `!c` 短路）。
 * 非对象/数组 → 形状非法。
 */
export function sanitizeConfidence(raw: unknown): SanitizeResult<FactFieldConfidence | undefined> {
  if (raw === null || raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false };
  const src = raw as Record<string, unknown>;
  const out: Partial<Record<keyof FactFieldConfidence, ConfidenceLevel>> = {};
  for (const key of CONFIDENCE_FIELD_KEYS) {
    const v = src[key];
    if (typeof v === "string" && CONFIDENCE_LEVELS.has(v)) {
      out[key] = v as ConfidenceLevel;
    }
  }
  return { ok: true, value: Object.keys(out).length > 0 ? (out as FactFieldConfidence) : undefined };
}
