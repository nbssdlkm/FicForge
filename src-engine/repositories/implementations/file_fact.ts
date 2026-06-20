// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LocalFileFactRepository — facts.jsonl 读写实现。参见 PRD §3.6、D-0003。 */

import type { PlatformAdapter } from "../../platform/adapter.js";
import { FactSource, FactStatus, FactType, NarrativeWeight, TimeKind, SuspenseType } from "../../domain/enums.js";
import type { Fact, FactFieldConfidence } from "../../domain/fact.js";
import { createFact } from "../../domain/fact.js";
import type { FactRepository } from "../interfaces/fact.js";
import { append_jsonl, joinPath, now_utc, read_jsonl, rewrite_jsonl, validateBasePath, withWriteLock } from "./file_utils.js";
import { hasLogger, getLogger } from "../../logger/index.js";

// ---------------------------------------------------------------------------
// Fact ↔ JSON 序列化
// ---------------------------------------------------------------------------

/** 将 Fact 转为 JSONL 行对象。sync_manager 重建 facts 时也需要用。 */
export function factToDict(fact: Fact): Record<string, unknown> {
  const d: Record<string, unknown> = {
    id: fact.id,
    content_raw: fact.content_raw,
    content_clean: fact.content_clean,
    characters: fact.characters,
    timeline: fact.timeline,
    chapter: fact.chapter,
    status: fact.status,
    type: fact.type,
    narrative_weight: fact.narrative_weight,
    source: fact.source,
    revision: fact.revision,
    created_at: fact.created_at,
    updated_at: fact.updated_at,
  };
  if (fact.story_time) d.story_time = fact.story_time;
  if (fact.resolves !== null) d.resolves = fact.resolves;
  // Layer 2 (M8-A)
  if (fact.location       != null) d.location        = fact.location;
  if (fact.story_time_tag != null) d.story_time_tag  = fact.story_time_tag;
  if (fact.story_time_order != null) d.story_time_order = fact.story_time_order;
  if (fact.time_kind      != null) d.time_kind       = fact.time_kind;
  if (fact.action_verb    != null) d.action_verb     = fact.action_verb;
  if (fact.caused_by?.length)      d.caused_by       = fact.caused_by;
  // Layer 3 (M8-A)
  if (fact.known_to       != null) d.known_to        = fact.known_to;
  if (fact.hidden_from?.length)    d.hidden_from     = fact.hidden_from;
  if (fact.suspense_type  != null) d.suspense_type   = fact.suspense_type;
  // _confidence (旁路，持久化供 UI 高亮用)
  if (fact._confidence)            d._confidence     = fact._confidence;
  // M10-B: 冷热分层 — archived 字段仅 true 时写入（节约存储，false 为默认）
  if (fact.archived === true) {
    d.archived    = true;
    if (fact.archived_at) d.archived_at = fact.archived_at;
  }
  return d;
}

function dictToFact(d: Record<string, unknown>): Fact {
  const now = now_utc();
  return createFact({
    id: d.id as string,
    content_raw: (d.content_raw as string) ?? "",
    content_clean: (d.content_clean as string) ?? "",
    characters: (d.characters as string[]) ?? [],
    timeline: (d.timeline as string) ?? "",
    story_time: (d.story_time as string) ?? "",
    chapter: (d.chapter as number) ?? 0,
    status: (d.status as FactStatus) ?? FactStatus.ACTIVE,
    type: (d.type as FactType) ?? FactType.PLOT_EVENT,
    resolves: (d.resolves as string) ?? null,
    narrative_weight: (d.narrative_weight as NarrativeWeight) ?? NarrativeWeight.MEDIUM,
    source: (d.source as FactSource) ?? FactSource.EXTRACT_AUTO,
    revision: (d.revision as number) ?? 1,
    created_at: (d.created_at as string) || now,
    updated_at: (d.updated_at as string) || now,
    // Layer 2 (M8-A)
    location:          (d.location       as string  | undefined) ?? null,
    story_time_tag:    (d.story_time_tag as string  | undefined) ?? null,
    story_time_order:  (d.story_time_order as number | undefined) ?? null,
    // time_kind / suspense_type: validate enum on read, non-legal → null (align with ops_projection)
    time_kind:         (Object.values(TimeKind) as string[]).includes(d.time_kind as string)
                         ? (d.time_kind as TimeKind)
                         : null,
    action_verb:       (d.action_verb    as string  | undefined) ?? null,
    caused_by:         Array.isArray(d.caused_by)   ? (d.caused_by  as string[]) : [],
    // Layer 3 (M8-A)
    known_to:          (d.known_to as ("all" | "reader_only" | string[]) | undefined) ?? null,
    hidden_from:       Array.isArray(d.hidden_from) ? (d.hidden_from as string[]) : [],
    suspense_type:     (Object.values(SuspenseType) as string[]).includes(d.suspense_type as string)
                         ? (d.suspense_type as SuspenseType)
                         : null,
    // _confidence
    _confidence:       (typeof d._confidence === "object" && d._confidence !== null)
                         ? (d._confidence as FactFieldConfidence)
                         : undefined,
    // M10-B: 冷热分层 — 旧 fact 无此字段时 undefined !== true → 兜底为 false
    archived:          d.archived === true ? true : false,
    archived_at:       typeof d.archived_at === "string" ? d.archived_at : undefined,
  });
}

// ---------------------------------------------------------------------------
// Repository 实现
// ---------------------------------------------------------------------------

export class FileFactRepository implements FactRepository {
  constructor(private adapter: PlatformAdapter) {}

  private factsPath(au_id: string): string {
    validateBasePath(au_id, "au_id");
    return joinPath(au_id, "facts.jsonl");
  }

  private async readAll(au_id: string): Promise<Fact[]> {
    const path = this.factsPath(au_id);
    const [facts, errors] = await read_jsonl(this.adapter, path, dictToFact);
    if (errors.length > 0) {
      if (hasLogger()) getLogger().warn("file_fact", "bad lines on read", { path, count: errors.length, first: errors[0] });
    }
    return facts;
  }

  async get(au_id: string, fact_id: string): Promise<Fact | null> {
    const facts = await this.readAll(au_id);
    return facts.find((f) => f.id === fact_id) ?? null;
  }

  async list_all(au_id: string): Promise<Fact[]> {
    return this.readAll(au_id);
  }

  async list_by_status(au_id: string, status: FactStatus): Promise<Fact[]> {
    const facts = await this.readAll(au_id);
    return facts.filter((f) => f.status === status);
  }

  async list_by_chapter(au_id: string, chapter_num: number): Promise<Fact[]> {
    const facts = await this.readAll(au_id);
    return facts.filter((f) => f.chapter === chapter_num);
  }

  async list_by_characters(au_id: string, character_names: string[]): Promise<Fact[]> {
    const namesSet = new Set(character_names);
    const facts = await this.readAll(au_id);
    return facts.filter((f) => f.characters.some((c) => namesSet.has(c)));
  }

  async list_unresolved(au_id: string): Promise<Fact[]> {
    return this.list_by_status(au_id, FactStatus.UNRESOLVED);
  }

  async append(au_id: string, fact: Fact): Promise<void> {
    const path = this.factsPath(au_id);
    await withWriteLock(path, () => append_jsonl(this.adapter, path, factToDict(fact)));
  }

  async update(au_id: string, fact: Fact): Promise<void> {
    fact.updated_at = now_utc();
    fact.revision += 1;
    const path = this.factsPath(au_id);
    await withWriteLock(path, async () => {
      const [facts, errors] = await read_jsonl(this.adapter, path, dictToFact);
      if (errors.length > 0) {
        if (hasLogger()) getLogger().warn("file_fact", "bad lines on update", { path, count: errors.length });
      }
      const items = facts.map((f) => (f.id === fact.id ? factToDict(fact) : factToDict(f)));
      await rewrite_jsonl(this.adapter, path, items);
    });
  }

  async delete_by_ids(au_id: string, fact_ids: string[]): Promise<void> {
    const idsSet = new Set(fact_ids);
    const path = this.factsPath(au_id);
    await withWriteLock(path, async () => {
      const [facts, errors] = await read_jsonl(this.adapter, path, dictToFact);
      if (errors.length > 0) {
        if (hasLogger()) getLogger().warn("file_fact", "bad lines on delete", { path, count: errors.length });
      }
      const remaining = facts.filter((f) => !idsSet.has(f.id));
      await rewrite_jsonl(this.adapter, path, remaining.map(factToDict));
    });
  }

  async replace_all(au_id: string, facts: Fact[]): Promise<void> {
    const path = this.factsPath(au_id);
    await withWriteLock(path, async () => {
      await rewrite_jsonl(this.adapter, path, facts.map(factToDict));
    });
  }
}
