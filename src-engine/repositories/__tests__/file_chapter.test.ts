// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { FileChapterRepository } from "../implementations/file_chapter.js";
import { createChapter } from "../../domain/chapter.js";
import { createGeneratedWith } from "../../domain/generated_with.js";
import { compute_content_hash } from "../../utils/file_utils.js";
import { MockAdapter } from "./mock_adapter.js";

describe("FileChapterRepository", () => {
  let adapter: MockAdapter;
  let repo: FileChapterRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    repo = new FileChapterRepository(adapter);
  });

  it("save and get round-trip", async () => {
    const chapter = createChapter({
      au_id: "au1",
      chapter_num: 1,
      content: "这是第一章的内容。夕阳西下。",
      chapter_id: "uuid-001",
      revision: 1,
      confirmed_focus: ["f1", "f2"],
      provenance: "ai",
    });
    await repo.save(chapter);

    const loaded = await repo.get("au1", 1);
    expect(loaded.content).toContain("这是第一章的内容");
    expect(loaded.chapter_id).toBe("uuid-001");
    expect(loaded.confirmed_focus).toEqual(["f1", "f2"]);
    expect(loaded.provenance).toBe("ai");
  });

  it("get auto-repairs missing fields", async () => {
    // Seed a chapter with no frontmatter
    adapter.seed("au1/chapters/main/ch0001.md", "纯正文，没有 frontmatter。");

    const loaded = await repo.get("au1", 1);
    expect(loaded.chapter_id).toBeTruthy(); // auto-generated UUID
    expect(loaded.confirmed_at).toBeTruthy();
    expect(loaded.content_hash).toBeTruthy();
    expect(["ai", "imported"]).toContain(loaded.provenance); // auto-repaired
    expect(loaded.revision).toBe(1);
  });

  it("returns null on missing chapter (get 契约：缺失 null、fs 错误照抛)", async () => {
    await expect(repo.get("au1", 99)).resolves.toBeNull();
  });

  it("delete removes file", async () => {
    const chapter = createChapter({ au_id: "au1", chapter_num: 1, content: "test" });
    await repo.save(chapter);
    expect(await repo.exists("au1", 1)).toBe(true);

    await repo.delete("au1", 1);
    expect(await repo.exists("au1", 1)).toBe(false);
  });

  it("list_main returns sorted chapters", async () => {
    await repo.save(createChapter({ au_id: "au1", chapter_num: 3, content: "ch3" }));
    await repo.save(createChapter({ au_id: "au1", chapter_num: 1, content: "ch1" }));
    await repo.save(createChapter({ au_id: "au1", chapter_num: 2, content: "ch2" }));

    const chapters = await repo.list_main("au1");
    expect(chapters.map((c) => c.chapter_num)).toEqual([1, 2, 3]);
  });

  it("get_content_only strips frontmatter", async () => {
    await repo.save(createChapter({ au_id: "au1", chapter_num: 1, content: "纯正文内容" }));
    const content = await repo.get_content_only("au1", 1);
    expect(content).toContain("纯正文内容");
    expect(content).not.toContain("chapter_id");
  });

  it("backup_chapter creates versioned backup", async () => {
    await repo.save(createChapter({ au_id: "au1", chapter_num: 1, content: "original" }));
    const backupPath = await repo.backup_chapter("au1", 1);
    expect(backupPath).toContain("ch0001_v1.md");

    // Second backup
    const backupPath2 = await repo.backup_chapter("au1", 1);
    expect(backupPath2).toContain("ch0001_v2.md");
  });

  // L23（审计第二轮）：版本号用 max(现存版本号)+1 而非文件数+1。外部清理 v1、只留 v2 后，
  // 新备份必须是 v3（旧码算 length+1 = 2 会覆盖既有 v2）。回退旧码即挂。
  it("backup_chapter 版本号用 max+1：外部删 v1 留 v2 后新备份是 v3", async () => {
    await repo.save(createChapter({ au_id: "au1", chapter_num: 1, content: "original" }));
    const v1 = await repo.backup_chapter("au1", 1); // v1
    const v2 = await repo.backup_chapter("au1", 1); // v2
    expect(v1).toContain("ch0001_v1.md");
    expect(v2).toContain("ch0001_v2.md");

    // 外部清理掉 v1（模拟用户/清理工具删了旧备份，只剩 v2）
    await adapter.deleteFile(v1);
    expect(await adapter.exists(v1)).toBe(false);
    expect(await adapter.exists(v2)).toBe(true);

    // 现存文件数=1，但现存最大版本号=2 → 新备份必须是 v3，绝不能覆盖 v2
    const v3 = await repo.backup_chapter("au1", 1);
    expect(v3).toContain("ch0001_v3.md");
    expect(v3).not.toBe(v2);
    // v2 仍在（未被覆盖）
    expect(await adapter.exists(v2)).toBe(true);
  });

  it("preserves generated_with metadata", async () => {
    const gw = createGeneratedWith({
      mode: "api",
      model: "gpt-4o",
      temperature: 0.8,
      input_tokens: 5000,
      output_tokens: 1500,
    });
    await repo.save(
      createChapter({
        au_id: "au1",
        chapter_num: 1,
        content: "test",
        generated_with: gw,
      }),
    );

    const loaded = await repo.get("au1", 1);
    expect(loaded.generated_with).not.toBeNull();
    expect(loaded.generated_with!.model).toBe("gpt-4o");
    expect(loaded.generated_with!.temperature).toBe(0.8);
  });
});

/**
 * frontmatter 解析安全性（审计 H6 + M27）判别性测试。
 *
 * 针对 gray-matter 的两个陷阱：
 * - H6：正文以 `---` 开头的无 frontmatter 文件会被误当 frontmatter 吞正文
 *   （读路径 matter(text)；写路径 matter.stringify(string, meta) 内部同样再解析一遍）；
 * - M27：无 options 调用按原文全局缓存并共享 .data，get() 的内存补齐污染缓存。
 * 回退到裸 matter(text) / matter.stringify(string, meta) 的旧实现必挂。
 */
describe("FileChapterRepository frontmatter safety (H6)", () => {
  let adapter: MockAdapter;
  let repo: FileChapterRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    repo = new FileChapterRepository(adapter);
  });

  it("reads a frontmatter-less chapter whose body starts with a --- scene divider", async () => {
    const raw = "---\n\n夜色如墨，山径无人。\n\n---\n\n第二场，晨光初现。";
    adapter.seed("au1/chapters/main/ch0001.md", raw);

    // 旧实现：data 变成字符串 primitive，赋 chapter_id 抛 TypeError
    const ch = await repo.get("au1", 1);
    expect(ch.content).toBe(raw);
    expect(ch.chapter_id).toBeTruthy();
    // 无 frontmatter 文件必须走「导入」分支
    expect(ch.provenance).toBe("imported");

    // 旧实现：get_content_only 静默返回残缺的后半正文
    expect(await repo.get_content_only("au1", 1)).toBe(raw);
  });

  it("save→get round-trip is lossless for body starting with ---", async () => {
    const raw = "---\n\n夜色如墨，山径无人。\n\n---\n\n第二场，晨光初现。";
    adapter.seed("au1/chapters/main/ch0001.md", raw);

    const ch = await repo.get("au1", 1);
    await repo.save(ch);
    // 旧实现：matter.stringify(string, meta) 把正文首段再解析成 frontmatter 吃掉
    const again = await repo.get("au1", 1);
    expect(again.content).toBe(raw);
    expect(again.chapter_id).toBe(ch.chapter_id);
    expect(again.provenance).toBe(ch.provenance);
    // 二次 save→get 稳定（不会每轮再啃掉一段）
    await repo.save(again);
    expect((await repo.get("au1", 1)).content).toBe(raw);
  });

  it("does not eat a yaml-looking body block without known chapter meta keys", async () => {
    const raw = "---\n时间: 深夜\n---\n正文第一行。";
    adapter.seed("au1/chapters/main/ch0002.md", raw);

    const ch = await repo.get("au1", 2);
    expect(ch.content).toBe(raw);
    expect(ch.provenance).toBe("imported");
    expect(await repo.get_content_only("au1", 2)).toBe(raw);
  });

  it("falls back to raw content on invalid YAML frontmatter instead of throwing", async () => {
    const raw = "---\nfoo: [unclosed\n---\n正文。";
    adapter.seed("au1/chapters/main/ch0003.md", raw);

    const ch = await repo.get("au1", 3);
    expect(ch.content).toBe(raw);
    expect(await repo.get_content_only("au1", 3)).toBe(raw);
  });

  it("list_main survives an AU containing a ----leading chapter", async () => {
    adapter.seed("au1/chapters/main/ch0001.md", "普通第一章正文。");
    adapter.seed("au1/chapters/main/ch0002.md", "---\n\n场景一。\n\n---\n\n场景二。");

    // 旧实现：get(2) 抛 TypeError → 整个 AU 的章节列表崩掉
    const chapters = await repo.list_main("au1");
    expect(chapters.map((c) => c.chapter_num)).toEqual([1, 2]);
    expect(chapters[1].content).toBe("---\n\n场景一。\n\n---\n\n场景二。");
  });

  it("keeps normal chapters with valid frontmatter fully intact", async () => {
    const content = "第一章正文。\n\n换行段落。";
    const ch = createChapter({
      au_id: "au1",
      chapter_num: 7,
      content,
      chapter_id: "id-777",
      revision: 3,
      confirmed_focus: ["f_1", "f_2"],
      confirmed_at: "2026-07-01T00:00:00Z",
      content_hash: await compute_content_hash(content),
      provenance: "ai",
      generated_with: createGeneratedWith({
        mode: "continue",
        model: "m",
        temperature: 0.7,
        top_p: 0.9,
        input_tokens: 10,
        output_tokens: 20,
        char_count: 30,
        duration_ms: 40,
        generated_at: "2026-07-01T00:00:00Z",
      }),
    });
    await repo.save(ch);

    const got = await repo.get("au1", 7);
    expect(got.content).toBe(content);
    expect(got.chapter_id).toBe("id-777");
    expect(got.revision).toBe(3);
    expect(got.confirmed_focus).toEqual(["f_1", "f_2"]);
    expect(got.confirmed_at).toBe("2026-07-01T00:00:00Z");
    expect(got.provenance).toBe("ai");
    expect(got.generated_with?.model).toBe("m");
    // 磁盘上确实是 frontmatter 形态（不是被回退成纯文本）
    expect(adapter.raw("au1/chapters/main/ch0007.md")!.startsWith("---\nchapter_id: id-777\n")).toBe(true);
  });

  it("treats frontmatter with a known key but missing provenance as ai-authored", async () => {
    adapter.seed("au1/chapters/main/ch0004.md", "---\nchapter_id: abc\n---\n正文。");

    const ch = await repo.get("au1", 4);
    expect(ch.chapter_id).toBe("abc");
    expect(ch.provenance).toBe("ai");
    expect(ch.content).toBe("正文。");
  });
});

describe("FileChapterRepository cache isolation (M27)", () => {
  let adapter: MockAdapter;
  let repo: FileChapterRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    repo = new FileChapterRepository(adapter);
  });

  it("byte-identical frontmatter-less chapters get distinct chapter_id", async () => {
    const raw = "两章字节完全相同的正文。";
    adapter.seed("au1/chapters/main/ch0001.md", raw);
    adapter.seed("au1/chapters/main/ch0002.md", raw);

    // 旧实现：gray-matter 按原文缓存 + 共享 .data，get(1) 的补齐污染缓存，
    // get(2) 读到同一个 chapter_id / confirmed_at
    const a = await repo.get("au1", 1);
    const b = await repo.get("au1", 2);
    expect(a.chapter_id).not.toBe(b.chapter_id);
  });

  it("in-memory 补齐 never leaks into a later parse of the same text", async () => {
    const raw = "同一文件读两次。";
    adapter.seed("au1/chapters/main/ch0001.md", raw);

    const first = await repo.get("au1", 1);
    // 未 save 之前磁盘上仍无 frontmatter；第二次读必须重新补齐，
    // 而不是从被污染的缓存里拿到第一次生成的 id
    const second = await repo.get("au1", 1);
    expect(first.chapter_id).not.toBe(second.chapter_id);
    expect(second.content).toBe(raw);
  });
});
