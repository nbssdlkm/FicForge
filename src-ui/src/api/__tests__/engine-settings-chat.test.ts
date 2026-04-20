// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../client";
import { initEngine } from "../engine-instance";
import { createAu, createFandom } from "../engine-fandom";
import { saveGlobalSettingsForEditing } from "../engine-settings";
import { sendSettingsChat } from "../engine-settings-chat";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";

describe("engine-settings-chat config validation", () => {
  let adapter: MockAdapter;
  let auPath: string;

  beforeEach(async () => {
    adapter = new MockAdapter();
    initEngine(adapter, "/data");

    const fandom = await createFandom("Naruto");
    const au = await createAu(fandom.name, "Canon", fandom.path);
    auPath = au.path;
  });

  it("fails fast with a friendly error when api mode has no key", async () => {
    await expect(
      sendSettingsChat({
        mode: "au",
        base_path: auPath,
        messages: [{ role: "user", content: "Add a character file." }],
      }),
    ).rejects.toMatchObject<ApiError>({
      errorCode: "no_api_key",
    });
  });

  it("fails fast with a friendly error when api mode has no base url", async () => {
    await saveGlobalSettingsForEditing({
      default_llm: {
        mode: "api",
        model: "gpt-test",
        api_base: "",
        api_key: "secret-key",
        local_model_path: "",
        ollama_model: "",
        context_window: 128000,
      },
      embedding: {
        use_custom_config: false,
        model: "",
        api_base: "",
        api_key: "",
      },
      sync: {
        mode: "none",
        url: "",
        username: "",
        password: "",
        remote_dir: "/FicForge/",
        last_sync: null,
      },
    });

    await expect(
      sendSettingsChat({
        mode: "au",
        base_path: auPath,
        messages: [{ role: "user", content: "Add a character file." }],
      }),
    ).rejects.toMatchObject<ApiError>({
      errorCode: "api_base_missing",
    });
  });
});
