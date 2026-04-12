// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * WebAdapter — PWA/Web 环境的 PlatformAdapter 实现。
 * 使用 IndexedDB 存储文件（比 OPFS 兼容性更好，尤其 iOS Safari）。
 *
 * 存储模型：key = 文件路径（string），value = 文件内容（string）。
 * 目录结构通过路径前缀模拟。
 */

import type { OpenDialogOptions, PlatformAdapter, SaveDialogOptions } from "./adapter.js";

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

function txGet(db: IDBDatabase, key: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as string | undefined);
    req.onerror = () => reject(req.error);
  });
}

function txPut(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function txDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function txGetAllKeys(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
}

export class WebAdapter implements PlatformAdapter {
  private _deviceId: string;
  private _db: IDBDatabase | null = null;

  constructor(deviceId?: string) {
    this._deviceId = deviceId ?? crypto.randomUUID();
  }

  /** 初始化（必须在使用前调用）。 */
  async init(): Promise<void> {
    this._db = await openDB();
  }

  private db(): IDBDatabase {
    if (!this._db) throw new Error("WebAdapter not initialized. Call init() first.");
    return this._db;
  }

  private norm(p: string): string {
    return p.replace(/\/+/g, "/").replace(/^\//, "").replace(/\/$/, "");
  }

  async readFile(path: string): Promise<string> {
    const content = await txGet(this.db(), this.norm(path));
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    await txPut(this.db(), this.norm(path), content);
  }

  async deleteFile(path: string): Promise<void> {
    await txDelete(this.db(), this.norm(path));
  }

  async listDir(path: string): Promise<string[]> {
    const normed = this.norm(path);
    const allKeys = await txGetAllKeys(this.db());
    const names = new Set<string>();
    if (normed === "") {
      // 根目录：提取所有顶层名称
      for (const key of allKeys) {
        const name = key.split("/")[0];
        if (name) names.add(name);
      }
    } else {
      const prefix = normed + "/";
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
    const content = await txGet(this.db(), normed);
    if (content !== undefined) return true;
    // 检查是否有子文件（目录存在性）
    const prefix = normed + "/";
    const allKeys = await txGetAllKeys(this.db());
    return allKeys.some((k) => k.startsWith(prefix));
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
    try { return localStorage.getItem(key); }
    catch { return this._kvFallback.get(key) ?? null; }
  }

  async kvSet(key: string, value: string): Promise<void> {
    try { localStorage.setItem(key, value); }
    catch { this._kvFallback.set(key, value); }
  }

  async kvRemove(key: string): Promise<void> {
    try { localStorage.removeItem(key); }
    catch { this._kvFallback.delete(key); }
  }

  // 敏感数据存储：当前为 KV + 前缀隔离（TODO: 接入 crypto.subtle 加密）
  async secureGet(key: string): Promise<string | null> {
    return this.kvGet(`__secure__:${key}`);
  }

  async secureSet(key: string, value: string): Promise<void> {
    return this.kvSet(`__secure__:${key}`, value);
  }

  async secureRemove(key: string): Promise<void> {
    return this.kvRemove(`__secure__:${key}`);
  }
}
