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
import {
  FACT_SOURCE_VALUES, FACT_STATUS_VALUES, FACT_TYPE_VALUES, NARRATIVE_WEIGHT_VALUES,
} from "../domain/enums.js";
import { hasLogger, getLogger } from "../logger/index.js";
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

    case "undo_chapter": {
      const undoSnap = op.payload.state_snapshot as Record<string, unknown> | undefined;
      if (undoSnap) {
        if (typeof undoSnap.current_chapter === "number") state.current_chapter = undoSnap.current_chapter;
        if (typeof undoSnap.last_scene_ending === "string") state.last_scene_ending = undoSnap.last_scene_ending;
        if (undoSnap.characters_last_seen && typeof undoSnap.characters_last_seen === "object") {
          state.characters_last_seen = undoSnap.characters_last_seen as Record<string, number>;
        }
        if (Array.isArray(undoSnap.last_confirmed_chapter_focus)) {
          state.last_confirmed_chapter_focus = undoSnap.last_confirmed_chapter_focus as string[];
        }
        if (undoSnap.chapter_titles && typeof undoSnap.chapter_titles === "object") {
          state.chapter_titles = undoSnap.chapter_titles as Record<number, string>;
        }
        if (Array.isArray(undoSnap.chapters_dirty)) {
          state.chapters_dirty = undoSnap.chapters_dirty as number[];
        }
      } else {
        // Legacy ops without snapshot — best effort
        state.current_chapter = op.chapter_num ?? state.current_chapter;
      }
      state.chapter_focus = [];
      break;
    }

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

    case "import_chapters": {
      const maxCh = op.payload.last_chapter_num as number | undefined;
      if (typeof maxCh === "number") {
        state.current_chapter = Math.max(state.current_chapter, maxCh + 1);
      }
      if (typeof op.payload.last_scene_ending === "string") {
        state.last_scene_ending = op.payload.last_scene_ending as string;
      }
      if (op.payload.characters_last_seen && typeof op.payload.characters_last_seen === "object") {
        state.characters_last_seen = {
          ...state.characters_last_seen,
          ...(op.payload.characters_last_seen as Record<string, number>),
        };
      }
      break;
    }

    case "set_chapter_title":
      if (op.chapter_num !== null && typeof op.payload.title === "string") {
        state.chapter_titles[op.chapter_num] = op.payload.title;
      }
      break;

    case "mark_chapters_dirty":
      if (Array.isArray(op.payload.added_dirty)) {
        // 增量格式：union 合并（跨设备并发安全）
        for (const ch of op.payload.added_dirty as number[]) {
          if (!state.chapters_dirty.includes(ch)) {
            state.chapters_dirty.push(ch);
          }
        }
      } else if (Array.isArray(op.payload.chapters_dirty)) {
        // 旧快照格式���向后兼容
        state.chapters_dirty = op.payload.chapters_dirty as number[];
      }
      break;

    case "resolve_dirty_chapter":
      if (op.chapter_num !== null) {
        const idx = state.chapters_dirty.indexOf(op.chapter_num);
        if (idx >= 0) state.chapters_dirty.splice(idx, 1);
      }
      break;

    case "recalc_global_state": {
      const snap = op.payload as Record<string, unknown>;
      if (snap.characters_last_seen && typeof snap.characters_last_seen === "object") {
        state.characters_last_seen = snap.characters_last_seen as Record<string, number>;
      }
      if (typeof snap.last_scene_ending === "string") {
        state.last_scene_ending = snap.last_scene_ending;
      }
      if (Array.isArray(snap.last_confirmed_chapter_focus)) {
        state.last_confirmed_chapter_focus = snap.last_confirmed_chapter_focus as string[];
      }
      if (Array.isArray(snap.chapters_dirty)) {
        state.chapters_dirty = snap.chapters_dirty as number[];
      }
      if (Array.isArray(snap.chapter_focus)) {
        state.chapter_focus = snap.chapter_focus as string[];
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// facts 重建
// ---------------------------------------------------------------------------

/** 运行时校验枚举值，非法值回退默认并打 warn。 */
function validateEnum<T extends string>(
  value: string, valid: readonly T[], fallback: T, field: string, id: string,
): T {
  if ((valid as readonly string[]).includes(value)) return value as T;
  if (hasLogger()) getLogger().warn("ops_merge", `unknown ${field}`, { id, value, fallback });
  return fallback;
}

/** 从 ops payload 安全构建 Fact（运行时校验枚举字段）。 */
function factFromPayload(id: string, d: Record<string, unknown>): Fact {
  const rawStatus = (d.status as string) ?? "active";
  const rawType = (d.type as string) ?? "plot_event";
  const rawWeight = (d.narrative_weight as string) ?? "medium";
  const rawSource = (d.source as string) ?? "extract_auto";

  return createFact({
    id,
    content_raw: (d.content_raw as string) ?? "",
    content_clean: (d.content_clean as string) ?? "",
    characters: (d.characters as string[]) ?? [],
    chapter: (d.chapter as number) ?? 0,
    status: validateEnum(rawStatus, FACT_STATUS_VALUES, "active" as FactStatus, "status", id),
    type: validateEnum(rawType, FACT_TYPE_VALUES, "plot_event" as FactType, "type", id),
    narrative_weight: validateEnum(rawWeight, NARRATIVE_WEIGHT_VALUES, "medium" as NarrativeWeight, "narrative_weight", id),
    source: validateEnum(rawSource, FACT_SOURCE_VALUES, "extract_auto" as FactSource, "source", id),
    timeline: (d.timeline as string) ?? "",
    story_time: (d.story_time as string) ?? "",
    resolves: (d.resolves as string) ?? null,
    revision: (d.revision as number) ?? 1,
    created_at: (d.created_at as string) ?? "",
    updated_at: (d.updated_at as string) ?? "",
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

export function getNextLamportClock(): number {
  return ++_localClock;
}

export function syncLamportClock(remoteClock: number): void {
  _localClock = Math.max(_localClock, remoteClock);
}

export function getCurrentLamportClock(): number {
  return _localClock;
}

/**
 * 从现有 ops 初始化/更新 lamport clock。
 * 每次加载 AU 的 ops.jsonl 时调用。若 ops 中的最大 clock 高于当前本地
 * 时钟则抬升，确保后续 op 的 clock 值不低于已有 ops。
 */
export function initLamportClockFromOps(ops: OpsEntry[]): void {
  const maxClock = ops.reduce((max, op) => Math.max(max, op.lamport_clock ?? 0), 0);
  if (maxClock > _localClock) {
    _localClock = maxClock;
  }
}
