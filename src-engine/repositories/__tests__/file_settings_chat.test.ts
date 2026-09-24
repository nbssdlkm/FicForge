// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FileSettingsChatRepository（设定助手会话底座）测试。
 * 覆盖：会话 CRUD、隔离、自动标题、toolCalls 透传、宽容读、RMW、无 legacy 迁移。
 */

import { describe, expect, it, beforeEach } from "vitest";
import * as yaml from "js-yaml";
import { FileSettingsChatRepository } from "../implementations/file_settings_chat.js";
import type { SettingsChatMessageEnvelope } from "../../domain/settings_chat.js";
import { MockAdapter } from "./mock_adapter.js";

function userMsg(id: string, content: string): SettingsChatMessageEnvelope {
  return { id, role: "user", content };
}

function assistantMsg(id: string, content: string, extra?: Record<string, unknown>): SettingsChatMessageEnvelope {
  return { id, role: "assistant", content, ...extra };
}

describe("FileSettingsChatRepository · settings-chat-sessions", () => {
  let adapter: MockAdapter;
  let repo: FileSettingsChatRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    repo = new FileSettingsChatRepository(adapter);
  });

  it("空上下文首次 listSessions 建空索引、返回空数组", async () => {
    const sessions = await repo.listSessions("fandom1");
    expect(sessions).toEqual([]);
    // 索引已落盘
    expect(await adapter.exists("fandom1/.well-known/settings-chat-sessions/index.yaml")).toBe(true);
  });

  it("createSession 无标题 → title_auto 占位；save 首条用户消息后自动改名", async () => {
    const meta = await repo.createSession("fandom1");
    expect(meta.title).toBe("Session");
    expect(meta.title_auto).toBe(true);

    await repo.saveSession("fandom1", meta.id, [userMsg("m1", "帮我整理哈利的人物小传"), assistantMsg("m2", "好的")]);
    const sessions = await repo.listSessions("fandom1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe("帮我整理哈利的人物小传");
    expect(sessions[0].title_auto).toBeUndefined();
    expect(sessions[0].message_count).toBe(2);
  });

  it("createSession 带标题 → 不自动改名", async () => {
    const meta = await repo.createSession("fandom1", "世界观 brainstorm");
    await repo.saveSession("fandom1", meta.id, [userMsg("m1", "随便聊点别的")]);
    const sessions = await repo.listSessions("fandom1");
    expect(sessions[0].title).toBe("世界观 brainstorm");
  });

  it("会话间消息隔离：切换互不可见", async () => {
    const a = await repo.createSession("fandom1", "A");
    const b = await repo.createSession("fandom1", "B");
    await repo.saveSession("fandom1", a.id, [userMsg("m1", "A 的消息")]);
    await repo.saveSession("fandom1", b.id, [userMsg("m2", "B 的消息")]);

    const fa = await repo.getSession("fandom1", a.id);
    const fb = await repo.getSession("fandom1", b.id);
    expect(fa.messages.map((m) => m.content)).toEqual(["A 的消息"]);
    expect(fb.messages.map((m) => m.content)).toEqual(["B 的消息"]);
  });

  it("renameSession 改标题并取消自动命名；空标题忽略", async () => {
    const meta = await repo.createSession("fandom1");
    await repo.renameSession("fandom1", meta.id, "角色卡整理");
    let sessions = await repo.listSessions("fandom1");
    expect(sessions[0].title).toBe("角色卡整理");
    expect(sessions[0].title_auto).toBeUndefined();

    await repo.renameSession("fandom1", meta.id, "   ");
    sessions = await repo.listSessions("fandom1");
    expect(sessions[0].title).toBe("角色卡整理");

    // 手动改名后即使保存消息也不再被自动标题覆盖
    await repo.saveSession("fandom1", meta.id, [userMsg("m1", "新的首条消息")]);
    sessions = await repo.listSessions("fandom1");
    expect(sessions[0].title).toBe("角色卡整理");
  });

  it("deleteSession 索引除名 + 文件删除；重复删幂等", async () => {
    const meta = await repo.createSession("fandom1");
    await repo.saveSession("fandom1", meta.id, [userMsg("m1", "x")]);
    const filePath = `fandom1/.well-known/settings-chat-sessions/${meta.id}.yaml`;
    expect(await adapter.exists(filePath)).toBe(true);

    await repo.deleteSession("fandom1", meta.id);
    expect(await repo.listSessions("fandom1")).toEqual([]);
    expect(await adapter.exists(filePath)).toBe(false);

    await repo.deleteSession("fandom1", meta.id); // 不抛
  });

  it("toolCalls 等附加键随消息原样透传（round-trip）", async () => {
    const meta = await repo.createSession("au1");
    const toolCalls = [
      {
        id: "card-1",
        status: "confirmed",
        parsedArgs: { name: "哈利", aliases: ["救世之星"] },
        toolCall: { name: "create_character_file", arguments: "{}" },
      },
    ];
    await repo.saveSession("au1", meta.id, [userMsg("m1", "建个角色卡"), assistantMsg("m2", "已生成", { toolCalls })]);

    const file = await repo.getSession("au1", meta.id);
    expect(file.messages).toHaveLength(2);
    const cards = file.messages[1].toolCalls as typeof toolCalls;
    expect(cards[0].status).toBe("confirmed");
    expect((cards[0].parsedArgs as Record<string, unknown>).name).toBe("哈利");
  });

  it("损坏 YAML 宽容读回退空白（不抛错）", async () => {
    await adapter.mkdir("fandom1/.well-known/settings-chat-sessions");
    await adapter.writeFile("fandom1/.well-known/settings-chat-sessions/default.yaml", "::: not yaml :::\n  - [broken");
    const file = await repo.getSession("fandom1", "default");
    expect(file.messages).toEqual([]);
    expect(file.context_path).toBe("fandom1");
  });

  it("非法会话 id 拒绝（路径穿越防护）", async () => {
    await expect(repo.getSession("fandom1", "../etc/passwd")).rejects.toThrow("invalid settings chat session id");
  });

  it("updateSession 以磁盘为基底 RMW（不丢并发写入）", async () => {
    const meta = await repo.createSession("fandom1");
    await repo.saveSession("fandom1", meta.id, [userMsg("m1", "第一条")]);
    await repo.updateSession("fandom1", meta.id, (messages) => [...messages, assistantMsg("m2", "第二条")]);
    const file = await repo.getSession("fandom1", meta.id);
    expect(file.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("不同上下文（fandomPath vs auPath）目录隔离", async () => {
    const fa = await repo.createSession("fandom1", "fandom 会话");
    const au = await repo.createSession("au1", "au 会话");
    await repo.saveSession("fandom1", fa.id, [userMsg("m1", "fandom 消息")]);
    await repo.saveSession("au1", au.id, [userMsg("m2", "au 消息")]);

    expect((await repo.listSessions("fandom1")).map((s) => s.title)).toEqual(["fandom 会话"]);
    expect((await repo.listSessions("au1")).map((s) => s.title)).toEqual(["au 会话"]);
  });

  it("索引损坏 → 从会话文件抢救重建，不写空索引埋掉会话列表（对抗审 2026-09-14）", async () => {
    const meta = await repo.createSession("fandom1", "抢救目标");
    await repo.saveSession("fandom1", meta.id, [userMsg("m1", "消息还在")]);
    // 人为写坏索引（YAML 无法解析）
    await adapter.writeFile("fandom1/.well-known/settings-chat-sessions/index.yaml", "{{{{not yaml at all");

    const sessions = await repo.listSessions("fandom1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(meta.id);
    expect(sessions[0].title).toBe("消息还在"); // 从会话文件重新导出自动标题
    expect(sessions[0].title_auto).toBeUndefined(); // role 判定（kimi 交叉验证：误用 m.kind 会错标 title_auto）
    expect(sessions[0].message_count).toBe(1);
    // 消息本体完好
    const file = await repo.getSession("fandom1", meta.id);
    expect(file.messages[0].content).toBe("消息还在");
  });

  it("save-after-delete 不复活已删会话（对抗审 2026-09-14 major）", async () => {
    const meta = await repo.createSession("fandom1");
    await repo.saveSession("fandom1", meta.id, [userMsg("m1", "hi")]);
    await repo.deleteSession("fandom1", meta.id);
    // 并发慢半拍的 save 落地：索引不复活、文件不重写
    await repo.saveSession("fandom1", meta.id, [userMsg("m2", "late write")]);
    expect(await repo.listSessions("fandom1")).toEqual([]);
    expect(await adapter.exists(`fandom1/.well-known/settings-chat-sessions/${meta.id}.yaml`)).toBe(false);
  });
});
