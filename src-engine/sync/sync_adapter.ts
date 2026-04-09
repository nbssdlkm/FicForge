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
  pullFile(remotePath: string): Promise<string>;
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
    if (!content) return [];
    const entries: OpsEntry[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as OpsEntry);
      } catch {
        continue;
      }
    }
    return entries;
  }

  async pushOps(auPath: string, ops: OpsEntry[]): Promise<void> {
    const content = ops.map((op) => JSON.stringify(op)).join("\n") + "\n";
    await this.pushFile(`${auPath}/ops.jsonl`, content);
  }

  async pullFile(remotePath: string): Promise<string> {
    const resp = await fetch(`${this.baseUrl}/${remotePath}`, {
      method: "GET",
      headers: this.headers,
    });
    if (resp.status === 404) return "";
    if (!resp.ok) throw new Error(`WebDAV GET failed: ${resp.status}`);
    return resp.text();
  }

  async pushFile(remotePath: string, content: string): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/${remotePath}`, {
      method: "PUT",
      headers: { ...this.headers, "Content-Type": "text/plain; charset=utf-8" },
      body: content,
    });
    if (!resp.ok) throw new Error(`WebDAV PUT failed: ${resp.status}`);
  }

  async listRemoteFiles(remotePath: string): Promise<string[]> {
    const resp = await fetch(`${this.baseUrl}/${remotePath}`, {
      method: "PROPFIND",
      headers: { ...this.headers, Depth: "1" },
    });
    if (!resp.ok) return [];
    const text = await resp.text();
    // 简单解析 PROPFIND 响应中的 href
    const hrefs: string[] = [];
    const regex = /<d:href>([^<]+)<\/d:href>/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const href = decodeURIComponent(m[1]);
      if (href !== `/${remotePath}/` && href !== `/${remotePath}`) {
        const name = href.split("/").filter(Boolean).pop();
        if (name) hrefs.push(name);
      }
    }
    return hrefs;
  }
}
