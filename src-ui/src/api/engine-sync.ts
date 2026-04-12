// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Sync API — 从 engine-client.ts 拆出的同步相关函数。
 * 只在设置页动态引入，减小主包体积。
 */

import type { SyncResult } from "@ficforge/engine";
import { getEngine, getDataDir, listFandoms } from "./engine-client";

// ===========================================================================
// Sync
// ===========================================================================

export interface WebDAVConfig {
  url: string;
  username: string;
  password: string;
  remote_dir: string;
}

export interface AggregatedSyncResult {
  synced: boolean;
  fileConflicts: { path: string; auPath: string; localModified?: string; remoteModified?: string }[];
  opsConflicts: string[];
  opsAdded: number;
  filesPushed: number;
  filesPulled: number;
  errors: string[];
}

/** 规范化 remote_dir：确保以 / 开头，去掉尾部 /。 */
function normalizeRemoteDir(dir: string): string {
  if (!dir) return ""; // 空 dir = 服务器根目录，无需前缀
  const trimmed = dir.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : "/" + trimmed;
}

/** 从本地绝对路径提取远端相对路径。去掉 dataDir 前缀，只保留 fandoms/xxx/aus/yyy */
function toRemoteAuPath(localAuPath: string, dataDir: string): string {
  let rel = localAuPath;
  if (dataDir && rel.startsWith(dataDir)) {
    rel = rel.slice(dataDir.length);
  }
  // 去掉开头的 / 或 \
  return rel.replace(/^[/\\]+/, "").replace(/\\/g, "/");
}

/** 测试 WebDAV 连接（PROPFIND）。 */
export async function testWebDAVConnection(
  config: WebDAVConfig,
): Promise<{ success: boolean }> {
  const url = config.url.replace(/\/+$/, "") + normalizeRemoteDir(config.remote_dir);
  const resp = await fetch(url, {
    method: "PROPFIND",
    headers: {
      Authorization: "Basic " + btoa(unescape(encodeURIComponent(`${config.username}:${config.password}`))),
      Depth: "0",
    },
  });
  return { success: resp.ok || resp.status === 207 };
}

export async function syncAllAus(webdavConfig: WebDAVConfig): Promise<AggregatedSyncResult> {
  const { SyncManager, WebDAVSyncAdapter } = await import("@ficforge/engine");
  const { adapter, repos } = getEngine();
  const dd = getDataDir();
  const baseUrl = webdavConfig.url.replace(/\/+$/, '') + normalizeRemoteDir(webdavConfig.remote_dir);
  const syncAdapter = new WebDAVSyncAdapter(baseUrl, webdavConfig.username, webdavConfig.password);
  const syncManager = new SyncManager(adapter, repos.ops, repos.state, syncAdapter, repos.fact);

  const agg: AggregatedSyncResult = {
    synced: true, fileConflicts: [], opsConflicts: [],
    opsAdded: 0, filesPushed: 0, filesPulled: 0, errors: [],
  };

  try {
    const fandoms = await listFandoms(dd);
    for (const fandom of fandoms) {
      for (const auName of fandom.aus) {
        const localPath = `${dd}/fandoms/${fandom.dir_name}/aus/${auName}`;
        const remotePath = toRemoteAuPath(localPath, dd);
        try {
          const result: SyncResult = await syncManager.sync(localPath, remotePath);
          if (!result.synced) {
            agg.errors.push(`${fandom.name}/${auName}: ${result.conflicts.map(c => c.description).join('; ')}`);
          }
          // S4: 收集 ops 冲突（非 sync_error 类型的 conflicts）
          for (const c of result.conflicts) {
            if (c.type !== "sync_error") {
              agg.opsConflicts.push(`${fandom.name}/${auName}: ${c.description}`);
            }
          }
          agg.opsAdded += result.opsAdded;
          agg.filesPushed += result.filesPushed;
          agg.filesPulled += result.filesPulled;
          for (const fc of result.fileConflicts) {
            agg.fileConflicts.push({ ...fc, auPath: localPath });
          }
        } catch (e) {
          agg.errors.push(`${fandom.name}/${auName}: ${String(e)}`);
        }
      }
    }
    // 只要有任何错误，synced 就是 false（不因 fileConflicts 存在而掩盖错误）
    if (agg.errors.length > 0) {
      agg.synced = false;
    }
  } catch (e) {
    agg.synced = false;
    agg.errors.push(String(e));
  }

  return agg;
}

export async function resolveFileConflict(
  auPath: string,
  filePath: string,
  choice: "local" | "remote",
  webdavConfig: WebDAVConfig,
): Promise<void> {
  const { WebDAVSyncAdapter } = await import("@ficforge/engine");
  const { adapter } = getEngine();
  const dd = getDataDir();
  const baseUrl = webdavConfig.url.replace(/\/+$/, '') + normalizeRemoteDir(webdavConfig.remote_dir);
  const syncAdapter = new WebDAVSyncAdapter(baseUrl, webdavConfig.username, webdavConfig.password);

  const localFullPath = `${auPath}/${filePath}`;
  // 远端路径用相对路径
  const remoteAuPath = toRemoteAuPath(auPath, dd);
  const remotePath = `${remoteAuPath}/${filePath}`;

  if (choice === "local") {
    const localContent = await adapter.readFile(localFullPath);
    await syncAdapter.pushFile(remotePath, localContent);
  } else {
    const remoteContent = await syncAdapter.pullFile(remotePath);
    if (remoteContent === null) {
      throw new Error(`远端文件已不存在: ${remotePath}`);
    }
    await adapter.writeFile(localFullPath, remoteContent);
  }
}
