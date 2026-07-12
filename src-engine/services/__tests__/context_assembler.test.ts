// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import {
  build_system_prompt,
  build_instruction,
  build_facts_layer,
  build_core_settings_layer,
  build_fact_enrichment_suffix,
  build_fact_knowledge_clause,
  assemble_context,
} from "../context_assembler.js";
import { createProject } from "../../domain/project.js";
import { createState } from "../../domain/state.js";
import { createFact } from "../../domain/fact.js";
import { FactStatus, NarrativeWeight, SuspenseType, TimeKind } from "../../domain/enums.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";

describe("build_system_prompt", () => {
  it("includes SYSTEM_NOVELIST", () => {
    const project = createProject({ project_id: "p1", au_id: "au1" });
    const result = build_system_prompt(project, false, "zh");
    expect(result).toContain("你是一位专业的小说作者");
  });

  it("includes pinned_context", () => {
    const project = createProject({ project_id: "p1", au_id: "au1", pinned_context: ["永远不要让Alice哭泣"] });
    const result = build_system_prompt(project, false, "zh");
    expect(result).toContain("永远不要让Alice哭泣");
  });

  it("trim_custom removes custom_instructions", () => {
    const project = createProject({
      project_id: "p1",
      au_id: "au1",
      writing_style: {
        perspective: "third_person" as any,
        pov_character: "",
        emotion_style: "implicit" as any,
        custom_instructions: "写得更诗意",
      },
    });
    const withCustom = build_system_prompt(project, false, "zh");
    const withoutCustom = build_system_prompt(project, true, "zh");
    expect(withCustom).toContain("写得更诗意");
    expect(withoutCustom).not.toContain("写得更诗意");
  });

  it("first_person includes pov character", () => {
    const project = createProject({
      project_id: "p1",
      au_id: "au1",
      writing_style: {
        perspective: "first_person" as any,
        pov_character: "Alice",
        emotion_style: "implicit" as any,
        custom_instructions: "",
      },
    });
    const result = build_system_prompt(project, false, "zh");
    expect(result).toContain("Alice");
    expect(result).toContain("第一人称");
  });

  it("chapter_length_max is 1.3x", () => {
    const project = createProject({ project_id: "p1", au_id: "au1", chapter_length: 2000 });
    const result = build_system_prompt(project, false, "zh");
    expect(result).toContain("2000");
    expect(result).toContain("2600"); // 2000 * 1.3
  });
});

describe("build_instruction", () => {
  it("includes current chapter", () => {
    const state = createState({ au_id: "au1", current_chapter: 5 });
    const result = build_instruction(state, "继续写", [], "zh");
    expect(result).toContain("第5章");
  });

  it("includes focus goal when chapter_focus set", () => {
    const state = createState({ au_id: "au1", chapter_focus: ["f1"] });
    const facts = [
      createFact({
        id: "f1",
        content_raw: "r",
        content_clean: "A and B are getting closer",
        status: FactStatus.UNRESOLVED,
      }),
    ];
    const result = build_instruction(state, "写", facts, "zh");
    expect(result).toContain("A and B are getting closer");
    expect(result).toContain("核心推进目标");
  });

  it("includes pacing instruction when unresolved facts but no focus", () => {
    const state = createState({ au_id: "au1" });
    const facts = [createFact({ id: "f1", content_raw: "r", content_clean: "c", status: FactStatus.UNRESOLVED })];
    const result = build_instruction(state, "写", facts, "zh");
    expect(result).toContain("叙事节奏");
  });
});

describe("build_facts_layer", () => {
  it("returns empty for no eligible facts", () => {
    const [text, degraded] = build_facts_layer([], [], 1000, null, "zh");
    expect(text).toBe("");
    expect(degraded).toBe(false);
  });

  it("includes active and unresolved facts", () => {
    const facts = [
      createFact({ id: "f1", content_raw: "r", content_clean: "active fact", status: FactStatus.ACTIVE, chapter: 1 }),
      createFact({
        id: "f2",
        content_raw: "r",
        content_clean: "unresolved fact",
        status: FactStatus.UNRESOLVED,
        chapter: 2,
      }),
    ];
    const [text] = build_facts_layer(facts, [], 10000, null, "zh");
    expect(text).toContain("[active] active fact");
    expect(text).toContain("[unresolved] unresolved fact");
  });

  it("soft degrades when over budget", () => {
    const facts = Array.from({ length: 20 }, (_, i) =>
      createFact({
        id: `f${i}`,
        content_raw: "r",
        content_clean: "很长的事实内容".repeat(10),
        status: FactStatus.UNRESOLVED,
        narrative_weight: NarrativeWeight.MEDIUM,
        chapter: i,
      }),
    );
    const [text, degraded] = build_facts_layer(facts, [], 100, null, "zh");
    expect(degraded).toBe(true);
    expect(text).toContain("未解决伏笔暂未展示");
  });

  it("sorts by weight and recency", () => {
    const facts = [
      createFact({
        id: "f1",
        content_raw: "r",
        content_clean: "low ch1",
        status: FactStatus.ACTIVE,
        narrative_weight: NarrativeWeight.LOW,
        chapter: 1,
      }),
      createFact({
        id: "f2",
        content_raw: "r",
        content_clean: "high ch2",
        status: FactStatus.ACTIVE,
        narrative_weight: NarrativeWeight.HIGH,
        chapter: 2,
      }),
    ];
    const [text] = build_facts_layer(facts, [], 10000, null, "zh");
    // high weight should appear, and facts sorted by chapter in final output
    expect(text).toContain("high ch2");
  });
});

describe("build_fact_enrichment_suffix", () => {
  it("returns empty string when no _confidence and no enrichment fields", () => {
    const fact = createFact({ id: "f1", content_raw: "r", content_clean: "c" });
    expect(build_fact_enrichment_suffix(fact)).toBe("");
  });

  it("no _confidence but has enrichment fields (manual/import ground truth) → injects (MED-3)", () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "c",
      location: "御书房",
      known_to: "reader_only",
    });
    const suffix = build_fact_enrichment_suffix(fact);
    expect(suffix).toContain("location: 御书房");
    // known_to 自 M3 批一迁出 suffix → 由 build_fact_knowledge_clause 渲染
    expect(suffix).not.toContain("known_to:");
    expect(build_fact_knowledge_clause(fact, "zh")).toBe("（仅读者知）");
  });

  it("空/纯空白字符串富化字段不注入空行（对抗审发现 2）", () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "c",
      location: "",
      action_verb: "   ",
      known_to: "", // 空串 / 纯空白
    });
    const suffix = build_fact_enrichment_suffix(fact);
    expect(suffix).toBe(""); // 无 _confidence 也不注入空值行
    expect(suffix).not.toContain("location:");
    expect(suffix).not.toContain("action_verb:");
  });

  it("returns empty string when known_to is empty array (M8-A MINOR fix)", () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "c",
      known_to: [],
      _confidence: { known_to: "high" },
    });
    // Empty array must NOT inject "known_to: " (no information value)
    const suffix = build_fact_enrichment_suffix(fact);
    expect(suffix).not.toContain("known_to:");
  });

  it("known_to 数组 → 迁出 suffix，clause 渲染「仅A、B知道」（M3 批一）", () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "c",
      known_to: ["Alice", "Bob"],
      _confidence: { known_to: "high" },
    });
    expect(build_fact_enrichment_suffix(fact)).toBe("");
    expect(build_fact_knowledge_clause(fact, "zh")).toBe("（仅Alice、Bob知道）");
    expect(build_fact_knowledge_clause(fact, "en")).toBe(" [known only to: Alice, Bob]");
  });

  it("known_to 'all' → 常态默认无信息量，suffix 与 clause 均不渲染（M3 批一有意变更）", () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "c",
      known_to: "all",
      _confidence: { known_to: "high" },
    });
    expect(build_fact_enrichment_suffix(fact)).toBe("");
    expect(build_fact_knowledge_clause(fact, "zh")).toBe("");
  });

  it("does not inject time_kind when it is 'normal'", () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "c",
      time_kind: TimeKind.NORMAL,
      _confidence: { time_kind: "high" },
    });
    const suffix = build_fact_enrichment_suffix(fact);
    expect(suffix).not.toContain("time_kind");
  });

  it("injects suspense_type when confidence is medium", () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "c",
      suspense_type: SuspenseType.SECRET,
      _confidence: { suspense_type: "medium" },
    });
    const suffix = build_fact_enrichment_suffix(fact);
    expect(suffix).toContain("suspense_type: secret");
  });
});

describe("build_fact_knowledge_clause（M3 批一：知情边界标注）", () => {
  it('hidden_from 非空 → zh「（瞒着X）」/ en " [hidden from: X]"', () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "c",
      hidden_from: ["王爷"],
      _confidence: { hidden_from: "medium" }, // ReAct 合成 medium → 放行
    });
    expect(build_fact_knowledge_clause(fact, "zh")).toBe("（瞒着王爷）");
    expect(build_fact_knowledge_clause(fact, "en")).toBe(" [hidden from: 王爷]");
  });

  it("known_to 数组 + hidden_from 同时存在 → 两段合并、known_to 在前", () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "c",
      known_to: ["王妃", "稳婆"],
      hidden_from: ["王爷"],
    });
    expect(build_fact_knowledge_clause(fact, "zh")).toBe("（仅王妃、稳婆知道；瞒着王爷）");
  });

  it("低置信 hidden_from 不指挥写作（_confidence.hidden_from=low → 不渲染）", () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "c",
      hidden_from: ["王爷"],
      _confidence: { hidden_from: "low" },
    });
    expect(build_fact_knowledge_clause(fact, "zh")).toBe("");
  });

  it("_confidence 存在但缺 hidden_from 条目 → 抑制（与 suffix 门控同语义）", () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "c",
      hidden_from: ["王爷"],
      _confidence: { location: "high" }, // 有对象但无 hidden_from 键
    });
    expect(build_fact_knowledge_clause(fact, "zh")).toBe("");
  });

  it("无 _confidence（手动/导入 ground truth）→ 无条件渲染", () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "c",
      hidden_from: ["王爷"],
    });
    expect(build_fact_knowledge_clause(fact, "zh")).toBe("（瞒着王爷）");
  });

  it("null / 空数组 / 'all' / 空白元素 → 全部不渲染", () => {
    expect(build_fact_knowledge_clause(createFact({ id: "f", content_raw: "r", content_clean: "c" }), "zh")).toBe("");
    expect(
      build_fact_knowledge_clause(
        createFact({ id: "f", content_raw: "r", content_clean: "c", known_to: [], hidden_from: [] }),
        "zh",
      ),
    ).toBe("");
    expect(
      build_fact_knowledge_clause(createFact({ id: "f", content_raw: "r", content_clean: "c", known_to: "all" }), "zh"),
    ).toBe("");
    expect(
      build_fact_knowledge_clause(
        createFact({ id: "f", content_raw: "r", content_clean: "c", hidden_from: ["  "] }),
        "zh",
      ),
    ).toBe("");
  });

  it("历史脏数据：known_to 裸字符串（非 all/reader_only）按单人名单渲染，不丢信息", () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "c",
      known_to: "皇帝" as unknown as "all", // 消毒 helper 上线前的存量磁盘形态
    });
    expect(build_fact_knowledge_clause(fact, "zh")).toBe("（仅皇帝知道）");
  });
});

describe("build_facts_layer 知情图例（INFO_ASYMMETRY_RULES 条件注入）", () => {
  it("有知情标注 → 图例出现且紧跟节头（首行）", () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "王妃有孕的真相",
      status: FactStatus.ACTIVE,
      chapter: 1,
      hidden_from: ["王爷"],
    });
    const [text] = build_facts_layer([fact], [], 10000, null, "zh");
    const lines = text.split("\n");
    expect(lines[0]).toBe("## 当前剧情状态");
    expect(lines[1]).toContain("知情范围说明");
    expect(text).toContain("（瞒着王爷）");
  });

  it("无知情标注 → 图例绝不出现（无标注 AU 逐字节不变的回归安全绳）", () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "普通事件",
      status: FactStatus.ACTIVE,
      chapter: 1,
      location: "御书房", // 有 enrichment 但无知情标注
    });
    const [text] = build_facts_layer([fact], [], 10000, null, "zh");
    expect(text).not.toContain("知情范围说明");
  });

  it("en 图例走英文模板", () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "the secret pregnancy",
      status: FactStatus.ACTIVE,
      chapter: 1,
      known_to: "reader_only" as "reader_only",
    });
    const [text] = build_facts_layer([fact], [], 10000, null, "en");
    expect(text).toContain("Knowledge-scope note");
    expect(text).toContain(" [reader-only]");
  });
});

describe("build_instruction 焦点/特别注意行带知情标注（M3 批一 P1 覆盖）", () => {
  it("chapter_focus 事实的推进目标行带 clause", () => {
    const focus = createFact({
      id: "f_focus",
      content_raw: "r",
      content_clean: "身世之谜待揭",
      status: FactStatus.UNRESOLVED,
      chapter: 2,
      hidden_from: ["林晚月"],
    });
    const state = createState({ current_chapter: 3, chapter_focus: ["f_focus"] });
    const text = build_instruction(state, "继续写", [focus], "zh");
    expect(text).toContain("- 身世之谜待揭（瞒着林晚月）");
  });

  it("非焦点高权重 unresolved 的特别注意行带 clause", () => {
    const focus = createFact({
      id: "f_focus",
      content_raw: "r",
      content_clean: "普通推进目标",
      status: FactStatus.UNRESOLVED,
      chapter: 2,
    });
    const caution = createFact({
      id: "f_caution",
      content_raw: "r",
      content_clean: "皇帝的暗线",
      status: FactStatus.UNRESOLVED,
      chapter: 1,
      narrative_weight: NarrativeWeight.HIGH,
      known_to: "reader_only" as "reader_only",
    });
    const state = createState({ current_chapter: 3, chapter_focus: ["f_focus"] });
    const text = build_instruction(state, "继续写", [focus, caution], "zh");
    expect(text).toContain("- 皇帝的暗线（仅读者知）");
  });
});

describe("build_facts_layer enrichment budget (M8-A MAJOR fix)", () => {
  it("enriched fact that fits budget+suffix is kept", () => {
    // Budget large enough for content + suffix
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "short fact",
      status: FactStatus.UNRESOLVED,
      known_to: ["Alice"],
      _confidence: { known_to: "high" },
    });
    const [text] = build_facts_layer([fact], [], 10000, null, "zh");
    expect(text).toContain("short fact");
    expect(text).toContain("（仅Alice知道）");
  });

  it("enriched fact that overflows tight budget is excluded (suffix counted in budget)", () => {
    // Make 20 facts each with long content + enrichment suffix
    // Budget is 1 token — everything should be excluded
    const facts = Array.from({ length: 5 }, (_, i) =>
      createFact({
        id: `f${i}`,
        content_raw: "r",
        content_clean: "这是一段很长的内容需要占用大量 token ".repeat(20),
        status: FactStatus.UNRESOLVED,
        narrative_weight: NarrativeWeight.MEDIUM,
        chapter: i,
        known_to: ["Alice", "Bob"],
        _confidence: { known_to: "high" },
      }),
    );
    // Budget = 1 → nothing should fit (content alone already > 1 token)
    const [_text, degraded] = build_facts_layer(facts, [], 1, null, "zh");
    expect(degraded).toBe(true);
  });
});

describe("build_core_settings_layer", () => {
  it("injects core_always_include first (guarantee budget)", () => {
    const project = createProject({
      project_id: "p1",
      au_id: "au1",
      core_always_include: ["Alice"],
      core_guarantee_budget: 400,
    });
    const charFiles = {
      Alice: "# Alice\nShe is the protagonist.",
      Bob: "# Bob\nHe is a friend.",
    };
    const [text, injected, truncated] = build_core_settings_layer(project, charFiles, 50, null, "zh");
    // With only 50 tokens budget but 400 guarantee, Alice should still be injected
    expect(injected).toContain("Alice");
  });

  it("returns empty when no files", () => {
    const project = createProject({ project_id: "p1", au_id: "au1" });
    const [text] = build_core_settings_layer(project, null, 1000, null, "zh");
    expect(text).toBe("");
  });
});

describe("assemble_context", () => {
  it("empty AU first chapter", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({ project_id: "p1", au_id: "au1" });
    const state = createState({ au_id: "au1", current_chapter: 1 });

    const result = await assemble_context(project, state, "开始写第一章", [], chapterRepo, "au1");

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1].role).toBe("user");
    expect(result.budget_report.context_window).toBeGreaterThan(0);
    expect(result.context_summary.pinned_count).toBe(0);
  });

  it("throws on budget exceeded", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    // Very long pinned_context with tiny context window
    const project = createProject({
      project_id: "p1",
      au_id: "au1",
      pinned_context: Array.from({ length: 100 }, (_, i) => `铁律${i}：` + "很长的规则描述".repeat(50)),
      llm: {
        mode: "api" as any,
        model: "",
        api_base: "",
        api_key: "",
        local_model_path: "",
        ollama_model: "",
        context_window: 100,
      },
    });
    const state = createState({ au_id: "au1" });

    await expect(assemble_context(project, state, "写", [], chapterRepo, "au1")).rejects.toThrow(
      "system_prompt_exceeds_budget",
    );
  });

  it("budget_report tracks all layers", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({ project_id: "p1", au_id: "au1" });
    const state = createState({ au_id: "au1", current_chapter: 1 });
    const facts = [createFact({ id: "f1", content_raw: "r", content_clean: "active fact", status: FactStatus.ACTIVE })];

    const result = await assemble_context(project, state, "继续", facts, chapterRepo, "au1");

    expect(result.budget_report.system_tokens).toBeGreaterThan(0);
    expect(result.budget_report.p1_tokens).toBeGreaterThan(0);
    expect(result.budget_report.max_output_tokens).toBeGreaterThan(0);
  });
});

describe("build_facts_layer 同章内剧情时间排序（M3 批二）", () => {
  it("同章内：闪回（序号小）排在当下（序号大）之前", () => {
    const now = createFact({
      id: "f_now",
      content_raw: "r",
      content_clean: "沈砚面圣翻案",
      status: FactStatus.ACTIVE,
      chapter: 9,
      story_time_order: 3,
    });
    const flashback = createFact({
      id: "f_fb",
      content_raw: "r",
      content_clean: "父亲当年蒙冤下狱",
      status: FactStatus.ACTIVE,
      chapter: 9,
      story_time_order: 1,
    });
    const [text] = build_facts_layer([now, flashback], [], 10000, null, "zh"); // 插入序：now 在前
    expect(text.indexOf("父亲当年蒙冤下狱")).toBeLessThan(text.indexOf("沈砚面圣翻案"));
  });

  it("无序号的排同章有序号之后；低置信序号视同无序号", () => {
    const ordered = createFact({
      id: "f_o",
      content_raw: "r",
      content_clean: "有序号的事实",
      status: FactStatus.ACTIVE,
      chapter: 5,
      story_time_order: 2,
    });
    const noOrder = createFact({
      id: "f_n",
      content_raw: "r",
      content_clean: "无序号的事实",
      status: FactStatus.ACTIVE,
      chapter: 5,
    });
    const lowConf = createFact({
      id: "f_l",
      content_raw: "r",
      content_clean: "低置信序号的事实",
      status: FactStatus.ACTIVE,
      chapter: 5,
      story_time_order: 1,
      _confidence: { story_time_order: "low" },
    });
    const [text] = build_facts_layer([noOrder, lowConf, ordered], [], 10000, null, "zh");
    const idx = (s: string) => text.indexOf(s);
    expect(idx("有序号的事实")).toBeLessThan(idx("无序号的事实"));
    expect(idx("有序号的事实")).toBeLessThan(idx("低置信序号的事实"));
    // 无序号与低置信之间保持插入稳定序
    expect(idx("无序号的事实")).toBeLessThan(idx("低置信序号的事实"));
  });

  it("跨章主序不被序号打破：ch2(序号99) 仍在 ch5(序号1) 之前", () => {
    const early = createFact({
      id: "f_e",
      content_raw: "r",
      content_clean: "第二章的事",
      status: FactStatus.ACTIVE,
      chapter: 2,
      story_time_order: 99,
    });
    const late = createFact({
      id: "f_t",
      content_raw: "r",
      content_clean: "第五章的事",
      status: FactStatus.ACTIVE,
      chapter: 5,
      story_time_order: 1,
    });
    const [text] = build_facts_layer([late, early], [], 10000, null, "zh");
    expect(text.indexOf("第二章的事")).toBeLessThan(text.indexOf("第五章的事"));
  });

  it("全部无序号 → 与旧行为逐字节一致（同章 unresolved 先于 active 的插入稳定序）", () => {
    const ur = createFact({
      id: "f_ur",
      content_raw: "r",
      content_clean: "未决伏笔",
      status: FactStatus.UNRESOLVED,
      chapter: 3,
    });
    const ac = createFact({
      id: "f_ac",
      content_raw: "r",
      content_clean: "普通事实",
      status: FactStatus.ACTIVE,
      chapter: 3,
    });
    const [text] = build_facts_layer([ac, ur], [], 10000, null, "zh");
    // unresolvedKept 在 activeKept 前拼接，同章无序号时稳定序保持
    expect(text.indexOf("未决伏笔")).toBeLessThan(text.indexOf("普通事实"));
  });
});

describe("build_facts_layer 同章排序 — 对抗审 R2 整改", () => {
  it("HIGH：NaN/±Infinity 序号折『无序号』，不破坏 comparator 全序（isFinite 门）", () => {
    const nan = createFact({
      id: "f_nan",
      content_raw: "r",
      content_clean: "NaN序号",
      status: FactStatus.ACTIVE,
      chapter: 4,
      story_time_order: Number.NaN,
    });
    const inf = createFact({
      id: "f_inf",
      content_raw: "r",
      content_clean: "无穷序号",
      status: FactStatus.ACTIVE,
      chapter: 4,
      story_time_order: Number.POSITIVE_INFINITY,
    });
    const ok = createFact({
      id: "f_ok",
      content_raw: "r",
      content_clean: "正常序号",
      status: FactStatus.ACTIVE,
      chapter: 4,
      story_time_order: 2,
    });
    const [text] = build_facts_layer([nan, inf, ok], [], 10000, null, "zh");
    const idx = (s: string) => text.indexOf(s);
    expect(idx("正常序号")).toBeLessThan(idx("NaN序号")); // 有效序号在前
    expect(idx("NaN序号")).toBeLessThan(idx("无穷序号")); // 折无序号后保持插入稳定序
  });

  it("MED-1 语义锁定：同章内剧情时间互排跨越状态分组（active 序号小可排到 unresolved 无序号之前）", () => {
    const urNoOrder = createFact({
      id: "f_ur",
      content_raw: "r",
      content_clean: "无序号未决伏笔",
      status: FactStatus.UNRESOLVED,
      chapter: 6,
    });
    const acOrdered = createFact({
      id: "f_ac",
      content_raw: "r",
      content_clean: "有序号普通事实",
      status: FactStatus.ACTIVE,
      chapter: 6,
      story_time_order: 1,
    });
    const [text] = build_facts_layer([urNoOrder, acOrdered], [], 10000, null, "zh");
    // 有意行为：时间线连贯压过状态分组（预算挑选的 unresolved 优先不受影响，这里只是呈现顺序）
    expect(text.indexOf("有序号普通事实")).toBeLessThan(text.indexOf("无序号未决伏笔"));
  });

  it("MED-4 边界容忍锁定：0 / 负数 / 小数按相对序参与（确定且无害），不被丢弃", () => {
    const zero = createFact({
      id: "f_0",
      content_raw: "r",
      content_clean: "序号零",
      status: FactStatus.ACTIVE,
      chapter: 7,
      story_time_order: 0,
    });
    const neg = createFact({
      id: "f_neg",
      content_raw: "r",
      content_clean: "序号负一",
      status: FactStatus.ACTIVE,
      chapter: 7,
      story_time_order: -1,
    });
    const frac = createFact({
      id: "f_frac",
      content_raw: "r",
      content_clean: "序号一点五",
      status: FactStatus.ACTIVE,
      chapter: 7,
      story_time_order: 1.5,
    });
    const [text] = build_facts_layer([frac, zero, neg], [], 10000, null, "zh");
    const idx = (s: string) => text.indexOf(s);
    expect(idx("序号负一")).toBeLessThan(idx("序号零"));
    expect(idx("序号零")).toBeLessThan(idx("序号一点五"));
  });

  it("LOW-1 相同有效序号保持插入稳定序；LOW-2 门控同源（无 _confidence / medium / high 均放行）", () => {
    const a = createFact({
      id: "f_a",
      content_raw: "r",
      content_clean: "同序甲",
      status: FactStatus.ACTIVE,
      chapter: 8,
      story_time_order: 2,
      _confidence: { story_time_order: "medium" },
    });
    const b = createFact({
      id: "f_b",
      content_raw: "r",
      content_clean: "同序乙",
      status: FactStatus.ACTIVE,
      chapter: 8,
      story_time_order: 2,
      _confidence: { story_time_order: "high" },
    });
    const c = createFact({
      id: "f_c",
      content_raw: "r",
      content_clean: "同序丙无置信",
      status: FactStatus.ACTIVE,
      chapter: 8,
      story_time_order: 2,
    });
    const first = createFact({
      id: "f_1st",
      content_raw: "r",
      content_clean: "序一",
      status: FactStatus.ACTIVE,
      chapter: 8,
      story_time_order: 1,
      _confidence: { story_time_order: "high" },
    });
    const [text] = build_facts_layer([a, b, c, first], [], 10000, null, "zh");
    const idx = (s: string) => text.indexOf(s);
    expect(idx("序一")).toBeLessThan(idx("同序甲")); // medium/high/无置信 全部放行参与
    expect(idx("同序甲")).toBeLessThan(idx("同序乙")); // 等值稳定序
    expect(idx("同序乙")).toBeLessThan(idx("同序丙无置信"));
  });
});
