// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebAdapter } from "../web_adapter.js";

function createStorageMock(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
}

describe("WebAdapter secret storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("sessionStorage", createStorageMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports session-only capabilities", () => {
    const adapter = new WebAdapter("device-id");

    expect(adapter.getSecretStorageCapabilities()).toEqual({
      backend: "session_storage_with_memory_fallback",
      encrypted_at_rest: false,
      persistence: "session_only",
    });
  });

  it("migrates legacy localStorage secrets into session storage on read", async () => {
    localStorage.setItem("__secure__:settings.default_llm.api_key", "legacy-secret");

    const adapter = new WebAdapter("device-id");

    await expect(adapter.secureGet("settings.default_llm.api_key")).resolves.toBe("legacy-secret");
    expect(sessionStorage.getItem("__secure__:settings.default_llm.api_key")).toBe("legacy-secret");
    expect(localStorage.getItem("__secure__:settings.default_llm.api_key")).toBeNull();
  });

  it("stores and removes secrets from session storage without leaving legacy copies", async () => {
    const adapter = new WebAdapter("device-id");
    localStorage.setItem("__secure__:project.au-1.llm.api_key", "old-secret");

    await adapter.secureSet("project.au-1.llm.api_key", "fresh-secret");
    expect(sessionStorage.getItem("__secure__:project.au-1.llm.api_key")).toBe("fresh-secret");
    expect(localStorage.getItem("__secure__:project.au-1.llm.api_key")).toBeNull();

    localStorage.setItem("__secure__:project.au-1.llm.api_key", "stale-secret");
    await adapter.secureRemove("project.au-1.llm.api_key");
    expect(sessionStorage.getItem("__secure__:project.au-1.llm.api_key")).toBeNull();
    expect(localStorage.getItem("__secure__:project.au-1.llm.api_key")).toBeNull();
  });
});
