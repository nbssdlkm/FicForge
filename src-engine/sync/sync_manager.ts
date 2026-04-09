// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 同步管理器。参见 PRD v4 §3。 */

import type { PlatformAdapter } from "../platform/adapter.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";
import type { SyncAdapter } from "./sync_adapter.js";
import { mergeOps, rebuildStateFromOps, rebuildFactsFromOps, syncLamportClock } from "./ops_merge.js";
import { joinPath } from "../repositories/implementations/file_utils.js";

export interface SyncResult {
  synced: boolean;
  conflicts: { type: string; description: string }[];
  opsAdded: number;
}

export class SyncManager {
  constructor(
    private adapter: PlatformAdapter,
    private opsRepo: OpsRepository,
    private stateRepo: StateRepository,
    private syncAdapter: SyncAdapter,
  ) {}

  async sync(auId: string): Promise<SyncResult> {
    // 1. 拉取远程 ops
    const remoteOps = await this.syncAdapter.pullOps(auId);

    // 2. 读取本地 ops
    const localOps = await this.opsRepo.list_all(auId);

    // 3. 合并
    const { ops: merged, conflicts, newLamportClock } = mergeOps(localOps, remoteOps);
    syncLamportClock(newLamportClock);

    // 4. 计算新增 ops 数
    const localIds = new Set(localOps.map((o) => o.op_id));
    const opsAdded = merged.filter((o) => !localIds.has(o.op_id)).length;

    // 5. 写回合并后的 ops（通过 opsRepo 确保序列化格式一致）
    await this.opsRepo.replace_all(auId, merged);

    // 6. 重建 state + facts（如果有新 ops）
    if (opsAdded > 0) {
      const state = rebuildStateFromOps(merged, auId);
      await this.stateRepo.save(state);

      const facts = rebuildFactsFromOps(merged);
      const factsPath = joinPath(auId, "facts.jsonl");
      const factsContent = facts.map((f) => JSON.stringify(f)).join("\n") + "\n";
      await this.adapter.writeFile(factsPath, factsContent);
    }

    // 7. 推送本地 ops 到远程
    await this.syncAdapter.pushOps(auId, merged);

    return {
      synced: true,
      conflicts: conflicts.map((c) => ({ type: c.type, description: c.description })),
      opsAdded,
    };
  }
}
