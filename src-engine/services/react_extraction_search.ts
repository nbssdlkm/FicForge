// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * M9 search_existing_facts 工具执行。纯函数：对「已加载的事实数组」做本地关键词 +
 * 角色过滤，返回精简结果（只带 search 相关字段，不泄露完整 Fact）。
 *
 * dispatch 在 loop 开始时一次性 fact_repo.list_all() 拿全量，之后每次 search 都过这个
 * 数组（避免每次 search 打 repo —— spec R5 性能）。跨章因果只看「更早章节」的事实
 * （chapter < current），同章正在提取的事实还没 fact_id，无从引用。
 */

import type { Fact } from "../domain/fact.js";

/** search 返回给 LLM 的精简事实（足够它选 fact_id 建因果，不含敏感全字段）。 */
export interface FactSearchHit {
  fact_id: string;
  content_clean: string;
  characters: string[];
  chapter: number;
}

export interface SearchExistingFactsArgs {
  query: string;
  characters?: string[];
  limit?: number;
}

const DEFAULT_SEARCH_LIMIT = 10;

function lc(s: string): string {
  return s.toLowerCase();
}

/**
 * @param allFacts       已加载的全量事实（dispatch 一次性 list_all 得到）
 * @param args           LLM 给的 search 参数
 * @param currentChapter 当前正在提取的章号；只检索 chapter < currentChapter 的事实
 */
export function executeSearchExistingFacts(
  allFacts: Fact[],
  args: SearchExistingFactsArgs,
  currentChapter: number,
): FactSearchHit[] {
  const query = (args.query ?? "").trim();
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_SEARCH_LIMIT, 1), 20);
  const filterChars = (args.characters ?? []).map(lc).filter((c) => c.length > 0);
  const q = lc(query);

  const hits: FactSearchHit[] = [];
  for (const f of allFacts) {
    // 跨章窗口：只看更早章节（同章/未来章无可引用的真实 fact_id）
    if (typeof f.chapter === "number" && f.chapter >= currentChapter) continue;

    const factChars = (f.characters ?? []).map(lc);

    // 角色过滤（提供了才过）：fact.characters 与 filterChars 有交集
    if (filterChars.length > 0) {
      const hasOverlap = filterChars.some((c) => factChars.some((fc) => fc.includes(c) || c.includes(fc)));
      if (!hasOverlap) continue;
    }

    // 关键词匹配：content_clean 含 query，或 query 命中任一角色名。空 query 视为全匹配。
    if (q.length > 0) {
      const inContent = lc(f.content_clean ?? "").includes(q);
      const inChars = factChars.some((fc) => fc.includes(q) || q.includes(fc));
      if (!inContent && !inChars) continue;
    }

    hits.push({
      fact_id: f.id,
      content_clean: f.content_clean,
      characters: f.characters ?? [],
      chapter: f.chapter,
    });
    if (hits.length >= limit) break;
  }

  return hits;
}
