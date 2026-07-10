// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * chat-to-llm golden test —— 逐字节锁定「聊天历史 → OpenAI messages」转换输出。
 *
 * 背景（盲审长期债④）：转换逻辑从 UI 层下沉引擎 services/chat_to_llm，硬约束是
 * 固定输入的输出逐字节不变。本测试在搬迁前对当时的 UI 实现捕获 EXPECTED_JSON /
 * EXPECTED_WARNS 基线，搬迁后经由本文件的 `../chat-to-llm` 薄 re-export 路径继续
 * 断言同一基线 —— 同时守住「输出不变」和「re-export 接线正确」两件事。
 *
 * 用 JSON.stringify 全串比对（而非 toEqual）：串行化保留 key 插入顺序，
 * 语义等价但字段顺序漂移也会被抓住，这才是"逐字节"。
 */

import { describe, expect, it, vi } from "vitest";
import { chatToOpenAIMessages } from "../chat-to-llm";
import type { SimpleChatMessage } from "../types";

const T = "2026-07-09T00:00:00Z";

/** 固定输入：覆盖全部 8 个 kind、全部 draft/tool-call 状态、三层孤儿防御路径。 */
const GOLDEN_INPUT: SimpleChatMessage[] = [
  // —— 正常链路：user → assistant 闲聊 → assistant.toolCalls 全配对 → 总结 ——
  { id: "g01", kind: "user", timestamp: T, content: "写第 1 章，主角进城" },
  { id: "g02", kind: "assistant", timestamp: T, content: "好的，我先看看设定。" },
  {
    id: "g03", kind: "assistant", timestamp: T, content: "",
    toolCalls: [
      { id: "call_g1", name: "show_chapter", args: '{"chapter_num":1}' },
      { id: "call_g2", name: "show_setting", args: '{"file_path":"characters/Alice.md"}' },
    ],
  },
  { id: "g04", kind: "tool-result", timestamp: T, toolCallId: "call_g1", toolName: "show_chapter", content: "第一章正文……" },
  {
    id: "g05", kind: "tool-result", timestamp: T, toolCallId: "call_g2", toolName: "show_setting",
    content: "FILE_NOT_FOUND", errorMessage: "characters/Alice.md 不存在",
  },
  { id: "g06", kind: "assistant", timestamp: T, content: "查完了，开始写。" },
  // —— writing-draft 全状态（streaming 与空 content 跳过） ——
  { id: "g07", kind: "writing-draft", timestamp: T, chapterNum: 1, draftLabel: "A", content: "半成品……", status: "streaming" },
  { id: "g08", kind: "writing-draft", timestamp: T, chapterNum: 1, draftLabel: "B", content: "", status: "pending" },
  { id: "g09", kind: "writing-draft", timestamp: T, chapterNum: 1, draftLabel: "C", content: "第一章草稿正文……", status: "pending" },
  { id: "g10", kind: "writing-draft", timestamp: T, chapterNum: 1, draftLabel: "D", content: "被接受的正文。", status: "accepted" },
  { id: "g11", kind: "writing-draft", timestamp: T, chapterNum: 2, draftLabel: "A", content: "被拒绝的正文。", status: "rejected" },
  { id: "g12", kind: "writing-draft", timestamp: T, chapterNum: 2, draftLabel: "B", content: "被丢弃的正文。", status: "discarded" },
  { id: "g13", kind: "writing-draft", timestamp: T, chapterNum: 2, draftLabel: "C", content: "出错的正文。", status: "error", errorMessage: "provider 超时" },
  // —— tool-call kind（legacy modify 链）全状态 + 嵌套/中文 args 的 JSON 格式化 ——
  { id: "g14", kind: "tool-call", timestamp: T, toolName: "show_chapter", toolArgs: { chapter_num: 5 }, status: "pending" },
  {
    id: "g15", kind: "tool-call", timestamp: T, toolName: "modify_character_file",
    toolArgs: { filename: "Alice.md", new_content: "她有银色长发。", change_summary: "改发色" }, status: "confirmed",
  },
  {
    id: "g16", kind: "tool-call", timestamp: T, toolName: "add_pinned_context",
    toolArgs: { content: "Alice 的发色是银色", meta: { level: 2, tags: ["外貌", "发色"] } }, status: "skipped",
  },
  { id: "g17", kind: "tool-call", timestamp: T, toolName: "remove_pinned_context", toolArgs: { index: 0 }, status: "undone" },
  { id: "g18", kind: "tool-call", timestamp: T, toolName: "create_character_file", toolArgs: { name: "Bob" }, status: "error", errorMessage: "引擎写盘失败" },
  { id: "g19", kind: "tool-call", timestamp: T, toolName: "create_character_file", toolArgs: { name: "Eve" }, status: "error" },
  // —— UI 噪音 kind 全跳过 ——
  { id: "g20", kind: "chapter-preview", timestamp: T, chapterNum: 1, expanded: true },
  { id: "g21", kind: "setting-preview", timestamp: T, filePath: "characters/Alice.md", expanded: false },
  { id: "g22", kind: "system", timestamp: T, tone: "info", content: "系统提示。" },
  // —— 防御路径①：orphan tool-result（无前置 assistant.toolCalls）skip ——
  { id: "g23", kind: "tool-result", timestamp: T, toolCallId: "orphan_1", toolName: "show_chapter", content: "孤儿结果" },
  // —— 防御路径②：半配对 assistant.toolCalls → downgrade + 剔除已配对 tool ——
  {
    id: "g24", kind: "assistant", timestamp: T, content: "让我查两个东西",
    toolCalls: [
      { id: "call_h1", name: "show_chapter", args: '{"chapter_num":2}' },
      { id: "call_h2", name: "show_setting", args: '{"file_path":"characters/Bob.md"}' },
    ],
  },
  { id: "g25", kind: "tool-result", timestamp: T, toolCallId: "call_h1", toolName: "show_chapter", content: "第二章正文……" },
  { id: "g26", kind: "assistant", timestamp: T, content: "只查到一个" },
  // —— 防御路径③：全孤儿 assistant.toolCalls 且 content 空 → 整条 drop ——
  {
    id: "g27", kind: "assistant", timestamp: T, content: "",
    toolCalls: [{ id: "call_o1", name: "show_chapter", args: '{"chapter_num":3}' }],
  },
  // —— 空 toolCalls 数组：不输出 tool_calls 字段 ——
  { id: "g28", kind: "assistant", timestamp: T, content: "空数组照常闲聊", toolCalls: [] },
  // —— 防御路径④：非相邻孤儿 tool（F7 全局兜底） ——
  {
    id: "g29", kind: "assistant", timestamp: T, content: "非相邻测试",
    toolCalls: [{ id: "call_x", name: "show_chapter", args: '{"chapter_num":4}' }],
  },
  { id: "g30", kind: "assistant", timestamp: T, content: "隔断消息" },
  { id: "g31", kind: "tool-result", timestamp: T, toolCallId: "call_x", toolName: "show_chapter", content: "被隔开的结果" },
  { id: "g32", kind: "user", timestamp: T, content: "结尾" },
];

// 基线于搬迁前的 UI 实现捕获（2026-07-09）。凡本串变化 = 转换输出破坏性变更。
const EXPECTED_JSON = "[{\"role\":\"user\",\"content\":\"写第 1 章，主角进城\"},{\"role\":\"assistant\",\"content\":\"好的，我先看看设定。\"},{\"role\":\"assistant\",\"content\":\"\",\"tool_calls\":[{\"id\":\"call_g1\",\"type\":\"function\",\"function\":{\"name\":\"show_chapter\",\"arguments\":\"{\\\"chapter_num\\\":1}\"}},{\"id\":\"call_g2\",\"type\":\"function\",\"function\":{\"name\":\"show_setting\",\"arguments\":\"{\\\"file_path\\\":\\\"characters/Alice.md\\\"}\"}}]},{\"role\":\"tool\",\"tool_call_id\":\"call_g1\",\"content\":\"第一章正文……\"},{\"role\":\"tool\",\"tool_call_id\":\"call_g2\",\"content\":\"FILE_NOT_FOUND\"},{\"role\":\"assistant\",\"content\":\"查完了，开始写。\"},{\"role\":\"assistant\",\"content\":\"第一章草稿正文……\\n\\n[此草稿等待用户确认]\"},{\"role\":\"assistant\",\"content\":\"被接受的正文。\\n\\n[此草稿已被用户接受为正式章节]\"},{\"role\":\"assistant\",\"content\":\"被拒绝的正文。\\n\\n[此草稿已被用户拒绝]\"},{\"role\":\"assistant\",\"content\":\"被丢弃的正文。\\n\\n[此草稿已被用户丢弃]\"},{\"role\":\"assistant\",\"content\":\"出错的正文。\\n\\n[此草稿生成出错]\"},{\"role\":\"assistant\",\"content\":\"[tool: show_chapter]\\n{\\n  \\\"chapter_num\\\": 5\\n}\\n[待用户确认]\"},{\"role\":\"assistant\",\"content\":\"[tool: modify_character_file]\\n{\\n  \\\"filename\\\": \\\"Alice.md\\\",\\n  \\\"new_content\\\": \\\"她有银色长发。\\\",\\n  \\\"change_summary\\\": \\\"改发色\\\"\\n}\\n[已执行]\"},{\"role\":\"assistant\",\"content\":\"[tool: add_pinned_context]\\n{\\n  \\\"content\\\": \\\"Alice 的发色是银色\\\",\\n  \\\"meta\\\": {\\n    \\\"level\\\": 2,\\n    \\\"tags\\\": [\\n      \\\"外貌\\\",\\n      \\\"发色\\\"\\n    ]\\n  }\\n}\\n[已跳过]\"},{\"role\":\"assistant\",\"content\":\"[tool: remove_pinned_context]\\n{\\n  \\\"index\\\": 0\\n}\\n[已撤销]\"},{\"role\":\"assistant\",\"content\":\"[tool: create_character_file]\\n{\\n  \\\"name\\\": \\\"Bob\\\"\\n}\\n[失败：引擎写盘失败]\"},{\"role\":\"assistant\",\"content\":\"[tool: create_character_file]\\n{\\n  \\\"name\\\": \\\"Eve\\\"\\n}\\n[失败：unknown]\"},{\"role\":\"assistant\",\"content\":\"让我查两个东西\"},{\"role\":\"assistant\",\"content\":\"只查到一个\"},{\"role\":\"assistant\",\"content\":\"空数组照常闲聊\"},{\"role\":\"assistant\",\"content\":\"非相邻测试\"},{\"role\":\"assistant\",\"content\":\"隔断消息\"},{\"role\":\"user\",\"content\":\"结尾\"}]";

// 告警文案基线（logger 未初始化时统一走 console.warn `[tag] msg` 格式）。
const EXPECTED_WARNS: string[] = [
  "[chat-to-llm] orphan tool-result skipped: tool_call_id=orphan_1 tool=show_chapter; no preceding assistant.toolCalls match. Likely legacy chat.yaml prior to 2026-05-04 fix.",
  "[chat-to-llm] orphan assistant.tool_calls dropped: missing tool messages for ids [call_h2]; downgrading to plain assistant content and dropping 1 paired tool message(s). This is likely a chat.yaml inconsistency from a previous failed dispatch.",
  "[chat-to-llm] orphan assistant.tool_calls dropped: missing tool messages for ids [call_o1]; downgrading to plain assistant content and dropping 0 paired tool message(s). This is likely a chat.yaml inconsistency from a previous failed dispatch.",
  "[chat-to-llm] orphan assistant.tool_calls dropped: missing tool messages for ids [call_x]; downgrading to plain assistant content and dropping 0 paired tool message(s). This is likely a chat.yaml inconsistency from a previous failed dispatch.",
  "[chat-to-llm] non-adjacent orphan tool message dropped: tool_call_id=call_x; not owned by the immediately-preceding assistant.tool_calls. Likely reordered/edited chat.yaml.",
];

describe("chatToOpenAIMessages golden（逐字节基线）", () => {
  it("固定输入 → 输出 JSON 串与告警文案逐字节等于搬迁前基线", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = chatToOpenAIMessages(GOLDEN_INPUT);
      const warns = warnSpy.mock.calls.map((c) => String(c[0] ?? ""));
      expect(JSON.stringify(out)).toBe(EXPECTED_JSON);
      expect(warns).toEqual(EXPECTED_WARNS);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
