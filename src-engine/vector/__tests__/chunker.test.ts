// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { scanChunkCharacters, splitChapterIntoChunks } from "../chunker.js";

describe("split_chapter_into_chunks", () => {
  it("empty text returns no chunks", () => {
    expect(splitChapterIntoChunks("", 1)).toEqual([]);
  });

  it("short text returns single chunk", () => {
    const chunks = splitChapterIntoChunks("这是一段短文本。", 1);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chapter_num).toBe(1);
    expect(chunks[0].chunk_index).toBe(0);
    expect(chunks[0].content).toContain("这是一段短文本");
  });

  it("strips frontmatter", () => {
    const text = "---\nchapter_id: test\n---\n正文内容，不含 frontmatter。";
    const chunks = splitChapterIntoChunks(text, 1);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).not.toContain("chapter_id");
    expect(chunks[0].content).toContain("正文内容");
  });

  it("splits long text at sentence boundaries", () => {
    // 生成多段 > 200 字的文本（用段落分隔）
    const paragraphs = [];
    for (let p = 0; p < 5; p++) {
      const sentences = [];
      for (let i = 0; i < 8; i++) {
        sentences.push(`这是第${p * 8 + i + 1}个句子，用来测试分块功能。`);
      }
      paragraphs.push(sentences.join(""));
    }
    const text = paragraphs.join("\n\n");
    const chunks = splitChapterIntoChunks(text, 5, 200, 0);
    expect(chunks.length).toBeGreaterThan(1);
    // 每个 chunk 应该在句号处断开
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.content).toMatch(/[。！？…]$/);
    }
  });

  it("merges short paragraphs", () => {
    const text = "短段落1。\n\n短。\n\n短段落3，这个比较长一些用来超过阈值。".repeat(2);
    const chunks = splitChapterIntoChunks(text, 1, 500, 0);
    // 短段落应该被合并
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("overlap includes last sentence of previous chunk", () => {
    const sentences = [];
    for (let i = 0; i < 20; i++) {
      sentences.push(`第${i + 1}句话内容比较长一些。`);
    }
    const text = sentences.join("");
    const chunks = splitChapterIntoChunks(text, 1, 150, 1);
    if (chunks.length > 1) {
      // chunk[1] should start with last sentence of chunk[0]
      const prevSentences = chunks[0].content.split(/(?<=[。！？…])/);
      const lastSentence = prevSentences[prevSentences.length - 1];
      if (lastSentence) {
        expect(chunks[1].content).toContain(lastSentence.trim());
      }
    }
  });

  it("chunk metadata is correct", () => {
    const chunks = splitChapterIntoChunks("一些内容。", 7);
    expect(chunks[0].chapter_num).toBe(7);
    expect(chunks[0].chunk_index).toBe(0);
    expect(chunks[0].branch_id).toBe("main");
    expect(chunks[0].characters).toEqual([]);
  });

  it("handles paragraph boundaries (empty lines)", () => {
    const text =
      "第一段内容比较长，足够保留不被合并掉的那种长度。" +
      "A".repeat(100) +
      "\n\n" +
      "第二段内容也比较长，足够保留不被合并掉的那种长度。" +
      "B".repeat(100);
    const chunks = splitChapterIntoChunks(text, 1, 500, 0);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * frontmatter 剥离安全性判别性测试（审计 B-2，H6 同族）。
 * 回退到裸 matter(text) 的旧实现必挂：`---` 开头的首场景被吞成 frontmatter
 * （永不进向量索引），非法 YAML 形态直接抛错（indexChapter 失败）。
 */
describe("splitChapterIntoChunks frontmatter safety (B-2)", () => {
  it("`---` 开头的正文分块包含首场景文本", () => {
    const text = "---\n\n夜色如墨，山径无人，唯有风声掠过林梢，走了很久。\n\n---\n\n第二场，晨光初现，旅人抵达山门。";
    const chunks = splitChapterIntoChunks(text, 1, 500, 0);
    const all = chunks.map((c) => c.content).join("\n");
    expect(all).toContain("夜色如墨");
    expect(all).toContain("第二场");
  });

  it("B-3: `---\\n\\n---` 开头的正文不丢分割线后内容", () => {
    const text = "---\n\n---\n\n正文从分割线后开始，讲述一段完整的故事。";
    const chunks = splitChapterIntoChunks(text, 1, 500, 0);
    expect(chunks.map((c) => c.content).join("\n")).toContain("正文从分割线后开始");
  });

  it("非法 YAML 形态正文不抛错、全文进分块", () => {
    const text = "---\nfoo: [unclosed\n---\n正文内容在此，一句完整的话。";
    expect(() => splitChapterIntoChunks(text, 1, 500, 0)).not.toThrow();
    const all = splitChapterIntoChunks(text, 1, 500, 0)
      .map((c) => c.content)
      .join("\n");
    expect(all).toContain("正文内容在此");
  });

  it("真章节 frontmatter（含未知键混合）仍被剥离", () => {
    const text = "---\nchapter_id: abc\nrevision: 2\n---\n正文内容，不含元数据。";
    const all = splitChapterIntoChunks(text, 1, 500, 0)
      .map((c) => c.content)
      .join("\n");
    expect(all).not.toContain("chapter_id");
    expect(all).toContain("正文内容");
  });
});

describe("TD-020 别名供表（chunk characters 标签）", () => {
  const cast = { characters: ["张三", "李四"] };
  const aliases = { 张三: ["小张", "阿三"], 李四: ["小李"] };

  it("通篇只用别名的正文：供表后标签记主名（char_filter 可命中的前提）", () => {
    const text = "小张走在路上，神色凝重。小李跟在后面，欲言又止。两人一路无话。";
    const chunks = splitChapterIntoChunks(text, 3, 500, 0, cast, aliases);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].characters).toEqual(expect.arrayContaining(["张三", "李四"]));
    // 别名本身不入标签（归一化到主名）
    expect(chunks[0].characters).not.toContain("小张");
    expect(chunks[0].characters).not.toContain("小李");
  });

  it("null 表回退现状：别名盲扫描，只有主名字面量命中（对照组）", () => {
    const text = "小张走在路上，神色凝重。小李跟在后面，欲言又止。两人一路无话。";
    const chunks = splitChapterIntoChunks(text, 3, 500, 0, cast, null);
    expect(chunks[0].characters).toEqual([]);
  });

  it("scanChunkCharacters 判据单源：与 splitChapterIntoChunks 的标签逐字一致", () => {
    const text = "阿三回头看了看，没有说话。夜风吹过街角。";
    const chunks = splitChapterIntoChunks(text, 5, 500, 0, cast, aliases);
    expect(scanChunkCharacters(chunks[0].content, cast, aliases, 5)).toEqual(chunks[0].characters);
  });
});
