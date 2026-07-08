// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebAdapter, __setSecureKeyForTest } from "../web_adapter.js";
import { SecretStoreReadError } from "../adapter.js";

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

// ── L14: setDeviceId 采用已持久化的 device_id ──
describe("WebAdapter device id (L14)", () => {
  it("setDeviceId 覆盖构造时的随机 ID，getDeviceId 返回采用值", () => {
    const adapter = new WebAdapter("fresh-random-id");
    expect(adapter.getDeviceId()).toBe("fresh-random-id");
    // 受限环境重开：init 阶段读到 KV 里的旧 ID 后采用之
    adapter.setDeviceId("persisted-old-id");
    expect(adapter.getDeviceId()).toBe("persisted-old-id");
  });
});

// ── Fallback path: no web crypto (no IndexedDB) → plaintext, honestly reported ──
describe("WebAdapter secret storage (plaintext fallback when web crypto unavailable)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("sessionStorage", createStorageMock());
    vi.stubGlobal("indexedDB", undefined); // force webCryptoAvailable() === false
    __setSecureKeyForTest(null); // reset the key singleton between describes
  });

  afterEach(() => {
    __setSecureKeyForTest(null);
    vi.unstubAllGlobals();
  });

  it("reports unencrypted session-only capabilities when crypto is unavailable", () => {
    const adapter = new WebAdapter("device-id");

    expect(adapter.getSecretStorageCapabilities()).toEqual({
      backend: "session_storage_plaintext_fallback",
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

// ── Encrypted path: web crypto available (key injected via the test seam) ──
// Uses the real crypto.subtle (Node webcrypto) with an injected AES key, so the
// adapter's encrypt/decrypt path is exercised without a real IndexedDB.
describe("WebAdapter secret encryption (web crypto available)", () => {
  beforeEach(async () => {
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("sessionStorage", createStorageMock());
    vi.stubGlobal("indexedDB", {}); // truthy → webCryptoAvailable() === true (key is injected, never opened)
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    __setSecureKeyForTest(key);
  });

  afterEach(() => {
    __setSecureKeyForTest(null);
    vi.unstubAllGlobals();
  });

  it("reports encrypted-at-rest capabilities when web crypto is available", () => {
    const adapter = new WebAdapter("device-id");
    expect(adapter.getSecretStorageCapabilities()).toEqual({
      backend: "web_crypto_aes_gcm",
      encrypted_at_rest: true,
      persistence: "session_only",
    });
  });

  it("stores ciphertext (not plaintext) in sessionStorage", async () => {
    const adapter = new WebAdapter("device-id");
    await adapter.secureSet("settings.default_llm.api_key", "sk-super-secret");

    const raw = sessionStorage.getItem("__secure__:settings.default_llm.api_key");
    expect(raw).not.toBeNull();
    expect(raw).not.toBe("sk-super-secret"); // proves it was actually encrypted
    expect(raw!.startsWith("encv1:")).toBe(true);
    expect(raw).not.toContain("sk-super-secret");
  });

  it("round-trips secureSet -> secureGet to the original plaintext", async () => {
    const adapter = new WebAdapter("device-id");
    await adapter.secureSet("project.au-1.llm.api_key", "round-trip-value-中文");
    await expect(adapter.secureGet("project.au-1.llm.api_key")).resolves.toBe("round-trip-value-中文");
  });

  it("encrypts legacy plaintext on migration (session value becomes ciphertext)", async () => {
    localStorage.setItem("__secure__:settings.embedding.api_key", "legacy-plain");
    const adapter = new WebAdapter("device-id");

    await expect(adapter.secureGet("settings.embedding.api_key")).resolves.toBe("legacy-plain");
    const raw = sessionStorage.getItem("__secure__:settings.embedding.api_key");
    expect(raw!.startsWith("encv1:")).toBe(true); // migrated value is encrypted, not plaintext
    expect(raw).not.toContain("legacy-plain");
    expect(localStorage.getItem("__secure__:settings.embedding.api_key")).toBeNull(); // plaintext copy gone
  });

  it("throws SecretStoreReadError (not null) when ciphertext can't be decrypted — H8: read failure ≠ never stored", async () => {
    sessionStorage.setItem("__secure__:settings.default_llm.api_key", "encv1:bogus.ciphertext");
    const adapter = new WebAdapter("device-id");
    // 旧行为返回 null 会被消费层当「没存过」，保存设置时按空值语义删掉已存值
    await expect(adapter.secureGet("settings.default_llm.api_key")).rejects.toBeInstanceOf(SecretStoreReadError);
  });

  it("falls back to legacy plaintext when ciphertext is undecryptable, without deleting the legacy copy", async () => {
    sessionStorage.setItem("__secure__:settings.default_llm.api_key", "encv1:bogus.ciphertext");
    localStorage.setItem("__secure__:settings.default_llm.api_key", "legacy-survivor");
    const adapter = new WebAdapter("device-id");
    await expect(adapter.secureGet("settings.default_llm.api_key")).resolves.toBe("legacy-survivor");
    // 失败路径上不做迁移/清理 —— legacy 是唯一可读来源，必须保留
    expect(localStorage.getItem("__secure__:settings.default_llm.api_key")).toBe("legacy-survivor");
  });
});

// ── Key fails to materialize at runtime (e.g. private-mode IndexedDB.open) ──
// The crypto APIs are present, but opening the keystore DB rejects. Capabilities
// must NOT claim encrypted_at_rest=true (false security banner + would gate a
// destructive migration), and secrets must fall back to honest plaintext.
describe("WebAdapter secret storage (keystore IndexedDB open fails)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("sessionStorage", createStorageMock());
    vi.stubGlobal("indexedDB", {
      open: () => {
        const req: { onsuccess: (() => void) | null; onerror: (() => void) | null; onupgradeneeded: (() => void) | null } = {
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        queueMicrotask(() => req.onerror?.());
        return req;
      },
    });
    __setSecureKeyForTest(null); // force real (failing) key acquisition
  });

  afterEach(() => {
    __setSecureKeyForTest(null);
    vi.unstubAllGlobals();
  });

  it("reports plaintext (encrypted_at_rest=false) and stores plaintext when the key can't materialize", async () => {
    const adapter = new WebAdapter("device-id");

    // a secret op triggers (failing) key acquisition → _keyMaterialized=false
    await adapter.secureSet("settings.default_llm.api_key", "plain-when-no-key");

    expect(adapter.getSecretStorageCapabilities()).toEqual({
      backend: "session_storage_plaintext_fallback",
      encrypted_at_rest: false,
      persistence: "session_only",
    });
    // honest plaintext fallback, not a "encv1:" value it could never decrypt
    expect(sessionStorage.getItem("__secure__:settings.default_llm.api_key")).toBe("plain-when-no-key");
    await expect(adapter.secureGet("settings.default_llm.api_key")).resolves.toBe("plain-when-no-key");
  });
});
