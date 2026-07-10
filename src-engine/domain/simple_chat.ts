// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — SimpleChat 消息 domain 类型 + 持久化数据结构。
 *
 * 每个 AU 一份 chat.yaml（位于 `{au_path}/.well-known/simple-chat.yaml`），
 * 永久驻留对话历史。
 *
 * 消息形状是 discriminated union（`kind` 判别），UI 渲染器与 chat-to-llm 转换
 * 都按 kind 分发。这些 kind 直接序列化进 chat.yaml 的 messages 数组，本来就是
 * 领域数据 —— 真相源在此（盲审长期债④第一步：原真相源在 src-ui/src/ui/simple/types.ts，
 * UI 现改为薄 re-export）。增删字段务必同步考虑迁移：optional 字段首选；
 * 新增 status 状态值要保持向后兼容。
 *
 * **为什么顶层消息形状用 type alias 而非 interface**：type alias 的对象字面量类型
 * 具备隐式 index signature，使 `SimpleChatMessage` 可以直接赋给宽容壳
 * `SimpleChatMessageEnvelope`（save 路径零 cast）；interface 没有隐式 index
 * signature，会报 "Index signature is missing"。读方向的唯一窄化点是
 * `asSimpleChatMessages`（见下）。
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

export type SimpleDraftStatus =
  | "streaming"
  | "pending"
  | "accepted"
  | "rejected"
  | "discarded"
  | "error";

export type SimpleToolCallStatus =
  | "pending"
  | "confirmed"
  | "skipped"
  | "undone"
  | "error";

export type SimpleSystemTone = "info" | "warning" | "error";

/**
 * confirm 后落盘的撤销元数据，用于「撤销」按钮还原。lore 类型记 category+filename
 * 删文件；pinned 记 index+content 删 pinned；其他 tool（modify_*）当前主仓库也只能
 * "unsupported"，简版同步。随 tool-call 消息持久化进 chat.yaml（向后兼容：旧消息
 * 无此字段读出 undefined）；settings-chat（full 模式）的内存卡片状态也共用本类型。
 */
export interface ToolUndoMeta {
  kind: "lore" | "fact" | "pinned" | "unsupported";
  category?: string;
  filename?: string;
  factId?: string;
  pinnedIndex?: number;
  pinnedContent?: string;
  chapterNum?: number;
  note?: string;
}

export type SimpleUserMessage = {
  id: string;
  kind: "user";
  timestamp: string;
  content: string;
};

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

export type SimpleAssistantMessage = {
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
};

/**
 * agent loop 中 engine 自动 fetch read-only tool 的结果，注入 chat history 喂给下一轮 LLM。
 * 跟 OpenAI `{role:"tool", tool_call_id, content}` 协议一一对应。
 * UI 不直接渲染（信息已经在 chapter-preview / setting-preview card 里展示），
 * 但会进 chat-to-llm 转换让 LLM 看到工具结果。
 */
export type SimpleToolResultMessage = {
  id: string;
  kind: "tool-result";
  timestamp: string;
  /** 对应 SimpleAssistantToolCall.id，让 LLM 把 result 串到自己上一轮的 tool_call。 */
  toolCallId: string;
  toolName: string;
  /** 工具执行返回内容（章节正文 / 设定文件原文 / FILE_NOT_FOUND / TOOL_ARGS_INVALID 等）。 */
  content: string;
  errorMessage?: string;
};

export type SimpleWritingDraftMessage = {
  id: string;
  kind: "writing-draft";
  timestamp: string;
  /** 草稿对应章节号；接受时写入这一章。 */
  chapterNum: number;
  /** 草稿标签（A/B/C/...），由 engine 在 confirm 时生成；本地 streaming 阶段先用临时标签。 */
  draftLabel: string;
  /** 当前正文，streaming 期增量更新；finalize 后冻结。 */
  content: string;
  status: SimpleDraftStatus;
  /** finalize 时回填，用于"接受"按钮调 confirmChapter。 */
  acceptedAt?: string;
  acceptedRevision?: number;
  errorMessage?: string;
  /** engine done 事件携带的 generated_with；confirm 时回传给 ops 审计。 */
  generatedWith?: Record<string, unknown>;
};

export type SimpleToolCallMessage = {
  id: string;
  kind: "tool-call";
  timestamp: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  status: SimpleToolCallStatus;
  resultNote?: string;
  errorMessage?: string;
  /** 见 ToolUndoMeta 注释；chat.yaml 持久化向后兼容：旧消息无此字段读出 undefined。 */
  undoMeta?: ToolUndoMeta | null;
};

export type SimpleChapterPreviewMessage = {
  id: string;
  kind: "chapter-preview";
  timestamp: string;
  chapterNum: number;
  /** 折叠态 / 展开态；UI 自管。 */
  expanded: boolean;
};

export type SimpleSettingPreviewMessage = {
  id: string;
  kind: "setting-preview";
  timestamp: string;
  /** 'characters/Alice.md' 或 'worldbuilding/Magic.md' 等相对路径。 */
  filePath: string;
  expanded: boolean;
};

export type SimpleSystemMessage = {
  id: string;
  kind: "system";
  timestamp: string;
  tone: SimpleSystemTone;
  content: string;
};

export type SimpleChatMessage =
  | SimpleUserMessage
  | SimpleAssistantMessage
  | SimpleWritingDraftMessage
  | SimpleToolCallMessage
  | SimpleToolResultMessage
  | SimpleChapterPreviewMessage
  | SimpleSettingPreviewMessage
  | SimpleSystemMessage;

/**
 * 持久化宽容壳：仓储读 chat.yaml 时只校验 id/timestamp/kind 三件套，其余字段
 * 原样透传 —— 未知 kind / 新版字段随 round-trip 保留（forward-compat 闭环证明见
 * file_simple_chat.test.ts「透传」用例）。正式消息形状是上面的 SimpleChatMessage
 * union：写方向 union 可直接赋给本壳（顶层消息用 type alias 的原因，见文件头注释）；
 * 读方向经 asSimpleChatMessages 窄化。
 */
export interface SimpleChatMessageEnvelope {
  /** 全局唯一消息 ID。 */
  id: string;
  /** ISO 8601 时间戳。 */
  timestamp: string;
  /** SimpleChatMessage union 的 `kind` 判别字段；宽容读取下可能是未知值。 */
  kind: string;
  /** 任意附加字段（content / chapterNum / status / toolName / 等）。 */
  [key: string]: unknown;
}

/**
 * 仓储宽容读取边界 → 正式 domain union 的**唯一**窄化点（dict-to-domain）。
 * 仓储已校验 id/timestamp/kind 三件套；详细字段不再运行时校验（向后兼容旧版
 * message 形状），未知 kind 成员静态上被视为 union 但运行时消费方按 kind 分发
 * 天然跳过（switch default），故此处窄化是安全的。UI / 服务层不得再自行 cast。
 */
export function asSimpleChatMessages(messages: SimpleChatMessageEnvelope[]): SimpleChatMessage[] {
  return messages as SimpleChatMessage[];
}

export interface SimpleChatFile {
  /** Schema 版本号。当前 1。后续若改 message 形状，写时升版本号 + 兼容旧版本读。 */
  version: number;
  /** AU 路径，写时回填用作 round-trip 校验，读时不校验值（允许 fork / rename）。 */
  au_path: string;
  created_at: string;
  updated_at: string;
  messages: SimpleChatMessageEnvelope[];
}

export const SIMPLE_CHAT_VERSION = 1;

export function createSimpleChatFile(partial?: Partial<SimpleChatFile>): SimpleChatFile {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    version: SIMPLE_CHAT_VERSION,
    au_path: "",
    created_at: now,
    updated_at: now,
    messages: [],
    ...partial,
  };
}
