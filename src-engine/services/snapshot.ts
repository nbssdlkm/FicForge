// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Ops 快照截断（D-0036）。
 * 每 50 章创建快照，归档旧 ops。
 */

import type { PlatformAdapter } from "../platform/adapter.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";
import type { FactRepository } from "../repositories/interfaces/fact.js";
import { joinPath } from "../repositories/implementations/file_utils.js";

export interface Snapshot {
  chapter: number;
  timestamp: string;
  state: unknown;
  facts: unknown[];
}

/**
 * 检查是否需要创建快照，如果需要则执行。
 * 每 50 章触发一次快照。
 */
export async function checkAndSnapshot(
  auPath: string,
  adapter: PlatformAdapter,
  opsRepo: OpsRepository,
  stateRepo: StateRepository,
  factRepo: FactRepository,
): Promise<boolean> {
  const state = await stateRepo.get(auPath);
  const currentChapter = state.current_chapter;

  // 只在 50 的倍数章触发
  if (currentChapter < 50 || currentChapter % 50 !== 0) return false;

  // 检查是否已有此章的快照
  const snapshotPath = joinPath(auPath, `snapshots/snapshot_${currentChapter}.json`);
  if (await adapter.exists(snapshotPath)) return false;

  // 创建快照
  const facts = await factRepo.list_all(auPath);
  const snapshot: Snapshot = {
    chapter: currentChapter,
    timestamp: new Date().toISOString(),
    state,
    facts,
  };

  const dir = joinPath(auPath, "snapshots");
  await adapter.mkdir(dir);
  await adapter.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));

  // 归档旧 ops
  const ops = await opsRepo.list_all(auPath);
  if (ops.length > 0) {
    // 将全部 ops 归档
    const archivePath = joinPath(auPath, "ops_archive.jsonl");
    const existingArchive = await adapter.exists(archivePath)
      ? await adapter.readFile(archivePath)
      : "";
    const newLines = ops.map((op) => JSON.stringify(op)).join("\n") + "\n";
    await adapter.writeFile(archivePath, existingArchive + newLines);

    // 清空当前 ops（保留空文件）
    await adapter.writeFile(joinPath(auPath, "ops.jsonl"), "");
  }

  return true;
}
