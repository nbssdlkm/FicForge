// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 角色别名归一化表：构建冲突规则 + per-AU 缓存生命周期。
 *
 * 判别契约：
 * - build：主名优先 / 歧义别名双弃 / 同主名合并 —— 归一化宁可不动、不可归错；
 * - cache：内容修改靠显式 invalidate、文件增删靠文件名签名兜底、
 *   构建在飞被 invalidate 不落脏缓存（epoch 守卫）、并发首访单飞、降级永不抛。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { buildAliasTable, CharacterAliasManager } from "../character_alias_table.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { initLogger } from "../../logger/index.js";

const AU = "/data/fandoms/f/aus/a";

function card(name: string, aliases: string[]): string {
  return `---\nname: ${name}\naliases: [${aliases.join(", ")}]\n---\n\n# ${name}\n`;
}

/** readFile 计数 + 可注入单文件失败 + 可注入「读完后挂起」门（模拟构建在飞）。 */
class CountingAdapter extends MockAdapter {
  readFileCalls = 0;
  failSuffixes: string[] = [];
  gate: Promise<void> | null = null;

  override async readFile(path: string): Promise<string> {
    this.readFileCalls++;
    if (this.failSuffixes.some((s) => path.endsWith(s))) {
      throw new Error(`mock read fail: ${path}`);
    }
    const content = await super.readFile(path);
    // 门放在读取之后：在飞构建拿到的是「旧内容」，用于验证 epoch 守卫不落脏缓存
    if (this.gate) await this.gate;
    return content;
  }
}

describe("buildAliasTable 冲突规则", () => {
  it("基本构建：每张卡都进表，无别名卡挂空数组", () => {
    expect(buildAliasTable([
      { name: "沈砚", aliases: ["砚哥", "沈大人"] },
      { name: "阿福", aliases: [] },
    ])).toEqual({ 沈砚: ["砚哥", "沈大人"], 阿福: [] });
  });

  it("同主名多卡（大小写不敏感）→ 别名合并，主名保首见写法", () => {
    expect(buildAliasTable([
      { name: "Harry", aliases: ["救世主"] },
      { name: "harry", aliases: ["疤头", "救世主"] },
    ])).toEqual({ Harry: ["救世主", "疤头"] });
  });

  it("别名与任一主名相撞（大小写不敏感）→ 剔除该别名（主名优先，防吞并角色）", () => {
    expect(buildAliasTable([
      { name: "沈砚", aliases: ["阿福", "砚哥"] },
      { name: "阿福", aliases: ["shen yan"] },
      { name: "Shen Yan", aliases: [] },
    ])).toEqual({ 沈砚: ["砚哥"], 阿福: [], "Shen Yan": [] });
  });

  it("同一别名被 ≥2 个主名认领 → 双方都剔除（歧义不归一）", () => {
    expect(buildAliasTable([
      { name: "沈砚", aliases: ["大人", "砚哥"] },
      { name: "王爷", aliases: ["大人"] },
      { name: "阿福", aliases: ["福伯"] },
    ])).toEqual({ 沈砚: ["砚哥"], 王爷: [], 阿福: ["福伯"] });
  });

  it("空输入 / 全空白主名 → null（与无表同表示）", () => {
    expect(buildAliasTable([])).toBeNull();
    expect(buildAliasTable([{ name: "   ", aliases: ["x"] }])).toBeNull();
  });

  it("别名 trim + 空白别名剔除", () => {
    expect(buildAliasTable([{ name: "沈砚", aliases: [" 砚哥 ", "  "] }]))
      .toEqual({ 沈砚: ["砚哥"] });
  });
});

describe("CharacterAliasManager 缓存生命周期", () => {
  let adapter: CountingAdapter;
  let mgr: CharacterAliasManager;

  beforeEach(() => {
    adapter = new CountingAdapter();
    initLogger(new MockAdapter(), "data");
    mgr = new CharacterAliasManager(adapter);
  });

  it("建表：读角色卡 frontmatter；name 缺失回退文件名", async () => {
    adapter.seed(`${AU}/characters/沈砚.md`, card("沈砚", ["砚哥"]));
    adapter.seed(`${AU}/characters/无名氏.md`, "# 正文而已，没有 frontmatter\n");
    adapter.seed(`${AU}/characters/notes.txt`, "非 md 文件不参与");
    await expect(mgr.get(AU)).resolves.toEqual({ 沈砚: ["砚哥"], 无名氏: [] });
  });

  it("缓存命中：第二次 get 不重读文件", async () => {
    adapter.seed(`${AU}/characters/a.md`, card("沈砚", ["砚哥"]));
    const t1 = await mgr.get(AU);
    const calls = adapter.readFileCalls;
    const t2 = await mgr.get(AU);
    expect(adapter.readFileCalls).toBe(calls);
    expect(t2).toBe(t1); // 同一份缓存对象
  });

  it("invalidate：内容修改（签名不变）后重建拿到新表", async () => {
    adapter.seed(`${AU}/characters/a.md`, card("沈砚", ["旧称"]));
    await expect(mgr.get(AU)).resolves.toEqual({ 沈砚: ["旧称"] });
    adapter.seed(`${AU}/characters/a.md`, card("沈砚", ["新称"]));
    // 未失效前：文件名签名相同 → 仍是旧表（这正是写入口必须显式失效的原因）
    await expect(mgr.get(AU)).resolves.toEqual({ 沈砚: ["旧称"] });
    mgr.invalidate(AU);
    await expect(mgr.get(AU)).resolves.toEqual({ 沈砚: ["新称"] });
  });

  it("签名兜底：文件增/删未经 invalidate 也自动重建", async () => {
    adapter.seed(`${AU}/characters/a.md`, card("沈砚", ["砚哥"]));
    await expect(mgr.get(AU)).resolves.toEqual({ 沈砚: ["砚哥"] });
    adapter.seed(`${AU}/characters/b.md`, card("阿福", []));
    await expect(mgr.get(AU)).resolves.toEqual({ 沈砚: ["砚哥"], 阿福: [] });
    await adapter.deleteFile(`${AU}/characters/a.md`);
    await adapter.deleteFile(`${AU}/characters/b.md`);
    await expect(mgr.get(AU)).resolves.toBeNull(); // 卡全删光 → 无表
  });

  it("并发首访单飞：两个 get 共享一次构建", async () => {
    adapter.seed(`${AU}/characters/a.md`, card("沈砚", ["砚哥"]));
    adapter.seed(`${AU}/characters/b.md`, card("阿福", []));
    const [t1, t2] = await Promise.all([mgr.get(AU), mgr.get(AU)]);
    expect(adapter.readFileCalls).toBe(2); // 每卡只读一次
    expect(t2).toBe(t1);
  });

  it("epoch 守卫：构建在飞期间被 invalidate → 旧结果不落缓存", async () => {
    adapter.seed(`${AU}/characters/a.md`, card("沈砚", ["旧称"]));
    let release!: () => void;
    adapter.gate = new Promise<void>((r) => { release = r; });

    const inflight = mgr.get(AU); // 已读到旧内容，挂在门上
    // 等构建真正走到 readFile（exists → listDir → readFile 各有一轮微任务）
    while (adapter.readFileCalls === 0) await new Promise((r) => setTimeout(r, 0));

    // 模拟 saveLore：写新内容（文件名/签名不变）+ 显式失效
    adapter.seed(`${AU}/characters/a.md`, card("沈砚", ["新称"]));
    mgr.invalidate(AU);
    adapter.gate = null;
    release();
    await inflight; // 旧构建收尾（结果不断言——它就是竞态中的陈旧值）

    // 若旧构建落了缓存（签名相同会命中），这里会错误地拿到旧称
    await expect(mgr.get(AU)).resolves.toEqual({ 沈砚: ["新称"] });
  });

  it("目录不存在 → null，不抛错", async () => {
    await expect(mgr.get("/data/fandoms/f/aus/ghost")).resolves.toBeNull();
  });

  it("单卡读失败 → 跳过该卡，其余照常（部分表可用）", async () => {
    adapter.seed(`${AU}/characters/a.md`, card("沈砚", ["砚哥"]));
    adapter.seed(`${AU}/characters/bad.md`, card("阿福", []));
    adapter.failSuffixes = ["bad.md"];
    await expect(mgr.get(AU)).resolves.toEqual({ 沈砚: ["砚哥"] });
  });
});
