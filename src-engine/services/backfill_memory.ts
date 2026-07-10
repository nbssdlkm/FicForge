// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 补全旧章记忆（plan 3.1）—— 逐章统一 pass。
 *
 * 给「缺记忆的旧章」一章一章补：章节摘要、剧情笔记（连带剧情线挂接）、向量索引。
 * 本模块只负责 **编排循环**（中断 / 半成功 / 进度 / 计数）；慢 LLM（摘要生成、笔记提取）
 * 与落盘（摘要 persist+索引、笔记 save、正文 index）都由调用方经回调注入：
 *  - generateSummary / extractFacts 在 **锁外** 跑（慢），
 *  - persistChapter 在调用方的 **AU 锁内** 做 content_hash CAS 后落盘，
 * 与 `backfill_chapter_summaries` 同款「慢生成锁外 + CAS 落盘锁内」语义。
 */

import { logCatch } from "../logger/index.js";
import { isAbortError } from "../utils/abort_error.js";


export interface BackfillMemoryTarget {
  chapterNum: number;
  content: string;       // 章节正文（去 frontmatter，= confirm 喂 LLM 同款）
  contentHash: string;   // 章节 content_hash，供 CAS 校验「跑的过程中章节没被改」
  needSummary: boolean;  // 该章缺 standard 摘要
  extractFacts: boolean; // 该章在用户勾选的提取集
}

export interface BackfillMemoryDeps {
  targets: BackfillMemoryTarget[];
  signal?: AbortSignal;
  /** 慢 LLM，锁外。返回 null = 生成降级（不落摘要，但仍可落笔记/索引）。仅 needSummary 时调用。 */
  generateSummary: (target: BackfillMemoryTarget) => Promise<string | null>;
  /**
   * 慢 LLM，锁外。返回该章提取出的笔记候选（对本模块不透明，原样回传 persistChapter）+
   * cappedCount（L16：因 REACT_MAX_FACTS_PER_CHAPTER 软上限被丢弃的条数，供结果汇总提示用户）。
   * 仅 extractFacts 时调用。
   */
  extractFacts: (target: BackfillMemoryTarget) => Promise<{ facts: unknown[]; cappedCount: number }>;
  /**
   * 锁内 CAS 落盘：重查 content_hash 未变才落（摘要 persist+索引、笔记 save、正文 index）。
   * 返回 persisted=false 表示章节中途被 edit/undo（hash 不符或已删）→ 跳过，不写陈旧数据。
   * factsAdded = 本章实际落库的笔记条数。
   */
  persistChapter: (
    target: BackfillMemoryTarget,
    payload: { summaryText: string | null; facts: unknown[] },
  ) => Promise<{ persisted: boolean; factsAdded: number }>;
  onProgress?: (info: { done: number; total: number; chapterNum: number; ok: boolean }) => void;
}

export interface BackfillMemoryResult {
  total: number;              // 待处理章数
  summariesGenerated: number; // 成功生成且落盘的摘要数
  factsChapters: number;      // 成功落盘 ≥1 条新笔记的章数
  factsAdded: number;         // 落库的笔记总条数
  indexed: number;            // 成功落盘（正文进索引）的章数 = persisted 数
  skipped: number;            // CAS 拒绝（章节中途被改/删）
  failed: number;             // 生成 / 提取 / 落盘抛错（已记录，不中断整批）
  aborted: boolean;           // 用户中途停止（已补的保留）
  factsOverCapCount: number;  // L16：react 提取因 8 条软上限被丢弃的笔记总数（跨已落盘的章累计）
}

/**
 * 逐章补记忆。每章独立 try/catch，单章失败不拖垮整批（CLAUDE.md 半成功处理）。
 *
 * 中断语义（审计⑨）：signal 透传给慢回调（generateSummary/extractFacts），用户点停时在飞的
 * 当前章 LLM 请求被立刻取消（不再空跑到完成，省时省 token）。三处查 signal —— 每章开头、慢回调
 * 之后、回调抛错时：中断则「干净停止」（当前章未落盘，不计 failed / 不标 STALE，下次 backfill
 * 再补），已补全部保留。慢回调因取消抛 AbortError 或提前返回空，两种情形都按中断处理、不误记 failed。
 */
export async function backfill_chapter_memory(deps: BackfillMemoryDeps): Promise<BackfillMemoryResult> {
  const total = deps.targets.length;
  let summariesGenerated = 0;
  let factsChapters = 0;
  let factsAdded = 0;
  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  let factsOverCapCount = 0;

  const result = (aborted: boolean): BackfillMemoryResult =>
    ({ total, summariesGenerated, factsChapters, factsAdded, indexed, skipped, failed, aborted, factsOverCapCount });

  for (let i = 0; i < total; i++) {
    if (deps.signal?.aborted) return result(true);
    const target = deps.targets[i];
    let ok = false;
    try {
      const summaryText = target.needSummary ? await deps.generateSummary(target) : null;
      const extracted = target.extractFacts ? await deps.extractFacts(target) : { facts: [], cappedCount: 0 };
      const facts = extracted.facts;
      // 慢回调期间用户点停（回调可能提前返回空而非抛错）→ 不落该章未完成的生成/提取，干净停止。
      if (deps.signal?.aborted) return result(true);
      const r = await deps.persistChapter(target, { summaryText, facts });
      if (r.persisted) {
        ok = true;
        indexed++;
        if (summaryText) summariesGenerated++;
        factsAdded += r.factsAdded;
        if (r.factsAdded > 0) factsChapters++;
        // L16：仅在该章真正落盘时累计软上限丢弃数（skipped/CAS 拒绝的章其提取未生效，不计）。
        factsOverCapCount += extracted.cappedCount;
      } else {
        skipped++; // 章节中途被改/删，CAS 拒绝 → 不落陈旧数据
      }
    } catch (err) {
      // 只认「错误本身是 AbortError」才当干净停止（不计 failed）—— 不能用 deps.signal.aborted 判断：
      // persist 阶段的真失败（indexChapter/落盘 IO 抛错）若恰逢用户点停，signal.aborted 已置位，
      // 用 signal 判断会把真失败误吞成干净停止、丢 failed 计数且遗留悬空 STALE（对抗审 MEDIUM）。
      // 注：三条慢回调 abort 时都返回空/降级而非抛错（走上面的 signal 检查分支），故此支实际只拦真 AbortError。
      if (isAbortError(err)) return result(true);
      logCatch("backfill_memory", `Backfill memory failed for chapter ${target.chapterNum}`, err);
      failed++;
    }
    deps.onProgress?.({ done: i + 1, total, chapterNum: target.chapterNum, ok });
  }

  return result(false);
}
