// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import {
  ANNOTATION_SCHEMA_VERSION,
  createAnnotation,
  createBudgetReport,
  createChapter,
  createChapterAnnotations,
  createChunk,
  createContextSummary,
  createDraft,
  createFact,
  createFactChange,
  createFandom,
  createGeneratedWith,
  createLLMConfig,
  createOpsEntry,
  createProject,
  createSettings,
  createState,
  FactSource,
  FactStatus,
  FactType,
  IndexStatus,
  LLMMode,
  NarrativeWeight,
  Perspective,
} from "../index.js";

describe("Domain object factories — field names and defaults match Python", () => {
  it("createFact defaults", () => {
    const f = createFact({ id: "f_001", content_raw: "raw", content_clean: "clean" });
    expect(f.id).toBe("f_001");
    expect(f.content_raw).toBe("raw");
    expect(f.content_clean).toBe("clean");
    expect(f.characters).toEqual([]);
    expect(f.timeline).toBe("");
    expect(f.story_time).toBe("");
    expect(f.chapter).toBe(0);
    expect(f.status).toBe(FactStatus.ACTIVE);
    expect(f.type).toBe(FactType.PLOT_EVENT);
    expect(f.resolves).toBeNull();
    expect(f.narrative_weight).toBe(NarrativeWeight.MEDIUM);
    expect(f.source).toBe(FactSource.MANUAL);
    expect(f.revision).toBe(1);
  });

  it("createChapter defaults", () => {
    const ch = createChapter({ au_id: "au1", chapter_num: 5 });
    expect(ch.au_id).toBe("au1");
    expect(ch.chapter_num).toBe(5);
    expect(ch.content).toBe("");
    expect(ch.revision).toBe(1);
    expect(ch.confirmed_focus).toEqual([]);
    expect(ch.generated_with).toBeNull();
  });

  it("createDraft defaults", () => {
    const d = createDraft({ au_id: "au1", chapter_num: 3, variant: "A" });
    expect(d.content).toBe("");
    expect(d.generated_with).toBeNull();
  });

  it("createProject defaults", () => {
    const p = createProject({ project_id: "p1", au_id: "au1" });
    expect(p.schema_version).toBe("1.0.0");
    expect(p.chapter_length).toBe(1500);
    expect(p.llm.mode).toBe(LLMMode.API);
    expect(p.writing_style.perspective).toBe(Perspective.THIRD_PERSON);
    expect(p.cast_registry.characters).toEqual([]);
    expect(p.core_guarantee_budget).toBe(400);
    expect(p.rag_decay_coefficient).toBe(0.05);
    expect(p.current_branch).toBe("main");
  });

  it("createSettings defaults", () => {
    const s = createSettings();
    expect(s.default_llm.mode).toBe(LLMMode.API);
    expect(s.embedding.ollama_model).toBe("nomic-embed-text");
    expect(s.app.language).toBe("zh");
    expect(s.app.data_dir).toBe("./fandoms");
    expect(s.app.chapter_metadata_display.enabled).toBe(true);
  });

  it("createState defaults", () => {
    const st = createState({ au_id: "au1" });
    expect(st.current_chapter).toBe(1);
    expect(st.index_status).toBe(IndexStatus.STALE);
    expect(st.index_built_with).toBeNull();
    expect(st.sync_unsafe).toBe(false);
  });

  it("createLLMConfig defaults", () => {
    const l = createLLMConfig();
    expect(l.context_window).toBe(0);
    expect(l.mode).toBe(LLMMode.API);
  });

  it("createOpsEntry defaults", () => {
    const o = createOpsEntry({ op_id: "op1", op_type: "confirm_chapter", target_id: "t1", timestamp: "2026-01-01" });
    expect(o.chapter_num).toBeNull();
    expect(o.payload).toEqual({});
  });

  it("createFactChange defaults", () => {
    const fc = createFactChange({ fact_id: "f1", action: "keep" });
    expect(fc.updated_fields).toBeNull();
  });

  it("createFandom defaults", () => {
    const f = createFandom();
    expect(f.name).toBe("");
    expect(f.core_characters).toEqual([]);
  });

  it("createGeneratedWith defaults", () => {
    const g = createGeneratedWith();
    expect(g.temperature).toBe(0);
    expect(g.duration_ms).toBe(0);
  });

  it("createBudgetReport defaults", () => {
    const b = createBudgetReport();
    expect(b.context_window).toBe(0);
    expect(b.is_fallback_estimate).toBe(false);
    expect(b.truncated_layers).toEqual([]);
  });

  it("createAnnotation defaults", () => {
    const a = createAnnotation({ id: "ann_001", type: "highlight", start_offset: 0, end_offset: 10 });
    expect(a.id).toBe("ann_001");
    expect(a.type).toBe("highlight");
    expect(a.color).toBe("yellow");
    expect(a.comment).toBe("");
    expect(a.created_at).toBe("");
  });

  it("createChapterAnnotations defaults", () => {
    const ca = createChapterAnnotations();
    expect(ca.schema_version).toBe(ANNOTATION_SCHEMA_VERSION);
    expect(ca.chapter_num).toBe(0);
    expect(ca.annotations).toEqual([]);
  });

  it("createChunk defaults", () => {
    const c = createChunk({ content: "text", chapter_num: 3, score: 0.95 });
    expect(c.content).toBe("text");
    expect(c.chapter_num).toBe(3);
    expect(c.score).toBe(0.95);
    expect(c.metadata).toEqual({});
  });

  it("createContextSummary defaults", () => {
    const cs = createContextSummary();
    expect(cs.characters_used).toEqual([]);
    expect(cs.worldbuilding_used).toEqual([]);
    expect(cs.facts_injected).toBe(0);
    expect(cs.facts_as_focus).toEqual([]);
    expect(cs.pinned_count).toBe(0);
    expect(cs.rag_chunks_retrieved).toBe(0);
    expect(cs.total_input_tokens).toBe(0);
    expect(cs.truncated_layers).toEqual([]);
    expect(cs.truncated_characters).toEqual([]);
  });
});
