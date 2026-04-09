// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

export type { Conflict, MergeResult } from "./ops_merge.js";
export {
  getCurrentLamportClock,
  getNextLamportClock,
  initLamportClockFromOps,
  mergeOps,
  rebuildFactsFromOps,
  rebuildStateFromOps,
  syncLamportClock,
} from "./ops_merge.js";

export type { SyncAdapter } from "./sync_adapter.js";
export { WebDAVSyncAdapter } from "./sync_adapter.js";

export type { SyncResult } from "./sync_manager.js";
export { SyncManager } from "./sync_manager.js";
