/**
 * API Client — 前端与 Python sidecar 通信基础设施。
 */

import i18n from "../i18n";

// sidecar 端口：从 Tauri 事件获取或使用默认值
let sidecarPort: number | null = null;

export function setSidecarPort(port: number): void {
  sidecarPort = port;
}

function getBaseUrl(): string {
  const port = sidecarPort || 54284; // 开发环境对应的 FastAPI 端口
  return `http://127.0.0.1:${port}`;
}

export function buildApiUrl(path: string): string {
  return `${getBaseUrl()}${path}`;
}

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

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = buildApiUrl(path);
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    try {
      const error = (await res.json()) as ErrorPayload;
      throw new ApiError(
        error.error_code || "UNKNOWN",
        getFriendlyErrorMessage(error, res.headers.get("Retry-After")),
        error.actions || [],
        error.message,
        getRetryAfter(error, res.headers.get("Retry-After"))
      );
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(
        "NETWORK_ERROR",
        getFriendlyErrorMessage({ error_code: "connection_failed" }),
        ["retry"]
      );
    }
  }

  return res.json();
}

/**
 * SSE 流式请求（用于生成章节）。
 */
export async function* sseStream(
  path: string,
  body: object
): AsyncGenerator<{ event: string; data: any }> {
  const url = buildApiUrl(path);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    throw new ApiError(
      "STREAM_ERROR",
      getFriendlyErrorMessage({ error_code: "stream_error" }),
      ["retry"]
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let currentEvent = "message";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          yield { event: currentEvent, data };
        } catch {
          // 非 JSON data 行，跳过
        }
      }
    }
  }
}
