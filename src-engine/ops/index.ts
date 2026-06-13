// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

// ops 投影：确定性排序 / state·facts 重建 / lamport 单调时钟。
// 这是 ops.jsonl（审计日志，D-0040）的投影逻辑，非多设备同步（同步已退役）。
export {
  sortAndDedupeOps,
  rebuildStateFromOps,
  rebuildFactsFromOps,
  getNextLamportClock,
  initLamportClockFromOps,
  loadLamportClock,
  saveLamportClock,
} from "./ops_projection.js";
