// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * OpenAI 兼容接口 Provider。适配 DeepSeek / OpenAI / Claude 中转站等。
 * 使用原生 fetch（无外部依赖，移动端兼容）。
 */

import type { GenerateParams, LLMChunk, LLMProvider, LLMResponse, ToolCall } from "./provider.js";
import { LLMError } from "./provider.js";
import { hasLogger, getLogger } from "../logger/index.js";

const READ_TIMEOUT = 120_000;

function isAbortError(error: unknown): error is DOMException | Error {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function createAbortError(message = "Aborted"): DOMException {
  return new DOMException(message, "AbortError");
}

/**
 * 把外部 signal 桥接到内部 controller，返回清理函数。
 * 调用方必须在 fetch 结束后（无论成功失败）调用清理函数，否则 listener 会泄漏。
 */
function attachAbort(controller: AbortController, externalSignal?: AbortSignal): () => void {
  if (!externalSignal) return () => {};
  if (externalSignal.aborted) {
    controller.abort();
    return () => {};
  }
  const onAbort = () => controller.abort();
  externalSignal.addEventListener("abort", onAbort, { once: true });
  return () => externalSignal.removeEventListener("abort", onAbort);
}

/**
 * 可取消的延时等待。signal abort 时立即 reject 为 AbortError，
 * 同时 clearTimeout + removeEventListener 不留垃圾。
 */
function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 清洗字符串中可能导致 JSON 解析失败的字符。
 * 部分 LLM 提供商的 JSON parser 对 lone surrogate、NULL 等字符报
 * "unexpected end of hex escape" 错误。在序列化前移除这些字符。
 */
function sanitizeForJson(s: string): string {
  // 仅移除 lone surrogates（不成对的）和 NULL (U+0000)。
  // 合法的 surrogate pair（如 emoji 😊 = \uD83D\uDE0A）不动。
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

export class OpenAICompatibleProvider implements LLMProvider {
  private apiBase: string;
  private apiKey: string;
  private model: string;

  constructor(apiBase: string, apiKey: string, model: string) {
    this.apiBase = apiBase.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.model = model;
  }

  // ------------------------------------------------------------------
  // 非流式
  // ------------------------------------------------------------------

  async generate(params: GenerateParams): Promise<LLMResponse> {
    const t0 = Date.now();
    const body = this.buildBody(params, false);
    let data: Record<string, unknown>;
    try {
      data = await this.requestWithRetry(body, params.signal);
    } catch (err) {
      if (hasLogger()) getLogger().error("llm", "generate failed", { model: this.model, duration_ms: Date.now() - t0, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }

    let content = "";
    let finishReason = "stop";
    let toolCalls: ToolCall[] | undefined;
    const choices = (data.choices ?? []) as Record<string, unknown>[];
    if (choices.length > 0) {
      const msg = (choices[0].message ?? {}) as Record<string, unknown>;
      content = (msg.content as string) ?? "";
      finishReason = (choices[0].finish_reason as string) ?? "stop";
      if (msg.tool_calls) {
        toolCalls = msg.tool_calls as ToolCall[];
      }
    }

    const usage = (data.usage ?? {}) as Record<string, number>;
    const inputTokens = usage.prompt_tokens ?? null;
    const outputTokens = usage.completion_tokens ?? null;
    if (hasLogger()) getLogger().info("llm", "generate ok", { model: this.model, input_tokens: inputTokens, output_tokens: outputTokens, duration_ms: Date.now() - t0, tools: params.tools?.length ?? 0 });

    return {
      content,
      model: (data.model as string) ?? this.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      finish_reason: finishReason,
      tool_calls: toolCalls,
    };
  }

  // ------------------------------------------------------------------
  // 流式
  // ------------------------------------------------------------------

  async *generateStream(params: GenerateParams): AsyncIterable<LLMChunk> {
    const body = this.buildBody(params, true);
    const url = `${this.apiBase}/chat/completions`;

    const controller = new AbortController();
    // 可重置超时：每次收到数据后重置，防止长生成被误杀
    let timeoutId = setTimeout(() => controller.abort(), READ_TIMEOUT);
    const resetTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort(), READ_TIMEOUT);
    };

    // 外部 signal 触发时同步 abort 内部 controller
    const onExternalAbort = () => controller.abort();
    if (params.signal) {
      if (params.signal.aborted) { controller.abort(); }
      else { params.signal.addEventListener("abort", onExternalAbort, { once: true }); }
    }

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timeoutId);
      if (params.signal?.aborted) {
        throw createAbortError(e instanceof Error ? e.message : undefined);
      }
      throw new LLMError("network_error", "网络异常，请检查连接后重试", ["retry"]);
    }

    if (!resp.ok) {
      clearTimeout(timeoutId);
      const text = await resp.text();
      handleError(resp.status, text);
    }

    try {
      if (!resp.body) {
        throw new LLMError("network_error", "网络异常，请检查连接后重试", ["retry"]);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        resetTimeout(); // 收到数据，重置超时计时器

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!; // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") return;

          let chunkData: Record<string, unknown>;
          try {
            chunkData = JSON.parse(payload);
          } catch {
            continue;
          }

          const choices = (chunkData.choices ?? []) as Record<string, unknown>[];
          let deltaText = "";
          let finish: string | null = null;
          if (choices.length > 0) {
            const delta = (choices[0].delta ?? {}) as Record<string, unknown>;
            deltaText = (delta.content as string) ?? "";
            finish = (choices[0].finish_reason as string) ?? null;
          }

          const usage = chunkData.usage as Record<string, number> | undefined;
          yield {
            delta: deltaText,
            is_final: finish !== null,
            input_tokens: usage?.prompt_tokens ?? null,
            output_tokens: usage?.completion_tokens ?? null,
            finish_reason: finish,
          };
        }
      }
    } catch (e) {
      if (params.signal?.aborted) {
        throw createAbortError(e instanceof Error ? e.message : undefined);
      }
      if (isAbortError(e)) {
        throw new LLMError("network_error", "网络异常，请检查连接后重试", ["retry"]);
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
      params.signal?.removeEventListener("abort", onExternalAbort);
    }
  }

  // ------------------------------------------------------------------
  // 内部
  // ------------------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private buildBody(params: GenerateParams, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: params.messages.map((m) => ({
        ...m,
        content: typeof m.content === "string" ? sanitizeForJson(m.content) : m.content,
      })),
      max_tokens: params.max_tokens,
      temperature: params.temperature,
      top_p: params.top_p,
      stream,
    };
    if (stream) {
      body.stream_options = { include_usage: true };
    }
    if (params.tools?.length) {
      body.tools = params.tools;
      if (params.tool_choice) body.tool_choice = params.tool_choice;
    }
    return body;
  }

  private async requestWithRetry(body: Record<string, unknown>, externalSignal?: AbortSignal): Promise<Record<string, unknown>> {
    const url = `${this.apiBase}/chat/completions`;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (externalSignal?.aborted) {
        throw new LLMError("cancelled", "请求已取消", []);
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), READ_TIMEOUT);
      const detachAbort = attachAbort(controller, externalSignal);

      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (resp.ok) {
          return (await resp.json()) as Record<string, unknown>;
        }

        if (resp.status === 429) {
          return await this.retry429(url, body, externalSignal);
        }

        // 5xx: retry once
        if (resp.status >= 500 && attempt === 0) {
          continue;
        }

        const text = await resp.text();
        handleError(resp.status, text);
      } catch (e) {
        if (externalSignal?.aborted) {
          throw new LLMError("cancelled", "请求已取消", []);
        }
        if (e instanceof LLMError) throw e;
        if (attempt === 0) continue; // retry once on network error
        throw new LLMError("network_error", "网络异常，请检查连接后重试", ["retry"]);
      } finally {
        clearTimeout(timeoutId);
        detachAbort();
      }
    }

    throw new LLMError("network_error", "网络异常，请检查连接后重试", ["retry"]);
  }

  private async retry429(url: string, body: Record<string, unknown>, externalSignal?: AbortSignal): Promise<Record<string, unknown>> {
    const delays = [1000, 2000, 4000];
    for (const delay of delays) {
      if (externalSignal?.aborted) {
        throw new LLMError("cancelled", "请求已取消", []);
      }
      try {
        await waitWithAbort(delay, externalSignal);
      } catch {
        // waitWithAbort 只在 signal abort 时 reject
        throw new LLMError("cancelled", "请求已取消", []);
      }

      const controller = new AbortController();
      const detachAbort = attachAbort(controller, externalSignal);
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (resp.ok) {
          return (await resp.json()) as Record<string, unknown>;
        }
        if (resp.status !== 429) {
          handleError(resp.status, await resp.text());
        }
      } catch (e) {
        if (externalSignal?.aborted) throw new LLMError("cancelled", "请求已取消", []);
        if (e instanceof LLMError) throw e;
        continue;
      } finally {
        detachAbort();
      }
    }
    throw new LLMError("rate_limited", "请求过于频繁", ["retry", "switch_model"], 429);
  }
}

// ---------------------------------------------------------------------------
// 错误分类（PRD §4.2 错误表）
// ---------------------------------------------------------------------------

/** 从 LLM 提供商返回的 JSON 错误体中提取可读消息。 */
function extractErrorDetail(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const err = (parsed.error ?? parsed) as Record<string, unknown>;
    const msg = (err.message ?? err.msg ?? err.detail ?? "") as string;
    return typeof msg === "string" ? msg.slice(0, 200) : "";
  } catch {
    return bodyText.slice(0, 200);
  }
}

function handleError(statusCode: number, bodyText: string): never {
  const lower = bodyText.toLowerCase();

  if (statusCode === 401) {
    throw new LLMError("invalid_api_key", "API 密钥无效或已过期", ["check_settings"], 401);
  }

  if (statusCode === 429) {
    throw new LLMError("rate_limited", "请求过于频繁", ["retry", "switch_model"], 429);
  }

  if (statusCode === 402 || statusCode === 403) {
    if (["billing", "quota", "insufficient", "balance"].some((k) => lower.includes(k))) {
      throw new LLMError("insufficient_balance", "API 余额不足", ["recharge", "switch_model", "change_key"], statusCode);
    }
    if (["safety", "flagged", "content_filter", "moderation"].some((k) => lower.includes(k))) {
      throw new LLMError("content_filtered", "生成被模型安全策略拦截", ["modify_input", "switch_model"], statusCode);
    }
  }

  if (statusCode === 400) {
    // 上下文超限（兼容中英文错误消息）
    if (["length", "context_length", "too long", "token", "过长", "超出", "exceed"].some((k) => lower.includes(k))) {
      throw new LLMError("context_length_exceeded", "输入超出模型最大处理能力", ["reduce_input", "switch_model"], 400);
    }
    if (["safety", "flagged", "content_filter"].some((k) => lower.includes(k))) {
      throw new LLMError("content_filtered", "生成被模型安全策略拦截", ["modify_input", "switch_model"], statusCode);
    }
    // tool calling 不兼容
    if (["tool", "function_call", "functions", "not support"].some((k) => lower.includes(k))) {
      throw new LLMError("tools_unsupported", "当前模型不支持 tool calling", ["retry"], 400);
    }
  }

  if (statusCode >= 500) {
    throw new LLMError("network_error", "网络异常，请检查连接后重试", ["retry"], statusCode);
  }

  // 附带提供商原始错误以便调试
  const detail = extractErrorDetail(bodyText);
  throw new LLMError("network_error", `LLM 调用失败 (HTTP ${statusCode})${detail ? `: ${detail}` : ""}`, ["retry"], statusCode);
}
