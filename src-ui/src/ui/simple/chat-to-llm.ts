// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — chat history → OpenAI multi-turn messages 转换
 *
 * 简版"全塞"哲学：不截取不简化。accepted/discarded/error 章节正文全带、
 * tool 完整 args 全带，让 LLM 看到完整对话连续性。token 消耗在对话面板顶部
 * badge 显示让用户监控（DeepSeek 1M ctx 模型支撑得起）。
 *
 * 跳过：chapter-preview / setting-preview / system message —— UI 操作 / 噪音，
 * 对 LLM 无意义。thinking placeholder 也是 system kind 自然被跳。
 *
 * 当前 user_input 不应通过此 helper 转换 —— 它由 dispatch.user_input 参数单独
 * 传，engine 端 assemble_chat_context 自己拼。caller 调用前应过滤掉刚 append
 * 的当前 user message。
 */

import type { Message } from "@ficforge/engine";
import type { SimpleChatMessage } from "./types";

/**
 * 一条 OpenAI 协议 message。直接 alias 到 engine `Message` 类型，避免手写双份接口
 * 漂移（v4-pro C2 review P1-1）—— dispatch 把 history 拼进 messages array 送 provider，
 * UI 端这边就是 source of truth 一份。
 *
 * 字段约束（OpenAI 协议）：
 * - role="assistant" 携 tool_calls 时 content 可为空字符串（部分严格 provider 要求 null；
 *   单轮 dispatch 不会触发该路径，C3 接通真实多轮后再决定是否改 engine `Message.content`
 *   为 string|null —— v4-pro C2 review P1-2 关注点）
 * - role="tool" 必须配 tool_call_id（engine 端 LLM 会按 id 串到上一条 assistant 的某个 tool_call）
 * - tool_calls[i].function.arguments 是 stringified JSON（不是 object）
 */
export type OpenAIChatMessage = Message;

function statusMarker(
  status: "pending" | "confirmed" | "skipped" | "undone" | "error",
  errorMessage: string | undefined,
): string {
  switch (status) {
    case "confirmed": return "[已执行]";
    case "skipped": return "[已跳过]";
    case "undone": return "[已撤销]";
    case "error": return `[失败：${errorMessage ?? "unknown"}]`;
    case "pending": return "[待用户确认]";
  }
}

function draftStatusMarker(
  status: "streaming" | "pending" | "accepted" | "rejected" | "discarded" | "error",
): string {
  switch (status) {
    case "accepted": return "\n\n[此草稿已被用户接受为正式章节]";
    case "discarded": return "\n\n[此草稿已被用户丢弃]";
    case "rejected": return "\n\n[此草稿已被用户拒绝]";
    case "error": return "\n\n[此草稿生成出错]";
    case "pending": return "\n\n[此草稿等待用户确认]";
    case "streaming": return ""; // streaming 中的不应进 history（caller 应过滤）
  }
}

export function chatToOpenAIMessages(messages: SimpleChatMessage[]): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = [];
  // 跟踪当前可见的 tool_call_id 集合 —— OpenAI 协议要求 role:"tool" 消息的
  // tool_call_id 必须出现在前置 role:"assistant" 的 tool_calls[].id 中，否则 API
  // 报 "Messages with role 'tool' must be a response to a preceding message
  // with 'tool_calls'"。简版早期 chat.yaml 因为 SimpleChatPanel.onToolCall 漏了
  // 持久化 assistant.toolCalls，read-only 路径会留下 orphan tool-result；这里
  // 在转换层做防御 —— orphan tool-result 直接 skip 不入 OpenAI history（已修
  // 但已存在的 chat.yaml 仍含 orphan，避免 reload 后整段 history 不可用）。
  // 真机 2026-05-04 P0 修复。
  const knownToolCallIds = new Set<string>();
  for (const msg of messages) {
    switch (msg.kind) {
      case "user":
        result.push({ role: "user", content: msg.content });
        break;
      case "assistant":
        // chat_reply 闲聊回答 → 直接进 history（content + 无 tool_calls）。
        // agent loop 一轮 LLM 决定调 read-only tool 时 → 携 tool_calls，content 可空，
        // 紧随其后的 SimpleToolResultMessage 会被转成 role:"tool" 串回该 tool_call.id。
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          result.push({
            role: "assistant",
            content: msg.content,
            tool_calls: msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.args },
            })),
          });
          // 这些 tool_call.id 现在可被后续 tool-result 配对
          for (const tc of msg.toolCalls) knownToolCallIds.add(tc.id);
        } else {
          result.push({ role: "assistant", content: msg.content });
        }
        break;
      case "writing-draft":
        // 章节草稿 — 全塞正文 + 状态 marker（让 LLM 知道用户接没接受）
        // streaming 状态跳过（不完整内容污染 history）
        if (msg.status === "streaming") break;
        if (!msg.content) break;
        result.push({
          role: "assistant",
          content: msg.content + draftStatusMarker(msg.status),
        });
        break;
      case "tool-call": {
        // tool call — 完整 args + 状态 marker
        const argsBlock = JSON.stringify(msg.toolArgs, null, 2);
        result.push({
          role: "assistant",
          content: `[tool: ${msg.toolName}]\n${argsBlock}\n${statusMarker(msg.status, msg.errorMessage)}`,
        });
        break;
      }
      case "tool-result":
        // agent loop 自动 fetch 的工具结果，串回上一条 assistant tool_call.id。
        // OpenAI 协议要求 role:"tool" 必须配 tool_call_id；若该 id 在 history 里找不到
        // 对应 assistant.tool_calls 项，整条 history 被 API 拒。
        // 防御：跳过 orphan tool-result（早期 chat.yaml 因 onToolCall 漏写
        // assistant.toolCalls 留下，2026-05-04 真机 P0 复现）。新代码已在 SimpleChatPanel
        // 起源端修，此防御保旧用户 chat.yaml 不变砖。
        // errorMessage 不进 OpenAI content 字段（防 LLM 误把 errorMessage 当工具产出真实
        // 文本），只在 UI / 持久化里保留。
        if (knownToolCallIds.has(msg.toolCallId)) {
          result.push({
            role: "tool",
            tool_call_id: msg.toolCallId,
            content: msg.content,
          });
        } else {
          // orphan tool-result：可能是 onToolCall 漏写 assistant.toolCalls 的早期 chat
          // 历史，或外部编辑器把 chat.yaml 改坏。skip 让 history 仍合法。
          // console.warn 在 production 也输出，方便用户 export 日志诊断。
          // eslint-disable-next-line no-console
          console.warn(
            `[chat-to-llm] orphan tool-result skipped: tool_call_id=${msg.toolCallId} tool=${msg.toolName}; ` +
            `no preceding assistant.toolCalls match. Likely legacy chat.yaml prior to 2026-05-04 fix.`,
          );
        }
        break;
      case "chapter-preview":
      case "setting-preview":
      case "system":
        // UI 操作 / 噪音消息，对 LLM 无意义；显式 fall-through 不进 history。
        break;
      default: {
        // exhaustive 检查：union 加新成员时编译期强制处理（v4-pro review P1 修复）。
        const _exhaustive: never = msg;
        void _exhaustive;
        break;
      }
    }
  }

  // 对称防御：drop orphan assistant.tool_calls（即 assistant 含 tool_calls 但后续
  // 没有匹配的 tool messages）。OpenAI 报 "An assistant message with 'tool_calls'
  // must be followed by tool messages... insufficient tool messages" 即此情形（真机
  // 2026-05-04 复现：dispatch chat_reply terminal 路径混 read-only 时漏 fetch 留
  // orphan）。
  // 处理：tool_calls 对应的 tool_call_ids 不全配对时，downgrade 该 assistant 消息
  // 为纯 content；若 content 也空则整体 drop。
  const cleaned: OpenAIChatMessage[] = [];
  // downgrade 半配对 assistant 时，同步剔除它已配对的那几条 role:"tool" 消息（M18）。
  // 收集要跳过的 tool 消息 index —— 若只丢 assistant 的 tool_calls、留下先前 push 的
  // 匹配 tool 消息，那些 tool 就没了前置 tool_calls 父消息，成 orphan → OpenAI 400
  // "Messages with role 'tool' must be a response to a preceding message with
  // 'tool_calls'"，整段 history 被钉死无法再发送。
  const orphanedToolIndexes = new Set<number>();
  for (let i = 0; i < result.length; i++) {
    const m = result[i];
    if (m.role !== "assistant" || !m.tool_calls || m.tool_calls.length === 0) continue;
    // 收集后续 tool messages 的 tool_call_id（直到遇到非-tool 消息为止；OpenAI 协议下
    // tool_calls 后立即跟 N 个 tool messages，再之后是其它 role）
    const requiredIds = new Set(m.tool_calls.map((tc) => tc.id));
    const seenIds = new Set<string>();
    const followingToolIndexes: number[] = [];
    for (let j = i + 1; j < result.length; j++) {
      const next = result[j];
      if (next.role !== "tool") break;
      if (next.tool_call_id) seenIds.add(next.tool_call_id);
      followingToolIndexes.push(j);
    }
    const allMatched = [...requiredIds].every((id) => seenIds.has(id));
    if (!allMatched) {
      const missing = [...requiredIds].filter((id) => !seenIds.has(id));
      // eslint-disable-next-line no-console
      console.warn(
        `[chat-to-llm] orphan assistant.tool_calls dropped: missing tool messages for ids [${missing.join(", ")}]; ` +
        `downgrading to plain assistant content and dropping ${followingToolIndexes.length} paired tool message(s). ` +
        `This is likely a chat.yaml inconsistency from a previous failed dispatch.`,
      );
      // 丢 tool_calls 后，它已配对的那几条 tool 消息就没有父消息了 → 标记跳过。
      for (const idx of followingToolIndexes) orphanedToolIndexes.add(idx);
    }
  }

  for (let i = 0; i < result.length; i++) {
    if (orphanedToolIndexes.has(i)) continue;
    const m = result[i];
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      const requiredIds = new Set(m.tool_calls.map((tc) => tc.id));
      const seenIds = new Set<string>();
      for (let j = i + 1; j < result.length; j++) {
        const next = result[j];
        if (next.role !== "tool") break;
        if (next.tool_call_id) seenIds.add(next.tool_call_id);
      }
      const allMatched = [...requiredIds].every((id) => seenIds.has(id));
      if (allMatched) {
        cleaned.push(m);
      } else {
        // downgrade：保留 content / reasoning_content（如有），丢 tool_calls
        const downgraded: OpenAIChatMessage = {
          role: "assistant",
          content: m.content,
        };
        if (m.reasoning_content !== undefined) downgraded.reasoning_content = m.reasoning_content;
        if (downgraded.content || downgraded.reasoning_content) {
          cleaned.push(downgraded);
        }
        // content + reasoning 都空 → 整体 drop（避免 OpenAI 拒空 assistant）
      }
    } else {
      cleaned.push(m);
    }
  }

  // 全局兜底校验（F7）：上面 orphanedToolIndexes 扫描只处理「紧随」被 downgrade 的
  // assistant 的那几条 tool 消息；若某条 role:"tool" 与它的 tool_calls 父消息之间被别的
  // 消息隔开（外部编辑 / 历史重排造成的非相邻配对），前面的相邻扫描 break 在首个非-tool
  // 消息处会漏掉它。OpenAI 协议硬要求 role:"tool" 紧跟在声明该 tool_call_id 的 assistant
  // 之后（相邻），否则整段 history 被 400 拒。故对最终产物再过一遍：任何 role:"tool" 若其
  // tool_call_id 不在**紧邻前方** assistant.tool_calls 里，一并剔除，保证输出零孤儿 tool。
  const finalMessages: OpenAIChatMessage[] = [];
  let precedingToolCallIds: Set<string> | null = null;
  for (const m of cleaned) {
    if (m.role === "tool") {
      if (m.tool_call_id && precedingToolCallIds?.has(m.tool_call_id)) {
        finalMessages.push(m);
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[chat-to-llm] non-adjacent orphan tool message dropped: tool_call_id=${m.tool_call_id ?? "<none>"}; ` +
          `not owned by the immediately-preceding assistant.tool_calls. Likely reordered/edited chat.yaml.`,
        );
      }
      // role:"tool" 不改变「上一条 assistant 的 tool_calls 上下文」——OpenAI 允许一条
      // assistant.tool_calls 后跟多条 tool 消息，故不在此清空 precedingToolCallIds。
      continue;
    }
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      precedingToolCallIds = new Set(m.tool_calls.map((tc) => tc.id));
    } else {
      // 任何非-tool、非-带-tool_calls-assistant 的消息都会打断相邻关系。
      precedingToolCallIds = null;
    }
    finalMessages.push(m);
  }
  return finalMessages;
}
