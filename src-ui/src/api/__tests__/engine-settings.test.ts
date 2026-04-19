// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it } from "vitest";
import { initEngine } from "../engine-instance";
import {
  getSettingsForEditing,
  saveAppPreferences,
  saveFontPreferences,
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
});
