/**
 * API Client — 前端与 Python sidecar 通信基础设施。
 */

// sidecar 端口：从 Tauri 事件获取或使用默认值
let sidecarPort: number | null = null;

export function setSidecarPort(port: number): void {
  sidecarPort = port;
}

function getBaseUrl(): string {
  const port = sidecarPort || 54284; // 开发环境对应的 FastAPI 端口
  return `http://127.0.0.1:${port}`;
}

export class ApiError extends Error {
  constructor(
    public errorCode: string,
    public userMessage: string,
    public actions: string[]
  ) {
    super(userMessage);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    try {
      const error = await res.json();
      throw new ApiError(
        error.error_code || "UNKNOWN",
        error.message || "请求失败",
        error.actions || []
      );
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError("NETWORK_ERROR", "网络错误", ["retry"]);
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
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    throw new ApiError("STREAM_ERROR", "流式连接失败", ["retry"]);
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
