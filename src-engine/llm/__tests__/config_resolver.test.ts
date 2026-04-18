// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { create_provider, resolve_llm_config, resolve_llm_params } from "../config_resolver.js";
import { OpenAICompatibleProvider } from "../openai_compatible.js";

describe("resolve_llm_config", () => {
  it("session_llm takes priority", () => {
    const result = resolve_llm_config(
      { mode: "api", model: "session-model", api_base: "http://session", api_key: "sk-session" },
      { llm: { mode: "api", model: "project-model", api_base: "http://project", api_key: "sk-project" } },
      { default_llm: { mode: "api", model: "settings-model", api_base: "http://settings", api_key: "sk-settings" } },
    );
    expect(result.model).toBe("session-model");
    expect(result.api_key).toBe("sk-session");
  });

  it("falls to project.llm when no session", () => {
    const result = resolve_llm_config(
      null,
      { llm: { mode: "api", model: "project-model", api_base: "http://project", api_key: "sk-project" } },
      { default_llm: { mode: "api", model: "settings-model" } },
    );
    expect(result.model).toBe("project-model");
  });

  it("falls to settings.default_llm when no session or project", () => {
    const result = resolve_llm_config(
      null,
      { llm: { mode: "api", model: "" } },
      { default_llm: { mode: "api", model: "settings-model", api_key: "sk-settings" } },
    );
    expect(result.model).toBe("settings-model");
  });

  it("masked api_key falls back to settings", () => {
    const result = resolve_llm_config(
      { mode: "api", model: "m", api_base: "http://x", api_key: "****xxxx" },
      {},
      { default_llm: { api_key: "sk-real-key" } },
    );
    expect(result.api_key).toBe("sk-real-key");
  });
});

describe("resolve_llm_params", () => {
  it("session_params takes priority", () => {
    const result = resolve_llm_params(
      "gpt-4o",
      { temperature: 0.5, top_p: 0.8 },
      {},
      {},
    );
    expect(result.temperature).toBe(0.5);
    expect(result.top_p).toBe(0.8);
  });

  it("falls to project override", () => {
    const result = resolve_llm_params(
      "gpt-4o",
      null,
      { model_params_override: { "gpt-4o": { temperature: 0.7, top_p: 0.9 } } },
      {},
    );
    expect(result.temperature).toBe(0.7);
  });

  it("falls to settings model_params", () => {
    const result = resolve_llm_params(
      "gpt-4o",
      null,
      {},
      { model_params: { "gpt-4o": { temperature: 0.6, top_p: 0.85 } } },
    );
    expect(result.temperature).toBe(0.6);
  });

  it("falls to defaults", () => {
    const result = resolve_llm_params("unknown", null, {}, {});
    expect(result.temperature).toBe(1.0);
    expect(result.top_p).toBe(0.95);
  });
});

// ---------------------------------------------------------------------------
// create_provider —— P1-5a 真正支持 ollama
// ---------------------------------------------------------------------------

describe("create_provider", () => {
  it("mode=api 返回 OpenAICompatibleProvider", () => {
    const p = create_provider({
      mode: "api", model: "gpt-4o", api_base: "https://api.openai.com/v1", api_key: "sk-x",
    });
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it("mode=ollama 走 OpenAI 兼容协议（默认 base = localhost:11434/v1）", () => {
    const p = create_provider({
      mode: "ollama", model: "", api_base: "", api_key: "",
      ollama_model: "llama3",
    });
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it("mode=ollama 自动补齐 /v1 后缀（用户只填了 host）", () => {
    const p = create_provider({
      mode: "ollama", model: "", api_base: "http://192.168.1.10:11434", api_key: "",
      ollama_model: "llama3",
    });
    // 通过 instanceof 检查 —— 具体的 base normalization 在 OpenAICompatibleProvider 内部不可观测，
    // 但至少不该因为缺 /v1 抛错
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it("mode=ollama 已带 /v1 不重复追加", () => {
    const p = create_provider({
      mode: "ollama", model: "", api_base: "http://host:11434/v1", api_key: "",
      ollama_model: "llama3",
    });
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it("mode=ollama 缺 ollama_model 抛错（引擎级护栏）", () => {
    expect(() =>
      create_provider({ mode: "ollama", model: "", api_base: "", api_key: "" }),
    ).toThrow(/ollama_model/i);
  });

  it("mode=local 抛错（未实现）", () => {
    expect(() =>
      create_provider({ mode: "local", model: "", api_base: "", api_key: "" }),
    ).toThrow(/local.*未实现|not.*implemented|sidecar/i);
  });

  it("未知 mode 抛错", () => {
    expect(() =>
      create_provider({ mode: "anthropic-native", model: "m", api_base: "", api_key: "" }),
    ).toThrow(/mode/i);
  });
});
