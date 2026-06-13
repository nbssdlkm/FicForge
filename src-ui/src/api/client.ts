// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * API Client — 错误码 → 友好消息映射（i18n）。
 */

import i18n from "../i18n";

export class ApiError extends Error {
  constructor(
    public errorCode: string,
    public userMessage: string,
    public actions: string[],
    public rawMessage?: string,
    public retryAfter?: number
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

export function getFriendlyErrorMessage(
  payload: ErrorPayload,
  retryAfterHeader?: string | null
): string {
  const normalized = normalizeErrorCode(payload.error_code);
  const retryAfter = getRetryAfter(payload, retryAfterHeader);

  const aliases: Record<string, string> = {
    network_error: "connection_failed",
    stream_error: "connection_failed",
    timeout_error: "timeout",
    http_429: "rate_limited",
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

