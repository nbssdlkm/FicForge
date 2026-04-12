// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** SyncAdapter 接口 + WebDAV 实现。参见 PRD v4 §3。 */

import type { OpsEntry } from "../domain/ops_entry.js";

// ---------------------------------------------------------------------------
// 接口
// ---------------------------------------------------------------------------

export interface SyncAdapter {
  pullOps(auPath: string): Promise<OpsEntry[]>;
  pushOps(auPath: string, ops: OpsEntry[]): Promise<void>;
  /** Returns file content, or null if file does not exist. */
  pullFile(remotePath: string): Promise<string | null>;
  pushFile(remotePath: string, content: string): Promise<void>;
  listRemoteFiles(remotePath: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// WebDAV 实现
// ---------------------------------------------------------------------------

export class WebDAVSyncAdapter implements SyncAdapter {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(url: string, username: string, password: string) {
    this.baseUrl = url.replace(/\/+$/, "");
    this.headers = {
      // btoa 安全编码（支持非 ASCII 用户名/密码）
      Authorization: "Basic " + btoa(unescape(encodeURIComponent(`${username}:${password}`))),
    };
  }

  async pullOps(auPath: string): Promise<OpsEntry[]> {
    const content = await this.pullFile(`${auPath}/ops.jsonl`);
    if (content === null || content === "") return [];
    const entries: OpsEntry[] = [];
    let badLineCount = 0;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as OpsEntry);
      } catch {
        badLineCount++;
      }
    }
    if (badLineCount > 0) {
      console.warn(`[sync_adapter] ${badLineCount} bad line(s) in remote ${auPath}/ops.jsonl`);
    }
    return entries;
  }

  async pushOps(auPath: string, ops: OpsEntry[]): Promise<void> {
    const content = ops.map((op) => JSON.stringify(op)).join("\n") + "\n";
    await this.pushFile(`${auPath}/ops.jsonl`, content);
  }

  async pullFile(remotePath: string): Promise<string | null> {
    const resp = await fetch(`${this.baseUrl}/${remotePath}`, {
      method: "GET",
      headers: this.headers,
    });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`WebDAV GET failed: ${resp.status}`);
    return resp.text();
  }

  async pushFile(remotePath: string, content: string): Promise<void> {
    // Ensure parent directories exist via MKCOL before PUT
    await this.ensureParentDir(remotePath);

    const resp = await fetch(`${this.baseUrl}/${remotePath}`, {
      method: "PUT",
      headers: { ...this.headers, "Content-Type": "text/plain; charset=utf-8" },
      body: content,
    });
    if (!resp.ok) throw new Error(`WebDAV PUT failed: ${resp.status}`);
  }

  /** Create parent directories via MKCOL (ignores 405/409 = already exists). */
  private async ensureParentDir(remotePath: string): Promise<void> {
    const parts = remotePath.split("/").filter(Boolean);
    if (parts.length <= 1) return;
    // Build each ancestor directory
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join("/");
      try {
        const resp = await fetch(`${this.baseUrl}/${dirPath}`, {
          method: "MKCOL",
          headers: this.headers,
        });
        // 201 = created, 405/409 = already exists — both fine
        if (!resp.ok && resp.status !== 405 && resp.status !== 409) {
          // Non-fatal: PUT may still succeed if server auto-creates dirs
        }
      } catch {
        // Network error on MKCOL — continue, let PUT handle it
      }
    }
  }

  async listRemoteFiles(remotePath: string): Promise<string[]> {
    const resp = await fetch(`${this.baseUrl}/${remotePath}`, {
      method: "PROPFIND",
      headers: { ...this.headers, Depth: "1" },
    });
    if (!resp.ok) return [];
    const text = await resp.text();
    // 解析 PROPFIND 响应中的 href（支持 d:href 和 D:href 命名空间变体）
    const hrefs: string[] = [];
    const regex = /<(?:(?:d|D):)?href>([^<]+)<\/(?:(?:d|D):)?href>/gi;
    // Normalize remotePath for contains-matching (handles non-standard mount prefixes)
    const remotePathStr = remotePath.split("/").filter(Boolean).join("/");
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const href = decodeURIComponent(m[1]);
      const hrefStr = href.split("/").filter(Boolean).join("/");
      if (!hrefStr.includes(remotePathStr)) continue;
      // Extract the part after remotePath — empty means parent dir itself
      const idx = hrefStr.lastIndexOf(remotePathStr);
      const rest = hrefStr.slice(idx + remotePathStr.length).split("/").filter(Boolean);
      if (rest.length === 0) continue;
      hrefs.push(rest[0]);
    }
    return hrefs;
  }
}
