// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_OUTPUT,
  get_context_window,
  get_model_max_output,
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
});
