// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import i18n from "../i18n";

function translateWithFallback(key: string, fallback: string): string {
  const value = i18n.t(key);
  return value === key ? fallback : value;
}

export function getEnumLabel(
  group: string,
  value: string | null | undefined,
  fallback = ""
): string {
  if (!value) return fallback;
  return translateWithFallback(`enums.${group}.${value}`, fallback || value);
}

// ---------------------------------------------------------------------------
// 知情范围 label（M3 批一）—— FactCard / 提取确认卡 / DirtyModal / ThreadDetail 共用的
// 单一真相源。口径与引擎注入端（build_fact_knowledge_clause）一致：
// null / 'all' / 空名单无信息量 → 返回 ""（调用方不渲染）。
// ---------------------------------------------------------------------------

function nameJoiner(): string {
  return i18n.language?.startsWith("zh") ? "、" : ", ";
}

// 参数类型放宽为 string（而非 "all"|"reader_only" 字面量）：兼容引擎消毒上线前
// 落盘的裸角色名等历史形态，运行时逐分支判别。
export function getKnownToLabel(
  knownTo: string | string[] | null | undefined,
): string {
  if (!knownTo || knownTo === "all") return "";
  if (knownTo === "reader_only") return i18n.t("enums.known_to.reader_only");
  if (Array.isArray(knownTo)) {
    const names = knownTo.filter((n) => typeof n === "string" && n.trim() !== "");
    if (names.length === 0) return "";
    return i18n.t("facts.knowledge.knownToSome", { names: names.join(nameJoiner()) });
  }
  // 历史脏数据：裸字符串按单人名单展示（引擎消毒上线前的存量磁盘形态）；
  // 非字符串垃圾（如数字 42，写侧校验上线前可能落盘）不渲染 —— 别出「仅42知道」这种章
  if (typeof knownTo !== "string" || knownTo.trim() === "") return "";
  return i18n.t("facts.knowledge.knownToSome", { names: knownTo.trim() });
}

export function getHiddenFromLabel(hiddenFrom: string[] | null | undefined): string {
  const names = (hiddenFrom ?? []).filter((n) => typeof n === "string" && n.trim() !== "");
  if (names.length === 0) return "";
  return i18n.t("facts.knowledge.hiddenFrom", { names: names.join(nameJoiner()) });
}

export function getOriginRefLabel(originRef: string | null | undefined): string {
  if (!originRef) return "";
  if (originRef === "original") {
    return i18n.t("enums.origin_ref.original");
  }
  if (originRef.startsWith("fandom/")) {
    return i18n.t("enums.origin_ref.fandom", {
      name: originRef.slice("fandom/".length),
    });
  }
  return originRef;
}
