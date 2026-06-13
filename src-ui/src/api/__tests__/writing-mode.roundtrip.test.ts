// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it } from "vitest";
import type { WritingMode } from "@ficforge/engine";
import { initEngine } from "../engine-instance";
import {
  getSettingsForEditing,
  getWritingMode,
  saveAppPreferences,
  saveFontPreferences,
} from "../engine-settings";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";

// Round-trip closure proof for the new app.writing_mode field (UI wrapper → settings.yaml → read).
// The engine-side dictToAppConfig coercion is covered by src-engine file_settings.test.ts;
// this proves the saveAppPreferences wrapper actually persists the field (it previously dropped
// everything but `language`).
describe("writing_mode persistence round-trip (UI → engine)", () => {
  beforeEach(async () => {
    initEngine(new MockAdapter(), "");
    await getSettingsForEditing();
  });

  it("defaults to 'full' and round-trips a save to 'simple'", async () => {
    expect(await getWritingMode()).toBe("full");
    await saveAppPreferences({ writing_mode: "simple" });
    expect(await getWritingMode()).toBe("simple");
    expect((await getSettingsForEditing()).app.writing_mode).toBe("simple");
  });

  it("preserves language + fonts when writing_mode is saved", async () => {
    await saveAppPreferences({ language: "en" });
    await saveFontPreferences({
      ui_latin_font_id: "x",
      ui_cjk_font_id: "y",
      reading_latin_font_id: "z",
      reading_cjk_font_id: "w",
    });
    await saveAppPreferences({ writing_mode: "simple" });

    const s = await getSettingsForEditing();
    expect(s.app.writing_mode).toBe("simple");
    expect(s.app.language).toBe("en");
    expect(s.app.fonts.ui_latin_font_id).toBe("x");
  });

  it("ignores an invalid writing_mode value (no throw, stays 'full')", async () => {
    await saveAppPreferences({ writing_mode: "weird" as unknown as WritingMode });
    expect(await getWritingMode()).toBe("full");
  });
});
