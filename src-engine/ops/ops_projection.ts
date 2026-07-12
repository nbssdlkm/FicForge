// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * ops 投影。把操作日志（ops.jsonl）确定性排序后重放，重建 state/facts；
 * 并管理 lamport 单调时钟（每条 op 的序号）。
 *
 * 历史：ops 原为多设备同步的 single source of truth（D-0036）。同步已退役
 * （D-0040），ops 降级为本地审计日志。本模块的排序/重建/时钟逻辑并非同步专属：
 * 由 file_ops 在每次 append 时分配 lamport 序号，并作为 confirm/undo 的回归不变量
 * 守卫（rebuildStateFromOps(ops) == repo state）。多设备合并/冲突检测随 D-0040
 * 一并退役，已从本模块移除。
 */

import type { OpsEntry } from "../domain/ops_entry.js";
import { createState } from "../domain/state.js";
import { ON_DISK_DEFAULT_REVISION } from "../domain/project.js";
import type { State } from "../domain/state.js";
import type { Fact } from "../domain/fact.js";
import { createFact } from "../domain/fact.js";
import { sanitizeKnownTo, sanitizeHiddenFrom, sanitizeConfidence } from "../domain/fact_sanitize.js";
import {
  FACT_SOURCE_VALUES,
  FACT_STATUS_VALUES,
  FACT_TYPE_VALUES,
  NARRATIVE_WEIGHT_VALUES,
  TIME_KIND_VALUES,
  SUSPENSE_TYPE_VALUES,
} from "../domain/enums.js";
import { hasLogger, getLogger } from "../logger/index.js";
import { FactType, NarrativeWeight } from "../domain/enums.js";
import type { FactSource, FactStatus, TimeKind, SuspenseType } from "../domain/enums.js";
import type { FactFieldConfidence } from "../domain/fact.js";
import type { PlatformAdapter } from "../platform/adapter.js";

// ---------------------------------------------------------------------------
// 排序 + 去重（重建前置）
// ---------------------------------------------------------------------------

/**
 * 对 ops 去重（按 op_id）+ 确定性排序（lamport_clock → timestamp → device_id → op_id）。
 * rebuildStateFromOps / rebuildFactsFromOps 要求输入有序，以保证重建结果确定。
 */
export function sortAndDedupeOps(ops: OpsEntry[]): OpsEntry[] {
  const seen = new Set<string>();
  const deduped: OpsEntry[] = [];
  for (const op of ops) {
    if (!seen.has(op.op_id)) {
      seen.add(op.op_id);
      deduped.push(op);
    }
  }
  deduped.sort(deterministicSort);
  return deduped;
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
        if (snap.chapter_titles && typeof snap.chapter_titles === "object") {
          state.chapter_titles = snap.chapter_titles as Record<number, string>;
        }
      }
      break;
    }

    case "import_chapters": {
      const maxCh = op.payload.last_chapter_num as number | undefined;
      // L24：与 executeImport 同口径——last_scene_ending（续写衔接锚点）只在本次导入触及现末章
      // 及之后（maxCh + 1 >= current_chapter；current_chapter 是「下一章指针」，现末章 = 指针−1，
      // 重导当前末章也必须刷新锚点，F-2）时才更新；低章号补导不动它。
      // 先用更新前的 current_chapter 判定，再推进指针。
      const reachedTail = typeof maxCh === "number" && maxCh + 1 >= state.current_chapter;
      if (typeof maxCh === "number") {
        state.current_chapter = Math.max(state.current_chapter, maxCh + 1);
      }
      if (reachedTail && typeof op.payload.last_scene_ending === "string") {
        state.last_scene_ending = op.payload.last_scene_ending as string;
      }
      if (op.payload.characters_last_seen && typeof op.payload.characters_last_seen === "object") {
        state.characters_last_seen = {
          ...state.characters_last_seen,
          ...(op.payload.characters_last_seen as Record<string, number>),
        };
      }
      if (op.payload.chapter_titles && typeof op.payload.chapter_titles === "object") {
        state.chapter_titles = {
          ...state.chapter_titles,
          ...(op.payload.chapter_titles as Record<number, string>),
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
        // 旧快照格式——向后兼容
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
function validateEnum<T extends string>(value: string, valid: readonly T[], fallback: T, field: string, id: string): T {
  if ((valid as readonly string[]).includes(value)) return value as T;
  if (hasLogger()) getLogger().warn("ops_merge", `unknown ${field}`, { id, value, fallback });
  return fallback;
}

/** 从 ops payload 安全构建 Fact（运行时校验枚举字段）。 */
function factFromPayload(id: string, d: Record<string, unknown>): Fact {
  const rawStatus = (d.status as string) ?? "active";
  const rawType = (d.type as string) ?? FactType.PLOT_EVENT;
  const rawWeight = (d.narrative_weight as string) ?? NarrativeWeight.MEDIUM;
  const rawSource = (d.source as string) ?? "extract_auto";

  return createFact({
    id,
    content_raw: (d.content_raw as string) ?? "",
    content_clean: (d.content_clean as string) ?? "",
    characters: (d.characters as string[]) ?? [],
    chapter: (d.chapter as number) ?? 0,
    status: validateEnum(rawStatus, FACT_STATUS_VALUES, "active" as FactStatus, "status", id),
    type: validateEnum(rawType, FACT_TYPE_VALUES, FactType.PLOT_EVENT, "type", id),
    narrative_weight: validateEnum(rawWeight, NARRATIVE_WEIGHT_VALUES, NarrativeWeight.MEDIUM, "narrative_weight", id),
    source: validateEnum(rawSource, FACT_SOURCE_VALUES, "extract_auto" as FactSource, "source", id),
    timeline: (d.timeline as string) ?? "",
    story_time: (d.story_time as string) ?? "",
    resolves: (d.resolves as string) ?? null,
    revision: (d.revision as number) ?? ON_DISK_DEFAULT_REVISION,
    created_at: (d.created_at as string) ?? "",
    updated_at: (d.updated_at as string) ?? "",
    // Layer 2 (M8-A)
    location: (d.location as string | undefined) ?? null,
    story_time_tag: (d.story_time_tag as string | undefined) ?? null,
    story_time_order: (d.story_time_order as number | undefined) ?? null,
    time_kind: (TIME_KIND_VALUES as readonly string[]).includes(d.time_kind as string)
      ? (d.time_kind as TimeKind)
      : null,
    action_verb: (d.action_verb as string | undefined) ?? null,
    caused_by: Array.isArray(d.caused_by) ? (d.caused_by as string[]) : [],
    // Layer 3 (M8-A)
    known_to: (d.known_to as ("all" | "reader_only" | string[]) | undefined) ?? null,
    hidden_from: Array.isArray(d.hidden_from) ? (d.hidden_from as string[]) : [],
    suspense_type: (SUSPENSE_TYPE_VALUES as readonly string[]).includes(d.suspense_type as string)
      ? (d.suspense_type as SuspenseType)
      : null,
    // _confidence
    _confidence:
      typeof d._confidence === "object" && d._confidence !== null ? (d._confidence as FactFieldConfidence) : undefined,
    // Thread 关联（M8-B）：default [] / undefined，mirror caused_by / _confidence
    thread_ids: Array.isArray(d.thread_ids) ? (d.thread_ids as string[]) : [],
    thread_roles:
      typeof d.thread_roles === "object" && d.thread_roles !== null
        ? (d.thread_roles as Record<string, string>)
        : undefined,
    // M10-B: cold-tier archival (default false; undefined on old facts treated as false)
    archived: typeof d.archived === "boolean" ? d.archived : false,
    archived_at: typeof d.archived_at === "string" ? d.archived_at : undefined,
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
          const EDITABLE_FIELDS = new Set([
            "content_raw",
            "content_clean",
            "characters",
            "status",
            "type",
            "narrative_weight",
            "source",
            "timeline",
            "story_time",
            "resolves",
            "chapter",
            // M8-A Layer 2 + Layer 3 enrichment fields
            "location",
            "story_time_tag",
            "story_time_order",
            "time_kind",
            "action_verb",
            "caused_by",
            "known_to",
            "hidden_from",
            "suspense_type",
            "_confidence",
            // M8-B: thread 关联（setFactThreads 走 edit_fact op → 这两个键必须在白名单内才能 replay）
            "thread_ids",
            "thread_roles",
            // M10-B: cold-tier archival fields
            "archived",
            "archived_at",
          ]);
          // 枚举字段防御性校验（与 editFact 写路径对称）：非法枚举不 replay，防旧 ops /
          // 手改 ops.jsonl 引入的垃圾把 fact 从筛选视图里抹掉。
          const EDIT_ENUM: Record<string, readonly string[]> = {
            status: FACT_STATUS_VALUES,
            type: FACT_TYPE_VALUES,
            narrative_weight: NARRATIVE_WEIGHT_VALUES,
            source: FACT_SOURCE_VALUES,
          };
          const changes = (op.payload.updated_fields ?? op.payload.changes ?? {}) as Record<string, unknown>;
          for (const [key, value] of Object.entries(changes)) {
            if (!EDITABLE_FIELDS.has(key)) continue;
            // M3 批一：known_to/hidden_from/_confidence 形状消毒与写路径共用单一真相源
            // （domain/fact_sanitize）——写侧校验上线前的历史垃圾 op 回放时同样挡掉，
            // 保住「重建结果 == 磁盘状态」的对称契约。回放不做别名归一化（写侧已做，
            // op 里存的即归一化后的值；回放语境也拿不到 project 配置）。
            if (key === "known_to" || key === "hidden_from" || key === "_confidence") {
              const res =
                key === "known_to"
                  ? sanitizeKnownTo(value)
                  : key === "hidden_from"
                    ? sanitizeHiddenFrom(value)
                    : sanitizeConfidence(value);
              if (!res.ok) {
                if (hasLogger())
                  getLogger().warn("ops_merge", `edit_fact 跳过非法形状 ${key}`, {
                    id: op.target_id,
                    value: String(value),
                  });
                continue;
              }
              (existing as unknown as Record<string, unknown>)[key] = res.value;
              continue;
            }
            const validVals = EDIT_ENUM[key];
            if (validVals && !(typeof value === "string" && (validVals as readonly string[]).includes(value))) {
              if (hasLogger())
                getLogger().warn("ops_merge", `edit_fact 跳过非法枚举 ${key}`, {
                  id: op.target_id,
                  value: String(value),
                });
              continue;
            }
            (existing as unknown as Record<string, unknown>)[key] = value;
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

      // M10-B: cold-tier archival — restore archived state on rebuild
      case "archive_fact": {
        const f = facts.get(op.target_id);
        if (f) {
          f.archived = true;
          if (typeof op.payload.archived_at === "string") {
            f.archived_at = op.payload.archived_at;
          }
        }
        break;
      }

      case "unarchive_fact": {
        const f = facts.get(op.target_id);
        if (f) {
          f.archived = false;
          f.archived_at = undefined;
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

const LAMPORT_KV_KEY = "ficforge:lamport_clock";

let _localClock = 0;

export function getNextLamportClock(): number {
  return ++_localClock;
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

/**
 * 从持久化 KV 存储加载 lamport clock。
 * 进程重启后 _localClock 归零，此函数从 kvGet 恢复上次持久化的值，
 * 保证后续分配的 clock 不低于历史已分配值。
 */
export async function loadLamportClock(adapter: PlatformAdapter): Promise<void> {
  const stored = await adapter.kvGet(LAMPORT_KV_KEY);
  if (stored !== null) {
    const parsed = parseInt(stored, 10);
    if (!isNaN(parsed) && parsed > _localClock) {
      _localClock = parsed;
    }
  }
}

/**
 * 将当前 lamport clock 持久化到 KV 存储。
 * 在 append op 分配 clock 后调用，确保下次进程启动时能恢复。
 */
export async function saveLamportClock(adapter: PlatformAdapter): Promise<void> {
  await adapter.kvSet(LAMPORT_KV_KEY, String(_localClock));
}
