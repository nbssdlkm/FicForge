// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, vi } from "vitest";
import { chatToOpenAIMessages } from "../chat-to-llm";
import type { SimpleChatMessage } from "../types";

describe("chatToOpenAIMessages", () => {
  it("user message → role:user content", () => {
    const out = chatToOpenAIMessages([
      { id: "1", kind: "user", timestamp: "t", content: "hi" },
    ]);
    expect(out).toEqual([{ role: "user", content: "hi" }]);
  });

  it("assistant 闲聊（无 toolCalls）→ role:assistant content（向后兼容）", () => {
    const out = chatToOpenAIMessages([
      { id: "1", kind: "assistant", timestamp: "t", content: "你好" },
    ]);
    expect(out).toEqual([{ role: "assistant", content: "你好" }]);
    // 关键：不输出 tool_calls 字段（保持闲聊消息形状跟 commit 6c7b3e2 之前一致）
    expect(out[0]).not.toHaveProperty("tool_calls");
  });

  it("assistant 携 toolCalls + 全部配对的 tool messages → emit role:assistant + 嵌套 OpenAI tool_calls", () => {
    // 配对完整时正常输出 OpenAI 嵌套 tool_calls 格式。orphan 场景见单独 test。
    const messages: SimpleChatMessage[] = [
      {
        id: "1",
        kind: "assistant",
        timestamp: "t",
        content: "",
        toolCalls: [
          { id: "call_001", name: "show_chapter", args: '{"chapter_num":5}' },
          { id: "call_002", name: "show_setting", args: '{"file_path":"characters/Alice.md"}' },
        ],
      },
      {
        id: "2",
        kind: "tool-result",
        timestamp: "t",
        toolCallId: "call_001",
        toolName: "show_chapter",
        content: "ch5 content",
      },
      {
        id: "3",
        kind: "tool-result",
        timestamp: "t",
        toolCallId: "call_002",
        toolName: "show_setting",
        content: "Alice content",
      },
    ];
    const out = chatToOpenAIMessages(messages);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_001",
          type: "function",
          function: { name: "show_chapter", arguments: '{"chapter_num":5}' },
        },
        {
          id: "call_002",
          type: "function",
          function: { name: "show_setting", arguments: '{"file_path":"characters/Alice.md"}' },
        },
      ],
    });
    expect(out[1]).toEqual({ role: "tool", tool_call_id: "call_001", content: "ch5 content" });
    expect(out[2]).toEqual({ role: "tool", tool_call_id: "call_002", content: "Alice content" });
  });

  it("orphan assistant.toolCalls（含 tool_calls 但后续 tool messages 不齐）→ 防御性 downgrade 为 plain content（agent MVP 真机 P0 修复 v2）", () => {
    // dispatch chat_reply terminal 路径混 read-only 时漏 fetch 留下的 orphan。
    // OpenAI 报 "insufficient tool messages following tool_calls"，chat-to-llm 层防御
    // downgrade 让 history 仍合法。
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = chatToOpenAIMessages([
        { id: "u", kind: "user", timestamp: "t", content: "看第 5 章和 chat" },
        {
          id: "a1",
          kind: "assistant",
          timestamp: "t",
          content: "",
          toolCalls: [
            { id: "call_show", name: "show_chapter", args: '{"chapter_num":5}' },
          ],
        },
        // 没 tool-result for call_show（orphan）
        { id: "a2", kind: "assistant", timestamp: "t", content: "看完了" },
      ]);

      // assistant.tool_calls 没有匹配 tool message → drop（content="" 也 drop 整条）
      expect(out).toEqual([
        { role: "user", content: "看第 5 章和 chat" },
        { role: "assistant", content: "看完了" },
      ]);

      expect(warnSpy).toHaveBeenCalled();
      const warnMsg = String(warnSpy.mock.calls[0]?.[0] ?? "");
      expect(warnMsg).toContain("orphan assistant.tool_calls");
      expect(warnMsg).toContain("call_show");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("orphan assistant.toolCalls 但 content 非空 → downgrade 为 plain content 保留", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = chatToOpenAIMessages([
        {
          id: "a",
          kind: "assistant",
          timestamp: "t",
          content: "我考虑一下",
          toolCalls: [
            { id: "orphan_id", name: "show_chapter", args: '{"chapter_num":1}' },
          ],
        },
      ]);
      // tool_calls drop 但 content 保留
      expect(out).toEqual([{ role: "assistant", content: "我考虑一下" }]);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("assistant.toolCalls 为空数组时不输出 tool_calls 字段（防空数组污染 history）", () => {
    const out = chatToOpenAIMessages([
      { id: "1", kind: "assistant", timestamp: "t", content: "hi", toolCalls: [] },
    ]);
    expect(out[0]).not.toHaveProperty("tool_calls");
  });

  it("paired assistant.toolCalls + tool-result → role:assistant tool_calls + role:tool（errorMessage 不入 OpenAI content）", () => {
    // 先 assistant.toolCalls 把 id 注入 knownToolCallIds，紧随的 tool-result 才能正确产 role:tool。
    // 没有匹配 assistant.toolCalls 的 tool-result 是 orphan，会被防御层 skip（见下个 test）。
    const out = chatToOpenAIMessages([
      {
        id: "a",
        kind: "assistant",
        timestamp: "t",
        content: "",
        toolCalls: [
          { id: "call_001", name: "show_chapter", args: '{"chapter_num":5}' },
          { id: "call_002", name: "show_setting", args: '{"file_path":"characters/Alice.md"}' },
        ],
      },
      {
        id: "1",
        kind: "tool-result",
        timestamp: "t",
        toolCallId: "call_001",
        toolName: "show_chapter",
        content: "第五章正文...",
      },
      {
        id: "2",
        kind: "tool-result",
        timestamp: "t",
        toolCallId: "call_002",
        toolName: "show_setting",
        content: "FILE_NOT_FOUND",
        errorMessage: "characters/Alice.md 不存在",
      },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ role: "assistant", tool_calls: expect.any(Array) });
    expect(out[1]).toEqual({ role: "tool", tool_call_id: "call_001", content: "第五章正文..." });
    // errorMessage 字段被故意丢掉（content 已经是 FILE_NOT_FOUND，errorMessage 只供 UI / 持久化）
    expect(out[2]).toEqual({ role: "tool", tool_call_id: "call_002", content: "FILE_NOT_FOUND" });
  });

  it("orphan tool-result（无前置 assistant.toolCalls）被防御性 skip（agent MVP 真机 P0 修复）", () => {
    // 早期 chat.yaml 因 SimpleChatPanel.onToolCall 漏写 assistant.toolCalls 留下的 orphan tool-result。
    // chat-to-llm 防御层应 skip 而不是输出 role:"tool"，否则 OpenAI 报 400
    // "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"。
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = chatToOpenAIMessages([
        { id: "u", kind: "user", timestamp: "t", content: "看第 5 章" },
        // 无 assistant.toolCalls 在前
        {
          id: "tr",
          kind: "tool-result",
          timestamp: "t",
          toolCallId: "orphan_id",
          toolName: "show_chapter",
          content: "第五章正文...",
        },
      ]);
      // 只有 user 消息进 history；orphan tool-result skip
      expect(out).toEqual([{ role: "user", content: "看第 5 章" }]);
      // 必须警告（方便 export 日志诊断）
      expect(warnSpy).toHaveBeenCalled();
      const warnMsg = String(warnSpy.mock.calls[0]?.[0] ?? "");
      expect(warnMsg).toContain("orphan tool-result");
      expect(warnMsg).toContain("orphan_id");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("agent 多轮链路 user → assistant(tool_calls) → tool → assistant(text) 顺序与字段完整", () => {
    // 模拟 Phase 1 真实 agent loop chat.yaml：
    //   user 问 → LLM 调 show_chapter + show_setting → engine 注两条 tool-result →
    //   下一轮 LLM chat_reply 总结
    const messages: SimpleChatMessage[] = [
      { id: "u1", kind: "user", timestamp: "t1", content: "看一下第 5 章和 Alice 的设定" },
      {
        id: "a1",
        kind: "assistant",
        timestamp: "t2",
        content: "",
        toolCalls: [
          { id: "tc_chap", name: "show_chapter", args: '{"chapter_num":5}' },
          { id: "tc_setting", name: "show_setting", args: '{"file_path":"characters/Alice.md"}' },
        ],
      },
      {
        id: "tr1",
        kind: "tool-result",
        timestamp: "t3",
        toolCallId: "tc_chap",
        toolName: "show_chapter",
        content: "第五章：夜色...",
      },
      {
        id: "tr2",
        kind: "tool-result",
        timestamp: "t4",
        toolCallId: "tc_setting",
        toolName: "show_setting",
        content: "FILE_NOT_FOUND",
        errorMessage: "characters/Alice.md 不存在",
      },
      { id: "a2", kind: "assistant", timestamp: "t5", content: "我看了第 5 章；Alice 设定还没有，要不要建？" },
    ];

    const out = chatToOpenAIMessages(messages);
    expect(out).toHaveLength(5);
    expect(out[0].role).toBe("user");
    expect(out[1].role).toBe("assistant");
    expect(out[1].tool_calls).toHaveLength(2);
    expect(out[1].tool_calls?.[0].id).toBe("tc_chap");
    expect(out[2].role).toBe("tool");
    expect(out[2].tool_call_id).toBe("tc_chap");
    expect(out[3].role).toBe("tool");
    expect(out[3].tool_call_id).toBe("tc_setting");
    // 关键：tool_call_id 跟 tool_calls[i].id 必须能对上 ——
    // OpenAI 协议要求 provider 按 id 串接，否则 LLM 看不到结果
    expect(out[3].tool_call_id).toBe(out[1].tool_calls?.[1].id);
    expect(out[4].role).toBe("assistant");
    expect(out[4].tool_calls).toBeUndefined();
  });

  it("tool-call kind（legacy modify_*/create_* 路径）→ role:assistant + status marker（v4-pro C2 review P2-3）", () => {
    // 旧版 modify chain 路径：dispatch emit tool_call → SimpleChatPanel append tool-call kind →
    // 用户 confirm/skip/error → setToolCallStatus 改 status；下一轮发送时 chat-to-llm 把这条
    // 消息转成 role:"assistant" + 内容标 [tool: X] + status marker，让 LLM 看到上下文。
    const out = chatToOpenAIMessages([
      {
        id: "tc1",
        kind: "tool-call",
        timestamp: "t1",
        toolName: "modify_character_file",
        toolArgs: { filename: "Alice.md", new_content: "...", change_summary: "改发色为银色" },
        status: "confirmed",
      },
      {
        id: "tc2",
        kind: "tool-call",
        timestamp: "t2",
        toolName: "add_pinned_context",
        toolArgs: { content: "Alice 的发色是银色" },
        status: "error",
        errorMessage: "engine 写盘失败",
      },
      {
        id: "tc3",
        kind: "tool-call",
        timestamp: "t3",
        toolName: "create_character_file",
        toolArgs: { name: "Bob" },
        status: "pending",
      },
    ]);

    expect(out).toHaveLength(3);
    out.forEach((m) => expect(m.role).toBe("assistant"));
    expect(out[0].content).toContain("[tool: modify_character_file]");
    expect(out[0].content).toContain("Alice.md");
    expect(out[0].content).toContain("[已执行]");
    expect(out[1].content).toContain("[tool: add_pinned_context]");
    expect(out[1].content).toContain("[失败：engine 写盘失败]");
    expect(out[2].content).toContain("[tool: create_character_file]");
    expect(out[2].content).toContain("[待用户确认]");
  });

  it("writing-draft accepted → role:assistant content + 状态 marker（旧逻辑不破坏）", () => {
    const out = chatToOpenAIMessages([
      {
        id: "d1",
        kind: "writing-draft",
        timestamp: "t",
        chapterNum: 1,
        draftLabel: "A",
        content: "第一章正文...",
        status: "accepted",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("assistant");
    expect(out[0].content).toContain("第一章正文...");
    expect(out[0].content).toContain("[此草稿已被用户接受为正式章节]");
  });

  it("writing-draft streaming 跳过（不污染 history）", () => {
    const out = chatToOpenAIMessages([
      {
        id: "d1",
        kind: "writing-draft",
        timestamp: "t",
        chapterNum: 1,
        draftLabel: "A",
        content: "半成品...",
        status: "streaming",
      },
    ]);
    expect(out).toEqual([]);
  });

  it("chapter-preview / setting-preview / system 跳过（旧逻辑不破坏）", () => {
    const out = chatToOpenAIMessages([
      { id: "1", kind: "chapter-preview", timestamp: "t", chapterNum: 5, expanded: false },
      { id: "2", kind: "setting-preview", timestamp: "t", filePath: "x.md", expanded: false },
      { id: "3", kind: "system", timestamp: "t", tone: "info", content: "提示" },
    ]);
    expect(out).toEqual([]);
  });
});
