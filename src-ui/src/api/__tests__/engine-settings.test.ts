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
        use_custom_config: true,
        model: "embed-test",
        api_base: "https://embed.example.com/v1",
        api_key: "embed-secret",
      },
      sync: {
        mode: "webdav",
        url: "https://dav.example.com",
        username: "alice",
        password: "dav-secret",
        remote_dir: "/ficforge",
        last_sync: "2026-04-20T00:00:00.000Z",
      },
    });

    const settings = await getSettingsForEditing();
    const summary = await getSettingsSummary();

    expect(settings.default_llm.api_key).toBe("super-secret-key");
    expect(settings.embedding.api_key).toBe("embed-secret");
    expect(settings.sync.webdav?.password).toBe("dav-secret");

    expect(summary.default_llm.has_api_key).toBe(true);
    expect(summary.embedding.has_api_key).toBe(true);
    expect(summary.sync.has_password).toBe(true);
    expect(summary.sync.last_sync).toBe("2026-04-20T00:00:00.000Z");
    expect("api_key" in summary.default_llm).toBe(false);
    expect("api_key" in summary.embedding).toBe(false);
    expect("password" in summary.sync).toBe(false);
  });
});
