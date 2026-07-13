// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * API Client — 错误码 → 友好消息映射（i18n）。
 */

import i18n from "../i18n";

/**
 * api 层错误类型的使用约定（R3 低危「ApiError vs plain Error 混用」裁决成文）：
 * - **ApiError**：有稳定 `errorCode` 且 UI 侧要据码分支/i18n 映射的**用户可见失败**
 *   （如 no_api_key / restore_conflict / CHAPTER_GENERATION_IN_FLIGHT）。
 * - **plain Error**：内部不变量与防御性守卫（engine 未初始化、not-found 早退、
 *   已被 UI 门控挡在前面的 precondition）——它们要么是程序员错误、要么按设计被
 *   调用方 catch 静默处理，升格 ApiError 只会凭空造一批无消费者的错误码。
 * 新增 throw 时按此判据二选一，不再逐处随手抄。
 */
export class ApiError extends Error {
  constructor(
    public errorCode: string,
    public userMessage: string,
    public actions: string[],
    public rawMessage?: string,
    public retryAfter?: number,
  ) {
    super(userMessage);
    this.name = "ApiError";
  }
}

type ErrorPayload = {
  error_code?: string;
  message?: string;
  actions?: string[];
  retry_after?: number | string;
};

function normalizeErrorCode(errorCode?: string): string {
  return (errorCode || "unknown").trim().toLowerCase();
}

function getRetryAfter(payload: ErrorPayload, retryAfterHeader?: string | null): number | undefined {
  const fromPayload = Number(payload.retry_after);
  if (Number.isFinite(fromPayload) && fromPayload > 0) return fromPayload;

  const fromHeader = Number(retryAfterHeader);
  if (Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader;

  return undefined;
}

export function getFriendlyErrorMessage(payload: ErrorPayload, retryAfterHeader?: string | null): string {
  const normalized = normalizeErrorCode(payload.error_code);
  const retryAfter = getRetryAfter(payload, retryAfterHeader);

  const aliases: Record<string, string> = {
    network_error: "connection_failed",
    stream_error: "connection_failed",
    timeout_error: "timeout",
    http_429: "rate_limited",
    // F8：上一次生成/对话仍在收尾时的 409（引擎 _generating 409 防重入）。两条 409 语义
    // 相同（都是「在飞请求未释放」），共用一条 friendly 文案，避免用户见到裸机器码困惑
    // ——尤其「刚点过停止立刻重发」时，取消的 finally 尚未跑完、锁未释放会撞这个码。
    dispatch_in_progress: "busy_in_progress",
    generation_in_progress: "busy_in_progress",
  };

  const key = aliases[normalized] || normalized;
  const translationKey = `error_messages.${key}`;

  if (i18n.exists(translationKey)) {
    if (key === "rate_limited") {
      return i18n.t(translationKey, { retry_after: retryAfter ?? 30 });
    }
    return i18n.t(translationKey);
  }

  if (payload.message) return payload.message;
  return i18n.t("error_messages.unknown");
}
