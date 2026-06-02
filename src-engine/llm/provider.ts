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
  /**
   * Thinking 模型（DeepSeek-V3 reasoner / R1 / OpenAI o1 等）多轮对话时必须回传上一轮
   * 产生的思考链。DeepSeek API 报 "The reasoning_content in the thinking mode must
   * be passed back to the API." 即此字段缺失。
   *
   * - 流式生成时由 provider 从 chunk.reasoning_delta 累积，写在最终 assistant message
   * - 非 thinking 模型不会产生此字段；序列化进 OpenAI 兼容请求体不影响（多余字段被忽略）
   * - simple agent loop dispatch 注入 internalHistory 的 assistant message 必须带上
   */
  reasoning_content?: string;
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

/**
 * 流式 tool_call 增量。OpenAI 协议把 tool_call 拆成多段：
 * 首次给 index/id/type/function.name，后续给 function.arguments 的字符串片段。
 * 调用方按 index 累积 arguments，finish_reason='tool_calls' 时拼装完整 ToolCall。
 */
export interface ToolCallChunkDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    /** 部分 JSON 字符串片段；调用方累加到对应 index 的 args 缓冲。 */
    arguments?: string;
  };
}

/** 流式生成的单个增量片段。 */
export interface LLMChunk {
  delta: string;
  /** 当本片段含 tool_call 信息时不为空（content + tool_calls 同 chunk 互斥时各有所长）。 */
  tool_call_deltas?: ToolCallChunkDelta[];
  /**
   * Thinking 模型（DeepSeek reasoner / o1 等）流式 chunk 中 `delta.reasoning_content`
   * 字段的内容。dispatch 累积成完整 reasoning_content 字符串后写进下一轮 assistant
   * message，否则 deepseek API 多轮会报 400 "reasoning_content must be passed back".
   * 非 thinking 模型此字段恒为 undefined。
   */
  reasoning_delta?: string;
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

/**
 * OpenAI tool_choice 字段两种形态：字符串 "auto" / "none" / "required"，
 * 或显式指定函数 `{type:"function", function:{name:"X"}}`。
 * 简版 agent loop 用后者强制 chat_reply 路径短消息硬路由（2026-05-04 真机偏离修复）。
 */
export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

export interface GenerateParams {
  messages: Message[];
  max_tokens: number;
  temperature: number;
  top_p: number;
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;
  /** 外部取消信号（与内部超时合并） */
  signal?: AbortSignal;
}

export interface LLMProvider {
  /** 非流式调用。 */
  generate(params: GenerateParams): Promise<LLMResponse>;
  /** 流式调用。 */
  generateStream(params: GenerateParams): AsyncIterable<LLMChunk>;
}
