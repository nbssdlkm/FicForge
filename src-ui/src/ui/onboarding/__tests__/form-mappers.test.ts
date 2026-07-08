// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

// TD-006: local embedding 三端均不支持（sidecar 退役）。onboarding 跳过 embedding 时
// 不得再落一个谁也不认的 LOCAL 死模式 —— 应落 mode=API + 空字段（优雅 STALE）。

import { describe, expect, it } from "vitest";
import { LLMMode, type OnboardingDefaults } from "../../../api/engine-client";
import {
  buildOnboardingSettingsSaveInput,
  createDefaultMobileOnboardingSettings,
  hydrateMobileOnboardingSettings,
} from "../form-mappers";

describe("buildOnboardingSettingsSaveInput — embedding mode (TD-006)", () => {
  it("never persists a dead LOCAL embedding mode when the user skips embedding", () => {
    const state = { ...createDefaultMobileOnboardingSettings(), useCustomEmbedding: false };
    const out = buildOnboardingSettingsSaveInput(state);
    expect(out.embedding.mode).toBe(LLMMode.API);
    // empty fields → createEmbeddingProvider returns undefined → RAG gracefully STALE
    expect(out.embedding.api_base).toBe("");
    expect(out.embedding.api_key).toBe("");
  });

  it("persists the user's API embedding fields when configured", () => {
    const state = {
      ...createDefaultMobileOnboardingSettings(),
      useCustomEmbedding: true,
      embeddingModel: "BAAI/bge-m3",
      embeddingApiBase: "https://embed.example/v1",
      embeddingApiKey: "k",
    };
    const out = buildOnboardingSettingsSaveInput(state);
    expect(out.embedding.mode).toBe(LLMMode.API);
    expect(out.embedding.model).toBe("BAAI/bge-m3");
    expect(out.embedding.api_base).toBe("https://embed.example/v1");
    expect(out.embedding.api_key).toBe("k");
  });
});

describe("onboarding form-mappers — ctx / chat_path 链（R2-3 / R2-7）", () => {
  it("build：ctx \"\"（窗口未知）→ 省略 context_window；chatPath 空 → 省略 chat_path", () => {
    const state = createDefaultMobileOnboardingSettings();
    const out = buildOnboardingSettingsSaveInput(state);
    expect("context_window" in out.default_llm).toBe(false);
    expect("chat_path" in out.default_llm).toBe(false);
  });

  it("build：选择器带出的 ctx / chatPath 进保存 payload", () => {
    const state = {
      ...createDefaultMobileOnboardingSettings(),
      contextWindow: "1000000",
      chatPath: "/relay/chat",
    };
    const out = buildOnboardingSettingsSaveInput(state);
    expect(out.default_llm.context_window).toBe(1_000_000);
    expect(out.default_llm.chat_path).toBe("/relay/chat");
  });

  it("hydrate：持久层 0 哨兵 → \"\"；显式 ctx / chat_path 原样回填", () => {
    const zero = hydrateMobileOnboardingSettings({
      default_llm: { mode: "api", model: "m", api_base: "https://a/v1", api_key: "k", context_window: 0 },
      embedding: {},
    } as unknown as OnboardingDefaults);
    expect(zero.contextWindow).toBe("");

    const explicit = hydrateMobileOnboardingSettings({
      default_llm: { mode: "api", model: "m", api_base: "https://a/v1", api_key: "k", context_window: 131072, chat_path: "/gw/chat" },
      embedding: {},
    } as unknown as OnboardingDefaults);
    expect(explicit.contextWindow).toBe("131072");
    expect(explicit.chatPath).toBe("/gw/chat");
  });
});
