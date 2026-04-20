// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { createAdapterSecretStore } from "../secret_store.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";

describe("createAdapterSecretStore", () => {
  it("delegates secret CRUD to the adapter-backed store", async () => {
    const store = createAdapterSecretStore(new MockAdapter());

    await expect(store.has("settings.default_llm.api_key")).resolves.toBe(false);
    await store.set("settings.default_llm.api_key", "sk-test");
    await expect(store.get("settings.default_llm.api_key")).resolves.toBe("sk-test");
    await expect(store.has("settings.default_llm.api_key")).resolves.toBe(true);

    await store.remove("settings.default_llm.api_key");
    await expect(store.get("settings.default_llm.api_key")).resolves.toBe(null);
  });

  it("surfaces the adapter capability descriptor unchanged", () => {
    const store = createAdapterSecretStore(new MockAdapter());

    expect(store.getCapabilities()).toEqual({
      backend: "memory",
      encrypted_at_rest: false,
      persistence: "memory_only",
    });
  });
});
