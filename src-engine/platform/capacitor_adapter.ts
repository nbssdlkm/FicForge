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

  async readFile(path: string): Promise<string> {
    const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
    const result = await Filesystem.readFile({
      path,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    return result.data as string;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
    await Filesystem.writeFile({
      path,
      data: content,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  }

  async deleteFile(path: string): Promise<void> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    await Filesystem.deleteFile({ path, directory: Directory.Data });
  }

  async listDir(path: string): Promise<string[]> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const result = await Filesystem.readdir({ path, directory: Directory.Data });
    return result.files.map((f) => f.name);
  }

  async exists(path: string): Promise<boolean> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    try {
      await Filesystem.stat({ path, directory: Directory.Data });
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string): Promise<void> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    try {
      await Filesystem.mkdir({ path, directory: Directory.Data, recursive: true });
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
    // Capacitor Filesystem 以 Directory.Data 为根，路径都是相对的
    return "";
  }

  getDeviceId(): string {
    return this._deviceId;
  }
}
