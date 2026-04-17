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
  type Settings,
} from "@ficforge/engine";
import { getEngine } from "./engine-instance";

/** 从 settings 创建 RemoteEmbeddingProvider（若已配置 embedding api_key）。 */
export function createEmbeddingProvider(sett: Settings): RemoteEmbeddingProvider | undefined {
  if (!sett.embedding?.api_key) return undefined;
  return new RemoteEmbeddingProvider(
    sett.embedding.api_base || sett.default_llm?.api_base || "",
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
  return await set_chapter_focus(auPath, focusIds, fact, ops, state);
}

export async function rebuildIndex(auPath: string) {
  const e = getEngine();
  const sett = await e.repos.settings.get();
  const embProvider = createEmbeddingProvider(sett);

  if (embProvider) {
    const proj = await e.repos.project.get(auPath);
    await e.ragManager.rebuildForAu(auPath, e.repos.chapter, embProvider, proj.cast_registry);
    // 原子更新 index_status（rebuild 可能耗时数十秒，期间 state 可能被其他操作修改）
    await e.repos.state.update(auPath, (st) => { st.index_status = IndexStatus.READY; });
    return { task_id: "rebuild_" + Date.now(), message: "index rebuilt successfully" };
  }

  // No embedding configured — mark stale
  await e.repos.state.update(auPath, (st) => { st.index_status = IndexStatus.STALE; });
  return { task_id: "rebuild_" + Date.now(), message: "index marked stale (no embedding configured)" };
}

export async function recalcState(auPath: string) {
  const { state, chapter, project, fact, ops } = getEngine().repos;
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
}
