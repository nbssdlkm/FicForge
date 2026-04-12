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
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    return readTextFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, content);
  }

  async deleteFile(path: string): Promise<void> {
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
    try { return localStorage.getItem(key); }
    catch { return null; }
  }

  async kvSet(key: string, value: string): Promise<void> {
    try { localStorage.setItem(key, value); }
    catch { /* Tauri WebView 理论上不会失败，兜底吞错 */ }
  }

  async kvRemove(key: string): Promise<void> {
    try { localStorage.removeItem(key); }
    catch { /* ignore */ }
  }
}
