// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 同 (au, chapter) 的「章节草稿生成在飞」互斥表 —— 单一真相源。
 *
 * 为什么必须共享一张表（对抗审 F1）：写文 generate_chapter 与对话 dispatch_simple_chat
 * 共用同一 AU 的草稿标签空间，且融合后双 tab 恒并列、双方常驻挂载（生成流跨 tab 存活）。
 * 两条路径都在 loop 前一次性 nextDraftLabel（读当时的 existingDrafts）——各自维护独立
 * Map 只能封住自身重入，封不住「对话流式中切写文 tab 再点生成」这类跨路径并发：
 * 双方拿到同一 label，后完成者 draft_repo.save 静默覆盖先完成者的草稿。
 */

const inflight = new Map<string, "generate" | "dispatch">();

export function chapterInflightKey(au_id: string, chapter_num: number): string {
  return `${au_id}:${chapter_num}`;
}

/** 有任一路径（写文/对话）在给该章生成草稿。 */
export function isChapterInflight(key: string): boolean {
  return inflight.has(key);
}

export function markChapterInflight(key: string, source: "generate" | "dispatch"): void {
  inflight.set(key, source);
}

export function releaseChapterInflight(key: string): void {
  inflight.delete(key);
}
