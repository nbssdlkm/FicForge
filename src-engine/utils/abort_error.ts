// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 「取消」错误的单一判据与构造（盲审 2026-07-11 重复维：此前 5 处各写一份且语义漂移）。
 *
 * 判据用鸭子类型而非 instanceof：跨 realm（webview / worker）或第三方库抛出的
 * 普通对象 `{ name: "AbortError" }` 也必须被一致地识别为取消 —— 否则同一次取消
 * 会在 backfill 被判「干净停止」、在生成 / agent 路径被判「真失败」走 partial rescue。
 */
export function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
}

/** 构造 name="AbortError" 的取消错误（DOMException，浏览器 fetch abort 同款形态）。 */
export function createAbortError(message = "aborted"): DOMException {
  return new DOMException(message, "AbortError");
}
