// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(command: string, payload: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { TauriAdapter } from "../tauri_adapter.js";

function createLocalStorageMock(): Storage {
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

describe("TauriAdapter secret storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createLocalStorageMock());
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports OS keyring capabilities", () => {
    const adapter = new TauriAdapter("device-id");

    expect(adapter.getSecretStorageCapabilities()).toEqual({
      backend: "os_keyring",
      encrypted_at_rest: true,
      persistence: "persistent",
    });
  });

  it("migrates legacy localStorage secrets into the secure store on read", async () => {
    const secureStore = new Map<string, string>();
    invokeMock.mockImplementation(async (command, payload) => {
      const key = String(payload.key);
      if (command === "secure_store_get") return secureStore.get(key) ?? null;
      if (command === "secure_store_set") {
        secureStore.set(key, String(payload.value));
        return undefined;
      }
      if (command === "secure_store_remove") {
        secureStore.delete(key);
        return undefined;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    localStorage.setItem("__secure__:settings.default_llm.api_key", "legacy-secret");

    const adapter = new TauriAdapter("device-id");

    await expect(adapter.secureGet("settings.default_llm.api_key")).resolves.toBe("legacy-secret");
    expect(secureStore.get("settings.default_llm.api_key")).toBe("legacy-secret");
    expect(localStorage.getItem("__secure__:settings.default_llm.api_key")).toBeNull();
  });

  it("cleans up legacy localStorage copies after secure writes and deletes", async () => {
    const secureStore = new Map<string, string>();
    invokeMock.mockImplementation(async (command, payload) => {
      const key = String(payload.key);
      if (command === "secure_store_get") return secureStore.get(key) ?? null;
      if (command === "secure_store_set") {
        secureStore.set(key, String(payload.value));
        return undefined;
      }
      if (command === "secure_store_remove") {
        secureStore.delete(key);
        return undefined;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const adapter = new TauriAdapter("device-id");
    localStorage.setItem("__secure__:project.au-1.llm.api_key", "old-secret");

    await adapter.secureSet("project.au-1.llm.api_key", "fresh-secret");
    expect(secureStore.get("project.au-1.llm.api_key")).toBe("fresh-secret");
    expect(localStorage.getItem("__secure__:project.au-1.llm.api_key")).toBeNull();

    localStorage.setItem("__secure__:project.au-1.llm.api_key", "stale-secret");
    await adapter.secureRemove("project.au-1.llm.api_key");
    expect(secureStore.has("project.au-1.llm.api_key")).toBe(false);
    expect(localStorage.getItem("__secure__:project.au-1.llm.api_key")).toBeNull();
  });
});
