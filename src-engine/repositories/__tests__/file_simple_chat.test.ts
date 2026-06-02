// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { FileSimpleChatRepository } from "../implementations/file_simple_chat.js";
import type { SimpleChatMessageEnvelope } from "../../domain/simple_chat.js";
import { MockAdapter } from "./mock_adapter.js";

describe("FileSimpleChatRepository", () => {
  let adapter: MockAdapter;
  let repo: FileSimpleChatRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    repo = new FileSimpleChatRepository(adapter);
  });

  it("get 在文件不存在时返回空白 SimpleChatFile", async () => {
    const file = await repo.get("au1");
    expect(file.au_path).toBe("au1");
    expect(file.messages).toEqual([]);
    expect(file.version).toBe(1);
    expect(file.created_at).toBeTruthy();
  });

  it("save / get round-trip 保留完整 message 字段", async () => {
    const messages: SimpleChatMessageEnvelope[] = [
      {
        id: "smplmsg-1",
        timestamp: "2026-05-03T10:00:00Z",
        kind: "user",
        content: "写第一章 主角进酒馆",
      },
      {
        id: "smplmsg-2",
        timestamp: "2026-05-03T10:00:30Z",
        kind: "writing-draft",
        chapterNum: 1,
        draftLabel: "A",
        content: "夜色低垂...",
        status: "accepted",
        acceptedAt: "2026-05-03T10:01:00Z",
        acceptedRevision: 1,
        generatedWith: { model: "deepseek", input_tokens: 1234 },
      },
      {
        id: "smplmsg-3",
        timestamp: "2026-05-03T10:02:00Z",
        kind: "tool-call",
        toolName: "modify_character_file",
        toolArgs: { filename: "Alice.md", new_content: "..." },
        status: "confirmed",
      },
    ];

    await repo.save("au1", messages);
    const loaded = await repo.get("au1");

    expect(loaded.messages).toHaveLength(3);
    expect(loaded.messages[0].kind).toBe("user");
    expect(loaded.messages[0].content).toBe("写第一章 主角进酒馆");
    expect(loaded.messages[1].kind).toBe("writing-draft");
    expect(loaded.messages[1].content).toBe("夜色低垂...");
    expect((loaded.messages[1].generatedWith as Record<string, unknown>).model).toBe("deepseek");
    expect(loaded.messages[2].kind).toBe("tool-call");
    expect((loaded.messages[2].toolArgs as Record<string, unknown>).filename).toBe("Alice.md");
  });

  it("round-trip 保留 assistant.toolCalls + tool-result kind 不丢字段（agent MVP T1）", async () => {
    // engine 持久化对 message 形状是透明的（envelope `[key:string]: unknown` 透传），
    // 所以新 kind / 新 optional 字段不需要改 engine 代码 —— 这个测试是闭环证明。
    const messages: SimpleChatMessageEnvelope[] = [
      {
        id: "smplmsg-A",
        timestamp: "2026-05-04T12:00:00Z",
        kind: "user",
        content: "看一下第 5 章和 Alice 的设定",
      },
      {
        id: "smplmsg-B",
        timestamp: "2026-05-04T12:00:05Z",
        kind: "assistant",
        content: "",
        toolCalls: [
          { id: "call_001", name: "show_chapter", args: '{"chapter_num":5}' },
          { id: "call_002", name: "show_setting", args: '{"file_path":"characters/Alice.md"}' },
        ],
      },
      {
        id: "smplmsg-C",
        timestamp: "2026-05-04T12:00:06Z",
        kind: "tool-result",
        toolCallId: "call_001",
        toolName: "show_chapter",
        content: "第五章正文...",
      },
      {
        id: "smplmsg-D",
        timestamp: "2026-05-04T12:00:06Z",
        kind: "tool-result",
        toolCallId: "call_002",
        toolName: "show_setting",
        content: "FILE_NOT_FOUND",
        errorMessage: "characters/Alice.md 不存在",
      },
      {
        id: "smplmsg-E",
        timestamp: "2026-05-04T12:00:10Z",
        kind: "assistant",
        content: "我看了第 5 章，但 Alice 的设定文件还没有，要不要我帮你建？",
      },
    ];

    await repo.save("au-agent", messages);
    const loaded = await repo.get("au-agent");

    expect(loaded.messages).toHaveLength(5);

    // assistant 消息的 toolCalls 完整保留（包括 stringified args）
    const assistantWithTools = loaded.messages[1] as Record<string, unknown>;
    expect(assistantWithTools.kind).toBe("assistant");
    expect(assistantWithTools.content).toBe("");
    const toolCalls = assistantWithTools.toolCalls as Array<Record<string, string>>;
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]).toEqual({ id: "call_001", name: "show_chapter", args: '{"chapter_num":5}' });
    expect(toolCalls[1]).toEqual({
      id: "call_002",
      name: "show_setting",
      args: '{"file_path":"characters/Alice.md"}',
    });

    // tool-result kind 完整保留所有必填 + optional 字段
    const successResult = loaded.messages[2] as Record<string, unknown>;
    expect(successResult.kind).toBe("tool-result");
    expect(successResult.toolCallId).toBe("call_001");
    expect(successResult.toolName).toBe("show_chapter");
    expect(successResult.content).toBe("第五章正文...");
    expect(successResult.errorMessage).toBeUndefined();

    const errorResult = loaded.messages[3] as Record<string, unknown>;
    expect(errorResult.kind).toBe("tool-result");
    expect(errorResult.content).toBe("FILE_NOT_FOUND");
    expect(errorResult.errorMessage).toBe("characters/Alice.md 不存在");

    // 最后的总结 assistant 消息没有 toolCalls 字段（保持闲聊兼容）
    const replyOnly = loaded.messages[4] as Record<string, unknown>;
    expect(replyOnly.kind).toBe("assistant");
    expect(replyOnly.toolCalls).toBeUndefined();
  });

  it("旧版 schema reload（assistant 无 toolCalls / 无 tool-result 消息）安全兼容（agent MVP T1）", async () => {
    // 模拟 commit 6beb720 之前生成的 chat.yaml：assistant 没有 toolCalls 字段
    const path = "au-legacy/.well-known/simple-chat.yaml";
    await adapter.mkdir("au-legacy/.well-known");
    // ISO 时间戳带引号防 yaml 解析成 Date 对象 ——
    // file_simple_chat 校验 `typeof timestamp === "string"`，未带引号会被丢弃。
    // 仓库自己的 save 路径走 yaml.dump 会自动加引号，所以这里完整模拟"上一版本写出来的
    // 合法文件"（带引号 ISO 时间戳）；本测试仅校验缺 toolCalls / 缺 tool-result 的旧
    // schema 能正常 reload，不验证无引号时间戳的降级路径（那已被 "缺 id / timestamp /
    // kind 的 message 在 load 时被丢弃" 用例覆盖）。
    await adapter.writeFile(
      path,
      [
        "version: 1",
        "au_path: au-legacy",
        'created_at: "2026-05-01T10:00:00Z"',
        'updated_at: "2026-05-01T10:00:00Z"',
        "messages:",
        "  - id: legacy-1",
        '    timestamp: "2026-05-01T10:00:00Z"',
        "    kind: user",
        "    content: hey",
        "  - id: legacy-2",
        '    timestamp: "2026-05-01T10:00:05Z"',
        "    kind: assistant",
        "    content: 你好，要不要写第一章？",
      ].join("\n"),
    );

    const loaded = await repo.get("au-legacy");
    expect(loaded.messages).toHaveLength(2);
    const legacyAssistant = loaded.messages[1] as Record<string, unknown>;
    expect(legacyAssistant.kind).toBe("assistant");
    expect(legacyAssistant.content).toBe("你好，要不要写第一章？");
    // 关键：缺 toolCalls 字段读出来是 undefined（不崩、不补默认）
    expect(legacyAssistant.toolCalls).toBeUndefined();
  });

  it("save 多次只保留最后一次（全量替换语义）", async () => {
    await repo.save("au2", [
      { id: "a", timestamp: "t1", kind: "user", content: "first" },
    ]);
    await repo.save("au2", [
      { id: "b", timestamp: "t2", kind: "user", content: "second" },
      { id: "c", timestamp: "t3", kind: "user", content: "third" },
    ]);
    const loaded = await repo.get("au2");
    expect(loaded.messages.map((m) => m.id)).toEqual(["b", "c"]);
  });

  it("save 多次保留 created_at 不变", async () => {
    await repo.save("au3", [{ id: "1", timestamp: "t", kind: "user" }]);
    const first = await repo.get("au3");
    const firstCreated = first.created_at;

    await repo.save("au3", [{ id: "2", timestamp: "t2", kind: "user" }]);
    const second = await repo.get("au3");
    // created_at 是首次写入时确定的，第二次 save 不应覆盖（即便同秒也要保留原值）
    expect(second.created_at).toBe(firstCreated);
    // updated_at 在 ISO 秒粒度上 ≥ first（同秒等于，跨秒大于；不同时间写入测时序）
    expect(second.updated_at >= first.updated_at).toBe(true);
  });

  it("clear 等价于 save([])", async () => {
    await repo.save("au4", [{ id: "x", timestamp: "t", kind: "user" }]);
    await repo.clear("au4");
    const loaded = await repo.get("au4");
    expect(loaded.messages).toEqual([]);
  });

  it("缺 id / timestamp / kind 的 message 在 load 时被丢弃", async () => {
    // 直接构造一个有问题的 yaml
    const path = "au5/.well-known/simple-chat.yaml";
    await adapter.mkdir("au5/.well-known");
    await adapter.writeFile(path, [
      "version: 1",
      "au_path: au5",
      "created_at: 2026-05-03T10:00:00Z",
      "updated_at: 2026-05-03T10:00:00Z",
      "messages:",
      "  - id: ok-1",
      "    timestamp: t1",
      "    kind: user",
      "    content: alpha",
      "  - id: missing-kind",
      "    timestamp: t2",
      "    content: beta",  // 缺 kind
      "  - timestamp: t3",
      "    kind: user",
      "    content: gamma",  // 缺 id
    ].join("\n"));

    const loaded = await repo.get("au5");
    expect(loaded.messages.map((m) => m.id)).toEqual(["ok-1"]);
  });

  it("损坏 YAML 静默回退到空 SimpleChatFile", async () => {
    const path = "au6/.well-known/simple-chat.yaml";
    await adapter.mkdir("au6/.well-known");
    await adapter.writeFile(path, "this is: not [valid yaml: :}\n  - x");
    const loaded = await repo.get("au6");
    expect(loaded.messages).toEqual([]);
    expect(loaded.au_path).toBe("au6");
  });

  it("非 object root 也回退到空文件", async () => {
    const path = "au7/.well-known/simple-chat.yaml";
    await adapter.mkdir("au7/.well-known");
    await adapter.writeFile(path, "just a string");
    const loaded = await repo.get("au7");
    expect(loaded.messages).toEqual([]);
  });

  it("并发 save 串行化（withWriteLock 保证）", async () => {
    const results = await Promise.all([
      repo.save("au8", [{ id: "p1", timestamp: "t", kind: "user", content: "concurrent-1" }]),
      repo.save("au8", [{ id: "p2", timestamp: "t", kind: "user", content: "concurrent-2" }]),
      repo.save("au8", [{ id: "p3", timestamp: "t", kind: "user", content: "concurrent-3" }]),
    ]);
    expect(results).toHaveLength(3);

    // 最终一定是某一份完整内容（不是被截断的混合）
    const loaded = await repo.get("au8");
    expect(loaded.messages).toHaveLength(1);
    expect(["p1", "p2", "p3"]).toContain(loaded.messages[0].id);
  });
});
