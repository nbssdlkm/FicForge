// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * CapacitorAdapter — 移动端（Android/iOS）PlatformAdapter 实现。
 * 使用 @capacitor/filesystem 进行文件 I/O。
 */

import type { OpenDialogOptions, PlatformAdapter, SaveDialogOptions, SecretStorageCapabilities } from "./adapter.js";

/**
 * Uint8Array ↔ base64 分块转换。
 *
 * 直接 `String.fromCharCode(...u8)` 在数组长度 ≥ 约 65535 时触发 "Maximum call stack
 * size exceeded"。我们按 32KB 分块处理，对 ~10MB 字体文件安全。
 */
const BASE64_CHUNK = 0x8000; // 32 KiB

function uint8ToBase64(data: Uint8Array): string {
  // 数组收集 + 末端 join("")：O(n)。比 `binary += ...` 累加字符串
  // （在某些 JS 引擎实现下是 O(n²)）更稳，对 7MB 字体数据差异显著。
  const parts: string[] = [];
  for (let i = 0; i < data.length; i += BASE64_CHUNK) {
    parts.push(String.fromCharCode(...data.subarray(i, i + BASE64_CHUNK)));
  }
  return btoa(parts.join(""));
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export class CapacitorAdapter implements PlatformAdapter {
  private _deviceId: string;

  constructor(deviceId?: string) {
    this._deviceId = deviceId ?? crypto.randomUUID();
  }

  /** Capacitor Filesystem 使用 Directory.Data 为根，path 必须是相对路径。 */
  private normPath(path: string): string {
    return path.replace(/^\/+/, "");
  }

  async readFile(path: string): Promise<string> {
    if (!path || !this.normPath(path)) throw new Error("readFile: path must not be empty");
    const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
    const result = await Filesystem.readFile({
      path: this.normPath(path),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    return result.data as string;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!path || !this.normPath(path)) throw new Error("writeFile: path must not be empty");
    const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
    await Filesystem.writeFile({
      path: this.normPath(path),
      data: content,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  }

  async deleteFile(path: string): Promise<void> {
    if (!path || !this.normPath(path)) throw new Error("deleteFile: path must not be empty");
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    await Filesystem.deleteFile({ path: this.normPath(path), directory: Directory.Data });
  }

  async readBinary(path: string): Promise<Uint8Array> {
    if (!path || !this.normPath(path)) throw new Error("readBinary: path must not be empty");
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    // 不指定 encoding：Capacitor 返回 base64 string（web）或 Blob（native Android/iOS）。
    const result = await Filesystem.readFile({
      path: this.normPath(path),
      directory: Directory.Data,
    });
    const data = result.data;
    if (typeof data === "string") return base64ToUint8(data);
    if (data instanceof Blob) {
      const buf = await data.arrayBuffer();
      return new Uint8Array(buf);
    }
    throw new Error(
      `CapacitorAdapter.readBinary: unexpected data type ${Object.prototype.toString.call(data)}`,
    );
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    if (!path || !this.normPath(path)) throw new Error("writeBinary: path must not be empty");
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    await Filesystem.writeFile({
      path: this.normPath(path),
      data: uint8ToBase64(data),
      directory: Directory.Data,
      // 不指定 encoding：Capacitor 将 data 视为 base64 并解码为字节写入。
      recursive: true,
    });
  }

  async getFileSize(path: string): Promise<number> {
    if (!path || !this.normPath(path)) return -1;
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const info = await Filesystem.stat({ path: this.normPath(path), directory: Directory.Data });
      return info.size;
    } catch {
      return -1;
    }
  }

  async listDir(path: string): Promise<string[]> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const result = await Filesystem.readdir({ path: this.normPath(path), directory: Directory.Data });
    return result.files.map((f) => f.name);
  }

  async exists(path: string): Promise<boolean> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    try {
      await Filesystem.stat({ path: this.normPath(path), directory: Directory.Data });
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string): Promise<void> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    try {
      await Filesystem.mkdir({ path: this.normPath(path), directory: Directory.Data, recursive: true });
    } catch {
      // 目录已存在时 Capacitor 可能抛错
    }
  }

  async showSaveDialog(_options: SaveDialogOptions): Promise<string | null> {
    // 移动端：使用 Share API 替代文件保存对话框
    return null;
  }

  async showOpenDialog(_options: OpenDialogOptions): Promise<string | null> {
    // 移动端：使用 Capacitor FilePicker 或系统选择器
    return null;
  }

  getPlatform(): "capacitor" {
    return "capacitor";
  }

  async getDataDir(): Promise<string> {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const result = await Filesystem.getUri({ path: "", directory: Directory.Data });
      return result.uri;
    } catch {
      return "";
    }
  }

  getDeviceId(): string {
    return this._deviceId;
  }

  // KV 存储：Capacitor WebView 支持 localStorage，加内存回退兜底
  private _kvFallback = new Map<string, string>();

  async kvGet(key: string): Promise<string | null> {
    try { return localStorage.getItem(key); }
    catch {
      console.warn(`[CapacitorAdapter] kvGet: localStorage 不可用，使用内存回退（数据不持久化）`);
      return this._kvFallback.get(key) ?? null;
    }
  }

  async kvSet(key: string, value: string): Promise<void> {
    try { localStorage.setItem(key, value); }
    catch {
      console.warn(`[CapacitorAdapter] kvSet: localStorage 不可用，使用内存回退（数据不持久化）`);
      this._kvFallback.set(key, value);
    }
  }

  async kvRemove(key: string): Promise<void> {
    try { localStorage.removeItem(key); }
    catch {
      console.warn(`[CapacitorAdapter] kvRemove: localStorage 不可用，使用内存回退`);
      this._kvFallback.delete(key);
    }
  }

  /**
   * @warning **未加密。** 当前实现仅在 KV 键前添加 `__secure__:` 前缀隔离，
   * 数据以明文存于 localStorage（或内存回退）。
   * 待接入 @capacitor-community/secure-storage (Android Keystore / iOS Keychain) 后实现真正加密。
   */
  async secureGet(key: string): Promise<string | null> {
    return this.kvGet(`__secure__:${key}`);
  }

  /** @see {@link CapacitorAdapter.secureGet} — 同样未加密。 */
  async secureSet(key: string, value: string): Promise<void> {
    return this.kvSet(`__secure__:${key}`, value);
  }

  /** @see {@link CapacitorAdapter.secureGet} — 同样未加密。 */
  async secureRemove(key: string): Promise<void> {
    return this.kvRemove(`__secure__:${key}`);
  }

  getSecretStorageCapabilities(): SecretStorageCapabilities {
    return {
      backend: "local_storage_with_memory_fallback",
      encrypted_at_rest: false,
      persistence: "best_effort",
    };
  }
}
