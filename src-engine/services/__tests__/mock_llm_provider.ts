// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 共享 LLMProvider mock（盲审 2026-07-09：此前 12+ 服务测试各自内联重复定义
 * provider mock；repo 层早有共享 mock_adapter，provider 层缺同款）。
 *
 * 新测试一律从此 import；存量测试迁移为跟随性重构（长期债②，2026-07-13 集中清偿）。
 *
 * 三种构造：
 *  - createMockLLMProvider({content|error|toolCalls|response|streamChunks}) —— 单轮固定响应；
 *    generate 返回 content(+可选 tool_calls)、generateStream 逐片 yield（缺省按 content 单终止片）。
 *  - createScriptedStreamProvider(iters) —— 多轮脚本化流式（第 N 次 generateStream yield iters[N]），
 *    统一原先 agent_loop / m9 / simple_chat_dispatch / react_extraction_dispatch 各自 byte-复制的
 *    scriptedProvider + capture 变体（断言读 provider.calls[n].messages / .tool_choice）。
 */

import type { GenerateParams, LLMChunk, LLMProvider, LLMResponse, ToolCall } from "../../llm/provider.js";

export interface MockLLMProviderOptions {
  /** 固定文本响应；传函数可按调用参数动态生成。 */
  content?: string | ((params: GenerateParams) => string);
  /** 抛错模拟（网络/超时/key 无效）。设置后 generate/generateStream 均抛。 */
  error?: Error;
  /** generate() 返回的 tool_calls（settings_chat 等 tool-call 路径需要）。 */
  toolCalls?: ToolCall[];
  /** 覆盖 generate() 返回的 model / finish_reason / token 计数等（默认零值/stop）。 */
  response?: Partial<LLMResponse>;
  /** generateStream() 逐片 yield 的真 LLMChunk；缺省 = 按 content 单片终止 chunk。 */
  streamChunks?: LLMChunk[];
}

export interface MockLLMProvider extends LLMProvider {
  /** 每次 generate/generateStream 的入参记录（断言 prompt/参数用）。 */
  calls: GenerateParams[];
}

/** 单片「终止」流式 chunk —— 把一段完整文本当一次性 final chunk 吐出。 */
function finalChunk(content: string): LLMChunk {
  return { delta: content, is_final: true, input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
}

export function createMockLLMProvider(options: MockLLMProviderOptions = {}): MockLLMProvider {
  const calls: GenerateParams[] = [];
  const resolveContent = (params: GenerateParams): string =>
    typeof options.content === "function" ? options.content(params) : (options.content ?? "");

  return {
    calls,
    async generate(params: GenerateParams): Promise<LLMResponse> {
      calls.push(params);
      if (options.error) throw options.error;
      return {
        content: resolveContent(params),
        model: "mock",
        input_tokens: 0,
        output_tokens: 0,
        finish_reason: options.toolCalls && options.toolCalls.length > 0 ? "tool_calls" : "stop",
        ...(options.toolCalls ? { tool_calls: options.toolCalls } : {}),
        ...options.response,
      };
    },
    async *generateStream(params: GenerateParams): AsyncIterable<LLMChunk> {
      calls.push(params);
      if (options.error) throw options.error;
      const chunks = options.streamChunks ?? [finalChunk(resolveContent(params))];
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

/**
 * 多轮脚本化流式 provider —— 第 N 次 generateStream 调用 yield `iters[N]`（越界 → 空片流）。
 * generate 返回空终止响应（脚本化 provider 走 stream 路径）。`.calls` 记录每次 GenerateParams，
 * 供断言消息序列 / tool_choice（替代各测试自建的 capture 数组）。
 */
export function createScriptedStreamProvider(iters: LLMChunk[][]): MockLLMProvider {
  const calls: GenerateParams[] = [];
  let callIndex = 0;
  return {
    calls,
    async generate(params: GenerateParams): Promise<LLMResponse> {
      calls.push(params);
      return { content: "", model: "mock", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
    },
    async *generateStream(params: GenerateParams): AsyncIterable<LLMChunk> {
      calls.push(params);
      const chunks = iters[callIndex++] ?? [];
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}
