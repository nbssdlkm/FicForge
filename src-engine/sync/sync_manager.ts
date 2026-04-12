// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 同步管理器。参见 PRD v4 §3。 */

import type { PlatformAdapter } from "../platform/adapter.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";
import type { SyncAdapter } from "./sync_adapter.js";
import { mergeOps, rebuildStateFromOps, rebuildFactsFromOps, syncLamportClock } from "./ops_merge.js";
import { joinPath } from "../repositories/implementations/file_utils.js";
import { factToDict } from "../repositories/implementations/file_fact.js";

export interface FileConflict {
  path: string;
  localModified?: string;
  remoteModified?: string;
}

export interface SyncResult {
  synced: boolean;
  conflicts: { type: string; description: string }[];
  fileConflicts: FileConflict[];
  opsAdded: number;
  filesPushed: number;
  filesPulled: number;
}

export class SyncManager {
  constructor(
    private adapter: PlatformAdapter,
    private opsRepo: OpsRepository,
    private stateRepo: StateRepository,
    private syncAdapter: SyncAdapter,
  ) {}

  /**
   * 同步单个 AU。
   * @param localAuPath 本地绝对路径（用于文件 I/O）
   * @param remoteAuPath 远端相对路径（用于 WebDAV I/O），如 "fandoms/dbh/aus/star-empire"
   */
  async sync(localAuPath: string, remoteAuPath?: string): Promise<SyncResult> {
    const remote = remoteAuPath ?? localAuPath;
    try {
      // 1. 拉取远程 ops
      const { entries: remoteOps, badLineCount } = await this.syncAdapter.pullOps(remote);

      // 远端 ops 有坏行时中止同步：merge+push 会永久丢失这些行
      if (badLineCount > 0) {
        return {
          synced: false,
          conflicts: [{
            type: "sync_error",
            description: `远端 ops.jsonl 包含 ${badLineCount} 行无法解析的数据，已中止同步以防数据丢失`,
          }],
          fileConflicts: [],
          opsAdded: 0,
          filesPushed: 0,
          filesPulled: 0,
        };
      }

      // 2. 读取本地 ops
      const localOps = await this.opsRepo.list_all(localAuPath);

      // 3. 合并
      const { ops: merged, conflicts, newLamportClock } = mergeOps(localOps, remoteOps);
      syncLamportClock(newLamportClock);

      // 4. 计算新增 ops 数
      const localIds = new Set(localOps.map((o) => o.op_id));
      const opsAdded = merged.filter((o) => !localIds.has(o.op_id)).length;

      // 5. 写回合并后的 ops
      await this.opsRepo.replace_all(localAuPath, merged);

      // 6. 重建 state + facts（如果有新 ops）
      if (opsAdded > 0) {
        const state = rebuildStateFromOps(merged, localAuPath);
        await this.stateRepo.save(state);

        const facts = rebuildFactsFromOps(merged);
        const factsPath = joinPath(localAuPath, "facts.jsonl");
        // 使用 factToDict 保持与 FileFactRepository 一致的序列化格式
        const factsContent = facts.map((f) => JSON.stringify(factToDict(f))).join("\n") + "\n";
        await this.adapter.writeFile(factsPath, factsContent);
      }

      // 7. 推送本地 ops 到远程
      await this.syncAdapter.pushOps(remote, merged);

      // 8. 同步内容文件
      const contentResult = await this.syncContentFiles(localAuPath, remote);

      return {
        synced: true,
        conflicts: conflicts.map((c) => ({ type: c.type, description: c.description })),
        fileConflicts: contentResult.fileConflicts,
        opsAdded,
        filesPushed: contentResult.pushed,
        filesPulled: contentResult.pulled,
      };
    } catch (e) {
      return {
        synced: false,
        conflicts: [{ type: "sync_error", description: String(e) }],
        fileConflicts: [],
        opsAdded: 0,
        filesPushed: 0,
        filesPulled: 0,
      };
    }
  }

  /** 同步内容文件（章节、设定、project.yaml、trash manifest）。 */
  async syncContentFiles(
    localAuPath: string,
    remoteAuPath: string,
  ): Promise<{ pushed: number; pulled: number; fileConflicts: FileConflict[] }> {
    const syncDirs = [
      "chapters/main",
      "characters",
      "worldbuilding",
    ];
    const syncFiles = ["project.yaml", ".trash/manifest.jsonl"];

    let pushed = 0;
    let pulled = 0;
    const fileConflicts: FileConflict[] = [];

    // Sync individual files
    for (const relPath of syncFiles) {
      const localPath = joinPath(localAuPath, relPath);
      const remotePath = joinPath(remoteAuPath, relPath);
      const result = await this.syncSingleFile(localPath, remotePath);
      if (result === "pushed") pushed++;
      else if (result === "pulled") pulled++;
      else if (result === "conflict") fileConflicts.push({ path: relPath });
    }

    // Sync directories
    for (const dir of syncDirs) {
      const localDir = joinPath(localAuPath, dir);
      const localExists = await this.adapter.exists(localDir);
      const localFiles = localExists ? await this.adapter.listDir(localDir) : [];

      let remoteFiles: string[] = [];
      try {
        remoteFiles = await this.syncAdapter.listRemoteFiles(joinPath(remoteAuPath, dir));
      } catch {
        // Remote dir may not exist yet
      }

      const allFiles = new Set([...localFiles, ...remoteFiles]);

      for (const file of allFiles) {
        const relPath = joinPath(dir, file);
        const localPath = joinPath(localAuPath, relPath);
        const remotePath = joinPath(remoteAuPath, relPath);
        const result = await this.syncSingleFile(localPath, remotePath);
        if (result === "pushed") pushed++;
        else if (result === "pulled") pulled++;
        else if (result === "conflict") fileConflicts.push({ path: relPath });
      }
    }

    return { pushed, pulled, fileConflicts };
  }

  /** 同步单个文件。返回 "pushed" | "pulled" | "conflict" | "unchanged"。 */
  private async syncSingleFile(localPath: string, remotePath: string): Promise<"pushed" | "pulled" | "conflict" | "unchanged"> {
    const localExists = await this.adapter.exists(localPath);
    let remoteContent: string | null = null;
    try {
      remoteContent = await this.syncAdapter.pullFile(remotePath);
    } catch {
      remoteContent = null;
    }
    const remoteExists = remoteContent !== null;

    if (!localExists && !remoteExists) return "unchanged";

    if (!localExists && remoteExists) {
      // Pull: remote has, local doesn't
      const dir = localPath.substring(0, localPath.lastIndexOf("/"));
      if (dir) await this.adapter.mkdir(dir);
      await this.adapter.writeFile(localPath, remoteContent!);
      return "pulled";
    }

    const localContent = localExists ? await this.adapter.readFile(localPath) : "";

    if (localExists && !remoteExists) {
      // Push: local has, remote doesn't
      await this.syncAdapter.pushFile(remotePath, localContent);
      return "pushed";
    }

    // Both exist: compare content
    if (localContent === remoteContent) return "unchanged";

    // Content differs → conflict
    return "conflict";
  }
}
