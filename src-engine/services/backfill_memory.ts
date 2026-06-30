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
  /** 慢 LLM，锁外。返回该章提取出的笔记候选（对本模块不透明，原样回传 persistChapter）。仅 extractFacts 时调用。 */
  extractFacts: (target: BackfillMemoryTarget) => Promise<unknown[]>;
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
}

/**
 * 逐章补记忆。每章独立 try/catch，单章失败不拖垮整批（CLAUDE.md 半成功处理）。
 *
 * 中断语义：每章开头查 signal → 立即停（当前章已开跑的让它跑完，下一章不再起），已补全部保留。
 * 不把 signal 传给慢回调 —— 在章边界停更干净，避免把「中途取消」误记成 failed。
 */
export async function backfill_chapter_memory(deps: BackfillMemoryDeps): Promise<BackfillMemoryResult> {
  const total = deps.targets.length;
  let summariesGenerated = 0;
  let factsChapters = 0;
  let factsAdded = 0;
  let indexed = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < total; i++) {
    if (deps.signal?.aborted) {
      return { total, summariesGenerated, factsChapters, factsAdded, indexed, skipped, failed, aborted: true };
    }
    const target = deps.targets[i];
    let ok = false;
    try {
      const summaryText = target.needSummary ? await deps.generateSummary(target) : null;
      const facts = target.extractFacts ? await deps.extractFacts(target) : [];
      const r = await deps.persistChapter(target, { summaryText, facts });
      if (r.persisted) {
        ok = true;
        indexed++;
        if (summaryText) summariesGenerated++;
        factsAdded += r.factsAdded;
        if (r.factsAdded > 0) factsChapters++;
      } else {
        skipped++; // 章节中途被改/删，CAS 拒绝 → 不落陈旧数据
      }
    } catch (err) {
      logCatch("backfill_memory", `Backfill memory failed for chapter ${target.chapterNum}`, err);
      failed++;
    }
    deps.onProgress?.({ done: i + 1, total, chapterNum: target.chapterNum, ok });
  }

  return { total, summariesGenerated, factsChapters, factsAdded, indexed, skipped, failed, aborted: false };
}
