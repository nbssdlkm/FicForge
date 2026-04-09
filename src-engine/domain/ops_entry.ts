// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 操作日志领域对象。参见 PRD §2.6.4、DECISIONS D-0010。 */

export interface OpsEntry {
  op_id: string;                          // 操作唯一 ID
  op_type: string;                        // 操作类型
  target_id: string;                      // 操作目标 ID
  timestamp: string;                      // ISO 8601
  chapter_num: number | null;             // 关联章节号（可选）
  payload: Record<string, unknown>;       // 操作负载（快照数据等）
  device_id: string;                      // 设备唯一标识（同步用）
  lamport_clock: number;                  // 逻辑时钟（同步排序用）
}

export function createOpsEntry(partial: Pick<OpsEntry, "op_id" | "op_type" | "target_id" | "timestamp"> & Partial<OpsEntry>): OpsEntry {
  return {
    chapter_num: null,
    payload: {},
    device_id: "",
    lamport_clock: 0,
    ...partial,
  };
}
