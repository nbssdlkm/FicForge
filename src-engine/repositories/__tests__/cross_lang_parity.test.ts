// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 跨语言对照测试：验证 TS Repository 读取 Python 写入的数据文件后字段值完全一致。
 *
 * Golden values 由 Python repositories 写入 → 读回 → 导出为 JSON 获得。
 * 测试方法：用 MockAdapter 注入 Python 写出的原始文件内容，TS 读取后对比 golden。
 */

import { describe, expect, it } from "vitest";
import { FileStateRepository } from "../implementations/file_state.js";
import { FileFactRepository } from "../implementations/file_fact.js";
import { FileProjectRepository } from "../implementations/file_project.js";
import { MockAdapter } from "./mock_adapter.js";

// ---------------------------------------------------------------------------
// Python 端写出的原始文件内容（手动从 Python 输出复制）
// ---------------------------------------------------------------------------

const STATE_YAML = `au_id: test_au
chapters_dirty:
- 3
- 4
chapter_focus: []
chapter_titles:
  1: 黄昏
  2: 新生
characters_last_seen:
  Alice: 3
  Bob: 5
current_chapter: 5
index_built_with: null
index_status: ready
last_confirmed_chapter_focus: []
last_scene_ending: 他转身离去。
revision: 1
sync_unsafe: false
updated_at: '2026-04-08T00:00:00Z'
`;

const FACTS_JSONL =
  '{"id": "f_golden_001", "content_raw": "第1章 Alice遇见Bob", "content_clean": "Alice遇见Bob", "characters": ["Alice", "Bob"], "timeline": "", "chapter": 1, "status": "active", "type": "plot_event", "narrative_weight": "high", "source": "extract_auto", "revision": 1, "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"}\n';

const PROJECT_YAML = `project_id: proj-golden
au_id: test_au
name: 黄金测试AU
fandom: TestFandom
schema_version: 1.0.0
revision: 2
created_at: ''
updated_at: '2026-04-08T00:00:00Z'
llm:
  mode: api
  model: gpt-4o
  api_base: ''
  api_key: ''
  local_model_path: ''
  ollama_model: ''
  context_window: 128000
model_params_override: {}
chapter_length: 2000
writing_style:
  perspective: first_person
  pov_character: Alice
  emotion_style: explicit
  custom_instructions: ''
ignore_core_worldbuilding: false
agent_pipeline_enabled: false
cast_registry:
  characters:
  - Alice
  - Bob
core_always_include: []
pinned_context:
- 不要让Alice哭
rag_decay_coefficient: 0.05
embedding_lock:
  mode: ''
  model: ''
  api_base: ''
  api_key: ''
core_guarantee_budget: 400
current_branch: main
`;

// ---------------------------------------------------------------------------
// Python 读回后的 golden 值
// ---------------------------------------------------------------------------

const GOLDEN_STATE = {
  current_chapter: 5,
  last_scene_ending: "他转身离去。",
  characters_last_seen: { Alice: 3, Bob: 5 },
  chapter_titles: { "1": "黄昏", "2": "新生" },
  chapters_dirty: [3, 4],
  index_status: "ready",
};

const GOLDEN_FACT = {
  id: "f_golden_001",
  content_clean: "Alice遇见Bob",
  status: "active",
  type: "plot_event",
  characters: ["Alice", "Bob"],
  chapter: 1,
  narrative_weight: "high",
};

const GOLDEN_PROJECT = {
  name: "黄金测试AU",
  fandom: "TestFandom",
  llm_mode: "api",
  llm_model: "gpt-4o",
  perspective: "first_person",
  pov_character: "Alice",
  characters: ["Alice", "Bob"],
  chapter_length: 2000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Cross-language parity: Python-written files → TS read", () => {
  it("state.yaml fields match Python golden", async () => {
    const adapter = new MockAdapter();
    adapter.seed("test_au/state.yaml", STATE_YAML);
    const repo = new FileStateRepository(adapter);
    const state = await repo.get("test_au");

    expect(state.current_chapter).toBe(GOLDEN_STATE.current_chapter);
    expect(state.last_scene_ending).toBe(GOLDEN_STATE.last_scene_ending);
    expect(state.characters_last_seen).toEqual(GOLDEN_STATE.characters_last_seen);
    expect(state.chapter_titles[1]).toBe(GOLDEN_STATE.chapter_titles["1"]);
    expect(state.chapter_titles[2]).toBe(GOLDEN_STATE.chapter_titles["2"]);
    expect(state.chapters_dirty).toEqual(GOLDEN_STATE.chapters_dirty);
    expect(state.index_status).toBe(GOLDEN_STATE.index_status);
  });

  it("facts.jsonl fields match Python golden", async () => {
    const adapter = new MockAdapter();
    adapter.seed("test_au/facts.jsonl", FACTS_JSONL);
    const repo = new FileFactRepository(adapter);
    const facts = await repo.list_all("test_au");

    expect(facts).toHaveLength(1);
    const f = facts[0];
    expect(f.id).toBe(GOLDEN_FACT.id);
    expect(f.content_clean).toBe(GOLDEN_FACT.content_clean);
    expect(f.status).toBe(GOLDEN_FACT.status);
    expect(f.type).toBe(GOLDEN_FACT.type);
    expect(f.characters).toEqual(GOLDEN_FACT.characters);
    expect(f.chapter).toBe(GOLDEN_FACT.chapter);
    expect(f.narrative_weight).toBe(GOLDEN_FACT.narrative_weight);
  });

  it("project.yaml fields match Python golden", async () => {
    const adapter = new MockAdapter();
    adapter.seed("test_au/project.yaml", PROJECT_YAML);
    const repo = new FileProjectRepository(adapter);
    const project = await repo.get("test_au");

    expect(project.name).toBe(GOLDEN_PROJECT.name);
    expect(project.fandom).toBe(GOLDEN_PROJECT.fandom);
    expect(project.llm.mode).toBe(GOLDEN_PROJECT.llm_mode);
    expect(project.llm.model).toBe(GOLDEN_PROJECT.llm_model);
    expect(project.writing_style.perspective).toBe(GOLDEN_PROJECT.perspective);
    expect(project.writing_style.pov_character).toBe(GOLDEN_PROJECT.pov_character);
    expect(project.cast_registry.characters).toEqual(GOLDEN_PROJECT.characters);
    expect(project.chapter_length).toBe(GOLDEN_PROJECT.chapter_length);
  });
});
