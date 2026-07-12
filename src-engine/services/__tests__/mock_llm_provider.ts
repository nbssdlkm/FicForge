// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 共享 LLMProvider mock（盲审 2026-07-09：此前 12+ 服务测试各自内联重复定义
 * provider mock；repo 层早有共享 mock_adapter，provider 层缺同款）。
 *
 * 新测试一律从此 import；存量测试迁移为跟随性重构，各文件被触碰时顺手换。
 */

import type { GenerateParams, LLMChunk, LLMProvider, LLMResponse } from "../../llm/provider.js";

export interface MockLLMProviderOptions {
  /** 固定文本响应；传函数可按调用参数动态生成。 */
  content?: string | ((params: GenerateParams) => string);
  /** 抛错模拟（网络/超时/key 无效）。设置后 generate/generateStream 均抛。 */
  error?: Error;
  /** 流式分片（generateStream 逐片 yield）；缺省按 content 单片。 */
  chunks?: string[];
}

export interface MockLLMProvider extends LLMProvider {
  /** 每次 generate/generateStream 的入参记录（断言 prompt/参数用）。 */
  calls: GenerateParams[];
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
        input_tokens: 0,
        output_tokens: 0,
      } as LLMResponse;
    },
    async *generateStream(params: GenerateParams): AsyncIterable<LLMChunk> {
      calls.push(params);
      if (options.error) throw options.error;
      const pieces = options.chunks ?? [resolveContent(params)];
      for (const piece of pieces) {
        yield { type: "token", content: piece } as unknown as LLMChunk;
      }
    },
  };
}
