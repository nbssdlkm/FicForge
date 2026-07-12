// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * safeMatter 判别性单元测试（审计 H6 + M27 + B-3）。
 * 回退到裸 matter(raw) 或去掉 B-3 零键回退的旧实现必挂。
 */

import { describe, expect, it } from "vitest";
import { safeMatter, splitFrontmatterRaw } from "../frontmatter.js";

const KEYS: ReadonlySet<string> = new Set(["chapter_id", "generated_with"]);

describe("safeMatter", () => {
  it("B-3: 空 frontmatter 块（`---\\n\\n---`）整文回退，不丢分割线", () => {
    // 裸 matter：data 为 {}（零键短路已知键白名单），content 丢掉两行 `---`
    const raw = "---\n\n---\n\n正文第一段。";
    const r = safeMatter(raw, KEYS);
    expect(r.data).toEqual({});
    expect(r.content).toBe(raw);
  });

  it("正文以 `---` 场景分割线开头（解析出字符串标量）整文回退", () => {
    const raw = "---\n\n夜色如墨。\n\n---\n\n第二场。";
    const r = safeMatter(raw, KEYS);
    expect(r.data).toEqual({});
    expect(r.content).toBe(raw);
  });

  it("开头 `---` 块无闭合分割线时整文回退", () => {
    const raw = "---\n正文没有闭合分割线";
    const r = safeMatter(raw, KEYS);
    expect(r.data).toEqual({});
    expect(r.content).toBe(raw);
  });

  it("非法 YAML 不抛错，整文回退", () => {
    const raw = "---\nfoo: [unclosed\n---\n正文。";
    const r = safeMatter(raw, KEYS);
    expect(r.data).toEqual({});
    expect(r.content).toBe(raw);
  });

  it("有键值对但无任何已知键时整文回退", () => {
    const raw = "---\n时间: 深夜\n地点: 山径\n---\n正文。";
    const r = safeMatter(raw, KEYS);
    expect(r.data).toEqual({});
    expect(r.content).toBe(raw);
  });

  it("含已知键的真 frontmatter 正常剥离", () => {
    const raw = "---\nchapter_id: abc\n---\n正文。";
    const r = safeMatter(raw, KEYS);
    expect(r.data.chapter_id).toBe("abc");
    expect(r.content).toBe("正文。");
  });

  it("已知键与未知键混合时按真 frontmatter 处理（some 语义）", () => {
    const raw = "---\nchapter_id: abc\nextra: 1\n---\n正文。";
    const r = safeMatter(raw, KEYS);
    expect(r.data.chapter_id).toBe("abc");
    expect(r.data.extra).toBe(1);
    expect(r.content).toBe("正文。");
  });

  it("无 frontmatter 的纯正文原样透传", () => {
    const raw = "普通正文。\n\n第二段。";
    const r = safeMatter(raw, KEYS);
    expect(r.data).toEqual({});
    expect(r.content).toBe(raw);
  });

  it("M27: 返回的 data 是拷贝，调用方补齐不污染后续解析", () => {
    const raw = "---\nchapter_id: abc\n---\n正文。";
    const first = safeMatter(raw, KEYS);
    first.data.injected = "polluted";
    const second = safeMatter(raw, KEYS);
    expect(second.data.injected).toBeUndefined();
  });
});

describe("splitFrontmatterRaw（保留行序原文分割，R4 架构维 M4）", () => {
  const KEYS: ReadonlySet<string> = new Set(["name", "aliases", "importance"]);

  it("正常 frontmatter：返回原文块（保注释与行序）+ 正文", () => {
    const raw = "---\n# 用户注释\nname: 林昭\ncustom: 用户自留字段\n---\n正文第一行。";
    const r = splitFrontmatterRaw(raw, KEYS);
    expect(r.frontmatter).toBe("# 用户注释\nname: 林昭\ncustom: 用户自留字段");
    expect(r.body).toBe("正文第一行。");
  });

  it("H6 防线：正文以 --- 场景分割线开头（块内无已知键）→ 整文当正文", () => {
    const raw = "---\n深夜，雨。\n---\n正文继续。";
    const r = splitFrontmatterRaw(raw, KEYS);
    expect(r.frontmatter).toBeNull();
    expect(r.body).toBe(raw);
  });

  it("未知键块（如 时间: 深夜）→ 不算 frontmatter", () => {
    const raw = "---\n时间: 深夜\n---\n正文。";
    const r = splitFrontmatterRaw(raw, KEYS);
    expect(r.frontmatter).toBeNull();
  });

  it("CRLF 归一 + 首部空白容忍", () => {
    const raw = "\n---\r\nname: A\r\n---\r\n正文。";
    const r = splitFrontmatterRaw(raw, KEYS);
    expect(r.frontmatter).toBe("name: A");
    expect(r.body).toBe("正文。");
  });

  it("无 frontmatter：body = 归一化全文", () => {
    const r = splitFrontmatterRaw("纯正文。", KEYS);
    expect(r.frontmatter).toBeNull();
    expect(r.body).toBe("纯正文。");
  });

  it("引号键（合法 YAML）也被接受——判定与 safeMatter 单源（codex E2 HIGH 回归锁）", () => {
    const raw = '---\n"name": 林昭\n---\n正文。';
    const r = splitFrontmatterRaw(raw, KEYS);
    expect(r.frontmatter).toBe('"name": 林昭');
    expect(r.body).toBe("正文。");
    expect(safeMatter(raw, KEYS).data.name).toBe("林昭");
  });

  it("与 safeMatter 判据同向：同输入两者对「是否 frontmatter」结论一致", () => {
    const eaten = "---\n深夜，雨。\n---\n正文。";
    const legit = "---\nname: 林昭\n---\n正文。";
    expect(splitFrontmatterRaw(eaten, KEYS).frontmatter).toBeNull();
    expect(safeMatter(eaten, KEYS).content).toBe(eaten);
    expect(splitFrontmatterRaw(legit, KEYS).frontmatter).not.toBeNull();
    expect(safeMatter(legit, KEYS).data.name).toBe("林昭");
  });
});
