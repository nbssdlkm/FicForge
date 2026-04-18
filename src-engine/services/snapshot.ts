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
import { withAuLock } from "./au_lock.js";

export interface Snapshot {
  chapter: number;
  timestamp: string;
  state: unknown;
  facts: unknown[];
  /** Watermark: total ops archived up to this snapshot (inclusive). */
  archivedOpsCount?: number;
}

/**
 * 检查是否需要创建快照，如果需要则执行。
 * 每 50 章触发一次快照。
 *
 * 2.1 原子性：采用 watermark 策略——在快照中记录已归档 ops 数量，
 *     仅追加增量 ops 到归档文件，不清空 ops.jsonl。崩溃时 ops.jsonl
 *     保持完整，不会丢失数据。
 * 2.2 并发安全：全程持有 AU 级锁（withAuLock），与 confirm/undo/edit 等其它
 *     AU 级写入共享同一命名空间 "au:<au_id>"，保证读取 state/ops 时的一致性。
 */
export async function checkAndSnapshot(
  auPath: string,
  adapter: PlatformAdapter,
  opsRepo: OpsRepository,
  stateRepo: StateRepository,
  factRepo: FactRepository,
): Promise<boolean> {
  // 2.2: 与 confirm/undo/edit 等共享同一把 AU 锁，避免命名空间分裂导致快照读到撕裂的 state
  return withAuLock(auPath, async () => {
    const state = await stateRepo.get(auPath);
    const currentChapter = state.current_chapter;

    // 只在 50 的倍数章触发
    if (currentChapter < 50 || currentChapter % 50 !== 0) return false;

    // 检查是否已有此章的快照
    const snapshotPath = joinPath(auPath, `snapshots/snapshot_${currentChapter}.json`);
    if (await adapter.exists(snapshotPath)) return false;

    // 创建快照
    const facts = await factRepo.list_all(auPath);
    const ops = await opsRepo.list_all(auPath);

    // 2.1: Watermark — record total ops count at snapshot time
    const snapshot: Snapshot = {
      chapter: currentChapter,
      timestamp: new Date().toISOString(),
      state,
      facts,
      archivedOpsCount: ops.length,
    };

    const dir = joinPath(auPath, "snapshots");
    await adapter.mkdir(dir);
    await adapter.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));

    // 归档增量 ops（跳过上一快照已归档的部分）
    if (ops.length > 0) {
      let previouslyArchived = 0;
      const prevChapter = currentChapter - 50;
      if (prevChapter >= 50) {
        const prevPath = joinPath(auPath, `snapshots/snapshot_${prevChapter}.json`);
        if (await adapter.exists(prevPath)) {
          try {
            const prev = JSON.parse(await adapter.readFile(prevPath)) as Snapshot;
            previouslyArchived = prev.archivedOpsCount ?? 0;
          } catch {
            // 上一快照损坏——安全回退，归档全部 ops
          }
        }
      }

      const newOps = ops.slice(previouslyArchived);
      if (newOps.length > 0) {
        const archivePath = joinPath(auPath, "ops_archive.jsonl");
        const existingArchive = await adapter.exists(archivePath)
          ? await adapter.readFile(archivePath)
          : "";
        const newLines = newOps.map((op) => JSON.stringify(op)).join("\n") + "\n";
        await adapter.writeFile(archivePath, existingArchive + newLines);
      }
    }

    // ops.jsonl 不清空——watermark 记录了已归档位置，
    // 消除了原 "先归档再清空" 两步操作的崩溃数据丢失风险。

    return true;
  });
}
