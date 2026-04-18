// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Chapters — listChapters, getChapter, getChapterContent,
 *   confirmChapter, undoChapter, updateChapterTitle,
 *   resolveDirtyChapter, updateChapterContent.
 */

import {
  confirm_chapter as engineConfirmChapter,
  undo_latest_chapter,
  resolve_dirty_chapter,
  edit_chapter_content,
  resolve_llm_config,
  create_provider,
  generateChapterTitle,
  createOpsEntry,
  generate_op_id,
  now_utc,
  WriteTransaction,
  withAuLock,
  type GeneratedWith,
} from "@ficforge/engine";
import { getEngine } from "./engine-instance";
import { createEmbeddingProvider } from "./engine-state";

export async function listChapters(auPath: string) {
  const { chapter, state } = getEngine().repos;
  const chapters = await chapter.list_main(auPath);
  const st = await state.get(auPath);
  return chapters.map((ch) => ({
    chapter_num: ch.chapter_num,
    chapter_id: ch.chapter_id,
    content: ch.content,
    revision: ch.revision,
    confirmed_at: ch.confirmed_at,
    provenance: ch.provenance,
    title: st.chapter_titles[ch.chapter_num] ?? undefined,
  }));
}

export async function getChapter(auPath: string, chapterNum: number) {
  const { chapter } = getEngine().repos;
  const ch = await chapter.get(auPath, chapterNum);
  return ch;
}

export async function getChapterContent(auPath: string, chapterNum: number) {
  const { chapter } = getEngine().repos;
  return await chapter.get_content_only(auPath, chapterNum);
}

export async function confirmChapter(
  auPath: string, chapterNum: number, draftId: string,
  generatedWith?: object, content?: string | null, title?: string | null,
) {
  const e = getEngine();
  const { chapter, draft, state, ops, project, settings } = e.repos;
  const proj = await project.get(auPath);
  const result = await engineConfirmChapter({
    au_id: auPath, chapter_num: chapterNum, draft_id: draftId,
    generated_with: generatedWith as GeneratedWith | undefined,
    cast_registry: proj.cast_registry,
    content_override: content,
    chapter_repo: chapter, draft_repo: draft, state_repo: state, ops_repo: ops,
  });

  const sett = await settings.get();

  // Update title: use provided title, or auto-generate via LLM
  let finalTitle = title;
  if (!finalTitle) {
    try {
      const llmConfig = resolve_llm_config(null, proj, sett);
      // 标题生成是纯 chat 调用，api 和 ollama 都能跑；local 暂未实现。
      // api 模式必须有 api_key，ollama 模式 key 可为空（引擎会填 dummy）。
      const canGenerate =
        llmConfig.mode === "ollama" ||
        (llmConfig.mode === "api" && !!llmConfig.api_key);
      if (canGenerate) {
        const provider = create_provider(llmConfig);
        const chContent = await chapter.get_content_only(auPath, chapterNum);
        const lang = sett.app?.language || "zh";
        finalTitle = await generateChapterTitle(chContent, lang, provider);
      }
    } catch {
      // AI title generation failed — silent fallback
    }
  }
  if (finalTitle) {
    // 原子更新：读取最新 state → 修改 title → WriteTransaction 保证 D-0036 顺序。
    // AU 锁保证：engineConfirmChapter 释放锁后到这里写 title 前（LLM 生成 title 可能耗时），
    // 如果用户发起 undo / edit 等操作，它们会和本段串行，不会覆盖中间状态。
    await withAuLock(auPath, async () => {
      const st = await state.get(auPath);
      st.chapter_titles[chapterNum] = finalTitle;
      const tx = new WriteTransaction();
      tx.appendOp(auPath, createOpsEntry({
        op_id: generate_op_id(),
        op_type: "set_chapter_title",
        target_id: auPath,
        chapter_num: chapterNum,
        timestamp: now_utc(),
        payload: { title: finalTitle },
      }));
      tx.setState(st);
      await tx.commit(ops, null, state);
    });
  }

  // Index the confirmed chapter for RAG (F7) — delegated to RagManager
  try {
    const embProvider = createEmbeddingProvider(sett);
    if (embProvider) {
      const chContent = await chapter.get_content_only(auPath, chapterNum);
      await e.ragManager.indexChapter(auPath, chapterNum, chContent, embProvider, proj.cast_registry);
    }
  } catch {
    // RAG indexing failure doesn't block confirm
  }

  return result;
}

export async function undoChapter(auPath: string) {
  const { chapter, draft, state, ops, fact, project } = getEngine().repos;
  const proj = await project.get(auPath);
  return await undo_latest_chapter({
    au_id: auPath, cast_registry: proj.cast_registry,
    chapter_repo: chapter, draft_repo: draft, state_repo: state, ops_repo: ops, fact_repo: fact,
  });
}

export async function updateChapterTitle(auPath: string, chapterNum: number, title: string) {
  const { state, ops } = getEngine().repos;
  // UI 直接写 state + ops，不经 service —— 必须顶层加 AU 锁，
  // 否则 confirm / undo / edit 并发时会覆写同一 state 文件。
  return withAuLock(auPath, async () => {
    const st = await state.get(auPath);
    st.chapter_titles[chapterNum] = title;
    const tx = new WriteTransaction();
    tx.appendOp(auPath, createOpsEntry({
      op_id: generate_op_id(),
      op_type: "set_chapter_title",
      target_id: auPath,
      chapter_num: chapterNum,
      timestamp: now_utc(),
      payload: { title },
    }));
    tx.setState(st);
    await tx.commit(ops, null, state);
    return { chapter_num: chapterNum, title };
  });
}

export async function resolveDirtyChapter(auPath: string, chapterNum: number, confirmedFactChanges: any[] = []) {
  const { chapter, state, ops, fact, project } = getEngine().repos;
  const proj = await project.get(auPath);
  return await resolve_dirty_chapter({
    au_id: auPath, chapter_num: chapterNum, confirmed_fact_changes: confirmedFactChanges,
    cast_registry: proj.cast_registry,
    chapter_repo: chapter, state_repo: state, ops_repo: ops, fact_repo: fact,
  });
}

export async function updateChapterContent(auPath: string, chapterNum: number, content: string) {
  const { chapter, state, ops } = getEngine().repos;
  // edit_chapter_content 属于"底层 service"，本身不加锁（避免被 dirty_resolve
  // 等已持锁的 orchestrator 调用时死锁）。UI 直接调用路径必须在此顶层加锁。
  return withAuLock(auPath, () =>
    edit_chapter_content(auPath, chapterNum, content, chapter, state, ops),
  );
}
