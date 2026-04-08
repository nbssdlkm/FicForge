// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import {
  APIMode,
  EmotionStyle,
  FactSource,
  FactStatus,
  FactType,
  IndexStatus,
  LicenseTier,
  LLMMode,
  NarrativeWeight,
  OpType,
  Perspective,
  Provenance,
} from "../enums.js";

describe("Enums match Python values", () => {
  it("FactStatus values", () => {
    expect(FactStatus.ACTIVE).toBe("active");
    expect(FactStatus.UNRESOLVED).toBe("unresolved");
    expect(FactStatus.RESOLVED).toBe("resolved");
    expect(FactStatus.DEPRECATED).toBe("deprecated");
  });

  it("FactType values", () => {
    expect(FactType.CHARACTER_DETAIL).toBe("character_detail");
    expect(FactType.RELATIONSHIP).toBe("relationship");
    expect(FactType.BACKSTORY).toBe("backstory");
    expect(FactType.PLOT_EVENT).toBe("plot_event");
    expect(FactType.FORESHADOWING).toBe("foreshadowing");
    expect(FactType.WORLD_RULE).toBe("world_rule");
  });

  it("NarrativeWeight values", () => {
    expect(NarrativeWeight.LOW).toBe("low");
    expect(NarrativeWeight.MEDIUM).toBe("medium");
    expect(NarrativeWeight.HIGH).toBe("high");
  });

  it("FactSource values", () => {
    expect(FactSource.MANUAL).toBe("manual");
    expect(FactSource.EXTRACT_AUTO).toBe("extract_auto");
    expect(FactSource.IMPORT_AUTO).toBe("import_auto");
  });

  it("LLMMode values", () => {
    expect(LLMMode.API).toBe("api");
    expect(LLMMode.LOCAL).toBe("local");
    expect(LLMMode.OLLAMA).toBe("ollama");
  });

  it("IndexStatus values", () => {
    expect(IndexStatus.READY).toBe("ready");
    expect(IndexStatus.STALE).toBe("stale");
    expect(IndexStatus.REBUILDING).toBe("rebuilding");
    expect(IndexStatus.INTERRUPTED).toBe("interrupted");
  });

  it("Perspective values", () => {
    expect(Perspective.THIRD_PERSON).toBe("third_person");
    expect(Perspective.FIRST_PERSON).toBe("first_person");
  });

  it("EmotionStyle values", () => {
    expect(EmotionStyle.IMPLICIT).toBe("implicit");
    expect(EmotionStyle.EXPLICIT).toBe("explicit");
  });

  it("LicenseTier values", () => {
    expect(LicenseTier.FREE).toBe("free");
    expect(LicenseTier.PRO).toBe("pro");
  });

  it("APIMode values", () => {
    expect(APIMode.SELF_HOSTED).toBe("self_hosted");
    expect(APIMode.MANAGED).toBe("managed");
  });

  it("Provenance values", () => {
    expect(Provenance.AI).toBe("ai");
    expect(Provenance.MANUAL).toBe("manual");
    expect(Provenance.MIXED).toBe("mixed");
    expect(Provenance.IMPORTED).toBe("imported");
  });

  it("OpType values", () => {
    expect(OpType.CONFIRM_CHAPTER).toBe("confirm_chapter");
    expect(OpType.UNDO_CHAPTER).toBe("undo_chapter");
    expect(OpType.IMPORT_PROJECT).toBe("import_project");
    expect(OpType.ADD_FACT).toBe("add_fact");
    expect(OpType.EDIT_FACT).toBe("edit_fact");
    expect(OpType.UPDATE_FACT_STATUS).toBe("update_fact_status");
    expect(OpType.SET_CHAPTER_FOCUS).toBe("set_chapter_focus");
    expect(OpType.RESOLVE_DIRTY_CHAPTER).toBe("resolve_dirty_chapter");
    expect(OpType.REBUILD_INDEX).toBe("rebuild_index");
    expect(OpType.RECALC_GLOBAL_STATE).toBe("recalc_global_state");
    expect(OpType.UPDATE_PINNED).toBe("update_pinned");
  });
});
