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
import { atomicWrite, joinPath } from "../utils/file_utils.js";
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

    // 快照素材
    const facts = await factRepo.listAll(auPath);
    const ops = await opsRepo.listAll(auPath);

    // 时序重排（E5 正确性 L2）：先归档增量 ops，**归档成功后**再回写含新 watermark 的快照。
    // 旧序是「先写含 archivedOpsCount=ops.length 的快照 → 再追加归档」，归档若抛错则 watermark
    // 已被推进 → 下一快照据错误 watermark 跳过这批未落盘的 ops，永久漏归档（不可恢复）。
    // 新序把该窗口换成可恢复的另一面：归档成功但快照写失败时，重试按旧 watermark 重新归档，
    // 归档文件会出现重复条目。归档语义不变量 = **at-least-once**（宁可重复不可丢失；
    // op_id 全局唯一，未来消费者按 op_id 去重——当前 ops_archive 零消费者、模块未接线（M6）。
    // 两文件均原子写；「新快照+旧归档」的危险组合被本序消除（快照恒在归档之后落盘）。
    // 两处均改原子写（write .tmp → rename），避免半截文件。
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
        const existingArchive = (await adapter.exists(archivePath)) ? await adapter.readFile(archivePath) : "";
        const newLines = `${newOps.map((op) => JSON.stringify(op)).join("\n")}\n`;
        // 原子写：失败在此抛出，下方快照不落盘 → watermark 不推进。
        await atomicWrite(adapter, archivePath, existingArchive + newLines);
      }
    }

    // 2.1: Watermark — 归档已成功，回写含 archivedOpsCount 的快照（原子写）。
    // ops.jsonl 不清空——watermark 记录了已归档位置，崩溃不丢数据。
    const snapshot: Snapshot = {
      chapter: currentChapter,
      timestamp: new Date().toISOString(),
      state,
      facts,
      archivedOpsCount: ops.length,
    };
    const dir = joinPath(auPath, "snapshots");
    await adapter.mkdir(dir);
    await atomicWrite(adapter, snapshotPath, JSON.stringify(snapshot, null, 2));

    return true;
  });
}
