// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * WebAdapter secrets 持久层测试（2026-09-09，v2：密文从 sessionStorage 迁 IndexedDB）。
 *
 * 核心判据：与桌面/安卓端拉齐「配一次永久」——
 * - 冷启动 round-trip：新 adapter 实例（模拟重启，sessionStorage 为空）能读回上次存的密钥
 * - 密文落 IDB（encv1: 前缀），不落明文
 * - 旧会话值（sessionStorage）与旧明文（localStorage __secure__: 前缀）读到即迁移上持久层
 * - 「解不开 = 读失败」口径不丢：抛 SecretStoreReadError 而不是返回 null
 * - 能力上报如实：IDB 可用 → persistent；加密就位 → encrypted_at_rest
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { WebAdapter, __setSecureKeyForTest, __secretsIdbOps } from "../web_adapter.js";
import { SecretStoreReadError } from "../adapter.js";

const realOps = { ...__secretsIdbOps };
const failedOp = () => Promise.resolve({ state: "failed", error: new Error("injected tx fault") }) as never;

afterEach(() => {
  Object.assign(__secretsIdbOps, realOps); // 每个用例后还原故障注入
});

const SECRET_KEY = "settings.default_llm.api_key";
const STORAGE_KEY = `__secure__:${SECRET_KEY}`;

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

/** 读 IDB secrets store 的原始落盘值（验证密文而非明文）。 */
async function readIdbRaw(storageKey: string): Promise<string | null> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("ficforge_keystore", 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("keys")) d.createObjectStore("keys");
      if (!d.objectStoreNames.contains("secrets")) d.createObjectStore("secrets");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const req = db.transaction("secrets", "readonly").objectStore("secrets").get(storageKey);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

describe("WebAdapter secrets 持久层 (fake-indexeddb)", () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    __setSecureKeyForTest(null); // 复位密钥单例 + 可用性探测（每用例全新 DB）
  });

  afterEach(() => {
    delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
    delete (globalThis as unknown as { sessionStorage?: unknown }).sessionStorage;
    __setSecureKeyForTest(null);
  });

  it("冷启动 round-trip：新实例读回上次存的密钥（配一次永久）", async () => {
    const a1 = new WebAdapter("dev");
    await a1.init();
    await a1.secureSet(SECRET_KEY, "sk-persist-me");

    // 模拟重启：全新 adapter 实例，无 sessionStorage（关标签页即清空）
    const a2 = new WebAdapter("dev");
    await a2.init();
    await expect(a2.secureGet(SECRET_KEY)).resolves.toBe("sk-persist-me");
  });

  it("落 IDB 的是密文（encv1: 前缀），且 sessionStorage 无残留", async () => {
    vi_stubSession();
    const a = new WebAdapter("dev");
    await a.init();
    await a.secureSet(SECRET_KEY, "sk-super-secret");

    const raw = await readIdbRaw(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(raw!.startsWith("encv1:")).toBe(true);
    expect(raw).not.toContain("sk-super-secret");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull(); // 双层不漂移
  });

  it("旧会话值（sessionStorage 密文）读到即迁移上持久层并删副本", async () => {
    vi_stubSession();
    // 第一轮：IDB 不可用时代的产物——只有 sessionStorage 里有密文
    const a1 = new WebAdapter("dev");
    await a1.init();
    await a1.secureSet(SECRET_KEY, "sk-from-session");
    const sessCipher = sessionStorage.getItem(STORAGE_KEY); // IDB 正常时这里本该为空
    // 构造「旧版本」场景：手动把密文放回 session 并清掉 IDB，模拟 v1 遗留
    if (sessCipher === null) {
      const idbRaw = await readIdbRaw(STORAGE_KEY);
      expect(idbRaw).not.toBeNull();
      sessionStorage.setItem(STORAGE_KEY, idbRaw!);
      await a1.secureRemove(SECRET_KEY); // 清 IDB+session
      sessionStorage.setItem(STORAGE_KEY, idbRaw!); // 只留 session 副本
    }

    const a2 = new WebAdapter("dev");
    await a2.init();
    await expect(a2.secureGet(SECRET_KEY)).resolves.toBe("sk-from-session");
    // 已迁移：IDB 有了，session 清了
    expect(await readIdbRaw(STORAGE_KEY)).not.toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("解不开的密文 = 读失败（抛 SecretStoreReadError），不静默返回 null", async () => {
    const a = new WebAdapter("dev");
    await a.init();
    // 直接往 IDB 塞一条垃圾密文（模拟密钥库被清/密文损坏）
    const { secretsIdbPutForTest } = await importSecretsTestHelpers();
    await secretsIdbPutForTest(STORAGE_KEY, "encv1:AAAA.BBBB");
    await expect(a.secureGet(SECRET_KEY)).rejects.toBeInstanceOf(SecretStoreReadError);
  });

  it("能力上报如实：IDB 可用 + 密钥就位 → persistent + encrypted", async () => {
    const a = new WebAdapter("dev");
    await a.init();
    const caps = a.getSecretStorageCapabilities();
    expect(caps.persistence).toBe("persistent");
    expect(caps.encrypted_at_rest).toBe(true);
    expect(caps.backend).toBe("web_crypto_aes_gcm");
  });

  it("secureRemove 三层全清（IDB + session + 内存兜底）", async () => {
    vi_stubSession();
    const a = new WebAdapter("dev");
    await a.init();
    await a.secureSet(SECRET_KEY, "sk-to-remove");
    await a.secureRemove(SECRET_KEY);
    expect(await readIdbRaw(STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    await expect(a.secureGet(SECRET_KEY)).resolves.toBeNull();
  });

  it("IDB 不可用（隐私模式）时降级 sessionStorage 会话级，能力如实报 session_only", async () => {
    vi_stubSession();
    delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB; // IDB 整块缺失
    const a = new WebAdapter("dev");
    // init() 里 openDB 也会失败——主库都没有，这里只测 secret 路径，绕过 init
    await a.secureSet(SECRET_KEY, "sk-session-only");
    await expect(a.secureGet(SECRET_KEY)).resolves.toBe("sk-session-only");
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(a.getSecretStorageCapabilities().persistence).toBe("session_only");
  });

  // ── 故障注入（对抗审 2026-09-09 M1-M4 回归）──

  it("M1: 主存储读故障且降级层全空 → 抛 SecretStoreReadError，绝不吞成「没存过」（H8）", async () => {
    vi_stubSession();
    const a = new WebAdapter("dev");
    await a.init();
    await a.secureSet(SECRET_KEY, "sk-real-value");
    __secretsIdbOps.get = failedOp; // 注入读故障（session 已被 secureSet 清空，无副本）
    await expect(a.secureGet(SECRET_KEY)).rejects.toBeInstanceOf(SecretStoreReadError);
  });

  it("M1-R2: 主存储读故障但会话层有真值副本 → 返回副本（真值兜底不算吞）", async () => {
    vi_stubSession();
    const a = new WebAdapter("dev");
    await a.init();
    await a.secureSet(SECRET_KEY, "sk-has-session-copy");
    // 构造「值同时在 IDB + session」（v1→v2 升级当会话的中间态）
    const idbRaw = await readIdbRaw(STORAGE_KEY);
    sessionStorage.setItem(STORAGE_KEY, idbRaw!);
    __secretsIdbOps.get = failedOp;
    await expect(a.secureGet(SECRET_KEY)).resolves.toBe("sk-has-session-copy");
  });

  it("M2: 会话→IDB 迁移写失败时保留会话源副本（不丢唯一副本）", async () => {
    vi_stubSession();
    const a = new WebAdapter("dev");
    await a.init();
    await a.secureSet(SECRET_KEY, "sk-migrate-me");
    // 构造 v1 遗留：值只在 session，IDB 没有
    const idbRaw = await readIdbRaw(STORAGE_KEY);
    expect(idbRaw).not.toBeNull();
    await a.secureRemove(SECRET_KEY);
    sessionStorage.setItem(STORAGE_KEY, idbRaw!);

    __secretsIdbOps.put = failedOp; // 注入迁移写故障（读正常）
    await expect(a.secureGet(SECRET_KEY)).resolves.toBe("sk-migrate-me"); // 值照样读回
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(idbRaw); // 源副本还在
  });

  it("M3: secureSet 持久层写失败 → 降级会话级 + best-effort 清 IDB 旧值防遮蔽", async () => {
    vi_stubSession();
    const a = new WebAdapter("dev");
    await a.init();
    await a.secureSet(SECRET_KEY, "sk-old"); // IDB 里先躺一个旧值

    const deleted: string[] = [];
    __secretsIdbOps.put = failedOp;
    __secretsIdbOps.delete = (async (k: string) => {
      deleted.push(k);
      return { state: "ok", value: undefined } as const;
    }) as never;
    await a.secureSet(SECRET_KEY, "sk-new");
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull(); // 新值落会话层
    expect(deleted).toEqual([STORAGE_KEY]); // 旧值清理被尝试
  });

  it("M3-R2: secureSet 双故障（写失败+清旧值也失败）→ 抛错，不静默留遮蔽态", async () => {
    vi_stubSession();
    const a = new WebAdapter("dev");
    await a.init();
    await a.secureSet(SECRET_KEY, "sk-old");

    __secretsIdbOps.put = failedOp;
    __secretsIdbOps.delete = failedOp;
    await expect(a.secureSet(SECRET_KEY, "sk-new")).rejects.toThrow(/write failed/);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull(); // 未生效的保存不留会话残留
  });

  it("M4: secureRemove 持久层删失败 → 抛错且三层副本全保留（密钥不复活）", async () => {
    vi_stubSession();
    const a = new WebAdapter("dev");
    await a.init();
    await a.secureSet(SECRET_KEY, "sk-undeletable");
    __secretsIdbOps.delete = failedOp;
    await expect(a.secureRemove(SECRET_KEY)).rejects.toThrow(/delete failed/);
    // 持久层值还在（delete 被注入失败）——下次读仍可读回，不是「以为删了其实没了」
    Object.assign(__secretsIdbOps, realOps);
    await expect(a.secureGet(SECRET_KEY)).resolves.toBe("sk-undeletable");
  });
});

function vi_stubSession() {
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = createStorageMock();
}

async function importSecretsTestHelpers() {
  // 测试内直接写 IDB 的小工具（不走 adapter 公开 API，用于构造损坏场景）
  return {
    async secretsIdbPutForTest(key: string, value: string) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("ficforge_keystore", 2);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains("keys")) d.createObjectStore("keys");
          if (!d.objectStoreNames.contains("secrets")) d.createObjectStore("secrets");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("secrets", "readwrite");
          tx.objectStore("secrets").put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
  };
}
