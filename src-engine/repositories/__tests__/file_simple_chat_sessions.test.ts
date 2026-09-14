// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FileSimpleChatRepository 多会话面（chat-sessions 底座）测试。
 * 覆盖：legacy 迁移、会话 CRUD、会话间隔离、自动标题、legacy 委托、RMW。
 */

import { describe, expect, it, beforeEach } from "vitest";
import * as yaml from "js-yaml";
import { FileSimpleChatRepository } from "../implementations/file_simple_chat.js";
import type { SimpleChatMessageEnvelope } from "../../domain/simple_chat.js";
import { MockAdapter } from "./mock_adapter.js";

function userMsg(id: string, content: string): SimpleChatMessageEnvelope {
  return { id, timestamp: "2026-09-13T10:00:00Z", kind: "user", content };
}

describe("FileSimpleChatRepository · chat-sessions 多会话", () => {
  let adapter: MockAdapter;
  let repo: FileSimpleChatRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    repo = new FileSimpleChatRepository(adapter);
  });

  // -------------------------------------------------------------------------
  // legacy 迁移
  // -------------------------------------------------------------------------

  it("首次访问自动迁移 legacy simple-chat.yaml 为 default 会话（老文件保留）", async () => {
    // 铺 legacy 单文件
    await adapter.mkdir("au1/.well-known");
    await adapter.writeFile(
      "au1/.well-known/simple-chat.yaml",
      yaml.dump({
        version: 1,
        au_path: "au1",
        created_at: "2026-08-01T08:00:00Z",
        updated_at: "2026-08-02T09:00:00Z",
        messages: [userMsg("m1", "写第一章 主角进酒馆")],
      }),
    );

    const sessions = await repo.listSessions("au1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("default");
    // 标题从首条用户消息自动推导
    expect(sessions[0].title).toBe("写第一章 主角进酒馆");
    expect(sessions[0].message_count).toBe(1);
    // 时间戳保留 legacy 原值
    expect(sessions[0].created_at).toBe("2026-08-01T08:00:00Z");
    expect(sessions[0].updated_at).toBe("2026-08-02T09:00:00Z");

    // 消息原样可读
    const file = await repo.getSession("au1", "default");
    expect(file.messages).toHaveLength(1);
    expect(file.messages[0].content).toBe("写第一章 主角进酒馆");

    // legacy 老文件保留不删（降级回旧版 App 仍能读到）
    expect(await adapter.exists("au1/.well-known/simple-chat.yaml")).toBe(true);

    // 迁移幂等：再 list 不翻倍
    const again = await repo.listSessions("au1");
    expect(again).toHaveLength(1);
  });

  it("全新 AU（无 legacy 文件）索引为空列表，不凭空造会话", async () => {
    const sessions = await repo.listSessions("au_fresh");
    expect(sessions).toEqual([]);
  });

  it("legacy 兼容面委托 default 会话：save → get round-trip 走会话文件", async () => {
    await repo.save("au1", [userMsg("m1", "hello")]);
    const file = await repo.get("au1");
    expect(file.messages).toHaveLength(1);
    // 物理落点是 default 会话文件，不是 legacy 单文件
    expect(await adapter.exists("au1/.well-known/chat-sessions/default.yaml")).toBe(true);
    expect(await adapter.exists("au1/.well-known/simple-chat.yaml")).toBe(false);
    // legacy save 后 default 会话进索引
    const sessions = await repo.listSessions("au1");
    expect(sessions.some((s) => s.id === "default")).toBe(true);
  });

  it("迁移后再 save 不再读 legacy 文件（索引存在即不再搬）", async () => {
    await adapter.mkdir("au1/.well-known");
    await adapter.writeFile(
      "au1/.well-known/simple-chat.yaml",
      yaml.dump({ version: 1, au_path: "au1", messages: [userMsg("m1", "旧对话")] }),
    );
    await repo.listSessions("au1"); // 触发迁移
    await repo.save("au1", [userMsg("m2", "新对话覆盖")]);
    const file = await repo.get("au1");
    expect(file.messages).toHaveLength(1);
    expect(file.messages[0].content).toBe("新对话覆盖");
  });

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  it("createSession：无标题落 title_auto 占位；有标题不自动起名", async () => {
    const auto = await repo.createSession("au1");
    expect(auto.title_auto).toBe(true);
    expect(auto.message_count).toBe(0);
    const named = await repo.createSession("au1", "第四章构思");
    expect(named.title).toBe("第四章构思");
    expect(named.title_auto).toBeUndefined();
    const sessions = await repo.listSessions("au1");
    expect(sessions).toHaveLength(2);
  });

  it("saveSession 自动标题：首条用户消息截断为标题，之后不再改写", async () => {
    const s = await repo.createSession("au1");
    const longContent = "  帮我写第四章：赫敏在图书馆禁书区发现少了一本书，悬疑开场  ";
    await repo.saveSession("au1", s.id, [userMsg("m1", longContent)]);
    let sessions = await repo.listSessions("au1");
    const titled = sessions.find((x) => x.id === s.id)!;
    // 压缩空白 + 截断 24 字（截到「书，」恰好 24 字符）
    expect(titled.title).toBe("帮我写第四章：赫敏在图书馆禁书区发现少了一本书，");
    expect(titled.title).toHaveLength(24);
    expect(titled.title_auto).toBeUndefined();
    expect(titled.message_count).toBe(1);
    // 再存不重新起名
    await repo.saveSession("au1", s.id, [userMsg("m1", longContent), userMsg("m2", "换个方向")]);
    sessions = await repo.listSessions("au1");
    expect(sessions.find((x) => x.id === s.id)!.title).toBe("帮我写第四章：赫敏在图书馆禁书区发现少了一本书，");
  });

  it("renameSession 截断超长标题并摘掉 title_auto；改名后 save 不再自动起名", async () => {
    const s = await repo.createSession("au1");
    await repo.renameSession("au1", s.id, "x".repeat(40));
    let sessions = await repo.listSessions("au1");
    expect(sessions[0].title).toBe("x".repeat(24));
    await repo.saveSession("au1", s.id, [userMsg("m1", "用户消息不该再改标题")]);
    sessions = await repo.listSessions("au1");
    expect(sessions[0].title).toBe("x".repeat(24));
    // 空标题改名 = no-op
    await repo.renameSession("au1", s.id, "   ");
    sessions = await repo.listSessions("au1");
    expect(sessions[0].title).toBe("x".repeat(24));
  });

  it("deleteSession 除名索引并删文件；重复删幂等", async () => {
    const s = await repo.createSession("au1");
    await repo.saveSession("au1", s.id, [userMsg("m1", "要删的会话")]);
    await repo.deleteSession("au1", s.id);
    expect(await repo.listSessions("au1")).toHaveLength(0);
    expect(await adapter.exists(`au1/.well-known/chat-sessions/${s.id}.yaml`)).toBe(false);
    await repo.deleteSession("au1", s.id); // 不抛
    await repo.deleteSession("au1", "cs_never_existed"); // 不抛
  });

  it("会话间完全隔离：两会话各自读写互不串扰", async () => {
    const a = await repo.createSession("au1", "会话 A");
    const b = await repo.createSession("au1", "会话 B");
    await repo.saveSession("au1", a.id, [userMsg("m1", "A 的消息")]);
    await repo.saveSession("au1", b.id, [userMsg("m2", "B 的消息"), userMsg("m3", "B 的第二条")]);
    const fa = await repo.getSession("au1", a.id);
    const fb = await repo.getSession("au1", b.id);
    expect(fa.messages).toHaveLength(1);
    expect(fa.messages[0].content).toBe("A 的消息");
    expect(fb.messages).toHaveLength(2);
  });

  it("读不存在的会话返回空白文件（宽容语义）", async () => {
    const file = await repo.getSession("au1", "cs_missing");
    expect(file.messages).toEqual([]);
    expect(file.au_path).toBe("au1");
  });

  it("非法会话 id 抛错（防路径穿越）", async () => {
    await expect(repo.getSession("au1", "../etc")).rejects.toThrow();
    await expect(repo.saveSession("au1", "a/b", [])).rejects.toThrow();
  });

  it("listSessions 按 updated_at 倒序", async () => {
    const first = await repo.createSession("au1", "先建");
    const second = await repo.createSession("au1", "后建");
    // 给先建的补一次写，把它顶到最前
    await repo.saveSession("au1", first.id, [userMsg("m1", "刷新时间")]);
    const sessions = await repo.listSessions("au1");
    expect(sessions[0].id).toBe(first.id);
    expect(sessions[1].id).toBe(second.id);
  });

  // -------------------------------------------------------------------------
  // RMW 与并发
  // -------------------------------------------------------------------------

  it("updateSession 锁内 RMW：以磁盘现状为基底，index 元数据同步", async () => {
    const s = await repo.createSession("au1", "RMW");
    await repo.saveSession("au1", s.id, [userMsg("m1", "第一条")]);
    await repo.updateSession("au1", s.id, (messages) => [
      ...messages,
      { id: "m2", timestamp: "2026-09-13T11:00:00Z", kind: "assistant", content: "回复" },
    ]);
    const file = await repo.getSession("au1", s.id);
    expect(file.messages).toHaveLength(2);
    const sessions = await repo.listSessions("au1");
    expect(sessions.find((x) => x.id === s.id)!.message_count).toBe(2);
  });

  it("并发 saveSession 串行化（同路径锁，不交叉撕裂）", async () => {
    const s = await repo.createSession("au1");
    await Promise.all([
      repo.saveSession("au1", s.id, [userMsg("m1", "A")]),
      repo.saveSession("au1", s.id, [userMsg("m2", "B")]),
      repo.saveSession("au1", s.id, [userMsg("m3", "C")]),
    ]);
    const file = await repo.getSession("au1", s.id);
    // 全量替换语义：最后一个赢；关键是文件是完整的一份，不是交叉撕裂的产物
    expect(file.messages).toHaveLength(1);
    expect(["A", "B", "C"]).toContain(file.messages[0].content);
  });
});
