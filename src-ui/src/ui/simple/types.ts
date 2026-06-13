// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite (粮坊·简) — SimpleChatPanel 共享类型。
 *
 * 设计原则：每条消息是一个 discriminated union 成员（kind），UI 渲染器按 kind 分发。
 * 持久化（C2）将这套类型直接序列化到 chat.yaml 的 messages 数组里，所以增删字段务必
 * 同步考虑迁移：optional 字段首选；新增 status 状态值要保持向后兼容。
 */

export type SimpleMessageKind =
  | "user"
  | "assistant"
  | "writing-draft"
  | "tool-call"
  | "tool-result"
  | "chapter-preview"
  | "setting-preview"
  | "system";

export type DraftStatus =
  | "streaming"
  | "pending"
  | "accepted"
  | "rejected"
  | "discarded"
  | "error";

export type ToolCallStatus =
  | "pending"
  | "confirmed"
  | "skipped"
  | "undone"
  | "error";

export type SystemTone = "info" | "warning" | "error";

export interface SimpleUserMessage {
  id: string;
  kind: "user";
  timestamp: string;
  content: string;
}

/**
 * agent loop 中 LLM 一轮调用产出的单个 tool call。
 * args 保持 stringified JSON 以跟 OpenAI tool_calls 协议一致 ——
 * 转 OpenAI history 时无需二次序列化；从 LLM stream tool_call_deltas 累积出来时也是字符串。
 * Phase 1 MVP 只在 read-only tool（show_chapter / show_setting）的 assistant 消息上挂；
 * mutating tool 走 tool-call kind（用户 confirm 路径），保留旧版渲染 ToolCallCard 的语义。
 */
export interface SimpleAssistantToolCall {
  id: string;
  name: string;
  /** stringified JSON，例如 '{"chapterNum":5}'。 */
  args: string;
}

export interface SimpleAssistantMessage {
  id: string;
  kind: "assistant";
  timestamp: string;
  /** AI chat_reply tool 返回的纯文本回答（闲聊 / 元问题 / 澄清反问）。
   * agent loop 中携带 toolCalls 的 assistant 消息 content 可为空字符串。 */
  content: string;
  /** agent loop 一轮 LLM 决定调用的工具（read-only 自动 fetch / 或缺 args 触发 LLM 重试）；
   * 持久化进 chat.yaml 让 reload 后 LLM 能从 history 还原完整 reasoning 链路。
   * 旧 schema reload 出来此字段为 undefined（向后兼容）。 */
  toolCalls?: SimpleAssistantToolCall[];
}

/**
 * agent loop 中 engine 自动 fetch read-only tool 的结果，注入 chat history 喂给下一轮 LLM。
 * 跟 OpenAI `{role:"tool", tool_call_id, content}` 协议一一对应。
 * UI 不直接渲染（信息已经在 chapter-preview / setting-preview card 里展示），
 * 但会进 chat-to-llm 转换让 LLM 看到工具结果。
 */
export interface SimpleToolResultMessage {
  id: string;
  kind: "tool-result";
  timestamp: string;
  /** 对应 SimpleAssistantToolCall.id，让 LLM 把 result 串到自己上一轮的 tool_call。 */
  toolCallId: string;
  toolName: string;
  /** 工具执行返回内容（章节正文 / 设定文件原文 / FILE_NOT_FOUND / TOOL_ARGS_INVALID 等）。 */
  content: string;
  errorMessage?: string;
}

export interface SimpleWritingDraftMessage {
  id: string;
  kind: "writing-draft";
  timestamp: string;
  /** 草稿对应章节号；接受时写入这一章。 */
  chapterNum: number;
  /** 草稿标签（A/B/C/...），由 engine 在 confirm 时生成；本地 streaming 阶段先用临时标签。 */
  draftLabel: string;
  /** 当前正文，streaming 期增量更新；finalize 后冻结。 */
  content: string;
  status: DraftStatus;
  /** finalize 时回填，用于"接受"按钮调 confirmChapter。 */
  acceptedAt?: string;
  acceptedRevision?: number;
  errorMessage?: string;
  /** engine done 事件携带的 generated_with；confirm 时回传给 ops 审计。 */
  generatedWith?: Record<string, unknown>;
}

export interface SimpleToolCallMessage {
  id: string;
  kind: "tool-call";
  timestamp: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  status: ToolCallStatus;
  resultNote?: string;
  errorMessage?: string;
  /**
   * confirm 后落盘，用于"撤销"按钮还原。lore 类型记 category+filename 删文件；
   * pinned 记 index+content 删 pinned；其他 tool（modify_*）当前主仓库也只能
   * "unsupported"，简版同步。chat.yaml 持久化向后兼容：旧消息无此字段读出 undefined。
   */
  undoMeta?: import("../shared/settings-chat/types").ToolUndoMeta | null;
}

export interface SimpleChapterPreviewMessage {
  id: string;
  kind: "chapter-preview";
  timestamp: string;
  chapterNum: number;
  /** 折叠态 / 展开态；UI 自管。 */
  expanded: boolean;
}

export interface SimpleSettingPreviewMessage {
  id: string;
  kind: "setting-preview";
  timestamp: string;
  /** 'characters/Alice.md' 或 'worldbuilding/Magic.md' 等相对路径。 */
  filePath: string;
  expanded: boolean;
}

export interface SimpleSystemMessage {
  id: string;
  kind: "system";
  timestamp: string;
  tone: SystemTone;
  content: string;
}

export type SimpleChatMessage =
  | SimpleUserMessage
  | SimpleAssistantMessage
  | SimpleWritingDraftMessage
  | SimpleToolCallMessage
  | SimpleToolResultMessage
  | SimpleChapterPreviewMessage
  | SimpleSettingPreviewMessage
  | SimpleSystemMessage;

/** 生成草稿 message id 时的前缀；C2 持久化时按 id 去重。 */
export const MESSAGE_ID_PREFIX = "smplmsg";

export function makeMessageId(): string {
  return `${MESSAGE_ID_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
