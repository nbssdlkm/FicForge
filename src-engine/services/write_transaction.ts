// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 写入事务抽象。
 *
 * 保证 D-0036 写入顺序：ops → facts → state。
 * Service 方法向 tx 注册写入意图，由 commit() 统一按固定顺序落盘，
 * 消除手工编排遗漏风险。
 */

import type { Fact } from "../domain/fact.js";
import type { OpsEntry } from "../domain/ops_entry.js";
import type { State } from "../domain/state.js";
import type { FactRepository } from "../repositories/interfaces/fact.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";

interface PendingOp {
  au_id: string;
  entry: OpsEntry;
}

interface PendingFact {
  au_id: string;
  fact: Fact;
  mode: "append" | "update";
}

export class WriteTransaction {
  private pendingOps: PendingOp[] = [];
  private pendingFacts: PendingFact[] = [];
  private pendingState: State | null = null;

  appendOp(au_id: string, entry: OpsEntry): void {
    this.pendingOps.push({ au_id, entry });
  }

  appendFact(au_id: string, fact: Fact): void {
    this.pendingFacts.push({ au_id, fact, mode: "append" });
  }

  updateFact(au_id: string, fact: Fact): void {
    this.pendingFacts.push({ au_id, fact, mode: "update" });
  }

  setState(state: State): void {
    this.pendingState = state;
  }

  /**
   * 按 D-0036 固定顺序落盘：ops → facts → state。
   * ops 是 sync truth，state 可从 ops 重建，故 state 最后写。
   */
  async commit(
    ops_repo: OpsRepository,
    fact_repo: FactRepository | null,
    state_repo: StateRepository | null,
  ): Promise<void> {
    // 1. ops 先落盘
    for (const { au_id, entry } of this.pendingOps) {
      await ops_repo.append(au_id, entry);
    }

    // 2. facts 落盘
    if (fact_repo) {
      for (const { au_id, fact, mode } of this.pendingFacts) {
        if (mode === "append") {
          await fact_repo.append(au_id, fact);
        } else {
          await fact_repo.update(au_id, fact);
        }
      }
    }

    // 3. state 最后落盘（可从 ops 重建）
    if (this.pendingState && state_repo) {
      await state_repo.save(this.pendingState);
    }
  }
}
