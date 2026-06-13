// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it } from "vitest";
import { initEngine } from "../engine-instance";
import {
  getSettingsForEditing,
  getSettingsSummary,
  saveAppPreferences,
  saveFontPreferences,
  saveGlobalSettingsForEditing,
  saveGlobalModelParams,
} from "../engine-settings";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";

class SlowMockAdapter extends MockAdapter {
  async readFile(path: string): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return super.readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return super.writeFile(path, content);
  }
}

describe("engine-settings write queue", () => {
  let adapter: SlowMockAdapter;

  beforeEach(async () => {
    adapter = new SlowMockAdapter();
    initEngine(adapter, "");
    await getSettingsForEditing();
  });

  it("preserves both fields across concurrent settings commands", async () => {
    const fonts = {
      ui_latin_font_id: "ui-latin-test",
      ui_cjk_font_id: "ui-cjk-test",
      reading_latin_font_id: "reading-latin-test",
      reading_cjk_font_id: "reading-cjk-test",
    };

    await Promise.all([
      saveAppPreferences({ language: "en" }),
      saveFontPreferences(fonts),
    ]);

    const settings = await getSettingsForEditing();
    expect(settings.app.language).toBe("en");
    expect(settings.app.fonts).toEqual(fonts);
  });

  it("preserves model params when saved concurrently with app preferences", async () => {
    await Promise.all([
      saveAppPreferences({ language: "en" }),
      saveGlobalModelParams("gpt-test", { temperature: 0.2, top_p: 0.8 }),
    ]);

    const settings = await getSettingsForEditing();
    expect(settings.app.language).toBe("en");
    expect(settings.model_params["gpt-test"]).toEqual({ temperature: 0.2, top_p: 0.8 });
  });

  it("keeps edit query rich while summary stays redacted", async () => {
    await saveGlobalSettingsForEditing({
      default_llm: {
        mode: "api",
        model: "gpt-test",
        api_base: "https://example.com/v1",
        api_key: "super-secret-key",
        local_model_path: "",
        ollama_model: "",
        context_window: 128000,
      },
      embedding: {
        model: "embed-test",
        api_base: "https://embed.example.com/v1",
        api_key: "embed-secret",
      },
    });

    const settings = await getSettingsForEditing();
    const summary = await getSettingsSummary();

    expect(settings.default_llm.api_key).toBe("super-secret-key");
    expect(settings.embedding.api_key).toBe("embed-secret");

    expect(summary.default_llm.has_api_key).toBe(true);
    expect(summary.embedding.has_api_key).toBe(true);
    expect("api_key" in summary.default_llm).toBe(false);
    expect("api_key" in summary.embedding).toBe(false);
  });

  // TD-006 / 残留消除: 「内置 embedding vs 自定义」概念已删（local embedding 三端均不
  // 支持）。embedding 现在只有 API 一种，恒落 mode=api 并原样持久化用户填的字段，
  // 不再有平台分支、不再落死的 "local"。
  it("always persists embedding mode 'api' with the provided fields (no built-in gating)", async () => {
    await saveGlobalSettingsForEditing({
      default_llm: {
        mode: "api",
        model: "gpt-test",
        api_base: "https://example.com/v1",
        api_key: "k",
        local_model_path: "",
        ollama_model: "",
        context_window: 128000,
      },
      embedding: { model: "bge-m3", api_base: "https://embed.example/v1", api_key: "ek" },
    });

    const settings = await getSettingsForEditing();
    expect(settings.embedding.mode).toBe("api"); // 修复前在 Tauri「内置」分支会是 "local"
    expect(settings.embedding.model).toBe("bge-m3");
    expect(settings.embedding.api_base).toBe("https://embed.example/v1");
  });

  it("persists empty embedding fields as 'not configured' (mode stays 'api')", async () => {
    await saveGlobalSettingsForEditing({
      default_llm: {
        mode: "api",
        model: "gpt-test",
        api_base: "https://example.com/v1",
        api_key: "k",
        local_model_path: "",
        ollama_model: "",
        context_window: 128000,
      },
      embedding: { model: "", api_base: "", api_key: "" },
    });

    const settings = await getSettingsForEditing();
    expect(settings.embedding.mode).toBe("api");
    expect(settings.embedding.api_key).toBe("");
  });
});
