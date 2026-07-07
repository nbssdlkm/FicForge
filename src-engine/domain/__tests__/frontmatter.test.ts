// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * safeMatter 判别性单元测试（审计 H6 + M27 + B-3）。
 * 回退到裸 matter(raw) 或去掉 B-3 零键回退的旧实现必挂。
 */

import { describe, expect, it } from "vitest";
import { safeMatter } from "../frontmatter.js";

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
