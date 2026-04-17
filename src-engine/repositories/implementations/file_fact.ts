// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LocalFileFactRepository — facts.jsonl 读写实现。参见 PRD §3.6、D-0003。 */

import type { PlatformAdapter } from "../../platform/adapter.js";
import { FactSource, FactStatus, FactType, NarrativeWeight } from "../../domain/enums.js";
import type { Fact } from "../../domain/fact.js";
import { createFact } from "../../domain/fact.js";
import type { FactRepository } from "../interfaces/fact.js";
import { append_jsonl, joinPath, now_utc, read_jsonl, rewrite_jsonl, validatePathSegment, withWriteLock } from "./file_utils.js";
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
  });
}

// ---------------------------------------------------------------------------
// Repository 实现
// ---------------------------------------------------------------------------

export class FileFactRepository implements FactRepository {
  constructor(private adapter: PlatformAdapter) {}

  private factsPath(au_id: string): string {
    validatePathSegment(au_id, "au_id");
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
