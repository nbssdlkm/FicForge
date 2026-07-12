// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 后台任务实现 — 批量笔记提取。
 *
 * 3 章一批调用 LLM，每批完成后 yield progress + 写 checkpoint。
 * 支持断点续传：resume 时跳过已完成的批次。
 */

import type { TaskDefinition, TaskContext, TaskEvent, TaskCheckpoint } from "../types.js";
import type { ExtractedFact } from "../../services/facts_extraction.js";
import type { LLMProvider } from "../../llm/provider.js";
import type { ChapterRepository } from "../../repositories/interfaces/chapter.js";
import type { FactRepository } from "../../repositories/interfaces/fact.js";
import type { ProjectRepository } from "../../repositories/interfaces/project.js";
import type { ThreadRepository } from "../../repositories/interfaces/thread.js";

// ---------------------------------------------------------------------------
// Params & Result
// ---------------------------------------------------------------------------

export interface FactsExtractionParams {
  auPath: string;
  fromChapter: number;
  toChapter: number;
  batchSize: number;
  language: string;
  /** M9：开启则批量路径也走 ReAct 提取（逐章），产出跨章 caused_by + 自动挂剧情线。默认 false（兼容旧行为）。 */
  reactExtractionEnabled?: boolean;
}

export interface FactsExtractionResult {
  facts: ExtractedFact[];
  totalExtracted: number;
}

// ---------------------------------------------------------------------------
// Checkpoint data
// ---------------------------------------------------------------------------

interface FactsCheckpointData {
  completedUpTo: number; // 已完成到哪一章（含）
  extractedSoFar: ExtractedFact[];
}

// ---------------------------------------------------------------------------
// Task Definition
// ---------------------------------------------------------------------------

export function createFactsExtractionTask(
  params: FactsExtractionParams,
  deps: {
    chapterRepo: ChapterRepository;
    factRepo: FactRepository;
    projectRepo: ProjectRepository;
    llmProvider: LLMProvider;
    /** M9：reactExtractionEnabled 时用于自动挂剧情线（不传则 thread_ids 为空）。 */
    threadRepo?: ThreadRepository;
    /** 角色别名归一化表（提交时快照）：进提取 prompt +归一化提取结果；不传 = 不归一化。 */
    characterAliases?: Record<string, string[]> | null;
  },
): TaskDefinition<FactsExtractionParams, FactsExtractionResult> {
  const { chapterRepo, factRepo, projectRepo, llmProvider, threadRepo, characterAliases = null } = deps;

  return {
    type: "facts_extraction",
    params,

    async *execute(ctx: TaskContext): AsyncGenerator<TaskEvent, FactsExtractionResult> {
      return yield* run(ctx, params, 0, []);
    },

    async *resume(ctx: TaskContext, checkpoint: TaskCheckpoint): AsyncGenerator<TaskEvent, FactsExtractionResult> {
      const data = checkpoint.data as FactsCheckpointData;
      return yield* run(ctx, params, data.completedUpTo, data.extractedSoFar ?? []);
    },
  };

  async function* run(
    ctx: TaskContext,
    p: FactsExtractionParams,
    completedUpTo: number,
    previousFacts: ExtractedFact[],
  ): AsyncGenerator<TaskEvent, FactsExtractionResult> {
    // Lazy import to avoid circular deps
    const { extractFactsBatch } = await import("../../services/facts_extraction.js");
    const { reactExtractFromChapter } = await import("../../services/react_extraction_dispatch.js");

    const { auPath, fromChapter, toChapter, batchSize, language, reactExtractionEnabled } = p;
    const totalChapters = toChapter - fromChapter + 1;
    const allFacts: ExtractedFact[] = [...previousFacts];

    // 读取项目和已有 facts（project.yaml 缺失 = AU 结构损坏，提取无法继续）
    const proj = await projectRepo.get(auPath);
    if (!proj) throw new Error(`project.yaml not found: ${auPath}`);
    const existingFacts = await factRepo.list_all(auPath);

    // 计算起始点（断点续传时跳过已完成的）
    const startFrom = completedUpTo > 0 ? completedUpTo + 1 : fromChapter;

    // 计算已完成的章数（用于进度）
    let done = completedUpTo > 0 ? completedUpTo - fromChapter + 1 : 0;
    yield { type: "progress", current: done, total: totalChapters };

    for (let batchStart = startFrom; batchStart <= toChapter; batchStart += batchSize) {
      if (ctx.signal.aborted) break;

      // 收集这一批的章节内容（并行读取）
      const batchEnd = Math.min(batchStart + batchSize - 1, toChapter);
      const chapterNums = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i);
      const contents = await Promise.all(
        chapterNums.map((ch) => chapterRepo.get_content_only(auPath, ch)),
      );
      const chapters = chapterNums.map((ch, i) => ({ chapter_num: ch, content: contents[i] }));

      if (ctx.signal.aborted) break;

      if (reactExtractionEnabled) {
        // M9：逐章跑 ReAct（产 caused_by + thread_ids）。某章 degraded&空 → 回退该章单次调用兜底。
        for (const { chapter_num, content } of chapters) {
          if (ctx.signal.aborted) break;
          const r = await reactExtractFromChapter(
            content, chapter_num, existingFacts, proj.cast_registry, characterAliases, llmProvider,
            { language: language as "zh" | "en", factRepo, threadRepo, auPath, signal: ctx.signal },
          ).catch(() => ({ facts: [] as ExtractedFact[], status: "degraded" as const }));
          if (r.status === "degraded" && r.facts.length === 0) {
            const single = await extractFactsBatch(
              [{ chapter_num, content }], existingFacts, proj.cast_registry, characterAliases,
              llmProvider, language, ctx.signal,
            ).catch(() => [] as ExtractedFact[]);
            allFacts.push(...single);
          } else {
            allFacts.push(...r.facts);
          }
        }
      } else {
        // 原批量单次调用路径
        const batchFacts = await extractFactsBatch(
          chapters, existingFacts, proj.cast_registry, characterAliases,
          llmProvider, language, ctx.signal,
        ).catch(() => [] as ExtractedFact[]);
        allFacts.push(...batchFacts);
      }
      done += chapters.length;

      yield { type: "progress", current: done, total: totalChapters, message: `${done}/${totalChapters}` };
      yield { type: "chunk_done", chunkId: `batch_${batchStart}_${batchEnd}` };

      // 写 checkpoint（每批一次，含已提取 facts 以支持断点续传后用户选择）
      await ctx.saveCheckpoint({
        completedUpTo: batchEnd,
        extractedSoFar: allFacts,
      } satisfies FactsCheckpointData);
    }

    return { facts: allFacts, totalExtracted: allFacts.length };
  }
}
