// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LLM Provider 抽象接口 + 数据结构。参见 PRD §2.3、§4.2。 */

// ---------------------------------------------------------------------------
// 数据结构
// ---------------------------------------------------------------------------

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** 非流式生成结果。 */
export interface LLMResponse {
  content: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  finish_reason: string;
  tool_calls?: ToolCall[];
}

/** 流式生成的单个增量片段。 */
export interface LLMChunk {
  delta: string;
  is_final: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  finish_reason: string | null;
}

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

export class LLMError extends Error {
  constructor(
    public error_code: string,
    message: string,
    public actions: string[] = [],
    public status_code: number | null = null,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

// ---------------------------------------------------------------------------
// 抽象接口
// ---------------------------------------------------------------------------

export interface GenerateParams {
  messages: Message[];
  max_tokens: number;
  temperature: number;
  top_p: number;
  tools?: ToolDefinition[];
  tool_choice?: string;
}

export interface LLMProvider {
  /** 非流式调用。 */
  generate(params: GenerateParams): Promise<LLMResponse>;
  /** 流式调用。 */
  generateStream(params: GenerateParams): AsyncIterable<LLMChunk>;
}
