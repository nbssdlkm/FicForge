// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * WebAdapter — PWA/Web 环境的 PlatformAdapter 实现。
 * 使用 IndexedDB 存储文件（比 OPFS 兼容性更好，尤其 iOS Safari）。
 *
 * 存储模型：key = 文件路径（string），value = 文件内容（string）。
 * 目录结构通过路径前缀模拟。
 */

import type { OpenDialogOptions, PlatformAdapter, SaveDialogOptions, SecretStorageCapabilities } from "./adapter.js";
import { SecretStoreReadError } from "./adapter.js";
import {
  base64ToUint8,
  kvGetWithFallback,
  kvRemoveWithFallback,
  kvSetWithFallback,
  legacySecureStorageKey,
  platformWarn,
  redactSecureKey,
  sharedOnVisibilityChange,
  uint8ToBase64,
} from "./shared.js";

const DB_NAME = "ficforge_fs";
const STORE_NAME = "files";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txGet<T = string>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
    // L12：事务被 abort（配额超限 / 连接回收 / 显式 abort）时若不 reject 会永久挂起。
    tx.onabort = () => reject(tx.error ?? new DOMException("transaction aborted", "AbortError"));
  });
}

function txPut<T>(db: IDBDatabase, key: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value as unknown, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    // L12：oncomplete/onerror 都不触发的 abort 场景（配额/连接回收）不再挂死，显式 reject。
    tx.onabort = () => reject(tx.error ?? new DOMException("transaction aborted", "AbortError"));
  });
}

function txDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    // L12：同上。
    tx.onabort = () => reject(tx.error ?? new DOMException("transaction aborted", "AbortError"));
  });
}

function txGetAllKeys(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
    // L12：abort 时也 reject，避免挂起。
    tx.onabort = () => reject(tx.error ?? new DOMException("transaction aborted", "AbortError"));
  });
}

// ── Web secret encryption (AES-GCM) — TD-004 ──────────────────────────────
// Secrets in sessionStorage are AES-GCM encrypted. The 256-bit key is
// NON-EXTRACTABLE and lives in a SEPARATE IndexedDB (`ficforge_keystore`) so it
// never appears in file listings (the file DB's listDir enumerates all keys)
// and can't be exported via crypto.subtle.exportKey. The ciphertext stays in
// sessionStorage (session_only: cleared on tab close), so secrets remain
// session-scoped exactly as before — the IDB key alone is useless without the
// live ciphertext, and the ciphertext alone is useless without the key.
//
// Threat model (honest): Web has no OS keychain. This protects against passive
// storage inspection / disk copy (an attacker with only an IndexedDB dump or
// only a sessionStorage dump cannot decrypt). It does NOT protect against an
// attacker running JS in the page (XSS) — they can call decrypt with the key
// handle. Degrades to plaintext (prior behavior) when crypto.subtle /
// IndexedDB are unavailable OR the key fails to materialize at runtime (e.g.
// IndexedDB.open rejecting in private mode). getSecretStorageCapabilities()
// reports encrypted_at_rest based on whether the key ACTUALLY materialized
// (warmed in init()), not just static API presence — so it never claims
// "encrypted" while values are actually plaintext.
const KEY_DB_NAME = "ficforge_keystore";
const KEY_STORE = "keys";
const AES_KEY_ID = "secure_aes_gcm_256_v1";
const CIPHER_PREFIX = "encv1:";

function webCryptoAvailable(): boolean {
  return typeof indexedDB !== "undefined" && typeof crypto !== "undefined" && !!crypto.subtle;
}

function openKeyDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(KEY_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function keyDbGet(db: IDBDatabase): Promise<CryptoKey | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(KEY_STORE, "readonly").objectStore(KEY_STORE).get(AES_KEY_ID);
    req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
    req.onerror = () => reject(req.error);
  });
}

function keyDbPut(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readwrite");
    tx.objectStore(KEY_STORE).put(key, AES_KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Per-origin singleton: one non-extractable key reused across the session(s).
let _aesKeyPromise: Promise<CryptoKey | null> | null = null;
// Whether the key ACTUALLY materialized (null = not resolved yet). Drives the
// capability report so it can't claim "encrypted" when the runtime fell back to
// plaintext (e.g. IndexedDB.open fails in private mode even though the APIs exist).
let _keyMaterialized: boolean | null = null;

function getSecureAesKey(): Promise<CryptoKey | null> {
  if (_aesKeyPromise) return _aesKeyPromise;
  _aesKeyPromise = (async () => {
    if (!webCryptoAvailable()) {
      _keyMaterialized = false;
      return null;
    }
    try {
      const db = await openKeyDB();
      try {
        const existing = await keyDbGet(db);
        if (existing) {
          _keyMaterialized = true;
          return existing;
        }
        const key = await crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          false, // non-extractable
          ["encrypt", "decrypt"],
        );
        await keyDbPut(db, key);
        _keyMaterialized = true;
        return key;
      } finally {
        db.close();
      }
    } catch {
      _keyMaterialized = false; // IDB blocked/unavailable → plaintext fallback (reported honestly)
      return null;
    }
  })();
  return _aesKeyPromise;
}

async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getSecureAesKey();
  if (!key) return plaintext; // no crypto → store plaintext; capability reports honestly
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `${CIPHER_PREFIX}${uint8ToBase64(iv)}.${uint8ToBase64(new Uint8Array(ct))}`;
}

async function decryptSecret(stored: string): Promise<string | null> {
  if (!stored.startsWith(CIPHER_PREFIX)) return stored; // legacy/plaintext value
  const key = await getSecureAesKey();
  if (!key) return null; // ciphertext but no key → unrecoverable → treat as missing
  try {
    const [ivB64, ctB64] = stored.slice(CIPHER_PREFIX.length).split(".");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToUint8(ivB64) }, key, base64ToUint8(ctB64));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/**
 * Test seam: inject a pre-built AES key (so the encryption path can be tested
 * without a real IndexedDB), or pass null to reset the singleton. Not used by
 * production code.
 */
export function __setSecureKeyForTest(key: CryptoKey | null): void {
  _aesKeyPromise = key === null ? null : Promise.resolve(key);
  _keyMaterialized = key === null ? null : true;
}

export class WebAdapter implements PlatformAdapter {
  private _deviceId: string;
  private _db: IDBDatabase | null = null;
  private _secureFallback = new Map<string, string>();

  constructor(deviceId?: string) {
    this._deviceId = deviceId ?? crypto.randomUUID();
  }

  setDeviceId(deviceId: string): void {
    this._deviceId = deviceId;
  }

  /** 初始化（必须在使用前调用）。 */
  async init(): Promise<void> {
    this._db = await openDB();
    // 预热 secret 加密密钥，让 getSecretStorageCapabilities() 反映「密钥是否真就位」，
    // 而不是仅凭 crypto.subtle/IndexedDB 静态存在就乐观上报已加密。
    await getSecureAesKey();
  }

  private db(): IDBDatabase {
    if (!this._db) throw new Error("WebAdapter not initialized. Call init() first.");
    return this._db;
  }

  /**
   * L12：iOS Safari 在页面进后台时会强制关闭 IndexedDB 连接，之后对旧连接调
   * `db.transaction()` 会**同步抛 InvalidStateError**（"The database connection is closing"）。
   * 旧代码不处理 → 回前台后所有保存永久失败直到用户手动刷新。这里对 tx 操作做一次性容错：
   * 捕获 InvalidStateError → 重开 DB（连接被回收，重开会拿到新的活连接）→ 用新连接重试一次。
   * 只重试一次：若重开后仍抛，说明是真故障（配额/损坏），继续重试只会无限循环、掩盖真问题。
   */
  private async withDb<T>(op: (db: IDBDatabase) => Promise<T>): Promise<T> {
    try {
      return await op(this.db());
    } catch (err) {
      if (err instanceof DOMException && err.name === "InvalidStateError") {
        // 连接被回收 → 重开一次，用新连接重试。
        this._db = await openDB();
        return await op(this.db());
      }
      throw err;
    }
  }

  private norm(p: string): string {
    return p.replace(/\/+/g, "/").replace(/^\//, "").replace(/\/$/, "");
  }

  async readFile(path: string): Promise<string> {
    if (!path || !this.norm(path)) throw new Error("readFile: path must not be empty");
    const content = await this.withDb((db) => txGet(db, this.norm(path)));
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!path || !this.norm(path)) throw new Error("writeFile: path must not be empty");
    await this.withDb((db) => txPut(db, this.norm(path), content));
  }

  async deleteFile(path: string): Promise<void> {
    if (!path || !this.norm(path)) throw new Error("deleteFile: path must not be empty");
    await this.withDb((db) => txDelete(db, this.norm(path)));
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    if (!oldPath || !this.norm(oldPath)) throw new Error("rename: oldPath must not be empty");
    if (!newPath || !this.norm(newPath)) throw new Error("rename: newPath must not be empty");
    // IndexedDB 无原生 rename：get(old) → put(new) → delete(old)。
    // put 是单记录原子操作（目标键要么整体换成新值、要么不变，不会出现截断内容），
    // 这正是原子写需要的提交语义。put 与 delete 之间崩溃会留下新旧两条记录并存
    // （正式文件已是完整新内容 + .tmp 残留），可接受且严格优于旧版「正式文件写一半」；
    // 残留 .tmp 会被下一次同路径原子写覆盖后消费。
    const from = this.norm(oldPath);
    const to = this.norm(newPath);
    const content = await this.withDb((db) => txGet<unknown>(db, from));
    if (content === undefined) throw new Error(`rename: source not found: ${oldPath}`);
    await this.withDb((db) => txPut(db, to, content));
    await this.withDb((db) => txDelete(db, from));
  }

  async readBinary(path: string): Promise<Uint8Array<ArrayBuffer>> {
    if (!path || !this.norm(path)) throw new Error("readBinary: path must not be empty");
    const content = await this.withDb((db) => txGet<ArrayBuffer | Uint8Array>(db, this.norm(path)));
    if (content === undefined) throw new Error(`File not found: ${path}`);
    // writeBinary 只存 ArrayBuffer（零拷贝建视图）；Uint8Array 分支是旧库
    // 防御路径，拷贝一次保证 ArrayBuffer 底座。
    return content instanceof Uint8Array ? new Uint8Array(content) : new Uint8Array(content);
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    if (!path || !this.norm(path)) throw new Error("writeBinary: path must not be empty");
    // 存为 ArrayBuffer 切片，避免保留原 Uint8Array 的 view 引用。
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    await this.withDb((db) => txPut(db, this.norm(path), buf));
  }

  async getFileSize(path: string): Promise<number> {
    if (!path || !this.norm(path)) return -1;
    const content = await this.withDb((db) => txGet<ArrayBuffer | Uint8Array | string>(db, this.norm(path)));
    if (content === undefined) return -1;
    if (typeof content === "string") return new TextEncoder().encode(content).length;
    return content.byteLength;
  }

  async listDir(path: string): Promise<string[]> {
    const normed = this.norm(path);
    const allKeys = await this.withDb((db) => txGetAllKeys(db));
    const names = new Set<string>();
    if (normed === "") {
      // 根目录：提取所有顶层名称
      for (const key of allKeys) {
        const name = key.split("/")[0];
        if (name) names.add(name);
      }
    } else {
      const prefix = `${normed}/`;
      for (const key of allKeys) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const name = rest.split("/")[0];
          if (name) names.add(name);
        }
      }
    }
    return [...names];
  }

  async exists(path: string): Promise<boolean> {
    const normed = this.norm(path);
    // 检查精确文件
    const content = await this.withDb((db) => txGet(db, normed));
    if (content !== undefined) return true;
    // 检查是否有子文件（目录存在性）
    const prefix = `${normed}/`;
    const allKeys = await this.withDb((db) => txGetAllKeys(db));
    return allKeys.some((k) => k.startsWith(prefix));
  }

  async statEntry(path: string): Promise<"file" | "directory" | "missing"> {
    const normed = this.norm(path);
    // 精确 key 存在 = 文件；否则有子文件前缀 = 目录（IndexedDB 空目录不存在，与 exists 同口径）。
    const content = await this.withDb((db) => txGet(db, normed));
    if (content !== undefined) return "file";
    const prefix = `${normed}/`;
    const allKeys = await this.withDb((db) => txGetAllKeys(db));
    return allKeys.some((k) => k.startsWith(prefix)) ? "directory" : "missing";
  }

  async mkdir(_path: string): Promise<void> {
    // IndexedDB 不需要显式创建目录
  }

  async showSaveDialog(_options: SaveDialogOptions): Promise<string | null> {
    return null;
  }

  async showOpenDialog(_options: OpenDialogOptions): Promise<string | null> {
    return null;
  }

  getPlatform(): "web" {
    return "web";
  }

  async getDataDir(): Promise<string> {
    return "";
  }

  getDeviceId(): string {
    return this._deviceId;
  }

  // KV 存储：localStorage + 内存回退（iOS Safari 隐私模式安全）
  private _kvFallback = new Map<string, string>();

  async kvGet(key: string): Promise<string | null> {
    return kvGetWithFallback("WebAdapter", this._kvFallback, key);
  }

  async kvSet(key: string, value: string): Promise<void> {
    kvSetWithFallback("WebAdapter", this._kvFallback, key, value);
  }

  async kvRemove(key: string): Promise<void> {
    kvRemoveWithFallback("WebAdapter", this._kvFallback, key);
  }

  /**
   * 敏感字段读取。会话内 secret 以 AES-GCM 密文存于 sessionStorage（密钥不可导出，
   * 存独立 IndexedDB `ficforge_keystore`）。旧版 localStorage 明文（`__secure__:` 前缀）
   * 首次读取时迁移为密文并删除明文副本。crypto.subtle / IndexedDB 不可用时优雅退回
   * 明文，且 getSecretStorageCapabilities() 如实上报 encrypted_at_rest=false（见模块顶部）。
   *
   * 与 Capacitor/Tauri 同口径（审计 H8）：密文**存在但解不开**（密钥库被清 / 密文损坏）
   * 是「读失败」而不是「没存过」，抛 SecretStoreReadError 而不是返回 null ——
   * 否则保存链路会按空值语义删掉已存值。
   */
  async secureGet(key: string): Promise<string | null> {
    const stored = this.getSessionSecureValue(key);
    if (stored !== null) {
      const decrypted = await decryptSecret(stored);
      if (decrypted === null) {
        // 有密文但无法解密 —— 读失败，不等于空。旧版明文副本若还在则作为真值返回
        // （与 Capacitor/Tauri 故障路径同口径，且不在失败路径上做迁移写入）。
        const legacyFallback = this.getLegacySecureValue(key);
        if (legacyFallback !== null) return legacyFallback;
        platformWarn("WebAdapter", "secureGet: ciphertext present but undecryptable", {
          key_redacted: redactSecureKey(key),
        });
        throw new SecretStoreReadError(key);
      }
      this.removeLegacySecureValue(key);
      return decrypted;
    }

    const legacyValue = this.getLegacySecureValue(key);
    if (legacyValue === null) {
      return null;
    }

    // 旧版明文 → 加密落 session + 删旧明文副本
    this.setSessionSecureValue(key, await encryptSecret(legacyValue));
    this.removeLegacySecureValue(key);
    return legacyValue;
  }

  async secureSet(key: string, value: string): Promise<void> {
    this.setSessionSecureValue(key, await encryptSecret(value));
    this.removeLegacySecureValue(key);
  }

  async secureRemove(key: string): Promise<void> {
    this.removeSessionSecureValue(key);
    this.removeLegacySecureValue(key);
  }

  getSecretStorageCapabilities(): SecretStorageCapabilities {
    // 只有当 AES 密钥真正就位（init() 已预热，或已发生过 secret 操作）时才报已加密。
    // 密钥未就位（如隐私模式下 IndexedDB.open 失败）则诚实报明文 —— 既不给用户假的
    // 「已加密」横幅，也避免在 IDB 失败时触发会销毁 YAML 明文的启动迁移
    // （migration gate 读 encrypted_at_rest）。未预热前保守报明文（不会误报已加密）。
    const encrypted = _keyMaterialized === true;
    return {
      backend: encrypted ? "web_crypto_aes_gcm" : "session_storage_plaintext_fallback",
      encrypted_at_rest: encrypted,
      persistence: "session_only",
    };
  }

  onVisibilityChange(cb: (state: "visible" | "hidden") => void): () => void {
    return sharedOnVisibilityChange(cb);
  }

  private getSecureStorageKey(key: string): string {
    return legacySecureStorageKey(key);
  }

  private getSessionSecureValue(key: string): string | null {
    const storageKey = this.getSecureStorageKey(key);
    try {
      return sessionStorage.getItem(storageKey);
    } catch {
      return this._secureFallback.get(storageKey) ?? null;
    }
  }

  private setSessionSecureValue(key: string, value: string): void {
    const storageKey = this.getSecureStorageKey(key);
    try {
      sessionStorage.setItem(storageKey, value);
    } catch {
      platformWarn(
        "WebAdapter",
        "secureSet: sessionStorage unavailable, using in-memory fallback (not persisted beyond this session)",
      );
      this._secureFallback.set(storageKey, value);
    }
  }

  private removeSessionSecureValue(key: string): void {
    const storageKey = this.getSecureStorageKey(key);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      this._secureFallback.delete(storageKey);
    }
  }

  private getLegacySecureValue(key: string): string | null {
    const storageKey = this.getSecureStorageKey(key);
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return this._kvFallback.get(storageKey) ?? null;
    }
  }

  private removeLegacySecureValue(key: string): void {
    const storageKey = this.getSecureStorageKey(key);
    this._kvFallback.delete(storageKey);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // 有意静默：best-effort 清理旧存储；隐私模式下 localStorage 每次调用都抛，
      // 读路径同样降级（读不到=无旧数据），告警只会刷屏无诊断价值
    }
  }
}
