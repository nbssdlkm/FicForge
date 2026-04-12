// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** In-memory PlatformAdapter mock for testing. */

import type { OpenDialogOptions, PlatformAdapter, SaveDialogOptions } from "../../platform/adapter.js";

export class MockAdapter implements PlatformAdapter {
  private files = new Map<string, string>();

  async readFile(path: string): Promise<string> {
    const content = this.files.get(this.norm(path));
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(this.norm(path), content);
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(this.norm(path));
  }

  async listDir(path: string): Promise<string[]> {
    const prefix = this.norm(path) + "/";
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name) names.add(name);
      }
    }
    return [...names];
  }

  async exists(path: string): Promise<boolean> {
    const normed = this.norm(path);
    // Check exact file or any file in directory
    if (this.files.has(normed)) return true;
    const prefix = normed + "/";
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  async mkdir(_path: string): Promise<void> {
    // no-op for in-memory
  }

  async showSaveDialog(_options: SaveDialogOptions): Promise<string | null> {
    return null;
  }

  async showOpenDialog(_options: OpenDialogOptions): Promise<string | null> {
    return null;
  }

  getPlatform(): "tauri" | "capacitor" | "web" {
    return "web";
  }

  async getDataDir(): Promise<string> {
    return "/mock/data";
  }

  getDeviceId(): string {
    return "mock-device";
  }

  /** Helper: seed a file for testing. */
  seed(path: string, content: string): void {
    this.files.set(this.norm(path), content);
  }

  /** Helper: get raw file content. */
  raw(path: string): string | undefined {
    return this.files.get(this.norm(path));
  }

  /** Helper: list all files. */
  allFiles(): string[] {
    return [...this.files.keys()];
  }

  // KV 存储（in-memory mock）
  private kv = new Map<string, string>();

  async kvGet(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async kvSet(key: string, value: string): Promise<void> {
    this.kv.set(key, value);
  }

  async kvRemove(key: string): Promise<void> {
    this.kv.delete(key);
  }

  // 敏感数据存储（mock：复用 KV + 前缀）
  async secureGet(key: string): Promise<string | null> {
    return this.kvGet(`__secure__:${key}`);
  }

  async secureSet(key: string, value: string): Promise<void> {
    return this.kvSet(`__secure__:${key}`, value);
  }

  async secureRemove(key: string): Promise<void> {
    return this.kvRemove(`__secure__:${key}`);
  }

  private norm(p: string): string {
    return p.replace(/\/+/g, "/").replace(/\/$/, "");
  }
}
