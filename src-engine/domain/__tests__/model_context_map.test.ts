// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_OUTPUT,
  get_context_window,
  get_model_max_output,
  normalize_model_id,
} from "../model_context_map.js";

describe("model_context_map", () => {
  it("exact match", () => {
    expect(get_model_max_output("deepseek-chat")).toBe(8_192);
    expect(get_model_max_output("gpt-4o")).toBe(4_096);
  });

  it("prefix match", () => {
    expect(get_model_max_output("deepseek-chat-v2")).toBe(8_192);
  });

  it("unknown model returns default", () => {
    expect(get_model_max_output("unknown-model")).toBe(DEFAULT_MAX_OUTPUT);
  });

  it("get_context_window — manual override", () => {
    expect(get_context_window({ llm: { context_window: 50000, model: "gpt-4o" } })).toBe(50000);
  });

  it("get_context_window — model lookup", () => {
    expect(get_context_window({ llm: { context_window: 0, model: "claude-3-5-sonnet" } })).toBe(200_000);
  });

  it("get_context_window — fallback default", () => {
    expect(get_context_window({})).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  // -------------------------------------------------------------------------
  // 数据刷新（2026-07-07）：新增主力模型条目
  // -------------------------------------------------------------------------

  it("refreshed data — DeepSeek V4 系列 1M ctx / 384K out", () => {
    expect(get_context_window({ llm: { context_window: 0, model: "deepseek-v4-flash" } })).toBe(1_000_000);
    expect(get_context_window({ llm: { context_window: 0, model: "deepseek-v4-pro" } })).toBe(1_000_000);
    expect(get_model_max_output("deepseek-v4-flash")).toBe(384_000);
  });

  it("refreshed data — claude-sonnet-4-6 修订为 1M ctx / 128K out（旧值 200000/8192 已过时）", () => {
    expect(get_context_window({ llm: { context_window: 0, model: "claude-sonnet-4-6" } })).toBe(1_000_000);
    expect(get_model_max_output("claude-sonnet-4-6")).toBe(128_000);
  });

  it("refreshed data — qwen3.7 1M / qwen-long 10M（旧 qwen-max=32768 保留）", () => {
    expect(get_context_window({ llm: { context_window: 0, model: "qwen3.7-max" } })).toBe(1_000_000);
    expect(get_context_window({ llm: { context_window: 0, model: "qwen-long" } })).toBe(10_000_000);
    expect(get_context_window({ llm: { context_window: 0, model: "qwen-max" } })).toBe(32_768);
  });

  it("refreshed data — 新旗舰 gpt-5.4-mini(400K) 不被 gpt-5.4(1M) 误命中", () => {
    expect(get_context_window({ llm: { context_window: 0, model: "gpt-5.4-mini" } })).toBe(400_000);
    expect(get_context_window({ llm: { context_window: 0, model: "gpt-5.4" } })).toBe(1_000_000);
  });

  it("legacy 条目保留 — deepseek-chat=65536（7-24 前存量用户仍在用）", () => {
    expect(get_context_window({ llm: { context_window: 0, model: "deepseek-chat" } })).toBe(65_536);
  });

  // -------------------------------------------------------------------------
  // fuzzy 匹配修复：strip org/ 前缀 + 小写化
  // -------------------------------------------------------------------------

  it("normalize_model_id — strip org/ 前缀 + 小写", () => {
    expect(normalize_model_id("deepseek-ai/DeepSeek-V4-Pro")).toBe("deepseek-v4-pro");
    expect(normalize_model_id("moonshotai/Kimi-K2.6")).toBe("kimi-k2.6");
    expect(normalize_model_id("GPT-4o")).toBe("gpt-4o");
    expect(normalize_model_id("deepseek-chat")).toBe("deepseek-chat");
  });

  it("fuzzy 修复 — SiliconFlow/OpenRouter org/ 形态命中裸名条目（判别测试）", () => {
    // 调研指定判别用例：moonshotai/Kimi-K2.6 → 命中 262144
    expect(get_context_window({ llm: { context_window: 0, model: "moonshotai/Kimi-K2.6" } })).toBe(262_144);
    // deepseek-ai/DeepSeek-V4-Pro → 1M（旧 startsWith 逻辑会落 32k）
    expect(get_context_window({ llm: { context_window: 0, model: "deepseek-ai/DeepSeek-V4-Pro" } })).toBe(1_000_000);
    // zai-org/GLM-4.7 → 200K
    expect(get_context_window({ llm: { context_window: 0, model: "zai-org/GLM-4.7" } })).toBe(200_000);
    // max output 同样受益
    expect(get_model_max_output("deepseek-ai/DeepSeek-V4-Pro")).toBe(384_000);
  });

  it("fuzzy 修复 — 未知 org/ 形态 id 仍落 DEFAULT(32000)（判别测试）", () => {
    expect(get_context_window({ llm: { context_window: 0, model: "some-org/Totally-Unknown-Model" } })).toBe(
      DEFAULT_CONTEXT_WINDOW,
    );
    expect(get_model_max_output("some-org/Totally-Unknown-Model")).toBe(DEFAULT_MAX_OUTPUT);
  });
});
