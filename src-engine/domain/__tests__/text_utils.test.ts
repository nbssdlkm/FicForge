// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { extract_last_scene_ending } from "../text_utils.js";

describe("extract_last_scene_ending", () => {
  it("empty string", () => {
    expect(extract_last_scene_ending("")).toBe("");
  });

  it("short text returns all", () => {
    expect(extract_last_scene_ending("短文本。")).toBe("短文本。");
  });

  it("long text truncates at sentence boundary", () => {
    const text = "这是一段很长的文本。" + "后面还有更多内容。".repeat(10) + "最后一句话。";
    const result = extract_last_scene_ending(text, 50);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(text.endsWith(result)).toBe(true);
  });

  it("respects max_chars parameter", () => {
    const text = "A".repeat(100) + "。" + "B".repeat(30);
    const result = extract_last_scene_ending(text, 50);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it("whitespace-only text returns empty", () => {
    expect(extract_last_scene_ending("   ")).toBe("");
  });

  it("no sentence boundary falls back to direct truncation", () => {
    const text = "A".repeat(200);
    const result = extract_last_scene_ending(text, 50);
    expect(result).toBe("A".repeat(50));
  });

  it("text ending with punctuation", () => {
    const text = "前面有很多内容。" + "中间的段落。".repeat(5) + "最后一段话。";
    const result = extract_last_scene_ending(text, 50);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.length).toBeGreaterThan(0);
  });
});
