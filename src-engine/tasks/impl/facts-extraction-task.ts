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

// ---------------------------------------------------------------------------
// Params & Result
// ---------------------------------------------------------------------------

export interface FactsExtractionParams {
  auPath: string;
  fromChapter: number;
  toChapter: number;
  batchSize: number;
  language: string;
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
  extractedSoFar?: ExtractedFact[]; // 仅 resume 兼容旧 checkpoint 用
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
  },
): TaskDefinition<FactsExtractionParams, FactsExtractionResult> {
  const { chapterRepo, factRepo, projectRepo, llmProvider } = deps;

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
    const { extract_facts_batch } = await import("../../services/facts_extraction.js");

    const { auPath, fromChapter, toChapter, batchSize, language } = p;
    const totalChapters = toChapter - fromChapter + 1;
    const allFacts: ExtractedFact[] = [...previousFacts];

    // 读取项目和已有 facts
    const proj = await projectRepo.get(auPath);
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

      // 调用 LLM 批量提取
      const batchFacts = await extract_facts_batch(
        chapters, existingFacts, proj.cast_registry, null,
        llmProvider, language, ctx.signal,
      ).catch(() => [] as ExtractedFact[]);

      allFacts.push(...batchFacts);
      done += chapters.length;

      yield { type: "progress", current: done, total: totalChapters, message: `${done}/${totalChapters}` };
      yield { type: "chunk_done", chunkId: `batch_${batchStart}_${batchEnd}` };

      // 写 checkpoint（每批一次，只存进度游标，不序列化全量 facts）
      await ctx.saveCheckpoint({
        completedUpTo: batchEnd,
      } satisfies FactsCheckpointData);
    }

    return { facts: allFacts, totalExtracted: allFacts.length };
  }
}
