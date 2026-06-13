// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

// TD-006: local embedding 三端均不支持（sidecar 退役）。onboarding 跳过 embedding 时
// 不得再落一个谁也不认的 LOCAL 死模式 —— 应落 mode=API + 空字段（优雅 STALE）。

import { describe, expect, it } from "vitest";
import { LLMMode } from "../../../api/engine-client";
import { buildOnboardingSettingsSaveInput, createDefaultMobileOnboardingSettings } from "../form-mappers";

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
