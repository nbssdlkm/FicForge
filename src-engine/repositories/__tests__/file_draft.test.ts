// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { FileDraftRepository } from "../implementations/file_draft.js";
import { createDraft } from "../../domain/draft.js";
import { createGeneratedWith } from "../../domain/generated_with.js";
import { MockAdapter } from "./mock_adapter.js";

const gw = () =>
  createGeneratedWith({
    mode: "continue",
    model: "m",
    temperature: 0.7,
    top_p: 0.9,
    input_tokens: 10,
    output_tokens: 20,
    char_count: 30,
    duration_ms: 40,
    generated_at: "2026-07-01T00:00:00Z",
  });

describe("FileDraftRepository", () => {
  let adapter: MockAdapter;
  let repo: FileDraftRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    repo = new FileDraftRepository(adapter);
  });

  it("save→get round-trip preserves content and generated_with", async () => {
    // 末尾带 \n：gray-matter stringify 对无尾换行的内容会补一个 \n（既有行为），
    // 用带尾换行的内容做逐字节断言
    const content = "第一段草稿。\n\n第二段草稿。\n";
    await repo.save(
      createDraft({
        au_id: "au1",
        chapter_num: 1,
        variant: "a",
        content,
        generated_with: gw(),
      }),
    );

    const loaded = await repo.get("au1", 1, "a");
    expect(loaded.content).toBe(content);
    expect(loaded.generated_with?.model).toBe("m");
    expect(loaded.generated_with?.temperature).toBe(0.7);
    // 磁盘上确实是 frontmatter 形态
    expect(adapter.raw("au1/chapters/.drafts/ch0001_draft_a.md")!.startsWith("---\ngenerated_with:\n")).toBe(true);
  });

  it("generated_with 为 null 时文件是纯正文（无 frontmatter 块）", async () => {
    const content = "无元数据的草稿。\n";
    await repo.save(
      createDraft({
        au_id: "au1",
        chapter_num: 2,
        variant: "a",
        content,
        generated_with: null,
      }),
    );

    expect(adapter.raw("au1/chapters/.drafts/ch0002_draft_a.md")).toBe(content);
    const loaded = await repo.get("au1", 2, "a");
    expect(loaded.content).toBe(content);
    expect(loaded.generated_with).toBeNull();
  });

  it("listByChapter and deleteByChapter", async () => {
    await repo.save(createDraft({ au_id: "au1", chapter_num: 3, variant: "a", content: "甲稿。\n" }));
    await repo.save(createDraft({ au_id: "au1", chapter_num: 3, variant: "b", content: "乙稿。\n" }));
    await repo.save(createDraft({ au_id: "au1", chapter_num: 4, variant: "a", content: "别章。\n" }));

    const drafts = await repo.listByChapter("au1", 3);
    expect(drafts.map((d) => d.variant).sort()).toEqual(["a", "b"]);

    await repo.deleteByChapter("au1", 3);
    expect(await repo.listByChapter("au1", 3)).toEqual([]);
    expect((await repo.listByChapter("au1", 4)).length).toBe(1);
  });
});

/**
 * frontmatter 解析安全性判别性测试（审计 B-1，H6 同族）。
 *
 * 危害链：AI 以 `---` 场景分割线开头出稿 → 旧写路径 matter.stringify(string, meta)
 * 把正文再解析一遍吞掉/搅碎首段 → 用户未编辑直接 confirm 时 confirmChapter 回退
 * draft.content → 截断内容固化进正式章节。
 * 回退到裸 matter(text) / matter.stringify(string, meta) 的旧实现必挂。
 */
describe("FileDraftRepository frontmatter safety (B-1)", () => {
  let adapter: MockAdapter;
  let repo: FileDraftRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    repo = new FileDraftRepository(adapter);
  });

  it("`---` 开头草稿（带 generated_with）save→get 无损", async () => {
    const content = "---\n\n夜色如墨，山径无人。\n\n---\n\n第二场，晨光初现。\n";
    await repo.save(
      createDraft({
        au_id: "au1",
        chapter_num: 1,
        variant: "a",
        content,
        generated_with: gw(),
      }),
    );

    // 旧写路径：stringify(string, meta) 把 `---` 块解析成字符串标量后按字符
    // 摊平进 frontmatter（'0': 夜 ...），正文被搅碎
    const rawFile = adapter.raw("au1/chapters/.drafts/ch0001_draft_a.md")!;
    expect(rawFile).not.toContain("'0':");
    expect(rawFile).toContain("夜色如墨，山径无人。");

    const loaded = await repo.get("au1", 1, "a");
    expect(loaded.content).toBe(content);
    expect(loaded.generated_with?.model).toBe("m");

    // 二次 save→get 稳定（不会每轮再啃掉一段）
    await repo.save(loaded);
    expect((await repo.get("au1", 1, "a")).content).toBe(content);
  });

  it("`---` 开头草稿（无 generated_with）save→get 无损", async () => {
    const content = "---\n\n夜色如墨。\n\n---\n\n第二场。\n";
    await repo.save(
      createDraft({
        au_id: "au1",
        chapter_num: 2,
        variant: "a",
        content,
        generated_with: null,
      }),
    );

    // 无 meta → 文件即纯正文；读路径不得把正文首段误当 frontmatter 吞掉
    expect(adapter.raw("au1/chapters/.drafts/ch0002_draft_a.md")).toBe(content);
    const loaded = await repo.get("au1", 2, "a");
    expect(loaded.content).toBe(content);
    expect(loaded.generated_with).toBeNull();
  });

  it("B-3: `---\\n\\n---` 开头草稿 save→get 无损（零键空块不吞分割线）", async () => {
    const content = "---\n\n---\n\n正文从分割线后开始。\n";

    // 带 generated_with：文件有真 frontmatter，正文里的空块原样保留
    await repo.save(
      createDraft({
        au_id: "au1",
        chapter_num: 3,
        variant: "a",
        content,
        generated_with: gw(),
      }),
    );
    expect((await repo.get("au1", 3, "a")).content).toBe(content);

    // 无 generated_with：文件即纯正文，读路径零键回退整文
    await repo.save(
      createDraft({
        au_id: "au1",
        chapter_num: 3,
        variant: "b",
        content,
        generated_with: null,
      }),
    );
    expect((await repo.get("au1", 3, "b")).content).toBe(content);
  });

  it("非法 YAML 形态正文不抛错、整文保留", async () => {
    // 直接 seed 模拟历史损伤/手工编辑的草稿文件
    adapter.seed("au1/chapters/.drafts/ch0004_draft_a.md", "---\nfoo: [unclosed\n---\n正文。");
    const loaded = await repo.get("au1", 4, "a");
    expect(loaded.content).toBe("---\nfoo: [unclosed\n---\n正文。");
    expect(loaded.generated_with).toBeNull();
  });
});
