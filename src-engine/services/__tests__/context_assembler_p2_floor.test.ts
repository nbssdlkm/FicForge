// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

// L7（审计第二轮）：P2「最近章节」层的 500 字下限不得突破层预算。
// 小窗口模型极端时，旧代码「不低于 500 字」的硬下限会让 P2 超 budget，
// 挤爆 P4/P5 甚至整体超窗。修复后：500 字仍超 budget 时下限退让到 0，
// 允许裁剪到真正塞得进预算；充足预算下逐字节不变（golden 由独立 golden 测试守）。

import { beforeAll, describe, expect, it } from "vitest";
import { build_recent_chapter_layer } from "../context_assembler.js";
import { count_tokens, ensure_tokenizer } from "../../tokenizer/index.js";
import { createState } from "../../domain/state.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";

// 与实现同源计数（context_assembler._count 内部就是 count_tokens）。
const _count = (text: string, llm: unknown) => count_tokens(text, llm as { mode?: string } | undefined);

async function seedPrevChapter(content: string) {
  const adapter = new MockAdapter();
  const repo = new FileChapterRepository(adapter);
  // current_chapter=2 → 层读取 current-1=1 的正文
  adapter.seed("au1/chapters/main/ch0001.md", content);
  const state = createState({ au_id: "au1", current_chapter: 2 });
  return { adapter, repo, state };
}

describe("build_recent_chapter_layer — L7 P2 floor 不突破层预算", () => {
  const llm = { model: "" };
  beforeAll(async () => { await ensure_tokenizer(); });

  it("500 字对应 token 超 budget 时，输出被裁到 <= budget（下限退让到 0）", async () => {
    // 800 字正文（> 500 下限），budget 只给 100 token —— 500 字（中文 ~ >= 500 token）远超之。
    const content = "夜色如墨，长街寂寂。".repeat(80); // 10 字 * 80 = 800 字
    const { repo, state } = await seedPrevChapter(content);
    const budget = 100;

    const out = await build_recent_chapter_layer(state, repo, "au1", budget, llm, "zh");

    // 关键断言：整层输出 token 不超 budget（旧代码因 500 字硬下限会超）。
    expect(out).not.toBe("");
    expect(_count(out, llm).count).toBeLessThanOrEqual(budget);
  });

  it("充足 budget 时整段原样返回（不进裁剪路径，行为不变）", async () => {
    const content = "短短一段结尾。";
    const { repo, state } = await seedPrevChapter(content);
    // budget 远大于内容 → 早返回全文
    const out = await build_recent_chapter_layer(state, repo, "au1", 10_000, llm, "zh");
    expect(out).toContain(content);
  });

  it("500 字能塞进 budget 时，下限仍守 500（不误伤：至少给到下限）", async () => {
    // 长正文，budget 给到足以容纳 500 字但不足以容纳全文 → floor=500 生效，输出 >= 约 500 字末尾。
    const content = "情节推进。".repeat(400); // 5 字 * 400 = 2000 字
    const { repo, state } = await seedPrevChapter(content);
    const floorText = content.slice(-500);
    const floorTokens = _count(floorText, llm).count;
    const budget = floorTokens + 5; // 刚好容得下 500 字下限、容不下全文

    const out = await build_recent_chapter_layer(state, repo, "au1", budget, llm, "zh");
    // 输出应至少覆盖到 500 字下限的量级（floor 未被误降到 0）。
    expect(out.length).toBeGreaterThanOrEqual(400);
  });
});
