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
// Secrets are AES-GCM encrypted. The 256-bit key is NON-EXTRACTABLE and lives in
// the `keys` store of IndexedDB `ficforge_keystore` so it never appears in file
// listings (the file DB's listDir enumerates all keys) and can't be exported via
// crypto.subtle.exportKey. Since 2026-09-09 (v2) the ciphertext lives in the same
// DB's `secrets` store — PERSISTENT across sessions, aligning with Tauri/Capacitor
// 「配一次永久」 UX (previously sessionStorage session-only forced PWA/browser users
// to re-enter API keys after every cold start for no real security gain — the key
// itself was already persisted, so anyone with a device dump could pair both halves
// anyway).
//
// Threat model (honest): Web has no OS keychain. This protects against passive
// storage inspection of the FILE DB only; key + ciphertext in the same keystore DB
// means an IndexedDB dump of ficforge_keystore suffices to decrypt offline
// (accepted trade-off, 2026-09-09 卡拉拍板: local-first app, device-unlocked
// attacker wins either way). It does NOT protect against an attacker running JS in
// the page (XSS) — they can call decrypt with the key handle. Degrades to
// sessionStorage (session_only) when IndexedDB is unavailable (e.g. private mode),
// and to plaintext when crypto.subtle is unavailable OR the key fails to
// materialize at runtime. getSecretStorageCapabilities()
// reports encrypted_at_rest based on whether the key ACTUALLY materialized
// (warmed in init()), not just static API presence — so it never claims
// "encrypted" while values are actually plaintext.
const KEY_DB_NAME = "ficforge_keystore";
const KEY_STORE = "keys";
/** v2（2026-09-09）：密文持久层。此前密文只在 sessionStorage（会话级），
 *  PWA/浏览器用户每次冷启动都要重输 API key；挪进 IndexedDB 后与桌面/安卓端
 *  拉齐「配一次永久」。威胁模型不变：密钥（不可导出 CryptoKey）与密文同设备不同
 *  store，本地运行下「拿到解锁设备」即能解，持久与否不改变这一点。 */
const SECRETS_STORE = "secrets";
const AES_KEY_ID = "secure_aes_gcm_256_v1";
const CIPHER_PREFIX = "encv1:";

function webCryptoAvailable(): boolean {
  return typeof indexedDB !== "undefined" && typeof crypto !== "undefined" && !!crypto.subtle;
}

function openKeyDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
      if (!db.objectStoreNames.contains(SECRETS_STORE)) db.createObjectStore(SECRETS_STORE);
    };
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
/** secrets 持久层（IndexedDB）是否可用；null=未探测。IDB 不可用（隐私模式等）时
 *  降级回 sessionStorage（会话级），能力上报 persistence 如实反映。 */
let _secretsIdbAvailable: boolean | null = null;

/**
 * 三态语义（对抗审 2026-09-09）：
 * - "unavailable"：环境不支持（open 失败，如隐私模式）——合理降级会话级，库内也不可能有值
 * - "ok"：操作成功（get 含 miss：value=null）
 * - "failed"：open 成功但事务/请求失败（含 abort）——真故障，绝不允许吞成「没存过」
 *   （H8 不变量：读失败 ≠ 空值）。
 */
type SecretsIdbResult<T> = { state: "unavailable" } | { state: "ok"; value: T } | { state: "failed"; error: unknown };

async function secretsIdbRun<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<SecretsIdbResult<T>> {
  if (typeof indexedDB === "undefined") {
    _secretsIdbAvailable = false;
    return { state: "unavailable" };
  }
  let db: IDBDatabase;
  try {
    db = await openKeyDB();
  } catch {
    // open 失败 = 环境不支持（隐私模式等）——合理降级，非故障
    _secretsIdbAvailable = false;
    return { state: "unavailable" };
  }
  try {
    const value = await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(SECRETS_STORE, mode);
      const req = run(tx.objectStore(SECRETS_STORE));
      let reqResult: T;
      req.onsuccess = () => {
        reqResult = req.result;
      };
      req.onerror = () => reject(req.error ?? new Error("secrets idb request error"));
      tx.oncomplete = () => resolve(reqResult);
      tx.onabort = () => reject(tx.error ?? new Error("secrets idb tx aborted")); // 不挂会悬挂（对抗审 M5）
      tx.onerror = () => reject(tx.error ?? new Error("secrets idb tx error"));
    });
    _secretsIdbAvailable = true;
    return { state: "ok", value };
  } catch (error) {
    // open 成功但事务/请求失败 = 真故障（H8：绝不许吞成「没存过」）
    return { state: "failed", error };
  } finally {
    db.close();
  }
}

function secretsIdbGet(key: string): Promise<SecretsIdbResult<string | null>> {
  return secretsIdbRun("readonly", (s) => s.get(key)).then((r) =>
    r.state === "ok" ? { state: "ok", value: (r.value as string | undefined) ?? null } : r,
  );
}

function secretsIdbPut(key: string, value: string): Promise<SecretsIdbResult<void>> {
  return secretsIdbRun("readwrite", (s) => s.put(value, key)).then((r) =>
    r.state === "ok" ? { state: "ok", value: undefined } : r,
  );
}

function secretsIdbDelete(key: string): Promise<SecretsIdbResult<void>> {
  return secretsIdbRun("readwrite", (s) => s.delete(key)).then((r) =>
    r.state === "ok" ? { state: "ok", value: undefined } : r,
  );
}

/** 测试缝（故障注入用，生产代码不触碰）：secureGet/Set/Remove 一律经此 holder 调用，
 *  测试可整体替换单个 op 模拟「不可用 / 事务故障」路径。 */
export const __secretsIdbOps = {
  get: secretsIdbGet,
  put: secretsIdbPut,
  delete: secretsIdbDelete,
};

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
  _secretsIdbAvailable = null; // 测试换 fake-indexeddb 时一并复位可用性探测
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
    // 同步探测 secrets 持久层可用性（crypto.subtle 缺失但 IDB 可用的环境也要如实上报）
    if (typeof indexedDB !== "undefined") {
      try {
        const db = await openKeyDB();
        db.close();
        _secretsIdbAvailable = true;
      } catch {
        _secretsIdbAvailable = false;
      }
    } else {
      _secretsIdbAvailable = false;
    }
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
   * 敏感字段读取。主存储 = IndexedDB `ficforge_keystore` 的 secrets store（v2 起持久，
   * 2026-09-09：与桌面/安卓端拉齐「配一次永久」）；会话级 sessionStorage 与旧版
   * localStorage 明文（`__secure__:` 前缀）作为迁移源，读到即迁移上持久层并删旧副本。
   * 密文用 AES-GCM（密钥不可导出，存同库 keys store）。crypto.subtle / IndexedDB 不可用时
   * 退回 sessionStorage 会话级明文/密文，且 getSecretStorageCapabilities() 如实上报。
   *
   * 与 Capacitor/Tauri 同口径（审计 H8）：密文**存在但解不开**（密钥库被清 / 密文损坏）
   * 是「读失败」而不是「没存过」，抛 SecretStoreReadError 而不是返回 null ——
   * 否则保存链路会按空值语义删掉已存值。
   */
  async secureGet(key: string): Promise<string | null> {
    const storageKey = this.getSecureStorageKey(key);

    // 1. IndexedDB 持久层（主存储）
    const persisted = await __secretsIdbOps.get(storageKey);
    if (persisted.state === "failed") {
      // 主存储读故障：先问降级层有没有真值副本——有则返回是真值不是吞（对抗审 R2，
      // v1 遗留/降级期副本恰好能兜底）；全空才抛 H8 读失败（读失败 ≠ 没存过）。
      // 故障路径不做任何迁移写入（ store 正在抽风，写可能损坏数据）。
      const sessFallback = this.getSessionSecureValue(key);
      if (sessFallback !== null) {
        platformWarn("WebAdapter", "secureGet: 持久层读故障，用会话副本兜底", { key_redacted: redactSecureKey(key) });
        return this.resolveStoredSecret(key, sessFallback);
      }
      const legacyFallback0 = this.getLegacySecureValue(key);
      if (legacyFallback0 !== null) {
        platformWarn("WebAdapter", "secureGet: 持久层读故障，用 legacy 明文副本兜底", { key_redacted: redactSecureKey(key) });
        return legacyFallback0;
      }
      throw new SecretStoreReadError(key);
    }
    if (persisted.state === "ok" && persisted.value !== null) {
      return this.resolveStoredSecret(key, persisted.value);
    }

    // 2. sessionStorage（旧会话值）→ 迁移到持久层后删副本；迁移写失败时保留源副本（对抗审 M2 原子性）
    const sess = this.getSessionSecureValue(key);
    if (sess !== null) {
      if (persisted.state === "ok") {
        const migrated = await __secretsIdbOps.put(storageKey, sess);
        if (migrated.state === "ok") {
          this.removeSessionSecureValue(key);
        } else {
          // 写失败不删源（唯一副本不能丢）；会话副本保留，下次读还会再试迁移
          platformWarn("WebAdapter", "secureGet: session→IDB 迁移写失败，保留会话副本", {
            key_redacted: redactSecureKey(key),
          });
        }
      }
      return this.resolveStoredSecret(key, sess);
    }

    // 3. legacy localStorage 明文 → 加密落持久层 + 删旧明文副本（写失败同样不删源）
    const legacyValue = this.getLegacySecureValue(key);
    if (legacyValue === null) {
      return null;
    }
    const encrypted = await encryptSecret(legacyValue);
    const migrated = await __secretsIdbOps.put(storageKey, encrypted);
    if (migrated.state === "ok") {
      this.removeLegacySecureValue(key);
    } else if (migrated.state === "unavailable") {
      // 环境本无 IDB（隐私模式等）：加密副本落会话层即完成迁移，删 legacy 明文（同 v1 旧行为）
      this.setSessionSecureValue(key, encrypted);
      this.removeLegacySecureValue(key);
    } else {
      // 真故障：会话层先顶上，但 legacy 明文保留——下次读还会重试迁移（不丢唯一持久源）
      this.setSessionSecureValue(key, encrypted);
      platformWarn("WebAdapter", "secureGet: legacy→IDB 迁移写失败，legacy 副本保留", {
        key_redacted: redactSecureKey(key),
      });
    }
    return legacyValue;
  }

  /** 解密 + 失败口径（解不开 = 读失败抛错，不回退成 null）。 */
  private async resolveStoredSecret(key: string, stored: string): Promise<string> {
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

  async secureSet(key: string, value: string): Promise<void> {
    const storageKey = this.getSecureStorageKey(key);
    const stored = await encryptSecret(value);
    const put = await __secretsIdbOps.put(storageKey, stored);
    if (put.state === "ok") {
      // 持久层写成功：清掉会话级副本，避免双层漂移
      this.removeSessionSecureValue(key);
      this._secureFallback.delete(storageKey);
    } else {
      // 持久层没写进去：IDB 里可能还躺着旧值，下次读会遮蔽新值——先 best-effort 清掉（对抗审 M3）。
      if (put.state === "failed") {
        const del = await __secretsIdbOps.delete(storageKey);
        if (del.state !== "ok") {
          // 双故障（写不进去 + 旧值也清不掉）：新值落了会话层也会被 IDB 旧值遮蔽，
          // 冷启动后用户读到的是旧密钥——保存实际未生效，必须抛错让调用方知道（对抗审 R2）。
          throw new Error(`secret store write failed (persistent layer fault, key len=${storageKey.length})`);
        }
        platformWarn("WebAdapter", "secureSet: 持久层写失败，新值仅本会话生效（旧值已清，无遮蔽）", {
          key_redacted: redactSecureKey(key),
        });
      }
      this.setSessionSecureValue(key, stored); // 环境不可用（隐私模式）/单故障降级会话级
    }
    this.removeLegacySecureValue(key);
  }

  async secureRemove(key: string): Promise<void> {
    const storageKey = this.getSecureStorageKey(key);
    const del = await __secretsIdbOps.delete(storageKey);
    if (del.state === "failed") {
      // 持久层删不掉却还清降级层 = 密钥复活（对抗审 M4）。抛错让调用方知道删除未生效，
      // 三层副本都保留，可重试。（唯一调用方 deleteCustomProvider 本就 best-effort catch。）
      throw new Error(`secret store delete failed (key redacted, len=${storageKey.length})`);
    }
    // unavailable（环境无 IDB，库里本就不可能有值）/ ok：正常清降级层
    this.removeSessionSecureValue(key);
    this._secureFallback.delete(storageKey);
    this.removeLegacySecureValue(key);
  }

  getSecretStorageCapabilities(): SecretStorageCapabilities {
    // 只有当 AES 密钥真正就位（init() 已预热，或已发生过 secret 操作）时才报已加密。
    // 密钥未就位（如隐私模式下 IndexedDB.open 失败）则诚实报明文 —— 既不给用户假的
    // 「已加密」横幅，也避免在 IDB 失败时触发会销毁 YAML 明文的启动迁移
    // （migration gate 读 encrypted_at_rest）。未预热前保守报明文（不会误报已加密）。
    // 持久性同理按 IDB 实测上报：可用 = persistent（v2 起密文落 IndexedDB），
    // 不可用 = session_only（降级 sessionStorage）。
    const encrypted = _keyMaterialized === true;
    const persistent = _secretsIdbAvailable === true;
    return {
      backend: encrypted ? "web_crypto_aes_gcm" : persistent ? "idb_plaintext_fallback" : "session_storage_plaintext_fallback",
      encrypted_at_rest: encrypted,
      persistence: persistent ? "persistent" : "session_only",
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
