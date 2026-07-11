// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * OpenAI 兼容接口 Provider。适配 DeepSeek / OpenAI / Claude 中转站等。
 * 使用原生 fetch（无外部依赖，移动端兼容）。
 */

import { createAbortError, isAbortError } from "../utils/abort_error.js";
import type { GenerateParams, LLMChunk, LLMProvider, LLMResponse, ToolCall } from "./provider.js";
import { LLMError } from "./provider.js";
import { hasLogger, getLogger } from "../logger/index.js";

const READ_TIMEOUT = 120_000;


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
  private chatPath: string;

  /**
   * @param chatPath 非标聊天补全路径（特殊网关用）。缺省 = /chat/completions。
   *                 只影响 chat completions；/models 拉取路径不走此处（见 engine-settings
   *                 fetchProviderModels，恒拼 /models）。
   */
  constructor(apiBase: string, apiKey: string, model: string, chatPath?: string) {
    this.apiBase = apiBase.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.model = model;
    // 归一化：非空才用自定义，且保证前导斜杠（api_base 已去尾斜杠，拼接即 `{base}{path}`）。
    // 防御纵深（盲审 R3 HIGH-2）：拒绝能改变宿主的 chatPath（协议相对 `//`、`\`、
    // scheme://）—— 主校验在 config_resolver.toChatPath，此处兜住直接 new Provider 的路径。
    // 先剥离控制字符（\n\r\t 等）：webview 会在解析 URL 前吃掉它们，`/\n/host` 剥离后
    // 变协议相对 `//host` —— 若不先清除会绕过下面的 startsWith("//") 判据。
    const trimmed = chatPath?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    const safe = trimmed
      && !trimmed.startsWith("//")
      && !trimmed.includes("\\")
      && !trimmed.includes("://");
    this.chatPath = safe ? (trimmed.startsWith("/") ? trimmed : `/${trimmed}`) : "/chat/completions";
  }

  /** 聊天补全端点完整 URL（单一真相源，流式 / 非流式 / 429 重试共用）。 */
  private chatUrl(): string {
    return `${this.apiBase}${this.chatPath}`;
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
    const url = this.chatUrl();

    const controller = new AbortController();
    // 可重置超时：每次收到数据后重置，防止长生成被误杀
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const armTimeout = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort(), READ_TIMEOUT);
    };
    const clearTimeoutIfSet = () => {
      if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
    };

    // 外部 signal 触发时同步 abort 内部 controller。
    // L6：listener + timer 的清理统一放最外层 finally（覆盖 fetch 失败 / !ok /
    // 无 body / 流中断等所有 throw 路径），旧代码只在 reader-loop 的 finally 清理，
    // 前置几条 throw 会泄漏 abort listener。
    const onExternalAbort = () => controller.abort();
    let listenerAttached = false;
    if (params.signal) {
      if (params.signal.aborted) { controller.abort(); }
      else { params.signal.addEventListener("abort", onExternalAbort, { once: true }); listenerAttached = true; }
    }

    try {
      armTimeout();

      // L5：首包前 429/5xx 自动重试（复用非流式 requestWithRetry 的等待口径）。
      // 只在还没 yield 任何数据的安全窗口内重试 —— 一旦进 reader 循环产出 chunk 就不能
      // 重发（会重复正文）。指数退避，可被外部 signal / 内部超时中断。
      const STREAM_OPEN_DELAYS = [0, 1000, 2000];
      let resp: Response | null = null;
      for (let attempt = 0; attempt < STREAM_OPEN_DELAYS.length; attempt++) {
        if (params.signal?.aborted) {
          throw createAbortError();
        }
        if (STREAM_OPEN_DELAYS[attempt] > 0) {
          // waitWithAbort 只在 signal abort 时 reject；此处把它归一成 AbortError
          await waitWithAbort(STREAM_OPEN_DELAYS[attempt], params.signal);
          armTimeout();
        }

        let candidate: Response;
        try {
          candidate = await fetch(url, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (e) {
          if (params.signal?.aborted) {
            throw createAbortError(e instanceof Error ? e.message : undefined);
          }
          // 建连阶段网络失败：还有重试机会就退避重试，否则报 network_error。
          if (attempt < STREAM_OPEN_DELAYS.length - 1) continue;
          throw new LLMError("network_error", "网络异常，请检查连接后重试", ["retry"]);
        }

        if (candidate.ok) { resp = candidate; break; }

        // 429 / 5xx：首包前的安全窗口，退避后重试；末次仍失败则走标准错误分类。
        const retryable = candidate.status === 429 || candidate.status >= 500;
        if (retryable && attempt < STREAM_OPEN_DELAYS.length - 1) {
          // drain body 避免连接泄漏（best-effort）
          try { await candidate.text(); } catch { /* ignore */ }
          continue;
        }
        const text = await candidate.text();
        handleError(candidate.status, text);
      }

      if (!resp) {
        // 理论不可达（循环要么 break/return 要么 throw），防御性兜底。
        throw new LLMError("network_error", "网络异常，请检查连接后重试", ["retry"]);
      }

      if (!resp.body) {
        throw new LLMError("network_error", "网络异常，请检查连接后重试", ["retry"]);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        armTimeout(); // 收到数据，重置超时计时器

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
          let reasoningDelta = "";
          let finish: string | null = null;
          let toolCallDeltas: import("./provider.js").ToolCallChunkDelta[] | undefined;
          if (choices.length > 0) {
            const delta = (choices[0].delta ?? {}) as Record<string, unknown>;
            deltaText = (delta.content as string) ?? "";
            // DeepSeek reasoner / R1 等 thinking 模型在 thinking 阶段把内容放
            // delta.reasoning_content（不是 delta.content），dispatch 必须累积起来
            // 在多轮调用时回传，否则 API 报 400（真机 2026-05-04 复现）。
            reasoningDelta = (delta.reasoning_content as string) ?? "";
            finish = (choices[0].finish_reason as string) ?? null;
            const rawTcs = delta.tool_calls as
              | { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }[]
              | undefined;
            if (Array.isArray(rawTcs) && rawTcs.length > 0) {
              toolCallDeltas = rawTcs.map((tc) => ({
                index: typeof tc.index === "number" ? tc.index : 0,
                id: tc.id,
                type: tc.type === "function" ? "function" : undefined,
                function: tc.function
                  ? {
                      name: tc.function.name,
                      arguments: tc.function.arguments,
                    }
                  : undefined,
              }));
            }
          }

          const usage = chunkData.usage as Record<string, number> | undefined;
          yield {
            delta: deltaText,
            ...(toolCallDeltas ? { tool_call_deltas: toolCallDeltas } : {}),
            ...(reasoningDelta ? { reasoning_delta: reasoningDelta } : {}),
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
      // LLMError / AbortError 保持既有语义：AbortError = 内部 READ_TIMEOUT 触发的
      // controller.abort()（外部未 abort），归 network_error 带重试。
      if (e instanceof LLMError) throw e;
      if (isAbortError(e)) {
        throw new LLMError("network_error", "网络异常，请检查连接后重试", ["retry"]);
      }
      // M16：流中途断网。fetch 的 ReadableStream reader.read() 在连接被 RST / DNS 丢失
      // 时抛 TypeError（"network error" / "Failed to fetch" 等），不是 AbortError。
      // 旧代码裸 `throw e` → 上游归 INTERNAL_ERROR/DISPATCH_FAILURE（无重试按钮），
      // 与"首包前断网正确报 network_error"不一致。这里统一分类为 network_error 带
      // retry；partial draft 由上层 rescue 保住，仅错误分类被修正。
      if (e instanceof TypeError) {
        throw new LLMError("network_error", "网络异常，请检查连接后重试", ["retry"]);
      }
      throw e;
    } finally {
      clearTimeoutIfSet();
      if (listenerAttached) params.signal?.removeEventListener("abort", onExternalAbort);
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
        // reasoning_content 跟 content 同样可能含 lone surrogates，需 sanitize 后再发回
        ...(typeof m.reasoning_content === "string"
          ? { reasoning_content: sanitizeForJson(m.reasoning_content) }
          : {}),
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
    const url = this.chatUrl();

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
    // tool calling 不兼容 —— 关键字过宽 false positive 修复（2026-05-04 真机回归）：
    // 旧版任何含 "tool" 子串的 400 错误都被误判，包括 "tool_call_id mismatch" /
    // "tool result not found" 等正常 agent loop 协议错。改为要求 "tool" 必须配上
    // 显著词（calling / support / unsupported / not allowed），其它含 tool 关键词
    // 的错误回落到默认分支显示原始 detail 让用户能看到真错。
    // BUG 3.1 错误码拆分（2026-05-05）：forced tool_choice 不支持 ≠ tool calling 不支持。
    // 前者是模型支持 function calling 但不允许指定非 "auto" 的 tool_choice（如
    // deepseek-reasoner commit 7dc151b 真机确证）。拆分后 dispatch 可 catch
    // forced_tool_choice_unsupported 自动降级到 "auto"，不让用户看到错误。
    // 决策依据：D-0046 "拆分让 dispatch 能 catch forced_tool_choice_unsupported
    // 自动降级到 'auto'"。
    const forcedToolChoicePhrases = [
      "tool choice",
      "tool_choice",
      "this tool_choice",
    ];
    const toolUnsupportedPhrases = [
      "tool calling",
      "tool_calling",
      "tool calls are not supported",
      "tool calls not supported",
      "tools are not supported",
      "tools not supported",
      "function calling not supported",
      "function calls are not supported",
      "function_call is not supported",
      "does not support function",
      "model does not support tool",
    ];
    // 检查顺序：先 toolUnsupported 后 forcedToolChoice。
    // 防御性场景：如果某模型返回 "tool_choice is not supported because tools are
    // not supported"（同时含两组关键字），应被识别为 tools_unsupported（语义更重，
    // 模型完全无法 tool call），而非 forced_tool_choice_unsupported（仅不支持
    // forced 模式但能 auto）。误判会让 dispatch 无限重试 "auto" 死循环。
    // Review A 2026-05-05 P1 修复。
    if (toolUnsupportedPhrases.some((p) => lower.includes(p))) {
      throw new LLMError("tools_unsupported", "当前模型不支持 tool calling", ["retry"], 400);
    }
    if (forcedToolChoicePhrases.some((p) => lower.includes(p))) {
      throw new LLMError("forced_tool_choice_unsupported", "当前模型不支持指定 tool_choice，请用 auto 模式", ["retry"], 400);
    }
  }

  if (statusCode >= 500) {
    throw new LLMError("network_error", "网络异常，请检查连接后重试", ["retry"], statusCode);
  }

  // 附带提供商原始错误以便调试
  const detail = extractErrorDetail(bodyText);
  throw new LLMError("network_error", `LLM 调用失败 (HTTP ${statusCode})${detail ? `: ${detail}` : ""}`, ["retry"], statusCode);
}
