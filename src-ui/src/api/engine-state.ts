// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine State — getState, setChapterFocus, rebuildIndex, recalcState.
 */

import {
  setChapterFocus as engineSetChapterFocus,
  recalcState as engineRecalcState,
  IndexStatus,
  createOpsEntry,
  generateOpId,
  nowUtc,
  WriteTransaction,
  RemoteEmbeddingProvider,
  warnIfPlaintextRemote,
  withAuLock,
  type Settings,
  type Project,
} from "@ficforge/engine";
import { getEngine, getProjectOrThrow } from "./engine-instance";

/**
 * 从 settings（+ 可选 project）创建 RemoteEmbeddingProvider。
 *
 * 优先级：AU 级 embedding_lock（api_key + api_base 都配齐时）> 全局 settings.embedding。
 *    embedding_lock 让单个 AU 用独立的 embedding 服务（AuSettingsLayout 暴露）。
 *    其 api_key 在 file_project.get() 里已被 restoreSecureFields 还原为明文，
 *    此处直接用，无需再读 secure storage。
 *    要求 api_key + api_base **同时**存在才生效，避免半配置（如只填 key）指向空端点。
 *
 * ⚠️ 严格使用 embedding 自己的 api_key + api_base，不回退到 default_llm。
 *    原因：很多 LLM 提供商（如 DeepSeek）不支持 embedding 端点，
 *    或者 embedding 额度使用不同的 key。隐式复用会把错误凭据发到错误端点，
 *    排障成本高于让用户显式配置。
 *    两级都未配置时返回 undefined，RAG 自然降级。
 */
// 掩码/占位符 key 不可用：secure 读取失败时字段可能停留在 <secure>/****，
// 决不能把占位符字面量当 bearer 发出（与 resolver 的 isMasked 纪律一致，盲审 R3 对抗审 NIT）。
function isUsableEmbeddingKey(k: string | undefined): k is string {
  return typeof k === "string" && k !== "" && !k.startsWith("****") && k !== "<secure>";
}

export function createEmbeddingProvider(sett: Settings, project?: Project): RemoteEmbeddingProvider | undefined {
  const lock = project?.embedding_lock;
  if (isUsableEmbeddingKey(lock?.api_key) && lock?.api_base) {
    // 明文远端告警与 LLM 生成路径同判据同口径（B2 对抗审：embedding 恰是局域网自建
    // HTTP 端点最常见的通路，此前整面漏保护）
    warnIfPlaintextRemote(lock.api_base);
    return new RemoteEmbeddingProvider(lock.api_base, lock.api_key, lock.model || "");
  }
  if (!isUsableEmbeddingKey(sett.embedding?.api_key) || !sett.embedding?.api_base) return undefined;
  warnIfPlaintextRemote(sett.embedding.api_base);
  return new RemoteEmbeddingProvider(sett.embedding.api_base, sett.embedding.api_key, sett.embedding.model || "");
}

export async function getState(auPath: string) {
  const { state } = getEngine().repos;
  return await state.get(auPath);
}

export async function setChapterFocus(auPath: string, focusIds: string[]) {
  const { fact, ops, state } = getEngine().repos;
  return withAuLock(auPath, () => engineSetChapterFocus(auPath, focusIds, fact, ops, state));
}

export async function rebuildIndex(auPath: string) {
  const e = getEngine();
  const sett = await e.repos.settings.get();
  const proj = await getProjectOrThrow(auPath);
  const embProvider = createEmbeddingProvider(sett, proj);

  if (embProvider) {
    // rebuild 可能耗时数十秒，不持 AU 锁（不写 ops/chapter/facts，只写 vector 索引）
    await e.ragManager.rebuildForAu(
      auPath,
      e.repos.chapter,
      embProvider,
      proj.cast_registry,
      undefined,
      undefined,
      e.repos.chapterSummary,
    );
    // 只对"更新 index_status"这一小段持锁，避免和其它 state 写入交叉
    await withAuLock(auPath, async () => {
      await e.repos.state.update(auPath, (st) => {
        st.index_status = IndexStatus.READY;
      });
    });
    return { task_id: "rebuild_" + Date.now(), message: "index rebuilt successfully" };
  }

  // No embedding configured — mark stale
  await withAuLock(auPath, async () => {
    await e.repos.state.update(auPath, (st) => {
      st.index_status = IndexStatus.STALE;
    });
  });
  return { task_id: "rebuild_" + Date.now(), message: "index marked stale (no embedding configured)" };
}

export async function recalcState(auPath: string) {
  const e = getEngine();
  const { state, chapter, project, fact, ops } = e.repos;
  return withAuLock(auPath, async () => {
    // 别名表供表与 confirm/undo 同姿势（E8）：重算的全量重扫不得比增量记录别名盲
    const aliases = await e.characterAliases.get(auPath);
    const result = await engineRecalcState(auPath, state, chapter, project, fact, aliases);
    // WriteTransaction 保证 D-0036 写入顺序：ops → state
    const tx = new WriteTransaction();
    tx.appendOp(
      auPath,
      createOpsEntry({
        op_id: generateOpId(),
        op_type: "recalc_global_state",
        target_id: auPath,
        timestamp: nowUtc(),
        payload: {
          characters_last_seen: { ...result.state.characters_last_seen },
          last_scene_ending: result.state.last_scene_ending,
          last_confirmed_chapter_focus: [...result.state.last_confirmed_chapter_focus],
          chapters_dirty: [...result.state.chapters_dirty],
          chapter_focus: [...result.state.chapter_focus],
        },
      }),
    );
    tx.setState(result.state);
    await tx.commit(ops, null, state);
    // 不泄露内部 state 对象到前端
    const { state: _s, ...publicResult } = result;
    return publicResult;
  });
}
