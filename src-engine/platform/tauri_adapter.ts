// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TauriAdapter — 桌面端 PlatformAdapter 实现。
 *
 * 参考现有前端 Tauri API 调用点：
 * - App.tsx: @tauri-apps/api/event, @tauri-apps/api/core
 * - ExportModal.tsx: @tauri-apps/plugin-dialog (save), @tauri-apps/plugin-fs (writeFile)
 */

import type { OpenDialogOptions, PlatformAdapter, SaveDialogOptions } from "./adapter.js";

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
   * @warning **未加密。** 当前实现仅在 KV 键前添加 `__secure__:` 前缀隔离，
   * 数据以明文存于 localStorage。待接入 @tauri-apps/plugin-stronghold 后实现真正加密。
   */
  async secureGet(key: string): Promise<string | null> {
    return this.kvGet(`__secure__:${key}`);
  }

  /** @see {@link TauriAdapter.secureGet} — 同样未加密。 */
  async secureSet(key: string, value: string): Promise<void> {
    return this.kvSet(`__secure__:${key}`, value);
  }

  /** @see {@link TauriAdapter.secureGet} — 同样未加密。 */
  async secureRemove(key: string): Promise<void> {
    return this.kvRemove(`__secure__:${key}`);
  }
}
