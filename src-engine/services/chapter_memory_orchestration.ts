// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 确认 / 撤销章节的「记忆编排」层（M1 架构下沉，原住 UI api/engine-chapters.ts）。
 *
 * 核心 confirm/undo（confirm_chapter.ts / undo_chapter.ts）只管章节+state+ops 的事务；
 * 本模块在其上编排「记忆栈」的 best-effort 副作用 —— 标题生成、RAG 索引与 index_status
 * 门控、M8-C 章节摘要（standard+micro，双阶段锁 + CAS）、M10-A retrospective 回望重写
 * （双阶段锁 + CAS）。这些数据完整性逻辑属引擎职责，UI 只负责构建 provider 并注入。
 *
 * ⚠️ provider 注入式（同 backfill_memory.ts 范式）：embedding/LLM provider 与 language
 * 由调用方从 settings/project 构建后传入 —— 传 null 即「该能力不可用」，对应分支整段跳过。
 * 调用方须保证核心 confirm 的前置读取（project/settings/别名）失败在调本服务前抛出；
 * provider 构建失败调用方应吞成 null（记忆层降级），不阻断确认本身。
 */

import { IndexStatus } from "../domain/enums.js";
import { createOpsEntry } from "../domain/ops_entry.js";
import { logCatch } from "../logger/index.js";
import type { EmbeddingProvider } from "../llm/embedding_provider.js";
import type { LLMProvider } from "../llm/provider.js";
import type { ChapterSummaryRepository } from "../repositories/interfaces/chapter_summary.js";
import { generateOpId, nowUtc } from "../utils/file_utils.js";
import { withAuLock } from "./au_lock.js";
import { confirmChapter, type ConfirmChapterParams, type ConfirmChapterResult } from "./confirm_chapter.js";
import { generateMicroSummary, generateStandardSummary, persistChapterSummary } from "./chapter_summary.js";
import type { RagManager } from "./rag_manager.js";
import {
  commitRetrospective,
  generateRetrospective,
  RETROSPECTIVE_INTERVAL,
  shouldRunRetrospective,
} from "./retrospective.js";
import { generateChapterTitle } from "./title_generator.js";
import { undoLatestChapter, type UndoChapterParams, type UndoChapterResult } from "./undo_chapter.js";
import { WriteTransaction } from "./write_transaction.js";

/**
 * confirmChapterWithMemory 的依赖 = 核心 confirm 参数 + 记忆层 provider 注入。
 * embedding_provider / llm_provider 为 null 时对应分支整段跳过（= 原 UI 的 canGen 判定：
 * embedding 未配 → 无索引/摘要/回望；LLM 不可用 → 无标题/摘要/回望）。
 */
export interface ConfirmChapterWithMemoryParams extends ConfirmChapterParams {
  chapter_summary_repo: ChapterSummaryRepository;
  rag_manager: RagManager;
  /** null → 跳过 RAG 索引 + 摘要向量化 + 回望向量覆盖（embedding 不可用）。 */
  embedding_provider: EmbeddingProvider | null;
  /** null → 跳过标题生成 + 摘要生成 + 回望生成（LLM 不可用）。 */
  llm_provider: LLMProvider | null;
  /** 摘要 / 回望 / 标题生成的语言（调用方从 settings 解析）。 */
  language: string;
  /** 用户提供的标题；缺省则在 llm_provider 可用时自动生成。 */
  title?: string | null;
}

/**
 * 确认章节 + 记忆栈编排。核心 confirm 事务先行（持 AU 锁），成功后依次跑标题 / 索引 /
 * 摘要 / 回望四个独立 best-effort 边界 —— 任一失败只记日志，绝不回滚已确认的章节，也不
 * 相互影响（决策② / codex MAJOR5）。逐段语义与原 UI engine-chapters.confirmChapter 等价。
 */
export async function confirmChapterWithMemory(params: ConfirmChapterWithMemoryParams): Promise<ConfirmChapterResult> {
  const {
    au_id,
    chapter_num,
    cast_registry = { characters: [] },
    character_aliases = null,
    chapter_repo,
    state_repo,
    ops_repo,
    chapter_summary_repo,
    rag_manager,
    embedding_provider,
    llm_provider,
    language,
    title,
  } = params;

  // 记录 confirm 前的 index_status。confirmChapter 内部会悲观置 STALE，增量索引成功后
  // 是否升回 READY 取决于 confirm 之前索引是否本就完整（M1a，见下方 RAG 段注释）。
  let preConfirmIndexStatus: IndexStatus | null = null;
  try {
    preConfirmIndexStatus = (await state_repo.get(au_id)).index_status;
  } catch {
    // state 读取失败 → 视为未知，保守不升 READY（首章除外）
  }

  const result = await confirmChapter(params);

  // === 标题：使用提供的标题，或经 LLM 自动生成 ===
  let finalTitle = title;
  if (!finalTitle && llm_provider) {
    try {
      // 标题生成是纯 chat 调用；llm_provider 非 null ⇔ 原 UI 的 canGenerate（api 有 key / ollama）。
      const chContent = await chapter_repo.getContentOnly(au_id, chapter_num);
      finalTitle = await generateChapterTitle(chContent, language, llm_provider);
    } catch (err) {
      // AI 标题生成失败 → 回退为无自动标题（非致命，best-effort）。
      logCatch("chapter_title", "AI 章节标题生成失败，跳过自动标题", err);
    }
  }
  if (finalTitle) {
    // 原子更新：读取最新 state → 修改 title → WriteTransaction 保证 D-0036 顺序。
    // AU 锁保证：confirmChapter 释放锁后到这里写 title 前（LLM 生成 title 可能耗时），
    // 如果用户发起 undo / edit 等操作，它们会和本段串行，不会覆盖中间状态。
    await withAuLock(au_id, async () => {
      const st = await state_repo.get(au_id);
      st.chapter_titles[chapter_num] = finalTitle;
      const tx = new WriteTransaction();
      tx.appendOp(
        au_id,
        createOpsEntry({
          op_id: generateOpId(),
          op_type: "set_chapter_title",
          target_id: au_id,
          chapter_num,
          timestamp: nowUtc(),
          payload: { title: finalTitle },
        }),
      );
      tx.setState(st);
      await tx.commit(ops_repo, null, state_repo);
    });
  }

  // === Index the confirmed chapter for RAG (F7) — delegated to RagManager ===
  try {
    if (embedding_provider) {
      const chContent = await chapter_repo.getContentOnly(au_id, chapter_num);
      // TD-020：别名表串入 chunker——通篇只用别名的块，characters 标签也记主名（char_filter 可命中）
      await rag_manager.indexChapter(
        au_id,
        chapter_num,
        chContent,
        embedding_provider,
        cast_registry,
        character_aliases,
      );
      // confirmChapter 里先悲观标记 STALE；增量索引成功后仅在两种情形升回 READY（M1a）：
      //  - confirm 前就是 READY —— 本次增量索引把索引重新补齐到完整；
      //  - 首章 confirm（chapter_num === 1，此前零章）—— 索引天然完整，否则新 AU 永远卡 STALE。
      // confirm 前已是 STALE / INTERRUPTED → 保持不动：index_status 是单 bit，无法区分 stale
      // 成因（编辑未重索引 / backfill 半成功 / undo 清理失败 / 旧章从未索引…），而增量索引
      // 只覆盖本章 —— 无条件升 READY 会掩盖既有降级提示。存量 STALE 由「重建索引」或
      // backfill 全量成功（M1b）解除。
      if (preConfirmIndexStatus === IndexStatus.READY || chapter_num === 1) {
        await withAuLock(au_id, async () => {
          await state_repo.update(au_id, (st) => {
            st.index_status = IndexStatus.READY;
          });
        });
      }
    }
  } catch (err) {
    // RAG indexing failure doesn't block confirm；保留 STALE 作为真实状态。
    logCatch("rag", `Failed to index chapter ${chapter_num} after confirm`, err);
  }

  // === M8-C：章节摘要生成。独立 best-effort 边界，放在 RAG 索引 / READY 升级之后/之外 ===
  // —— 摘要失败绝不影响 index_status 或章节确认（决策② / codex MAJOR5）。
  try {
    if (embedding_provider && llm_provider) {
      const chContent = await chapter_repo.getContentOnly(au_id, chapter_num);

      // Standard 摘要：生成（慢 LLM）在锁外，落盘+索引在锁内 + CAS 校验（M8-C）
      const summaryText = await generateStandardSummary(chContent, chapter_num, llm_provider, { language });

      // Micro 摘要：同样在锁外生成（M10-A）
      const microText = await generateMicroSummary(chContent, chapter_num, llm_provider, { language });

      if (summaryText || microText) {
        // 落盘在锁内，CAS 校验章节内容未被并发 undo/edit 改动
        await withAuLock(au_id, async () => {
          // CAS：章节被并发 undo 删除（get 返回 null）或内容已变 → 摘要作废不落盘
          const ch = await chapter_repo.get(au_id, chapter_num);
          const stillCurrent = ch !== null && ch.content_hash === result.content_hash;
          if (!stillCurrent) return;

          // Standard 落盘 + 索引（M8-C）
          if (summaryText) {
            await persistChapterSummary({
              auPath: au_id,
              chapterNum: chapter_num,
              text: summaryText,
              contentHash: result.content_hash,
              embeddingProvider: embedding_provider,
              summaryRepo: chapter_summary_repo,
              ragManager: rag_manager,
            });
          }

          // Micro 落盘（M10-A）：updateMicro 合并写入，不进向量库
          if (microText) {
            try {
              await chapter_summary_repo.updateMicro(au_id, chapter_num, microText, result.content_hash);
            } catch (microErr) {
              logCatch("summary", `Failed to save micro summary for chapter ${chapter_num}`, microErr);
            }
          }
        });
      }
    }
  } catch (err) {
    logCatch("summary", `Failed to generate chapter summary after confirm ${chapter_num}`, err);
  }

  // === M10-A：Retrospective Rewrite。独立 best-effort 边界，在摘要生成之后运行。 ===
  // 触发条件：每 RETROSPECTIVE_INTERVAL 章，对 N-interval 章执行后见之明重写。
  // 双阶段：锁外生成（慢 LLM）+ 锁内 CAS 写盘，防止并发 undo 产生孤儿 .summary.jsonl。
  try {
    if (shouldRunRetrospective(chapter_num, RETROSPECTIVE_INTERVAL)) {
      if (embedding_provider && llm_provider) {
        const targetChapterNum = chapter_num - RETROSPECTIVE_INTERVAL;

        // Phase 1（锁外）：LLM 生成 v2 文本
        const genResult = await generateRetrospective(
          au_id,
          targetChapterNum,
          chapter_repo,
          chapter_summary_repo,
          llm_provider,
          chapter_num,
          { language },
        );

        // Phase 2（锁内）：CAS 校验章节还在，再写 v2 + 更新向量索引
        if (genResult) {
          await withAuLock(au_id, async () => {
            let targetCh: Awaited<ReturnType<typeof chapter_repo.get>>;
            try {
              targetCh = await chapter_repo.get(au_id, targetChapterNum);
            } catch {
              return; // 章节已被 undo 删除 → 跳过
            }
            // CAS：章节仍在 **且内容未变**（content_hash 与 Phase1 读取时一致）才提交。
            // 审计⑤：Phase1 慢 LLM 期间用户若编辑该历史章（编辑=作废旧摘要），content_hash 变化
            // → 跳过提交，避免用「编辑前的旧正文」重建摘要 + 覆盖向量。与当前章摘要 / backfill 的 CAS 同口径。
            if (!targetCh || targetCh.content_hash !== genResult.contentHash) return;

            await commitRetrospective(
              au_id,
              targetChapterNum,
              genResult,
              chapter_summary_repo,
              rag_manager,
              embedding_provider,
              // L17：向量覆盖失败时置 index_status=STALE（既在 withAuLock 内，state 写锁安全）。
              state_repo,
            );
          });
        }
      }
    }
  } catch (err) {
    logCatch("retrospective", `Retrospective failed after ch${chapter_num}`, err);
  }

  return result;
}

/**
 * undoChapterWithMemory 的依赖 = 核心 undo 参数 + 记忆层清理注入（摘要 repo + RAG）。
 * undo = 删除，不需要 embedding/LLM provider。
 */
export interface UndoChapterWithMemoryParams extends UndoChapterParams {
  chapter_summary_repo: ChapterSummaryRepository;
  rag_manager: RagManager;
}

/**
 * 撤销最新章 + 记忆栈清理。核心 undo（10 步级联回滚）先行，成功后删该章摘要文件与向量，
 * 并按 index_status 门控恢复。逐段语义与原 UI engine-chapters.undoChapter 等价。
 */
export async function undoChapterWithMemory(params: UndoChapterWithMemoryParams): Promise<UndoChapterResult> {
  const { au_id, chapter_summary_repo, rag_manager, state_repo } = params;

  // H9a：记录 undo 前的 index_status。undo 服务内部会悲观置 STALE（10 步级联，golden 逻辑不动）；
  // 向量删除不需要 embedding，删除成功后索引即与剩余章节一致，可恢复原状态。
  let preUndoIndexStatus: IndexStatus | null = null;
  try {
    preUndoIndexStatus = (await state_repo.get(au_id)).index_status;
  } catch {
    // 读不到就不恢复，保持 undo 服务置下的 STALE
  }

  const result = await undoLatestChapter(params);

  // M8-C（codex 实现审 #3）：撤销删了章节，连带删其摘要文件，避免孤儿 .summary.jsonl。best-effort。
  try {
    await chapter_summary_repo.remove(au_id, result.chapter_num);
  } catch (err) {
    logCatch("summary", `Failed to remove summary after undo ${result.chapter_num}`, err);
  }

  // H9a：undo = 用户明确拒绝该章 —— 删其正文 chunks + sum{N} 摘要向量（内存 + 落盘），
  // 否则被拒正文以 decay=1 最高时间权重残留召回、污染重写。删除成功且 undo 前是 READY
  // → 恢复 READY（索引仍完整）；删除失败 → 保持 undo 置下的 STALE，等「重建索引」修复。
  try {
    await rag_manager.removeChapter(au_id, result.chapter_num);
    if (preUndoIndexStatus === IndexStatus.READY) {
      await withAuLock(au_id, async () => {
        await state_repo.update(au_id, (st) => {
          st.index_status = IndexStatus.READY;
        });
      });
    }
  } catch (err) {
    logCatch("rag", `Failed to remove vectors after undo ${result.chapter_num}`, err);
  }

  return result;
}
