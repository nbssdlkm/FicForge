// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TauriAdapter — 桌面端 PlatformAdapter 实现。
 *
 * 参考现有前端 Tauri API 调用点：
 * - App.tsx: @tauri-apps/api/event, @tauri-apps/api/core
 * - ExportModal.tsx: @tauri-apps/plugin-dialog (save), @tauri-apps/plugin-fs (writeFile)
 */

import type { OpenDialogOptions, PlatformAdapter, SaveDialogOptions, SecretStorageCapabilities } from "./adapter.js";

const LEGACY_SECURE_KEY_PREFIX = "__secure__:";

export class TauriAdapter implements PlatformAdapter {
  private _deviceId: string;

  constructor(deviceId?: string) {
    this._deviceId = deviceId ?? crypto.randomUUID();
  }

  async readFile(path: string): Promise<string> {
    if (!path) throw new Error("readFile: path must not be empty");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    return readTextFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!path) throw new Error("writeFile: path must not be empty");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    if (!path) throw new Error("deleteFile: path must not be empty");
    const { remove } = await import("@tauri-apps/plugin-fs");
    await remove(path);
  }

  async readBinary(path: string): Promise<Uint8Array> {
    if (!path) throw new Error("readBinary: path must not be empty");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    return readFile(path);
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    if (!path) throw new Error("writeBinary: path must not be empty");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(path, data);
  }

  async getFileSize(path: string): Promise<number> {
    if (!path) return -1;
    try {
      const { stat } = await import("@tauri-apps/plugin-fs");
      const info = await stat(path);
      return Number(info.size);
    } catch {
      return -1;
    }
  }

  async listDir(path: string): Promise<string[]> {
    const { readDir } = await import("@tauri-apps/plugin-fs");
    const entries = await readDir(path);
    return entries.map((e) => e.name);
  }

  async exists(path: string): Promise<boolean> {
    const { exists } = await import("@tauri-apps/plugin-fs");
    return exists(path);
  }

  async mkdir(path: string): Promise<void> {
    const { mkdir } = await import("@tauri-apps/plugin-fs");
    await mkdir(path, { recursive: true });
  }

  async showSaveDialog(options: SaveDialogOptions): Promise<string | null> {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const result = await save({
      defaultPath: options.defaultPath,
      filters: options.filters,
    });
    return result;
  }

  async showOpenDialog(options: OpenDialogOptions): Promise<string | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({
      filters: options.filters,
      multiple: options.multiple ?? false,
    });
    if (result === null) return null;
    // open() returns string | string[] depending on multiple flag
    return Array.isArray(result) ? result[0] ?? null : result;
  }

  getPlatform(): "tauri" {
    return "tauri";
  }

  async getDataDir(): Promise<string> {
    const { appDataDir } = await import("@tauri-apps/api/path");
    return appDataDir();
  }

  getDeviceId(): string {
    return this._deviceId;
  }

  async kvGet(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  }

  async kvSet(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }

  async kvRemove(key: string): Promise<void> {
    localStorage.removeItem(key);
  }

  /**
   * Tauri 端通过 Rust command 调用 OS keyring / keychain。
   * 首次读取旧版 `__secure__:` localStorage 条目时会自动迁移并清理明文副本。
   */
  async secureGet(key: string): Promise<string | null> {
    const stored = await this.invokeSecureStore<string | null>("secure_store_get", { key });
    if (stored !== null) {
      this.removeLegacySecureValue(key);
      return stored;
    }

    const legacyValue = this.getLegacySecureValue(key);
    if (legacyValue === null) {
      return null;
    }

    await this.invokeSecureStore<void>("secure_store_set", { key, value: legacyValue });
    this.removeLegacySecureValue(key);
    return legacyValue;
  }

  /** @see {@link TauriAdapter.secureGet} */
  async secureSet(key: string, value: string): Promise<void> {
    await this.invokeSecureStore<void>("secure_store_set", { key, value });
    this.removeLegacySecureValue(key);
  }

  /** @see {@link TauriAdapter.secureGet} */
  async secureRemove(key: string): Promise<void> {
    await this.invokeSecureStore<void>("secure_store_remove", { key });
    this.removeLegacySecureValue(key);
  }

  getSecretStorageCapabilities(): SecretStorageCapabilities {
    return {
      backend: "os_keyring",
      encrypted_at_rest: true,
      persistence: "persistent",
    };
  }

  private getLegacySecureStorageKey(key: string): string {
    return `${LEGACY_SECURE_KEY_PREFIX}${key}`;
  }

  private getLegacySecureValue(key: string): string | null {
    return localStorage.getItem(this.getLegacySecureStorageKey(key));
  }

  private removeLegacySecureValue(key: string): void {
    localStorage.removeItem(this.getLegacySecureStorageKey(key));
  }

  private async invokeSecureStore<T>(command: "secure_store_get" | "secure_store_set" | "secure_store_remove", payload: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(command, payload);
  }
}
