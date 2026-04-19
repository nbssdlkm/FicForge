// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { secureStorageMock } = vi.hoisted(() => ({
  secureStorageMock: {
    getItem: vi.fn<(key: string) => Promise<string | null>>(),
    setItem: vi.fn<(key: string, value: string) => Promise<void>>(),
    removeItem: vi.fn<(key: string) => Promise<void>>(),
  },
}));

vi.mock("@aparajita/capacitor-secure-storage", () => ({
  SecureStorage: secureStorageMock,
}));

import { CapacitorAdapter } from "../capacitor_adapter.js";

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

describe("CapacitorAdapter secret storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createLocalStorageMock());
    secureStorageMock.getItem.mockReset();
    secureStorageMock.setItem.mockReset();
    secureStorageMock.removeItem.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports encrypted persistent capabilities", () => {
    const adapter = new CapacitorAdapter("device-id");

    expect(adapter.getSecretStorageCapabilities()).toEqual({
      backend: "os_keyring",
      encrypted_at_rest: true,
      persistence: "persistent",
    });
  });

  it("migrates legacy localStorage secrets into secure storage on read", async () => {
    const secureStore = new Map<string, string>();
    secureStorageMock.getItem.mockImplementation(async (key) => secureStore.get(key) ?? null);
    secureStorageMock.setItem.mockImplementation(async (key, value) => {
      secureStore.set(key, value);
    });
    secureStorageMock.removeItem.mockImplementation(async (key) => {
      secureStore.delete(key);
    });

    localStorage.setItem("__secure__:settings.default_llm.api_key", "legacy-secret");

    const adapter = new CapacitorAdapter("device-id");

    await expect(adapter.secureGet("settings.default_llm.api_key")).resolves.toBe("legacy-secret");
    expect(secureStore.get("settings.default_llm.api_key")).toBe("legacy-secret");
    expect(localStorage.getItem("__secure__:settings.default_llm.api_key")).toBeNull();
  });

  it("cleans up legacy localStorage copies after secure writes and deletes", async () => {
    const secureStore = new Map<string, string>();
    secureStorageMock.getItem.mockImplementation(async (key) => secureStore.get(key) ?? null);
    secureStorageMock.setItem.mockImplementation(async (key, value) => {
      secureStore.set(key, value);
    });
    secureStorageMock.removeItem.mockImplementation(async (key) => {
      secureStore.delete(key);
    });

    const adapter = new CapacitorAdapter("device-id");
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
