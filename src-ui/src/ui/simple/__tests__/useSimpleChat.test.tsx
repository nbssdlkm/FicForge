// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSimpleChat } from "../useSimpleChat";

describe("useSimpleChat", () => {
  it("appendUserMessage adds a user message and returns id", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    let id = "";
    act(() => {
      id = result.current.appendUserMessage("写第一章");
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      id,
      kind: "user",
      content: "写第一章",
    });
  });

  it("appendDraftMessage starts in 'streaming' status with empty content", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    let id = "";
    act(() => {
      id = result.current.appendDraftMessage({ chapterNum: 3 });
    });
    const draft = result.current.messages.find((m) => m.id === id);
    expect(draft).toMatchObject({
      kind: "writing-draft",
      chapterNum: 3,
      draftLabel: "?",
      content: "",
      status: "streaming",
    });
  });

  it("appendDraftChunk concatenates content; setDraftStatus + markDraftAccepted finalize", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    let id = "";
    act(() => {
      id = result.current.appendDraftMessage({ chapterNum: 1 });
    });
    act(() => {
      result.current.appendDraftChunk(id, "Hello ");
      result.current.appendDraftChunk(id, "world");
      // chunks 走 rAF buffer 不立即落地；终态前必须 flush（caller 在 onDoneText
      // 等终态 callback 调）。jsdom 不自动 fire rAF，必须显式 flush。
      result.current.flushStreamingChunks();
      result.current.setDraftStatus(id, "pending");
    });
    let draft = result.current.messages.find((m) => m.id === id);
    expect(draft?.kind === "writing-draft" && draft.content).toBe("Hello world");
    expect(draft?.kind === "writing-draft" && draft.status).toBe("pending");

    act(() => {
      result.current.markDraftAccepted(id, 2);
    });
    draft = result.current.messages.find((m) => m.id === id);
    expect(draft?.kind === "writing-draft" && draft.status).toBe("accepted");
    expect(draft?.kind === "writing-draft" && draft.acceptedRevision).toBe(2);
    expect(draft?.kind === "writing-draft" && draft.acceptedAt).toBeTruthy();
  });

  it("setDraftLabel updates only writing-draft messages", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    let id = "";
    act(() => {
      id = result.current.appendDraftMessage({ chapterNum: 1 });
    });
    act(() => {
      result.current.setDraftLabel(id, "B");
    });
    const draft = result.current.messages.find((m) => m.id === id);
    expect(draft?.kind === "writing-draft" && draft.draftLabel).toBe("B");
  });

  it("AU 切换清空 messages", () => {
    const { result, rerender } = renderHook(({ au }) => useSimpleChat(au), {
      initialProps: { au: "au_a" },
    });
    act(() => {
      result.current.appendUserMessage("hi");
    });
    expect(result.current.messages).toHaveLength(1);

    rerender({ au: "au_b" });
    expect(result.current.messages).toHaveLength(0);
  });

  it("appendAssistantMessage 携 toolCalls 持久化进 messages（agent MVP T2）", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    let id = "";
    act(() => {
      id = result.current.appendAssistantMessage("", [
        { id: "tc_001", name: "show_chapter", args: '{"chapter_num":5}' },
      ]);
    });
    const msg = result.current.messages.find((m) => m.id === id);
    expect(msg?.kind === "assistant" && msg.toolCalls).toEqual([
      { id: "tc_001", name: "show_chapter", args: '{"chapter_num":5}' },
    ]);
  });

  it("appendAssistantMessage 不带 toolCalls 时不写空字段（向后兼容旧 caller）", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    let id = "";
    act(() => {
      id = result.current.appendAssistantMessage("hello");
    });
    const msg = result.current.messages.find((m) => m.id === id);
    // 关键：闲聊路径不污染 chat.yaml 形状（toolCalls 字段不存在，不是 undefined）
    expect(msg?.kind === "assistant" && "toolCalls" in msg).toBe(false);
  });

  it("appendAssistantMessage 传空数组 toolCalls 时也不写字段（防空数组污染）", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    let id = "";
    act(() => {
      id = result.current.appendAssistantMessage("hello", []);
    });
    const msg = result.current.messages.find((m) => m.id === id);
    expect(msg?.kind === "assistant" && "toolCalls" in msg).toBe(false);
  });

  it("appendToolResultMessage 加 tool-result kind 消息（agent MVP T2）", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    let id = "";
    act(() => {
      id = result.current.appendToolResultMessage({
        toolCallId: "tc_001",
        toolName: "show_chapter",
        content: "第五章正文...",
      });
    });
    const msg = result.current.messages.find((m) => m.id === id);
    expect(msg).toMatchObject({
      kind: "tool-result",
      toolCallId: "tc_001",
      toolName: "show_chapter",
      content: "第五章正文...",
    });
    // errorMessage 缺省时不写字段（保持 chat.yaml 干净）
    expect(msg && "errorMessage" in msg).toBe(false);
  });

  it("appendToolResultMessage 带 errorMessage 时持久化", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    let id = "";
    act(() => {
      id = result.current.appendToolResultMessage({
        toolCallId: "tc_002",
        toolName: "show_setting",
        content: "FILE_NOT_FOUND",
        errorMessage: "characters/Alice.md 不存在",
      });
    });
    const msg = result.current.messages.find((m) => m.id === id);
    expect(msg?.kind === "tool-result" && msg.errorMessage).toBe("characters/Alice.md 不存在");
  });

  it("appendToolCallMessage + setToolCallStatus 状态迁移", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    let id = "";
    act(() => {
      id = result.current.appendToolCallMessage({
        toolName: "modify_character_file",
        toolArgs: { filename: "Alice.md", new_content: "..." },
      });
    });
    expect(result.current.messages.find((m) => m.id === id)).toMatchObject({
      kind: "tool-call",
      status: "pending",
    });

    act(() => {
      result.current.setToolCallStatus(id, "confirmed", { resultNote: "wrote 300 chars" });
    });
    const card = result.current.messages.find((m) => m.id === id);
    expect(card?.kind === "tool-call" && card.status).toBe("confirmed");
    expect(card?.kind === "tool-call" && card.resultNote).toBe("wrote 300 chars");
  });

  it("togglePreviewExpanded 反转 chapter-preview / setting-preview 的 expanded", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    let chapterId = "";
    let settingId = "";
    act(() => {
      chapterId = result.current.appendChapterPreviewMessage(2);
      settingId = result.current.appendSettingPreviewMessage("characters/Alice.md");
    });
    const initialChapter = result.current.messages.find((m) => m.id === chapterId);
    expect(initialChapter?.kind === "chapter-preview" && initialChapter.expanded).toBe(false);

    act(() => {
      result.current.togglePreviewExpanded(chapterId);
      result.current.togglePreviewExpanded(settingId);
    });
    const flippedChapter = result.current.messages.find((m) => m.id === chapterId);
    const flippedSetting = result.current.messages.find((m) => m.id === settingId);
    expect(flippedChapter?.kind === "chapter-preview" && flippedChapter.expanded).toBe(true);
    expect(flippedSetting?.kind === "setting-preview" && flippedSetting.expanded).toBe(true);
  });

  it("appendSystemMessage with each tone", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    act(() => {
      result.current.appendSystemMessage("info", "Hi");
      result.current.appendSystemMessage("warning", "Watch");
      result.current.appendSystemMessage("error", "Bad");
    });
    expect(result.current.messages.map((m) => (m.kind === "system" ? m.tone : null))).toEqual([
      "info",
      "warning",
      "error",
    ]);
  });

  it("clearMessages 清空", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    act(() => {
      result.current.appendUserMessage("a");
      result.current.appendUserMessage("b");
    });
    expect(result.current.messages).toHaveLength(2);
    act(() => {
      result.current.clearMessages();
    });
    expect(result.current.messages).toHaveLength(0);
  });

  it("appendDraftChunk: chunks 进 rAF buffer，flush 前 message.content 不变", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    let id = "";
    act(() => {
      id = result.current.appendDraftMessage({ chapterNum: 1 });
    });
    act(() => {
      result.current.appendDraftChunk(id, "abc");
      result.current.appendDraftChunk(id, "def");
    });
    // rAF 没跑（jsdom 默认不 fire），content 还是空
    let draft = result.current.messages.find((m) => m.id === id);
    expect(draft?.kind === "writing-draft" && draft.content).toBe("");

    act(() => {
      result.current.flushStreamingChunks();
    });
    draft = result.current.messages.find((m) => m.id === id);
    expect(draft?.kind === "writing-draft" && draft.content).toBe("abcdef");
  });

  it("appendAssistantChunk: 同样走 rAF buffer，flush 后批量生效", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    let id = "";
    act(() => {
      id = result.current.appendAssistantMessage("");
    });
    act(() => {
      result.current.appendAssistantChunk(id, "你好");
      result.current.appendAssistantChunk(id, "世界");
    });
    let msg = result.current.messages.find((m) => m.id === id);
    expect(msg?.kind === "assistant" && msg.content).toBe("");

    act(() => {
      result.current.flushStreamingChunks();
    });
    msg = result.current.messages.find((m) => m.id === id);
    expect(msg?.kind === "assistant" && msg.content).toBe("你好世界");
  });

  it("flushStreamingChunks 在 buffer 空时是 noop", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    act(() => {
      result.current.appendUserMessage("hi");
    });
    const before = result.current.messages;
    act(() => {
      result.current.flushStreamingChunks();
    });
    // 引用不变（setMessages 没被调）
    expect(result.current.messages).toBe(before);
  });

  it("AU 切换 cleanup buffer：旧 AU 缓冲 chunk 不漏到新 AU", () => {
    const { result, rerender } = renderHook(({ au }) => useSimpleChat(au), {
      initialProps: { au: "au_a" },
    });
    let oldId = "";
    act(() => {
      oldId = result.current.appendDraftMessage({ chapterNum: 1 });
    });
    act(() => {
      result.current.appendDraftChunk(oldId, "old AU 残留 chunk");
      // 故意不 flush，让 chunk 留在 buffer
    });

    rerender({ au: "au_b" });
    // AU 切换 → useEffect cleanup 跑 → buffer clear + cancelAnimationFrame

    let newId = "";
    act(() => {
      newId = result.current.appendDraftMessage({ chapterNum: 1 });
    });
    act(() => {
      // 新 AU flush —— 旧 AU 的 chunk 不应该 leak 进来
      result.current.flushStreamingChunks();
    });
    const newDraft = result.current.messages.find((m) => m.id === newId);
    expect(newDraft?.kind === "writing-draft" && newDraft.content).toBe("");
  });

  it("flushStreamingChunks 在 rAF schedule 后立即调：不 double flush（同一 chunk 不被 append 两次）", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    let id = "";
    act(() => {
      id = result.current.appendDraftMessage({ chapterNum: 1 });
    });
    act(() => {
      result.current.appendDraftChunk(id, "abc");
      // rAF 已 schedule 但 jsdom 默认不 fire；同步 flush 一次
      result.current.flushStreamingChunks();
      // 立即再 flush —— buffer 已清，应早返 noop（即使 rAF 后续被 fire 也 noop）
      result.current.flushStreamingChunks();
    });
    const draft = result.current.messages.find((m) => m.id === id);
    // content 必须是 "abc" 不是 "abcabc"
    expect(draft?.kind === "writing-draft" && draft.content).toBe("abc");
  });

  it("removeMessage: 删除指定 id 的 message", () => {
    const { result } = renderHook(() => useSimpleChat("au_a"));
    act(() => {
      result.current.appendUserMessage("a");
      result.current.appendUserMessage("b");
      result.current.appendUserMessage("c");
    });
    expect(result.current.messages).toHaveLength(3);
    const id = result.current.messages[1].id;
    act(() => {
      result.current.removeMessage(id);
    });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages.map((m) => m.id)).not.toContain(id);
  });
});
