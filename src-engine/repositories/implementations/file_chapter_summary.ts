// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Chapter Summary 文件读写（M8-C）。
 * 存储于 chapters/main/ch{NNNN}.summary.jsonl —— 单个 JSON 对象，每章一条。
 */

import type { PlatformAdapter } from "../../platform/adapter.js";
import type { ChapterSummary, SummaryTier } from "../../domain/chapter_summary.js";
import { createChapterSummary } from "../../domain/chapter_summary.js";
import type { ChapterSummaryRepository } from "../interfaces/chapter_summary.js";
import { atomicWrite, joinPath, now_utc } from "./file_utils.js";

/** ch{NNNN}.summary.jsonl 路径。NNNN 为 4 位零填充章节号。 */
export function summaryPath(auPath: string, chapterNum: number): string {
  const padded = String(chapterNum).padStart(4, "0");
  return joinPath(auPath, "chapters", "main", `ch${padded}.summary.jsonl`);
}

export class FileChapterSummaryRepository implements ChapterSummaryRepository {
  constructor(private adapter: PlatformAdapter) {}

  async get(auPath: string, chapterNum: number): Promise<ChapterSummary | null> {
    const path = summaryPath(auPath, chapterNum);
    if (!(await this.adapter.exists(path))) return null;
    try {
      const raw = JSON.parse(await this.adapter.readFile(path)) as Partial<ChapterSummary>;
      return createChapterSummary(raw);
    } catch {
      // 损坏文件按"无摘要"处理（决策②降级精神）
      return null;
    }
  }

  async save(auPath: string, chapterNum: number, summary: ChapterSummary): Promise<void> {
    const path = summaryPath(auPath, chapterNum);
    const dir = path.substring(0, path.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    // 摘要是 LLM 生成成本换来的数据、损坏按「无摘要」静默降级（get 的 catch）——
    // 截断不会报错但会丢层级，原子写防固化（审计 H5）
    await atomicWrite(this.adapter, path, JSON.stringify(summary, null, 2));
  }

  async remove(auPath: string, chapterNum: number): Promise<void> {
    const path = summaryPath(auPath, chapterNum);
    if (await this.adapter.exists(path)) await this.adapter.deleteFile(path);
  }

  /** 读取现有摘要（或空初始），合并写入 micro 键。幂等（后者覆盖）。 */
  async update_micro(auPath: string, chapterNum: number, text: string, hash: string): Promise<void> {
    const existing = (await this.get(auPath, chapterNum)) ?? createChapterSummary({});
    const micro: SummaryTier = {
      version: 1,
      text,
      generated_at: now_utc(),
      source_chapter_hash: hash,
    };
    const updated: ChapterSummary = {
      ...existing,
      micro,
    };
    await this.save(auPath, chapterNum, updated);
  }

  /**
   * 将 standard 备份为 standard_v1（已有 standard_v1 时不覆盖），写入新 standard（version:2）。
   * 若当前无 standard，仅写入新 standard，不创建 standard_v1。
   */
  async promote_to_v2(auPath: string, chapterNum: number, v2Text: string, hash: string): Promise<void> {
    const existing = (await this.get(auPath, chapterNum)) ?? createChapterSummary({});
    const newStandard: SummaryTier = {
      version: 2,
      text: v2Text,
      generated_at: now_utc(),
      source_chapter_hash: hash,
    };
    // Backup v1: preserve existing standard as standard_v1 only if no backup yet
    const newStandardV1 = existing.standard_v1 ?? (existing.standard ?? undefined);
    const updated: ChapterSummary = {
      ...existing,
      standard: newStandard,
      ...(newStandardV1 !== undefined ? { standard_v1: newStandardV1 } : {}),
    };
    await this.save(auPath, chapterNum, updated);
  }
}
