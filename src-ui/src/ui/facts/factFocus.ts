// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * REQ-140 剧情线「编辑笔记」跳转的 pending-focus 单次投递。
 *
 * 为什么用模块级存储而不是 props  drilling：FactsLayout 是按需挂载的（`activeTab === "facts" &&`），
 * 跳转发生时它还没挂载，props 传不进去；挂载后它从这里取走「待聚焦 fact id」，加载完成后
 * 自动进入该笔记的编辑态。单次消费（take 即清），不残留。
 */

let pendingFactId: string | null = null;

/** 发起跳转前登记（ThreadDetail「编辑笔记」→ 切 tab 前调用）。 */
export function requestFactFocus(factId: string): void {
  pendingFactId = factId;
}

/** 看一眼但不取走（facts 还没加载完时反复试探用）。 */
export function peekFactFocus(): string | null {
  return pendingFactId;
}

/** 取走并清空（找到目标 / 目标已不存在，都消费掉防挂住）。 */
export function consumeFactFocus(): string | null {
  const id = pendingFactId;
  pendingFactId = null;
  return id;
}
