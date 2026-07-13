// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Stream buffer / partial JSON parsing 通用 helper，从 simple_chat_dispatch 抽出，
 * 供任何 agent 复用。
 */

import type { ToolCall, ToolCallChunkDelta } from "../llm/provider.js";
import { escapeRegExp } from "../utils/regex.js";

// ---------------------------------------------------------------------------
// tool_call 累积器
// ---------------------------------------------------------------------------

export interface ToolBuffer {
  index: number;
  id: string;
  name: string;
  args: string;
}

export function applyToolDelta(buffers: Map<number, ToolBuffer>, delta: ToolCallChunkDelta): void {
  let buf = buffers.get(delta.index);
  if (!buf) {
    buf = { index: delta.index, id: delta.id ?? "", name: "", args: "" };
    buffers.set(delta.index, buf);
  }
  if (delta.id) buf.id = delta.id;
  // OpenAI 协议：name 只在首 chunk 给完整值，后续 chunks 不带 name 字段。
  // 用 `=` 而不是 `+=` 防御非标 implementation 在每个 chunk 都重发 name 时拼出
  // "show_chaptershow_chapter"（v4 盲审 P1-4）。
  if (delta.function?.name) buf.name = delta.function.name;
  if (delta.function?.arguments) buf.args += delta.function.arguments;
}

export function finalizeToolCalls(buffers: Map<number, ToolBuffer>): ToolCall[] {
  return [...buffers.values()]
    .sort((a, b) => a.index - b.index)
    .map((b, i) => ({
      id: b.id || `tc-${Date.now()}-${i}`,
      type: "function" as const,
      function: { name: b.name, arguments: b.args || "{}" },
    }));
}

/**
 * 增量从 partial JSON tool args 中提取指定字段当前已累积的字符串。
 * 用于 chat_reply 等 tool 的流式 UX：args 是 stringified JSON，但 LLM 边累积边
 * stream，我们手动 partial-parse 目标字段每次 delta 取 diff emit 给 UI 实时渲染。
 *
 * 处理 JSON 字符串的转义（\n/\t/\"/\\/\uXXXX 等）；遇到不完整 escape 时保守返回
 * 已 parse 的部分（下一次 args 增长后再补全）。返回 null 表示目标字段还没出现。
 */
export function extractPartialJsonStringField(args: string, fieldName: string): string | null {
  const keyMatch = new RegExp('"' + escapeRegExp(fieldName) + '"\\s*:\\s*"').exec(args);
  if (!keyMatch) return null;
  let i = keyMatch.index + keyMatch[0].length;
  let result = "";
  while (i < args.length) {
    const ch = args[i];
    if (ch === "\\") {
      if (i + 1 >= args.length) return result; // 不完整 escape，等下一次
      const next = args[i + 1];
      switch (next) {
        case "n":
          result += "\n";
          break;
        case "t":
          result += "\t";
          break;
        case "r":
          result += "\r";
          break;
        case '"':
          result += '"';
          break;
        case "\\":
          result += "\\";
          break;
        case "/":
          result += "/";
          break;
        case "b":
          result += "\b";
          break;
        case "f":
          result += "\f";
          break;
        case "u": {
          if (i + 5 >= args.length) return result;
          const hex = args.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return result;
          result += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        default:
          result += next;
          break;
      }
      i += 2;
    } else if (ch === '"') {
      return result; // 闭合引号，content 已完整
    } else {
      result += ch;
      i++;
    }
  }
  return result; // 未到闭合引号，partial 返回
}
