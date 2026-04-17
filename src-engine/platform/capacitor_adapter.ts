// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * CapacitorAdapter — 移动端（Android/iOS）PlatformAdapter 实现。
 * 使用 @capacitor/filesystem 进行文件 I/O。
 */

import type { OpenDialogOptions, PlatformAdapter, SaveDialogOptions } from "./adapter.js";

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
}
