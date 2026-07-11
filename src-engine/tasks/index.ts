// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 后台任务系统 — 统一导出。 */

export type {
  TaskCheckpoint,
  TaskContext,
  TaskDefinition,
  TaskEvent,
  TaskHandle,
  TaskStatus,
} from "./types.js";

export { TaskRunner } from "./task_runner.js";

// Task implementations
export { createFactsExtractionTask } from "./impl/facts_extraction_task.js";
export type { FactsExtractionParams, FactsExtractionResult } from "./impl/facts_extraction_task.js";
