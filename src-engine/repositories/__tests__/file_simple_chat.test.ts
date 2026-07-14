// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import * as yaml from "js-yaml";
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
        chapter_num: 1,
        draft_label: "A",
        content: "夜色低垂...",
        status: "accepted",
        accepted_at: "2026-05-03T10:01:00Z",
        accepted_revision: 1,
        generated_with: { model: "deepseek", input_tokens: 1234 },
      },
      {
        id: "smplmsg-3",
        timestamp: "2026-05-03T10:02:00Z",
        kind: "tool-call",
        tool_name: "modify_character_file",
        tool_args: { filename: "Alice.md", new_content: "..." },
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
    expect((loaded.messages[1].generated_with as Record<string, unknown>).model).toBe("deepseek");
    expect(loaded.messages[2].kind).toBe("tool-call");
    expect((loaded.messages[2].tool_args as Record<string, unknown>).filename).toBe("Alice.md");
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
        tool_calls: [
          { id: "call_001", name: "show_chapter", args: '{"chapter_num":5}' },
          { id: "call_002", name: "show_setting", args: '{"file_path":"characters/Alice.md"}' },
        ],
      },
      {
        id: "smplmsg-C",
        timestamp: "2026-05-04T12:00:06Z",
        kind: "tool-result",
        tool_call_id: "call_001",
        tool_name: "show_chapter",
        content: "第五章正文...",
      },
      {
        id: "smplmsg-D",
        timestamp: "2026-05-04T12:00:06Z",
        kind: "tool-result",
        tool_call_id: "call_002",
        tool_name: "show_setting",
        content: "FILE_NOT_FOUND",
        error_message: "characters/Alice.md 不存在",
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

    // assistant 消息的 tool_calls 完整保留（包括 stringified args）
    const assistantWithTools = loaded.messages[1] as Record<string, unknown>;
    expect(assistantWithTools.kind).toBe("assistant");
    expect(assistantWithTools.content).toBe("");
    const toolCalls = assistantWithTools.tool_calls as Array<Record<string, string>>;
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
    expect(successResult.tool_call_id).toBe("call_001");
    expect(successResult.tool_name).toBe("show_chapter");
    expect(successResult.content).toBe("第五章正文...");
    expect(successResult.error_message).toBeUndefined();

    const errorResult = loaded.messages[3] as Record<string, unknown>;
    expect(errorResult.kind).toBe("tool-result");
    expect(errorResult.content).toBe("FILE_NOT_FOUND");
    expect(errorResult.error_message).toBe("characters/Alice.md 不存在");

    // 最后的总结 assistant 消息没有 tool_calls 字段（保持闲聊兼容）
    const replyOnly = loaded.messages[4] as Record<string, unknown>;
    expect(replyOnly.kind).toBe("assistant");
    expect(replyOnly.tool_calls).toBeUndefined();
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
    // 关键：缺 tool_calls 字段读出来是 undefined（不崩、不补默认）
    expect(legacyAssistant.tool_calls).toBeUndefined();
  });

  it("legacy camelCase 消息键 tolerant-read → coalesce 到 snake，再 save 落盘自愈（键迁移）", async () => {
    // 2026-07 消息键 snake 化前，chat.yaml 里 SimpleChatMessage 字段用 camelCase 落盘。
    // 手写一份 legacy camel 文件，覆盖顶层键（chapterNum/draftLabel/acceptedRevision/
    // generatedWith/toolCalls/toolName/toolArgs）+ 嵌套 undoMeta.factId/chapterNum。
    const path = "au-legacy-camel/.well-known/simple-chat.yaml";
    await adapter.mkdir("au-legacy-camel/.well-known");
    const legacyObj = {
      version: 1,
      au_path: "au-legacy-camel",
      created_at: "2026-05-01T10:00:00Z",
      updated_at: "2026-05-01T10:00:00Z",
      messages: [
        {
          id: "leg-draft",
          timestamp: "2026-05-01T10:00:00Z",
          kind: "writing-draft",
          chapterNum: 7,
          draftLabel: "A",
          content: "夜色四合",
          status: "accepted",
          acceptedRevision: 2,
          generatedWith: { model: "deepseek-v4", input_tokens: 999 },
        },
        {
          id: "leg-assistant",
          timestamp: "2026-05-01T10:00:05Z",
          kind: "assistant",
          content: "",
          toolCalls: [{ id: "call_leg", name: "show_chapter", args: '{"chapter_num":7}' }],
        },
        {
          id: "leg-toolcall",
          timestamp: "2026-05-01T10:00:10Z",
          kind: "tool-call",
          toolName: "modify_fact",
          toolArgs: { fact: "fact-42" },
          status: "confirmed",
          undoMeta: { kind: "fact", factId: "fact-42", chapterNum: 7 },
        },
      ],
    };
    await adapter.writeFile(path, yaml.dump(legacyObj));

    // 读出后 camel 键已 coalesce 到 snake（否则消费方读 snake 拿 undefined → 丢数据）
    const loaded = await repo.get("au-legacy-camel");
    expect(loaded.messages).toHaveLength(3);

    const draft = loaded.messages[0] as Record<string, unknown>;
    expect(draft.chapter_num).toBe(7);
    expect(draft.draft_label).toBe("A");
    expect(draft.accepted_revision).toBe(2);
    expect((draft.generated_with as Record<string, unknown>).model).toBe("deepseek-v4");
    // 旧 camel 键已被删（不残留双份）
    expect(draft.chapterNum).toBeUndefined();
    expect(draft.generatedWith).toBeUndefined();

    const assistant = loaded.messages[1] as Record<string, unknown>;
    expect(assistant.tool_calls).toEqual([{ id: "call_leg", name: "show_chapter", args: '{"chapter_num":7}' }]);
    expect(assistant.toolCalls).toBeUndefined();

    const toolCall = loaded.messages[2] as Record<string, unknown>;
    expect(toolCall.tool_name).toBe("modify_fact");
    // 嵌套 undoMeta 也 coalesce：undoMeta→undo_meta，factId→fact_id，chapterNum→chapter_num
    const undo = toolCall.undo_meta as Record<string, unknown>;
    expect(undo.fact_id).toBe("fact-42");
    expect(undo.chapter_num).toBe(7);
    expect(undo.factId).toBeUndefined();
    expect(toolCall.undoMeta).toBeUndefined();

    // 自愈：把读出来的（已 snake）消息 save 回去，落盘键即为 snake，legacy camel 彻底消失
    await repo.save("au-legacy-camel", loaded.messages);
    const rawAfter = await adapter.readFile(path);
    expect(rawAfter).toContain("chapter_num");
    expect(rawAfter).toContain("tool_calls");
    expect(rawAfter).toContain("generated_with");
    expect(rawAfter).toContain("fact_id");
    // 磁盘上不再有任何 legacy camel 消息键
    expect(rawAfter).not.toContain("chapterNum");
    expect(rawAfter).not.toContain("draftLabel");
    expect(rawAfter).not.toContain("acceptedRevision");
    expect(rawAfter).not.toContain("generatedWith");
    expect(rawAfter).not.toContain("toolCalls");
    expect(rawAfter).not.toContain("toolName");
    expect(rawAfter).not.toContain("undoMeta");
    expect(rawAfter).not.toContain("factId");
    // 再读一遍仍 snake、值不变（round-trip 闭环）
    const reloaded = await repo.get("au-legacy-camel");
    expect((reloaded.messages[0] as Record<string, unknown>).chapter_num).toBe(7);
    expect(((reloaded.messages[2] as Record<string, unknown>).undo_meta as Record<string, unknown>).fact_id).toBe(
      "fact-42",
    );
  });

  it("save 多次只保留最后一次（全量替换语义）", async () => {
    await repo.save("au2", [{ id: "a", timestamp: "t1", kind: "user", content: "first" }]);
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
    await adapter.writeFile(
      path,
      [
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
        "    content: beta", // 缺 kind
        "  - timestamp: t3",
        "    kind: user",
        "    content: gamma", // 缺 id
      ].join("\n"),
    );

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

describe("FileSimpleChatRepository.update（锁内 read-modify-write，审计 H3）", () => {
  let adapter: MockAdapter;
  let repo: FileSimpleChatRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    repo = new FileSimpleChatRepository(adapter);
  });

  it("以磁盘现状为基底应用 updater：钉 accepted 标记不丢其他消息", async () => {
    await repo.save("au_u1", [
      { id: "m1", timestamp: "t1", kind: "user", content: "写第一章" },
      {
        id: "d1",
        timestamp: "t2",
        kind: "writing-draft",
        chapter_num: 1,
        content: "正文",
        status: "pending",
        error_message: "旧错误",
      },
    ]);

    await repo.update("au_u1", (messages) =>
      messages.map((m) => (m.id === "d1" ? { ...m, status: "accepted", accepted_revision: 3 } : m)),
    );

    const loaded = await repo.get("au_u1");
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0]).toMatchObject({ id: "m1", content: "写第一章" });
    expect(loaded.messages[1]).toMatchObject({ id: "d1", status: "accepted", accepted_revision: 3 });
  });

  it("文件不存在时 update 等价于对空列表应用 updater", async () => {
    await repo.update("au_u2", (messages) => [
      ...messages,
      { id: "n1", timestamp: "t", kind: "system", tone: "info", content: "seed" },
    ]);
    const loaded = await repo.get("au_u2");
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0].id).toBe("n1");
  });

  it("update 与 save 并发不丢 update 的写入（同锁串行化）", async () => {
    await repo.save("au_u3", [
      { id: "d1", timestamp: "t", kind: "writing-draft", chapter_num: 1, content: "正文", status: "pending" },
    ]);
    // 并发：save 整体覆盖 vs update 钉标记。两者同锁串行，最终状态必是两种合法顺序之一，
    // 不会出现半截/混合写入。
    await Promise.all([
      repo.save("au_u3", [
        { id: "d1", timestamp: "t", kind: "writing-draft", chapter_num: 1, content: "正文", status: "pending" },
        { id: "m2", timestamp: "t2", kind: "user", content: "后续消息" },
      ]),
      repo.update("au_u3", (messages) => messages.map((m) => (m.id === "d1" ? { ...m, status: "accepted" } : m))),
    ]);
    const loaded = await repo.get("au_u3");
    const draft = loaded.messages.find((m) => m.id === "d1");
    expect(draft).toBeDefined();
    expect(["accepted", "pending"]).toContain(draft!.status);
    // 文件始终是合法 YAML 且消息结构完整
    expect(loaded.messages.every((m) => typeof m.id === "string" && typeof m.kind === "string")).toBe(true);
  });
});
