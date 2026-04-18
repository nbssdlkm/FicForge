// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine State — getState, setChapterFocus, rebuildIndex, recalcState.
 */

import {
  set_chapter_focus,
  recalc_state,
  IndexStatus,
  createOpsEntry,
  generate_op_id,
  now_utc,
  WriteTransaction,
  RemoteEmbeddingProvider,
  withAuLock,
  type Settings,
} from "@ficforge/engine";
import { getEngine } from "./engine-instance";

/**
 * 从 settings 创建 RemoteEmbeddingProvider。
 *
 * ⚠️ 严格使用 embedding 自己的 api_key + api_base，不再回退到 default_llm。
 *    原因：很多 LLM 提供商（DeepSeek、Claude 官方等）不支持 embedding 端点，
 *    或者 embedding 额度使用不同的 key。隐式复用会把错误凭据发到错误端点，
 *    排障成本高于让用户显式配置。
 *    未配置 embedding 时返回 undefined，RAG 自然降级。
 */
export function createEmbeddingProvider(sett: Settings): RemoteEmbeddingProvider | undefined {
  if (!sett.embedding?.api_key || !sett.embedding?.api_base) return undefined;
  return new RemoteEmbeddingProvider(
    sett.embedding.api_base,
    sett.embedding.api_key,
    sett.embedding.model || "",
  );
}

export async function getState(auPath: string) {
  const { state } = getEngine().repos;
  return await state.get(auPath);
}

export async function setChapterFocus(auPath: string, focusIds: string[]) {
  const { fact, ops, state } = getEngine().repos;
  return withAuLock(auPath, () => set_chapter_focus(auPath, focusIds, fact, ops, state));
}

export async function rebuildIndex(auPath: string) {
  const e = getEngine();
  const sett = await e.repos.settings.get();
  const embProvider = createEmbeddingProvider(sett);

  if (embProvider) {
    const proj = await e.repos.project.get(auPath);
    // rebuild 可能耗时数十秒，不持 AU 锁（不写 ops/chapter/facts，只写 vector 索引）
    await e.ragManager.rebuildForAu(auPath, e.repos.chapter, embProvider, proj.cast_registry);
    // 只对"更新 index_status"这一小段持锁，避免和其它 state 写入交叉
    await withAuLock(auPath, async () => {
      await e.repos.state.update(auPath, (st) => { st.index_status = IndexStatus.READY; });
    });
    return { task_id: "rebuild_" + Date.now(), message: "index rebuilt successfully" };
  }

  // No embedding configured — mark stale
  await withAuLock(auPath, async () => {
    await e.repos.state.update(auPath, (st) => { st.index_status = IndexStatus.STALE; });
  });
  return { task_id: "rebuild_" + Date.now(), message: "index marked stale (no embedding configured)" };
}

export async function recalcState(auPath: string) {
  const { state, chapter, project, fact, ops } = getEngine().repos;
  return withAuLock(auPath, async () => {
    const result = await recalc_state(auPath, state, chapter, project, fact);
    // WriteTransaction 保证 D-0036 写入顺序：ops → state
    const tx = new WriteTransaction();
    tx.appendOp(auPath, createOpsEntry({
      op_id: generate_op_id(),
      op_type: "recalc_global_state",
      target_id: auPath,
      timestamp: now_utc(),
      payload: {
        characters_last_seen: { ...result.state.characters_last_seen },
        last_scene_ending: result.state.last_scene_ending,
        last_confirmed_chapter_focus: [...result.state.last_confirmed_chapter_focus],
        chapters_dirty: [...result.state.chapters_dirty],
        chapter_focus: [...result.state.chapter_focus],
      },
    }));
    tx.setState(result.state);
    await tx.commit(ops, null, state);
    // 不泄露内部 state 对象到前端
    const { state: _s, ...publicResult } = result;
    return publicResult;
  });
}
