// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * ops 合并引擎。参见 PRD v4 §3（D-0036）。
 *
 * ops.jsonl 是唯一 truth，state/facts 是 ops 的投影。
 * 合并算法：去重 → lamport clock 确定性排序 → 重建。
 */

import type { OpsEntry } from "../domain/ops_entry.js";
import { createState } from "../domain/state.js";
import type { State } from "../domain/state.js";
import type { Fact } from "../domain/fact.js";
import { createFact } from "../domain/fact.js";
import type { FactSource, FactStatus, FactType, NarrativeWeight } from "../domain/enums.js";

// ---------------------------------------------------------------------------
// 合并结果
// ---------------------------------------------------------------------------

export interface MergeResult {
  ops: OpsEntry[];
  conflicts: Conflict[];
  newLamportClock: number;
}

export interface Conflict {
  type: "concurrent_confirm" | "confirm_undo_conflict" | "concurrent_fact_edit";
  description: string;
  ops: OpsEntry[];
}

// ---------------------------------------------------------------------------
// 合并算法
// ---------------------------------------------------------------------------

/**
 * 合并本地和远程 ops。
 * 1. 按 op_id 去重
 * 2. 确定性排序（lamport_clock → timestamp → device_id）
 * 3. 冲突检测
 */
export function mergeOps(localOps: OpsEntry[], remoteOps: OpsEntry[]): MergeResult {
  // 1. 合并 + 去重
  const seen = new Set<string>();
  const deduped: OpsEntry[] = [];
  for (const op of [...localOps, ...remoteOps]) {
    if (!seen.has(op.op_id)) {
      seen.add(op.op_id);
      deduped.push(op);
    }
  }

  // 2. 确定性排序
  deduped.sort(deterministicSort);

  // 3. 冲突检测
  const conflicts = detectConflicts(deduped);

  // 4. 计算新 lamport clock
  const maxClock = deduped.reduce((max, op) => Math.max(max, op.lamport_clock ?? 0), 0);

  return { ops: deduped, conflicts, newLamportClock: maxClock + 1 };
}

/** 确定性排序比较器。 */
function deterministicSort(a: OpsEntry, b: OpsEntry): number {
  const clockA = a.lamport_clock ?? 0;
  const clockB = b.lamport_clock ?? 0;
  if (clockA !== clockB) return clockA - clockB;
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
  const devA = a.device_id ?? "";
  const devB = b.device_id ?? "";
  if (devA !== devB) return devA < devB ? -1 : 1;
  // 最终 tiebreaker：op_id（确保完全确定性）
  return a.op_id < b.op_id ? -1 : a.op_id > b.op_id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 冲突检测
// ---------------------------------------------------------------------------

function detectConflicts(ops: OpsEntry[]): Conflict[] {
  const conflicts: Conflict[] = [];

  // 按章节号分组 confirm/undo
  const confirmsByChapter = new Map<number, OpsEntry[]>();
  const undoByChapter = new Map<number, OpsEntry[]>();

  for (const op of ops) {
    if (op.op_type === "confirm_chapter" && op.chapter_num !== null) {
      const list = confirmsByChapter.get(op.chapter_num) ?? [];
      list.push(op);
      confirmsByChapter.set(op.chapter_num, list);
    }
    if (op.op_type === "undo_chapter" && op.chapter_num !== null) {
      const list = undoByChapter.get(op.chapter_num) ?? [];
      list.push(op);
      undoByChapter.set(op.chapter_num, list);
    }
  }

  // 两个设备对同一章节 confirm
  for (const [ch, confirms] of confirmsByChapter) {
    const devices = new Set(confirms.map((c) => c.device_id));
    if (devices.size > 1) {
      conflicts.push({
        type: "concurrent_confirm",
        description: `第 ${ch} 章被多个设备同时确认`,
        ops: confirms,
      });
    }
  }

  // 一端 confirm，另一端 undo 同一章
  for (const [ch, confirms] of confirmsByChapter) {
    const undos = undoByChapter.get(ch);
    if (undos) {
      const confirmDevices = new Set(confirms.map((c) => c.device_id));
      const undoDevices = new Set(undos.map((u) => u.device_id));
      for (const ud of undoDevices) {
        if (!confirmDevices.has(ud)) {
          conflicts.push({
            type: "confirm_undo_conflict",
            description: `第 ${ch} 章：一端确认，另一端撤销`,
            ops: [...confirms, ...undos],
          });
          break;
        }
      }
    }
  }

  // 两端同时修改同一条 fact
  const factEdits = new Map<string, OpsEntry[]>();
  for (const op of ops) {
    if (op.op_type === "edit_fact" || op.op_type === "update_fact_status") {
      const list = factEdits.get(op.target_id) ?? [];
      list.push(op);
      factEdits.set(op.target_id, list);
    }
  }
  for (const [factId, edits] of factEdits) {
    const devices = new Set(edits.map((e) => e.device_id));
    if (devices.size > 1) {
      conflicts.push({
        type: "concurrent_fact_edit",
        description: `Fact ${factId} 被多个设备同时编辑`,
        ops: edits,
      });
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// state 重建
// ---------------------------------------------------------------------------

export function rebuildStateFromOps(ops: OpsEntry[], au_id: string): State {
  const state = createState({ au_id });
  for (const op of ops) {
    applyOpToState(state, op);
  }
  return state;
}

function applyOpToState(state: State, op: OpsEntry): void {
  switch (op.op_type) {
    case "confirm_chapter":
      state.current_chapter = (op.chapter_num ?? 0) + 1;
      if (typeof op.payload.last_scene_ending_snapshot === "string") {
        state.last_scene_ending = op.payload.last_scene_ending_snapshot;
      }
      if (op.payload.characters_last_seen_snapshot && typeof op.payload.characters_last_seen_snapshot === "object") {
        state.characters_last_seen = op.payload.characters_last_seen_snapshot as Record<string, number>;
      }
      state.chapter_focus = [];
      if (Array.isArray(op.payload.focus)) {
        state.last_confirmed_chapter_focus = op.payload.focus as string[];
      }
      break;

    case "undo_chapter":
      state.current_chapter = op.chapter_num ?? state.current_chapter;
      state.chapter_focus = [];
      break;

    case "set_chapter_focus":
      if (Array.isArray(op.payload.focus)) {
        state.chapter_focus = op.payload.focus as string[];
      }
      break;

    case "import_project": {
      const snap = op.payload.state_snapshot as Record<string, unknown> | undefined;
      if (snap) {
        if (typeof snap.current_chapter === "number") state.current_chapter = snap.current_chapter;
        if (typeof snap.last_scene_ending === "string") state.last_scene_ending = snap.last_scene_ending;
        if (snap.characters_last_seen && typeof snap.characters_last_seen === "object") {
          state.characters_last_seen = snap.characters_last_seen as Record<string, number>;
        }
      }
      break;
    }

    case "resolve_dirty_chapter":
      if (op.chapter_num !== null) {
        const idx = state.chapters_dirty.indexOf(op.chapter_num);
        if (idx >= 0) state.chapters_dirty.splice(idx, 1);
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// facts 重建
// ---------------------------------------------------------------------------

/** 从 ops payload 安全构建 Fact（类型安全，无 type assertion bypass）。 */
function factFromPayload(id: string, d: Record<string, unknown>): Fact {
  return createFact({
    id,
    content_raw: (d.content_raw as string) ?? "",
    content_clean: (d.content_clean as string) ?? "",
    characters: (d.characters as string[]) ?? [],
    chapter: (d.chapter as number) ?? 0,
    status: ((d.status as string) ?? "active") as FactStatus,
    type: ((d.type as string) ?? "plot_event") as FactType,
    narrative_weight: ((d.narrative_weight as string) ?? "medium") as NarrativeWeight,
    source: ((d.source as string) ?? "extract_auto") as FactSource,
    timeline: (d.timeline as string) ?? "",
  });
}

export function rebuildFactsFromOps(ops: OpsEntry[]): Fact[] {
  const facts = new Map<string, Fact>();

  for (const op of ops) {
    switch (op.op_type) {
      case "add_fact": {
        const factData = op.payload.fact as Record<string, unknown> | undefined;
        if (factData) {
          facts.set(op.target_id, factFromPayload(op.target_id, factData));
        }
        break;
      }

      case "edit_fact": {
        const existing = facts.get(op.target_id);
        if (existing) {
          const EDITABLE_FIELDS = new Set(["content_raw", "content_clean", "characters", "status", "type", "narrative_weight", "source", "timeline", "story_time", "resolves", "chapter"]);
          const changes = (op.payload.updated_fields ?? op.payload.changes ?? {}) as Record<string, unknown>;
          for (const [key, value] of Object.entries(changes)) {
            if (EDITABLE_FIELDS.has(key)) {
              (existing as unknown as Record<string, unknown>)[key] = value;
            }
          }
        }
        break;
      }

      case "update_fact_status": {
        const f = facts.get(op.target_id);
        if (f && typeof op.payload.new_status === "string") {
          f.status = op.payload.new_status as FactStatus;
        }
        break;
      }

      case "delete_fact": {
        facts.delete(op.target_id);
        break;
      }

      case "batch_extract_facts": {
        const batchFacts = (op.payload.facts as Record<string, unknown>[]) ?? [];
        for (const fd of batchFacts) {
          const id = (fd.id as string) ?? op.target_id;
          facts.set(id, factFromPayload(id, fd));
        }
        break;
      }
    }
  }

  return Array.from(facts.values());
}

// ---------------------------------------------------------------------------
// Lamport clock 管理
// ---------------------------------------------------------------------------

let _localClock = 0;
let _initialized = false;

export function getNextLamportClock(): number {
  return ++_localClock;
}

export function syncLamportClock(remoteClock: number): void {
  _localClock = Math.max(_localClock, remoteClock);
  _initialized = true;
}

export function getCurrentLamportClock(): number {
  return _localClock;
}

/**
 * 从现有 ops 初始化 lamport clock。
 * 必须在 app 启动时调用（读取 ops.jsonl 后），否则新 ops 的 clock 值
 * 可能低于已有 ops，破坏排序保证。
 */
export function initLamportClockFromOps(ops: OpsEntry[]): void {
  if (_initialized) return;
  const maxClock = ops.reduce((max, op) => Math.max(max, op.lamport_clock ?? 0), 0);
  _localClock = maxClock;
  _initialized = true;
}
