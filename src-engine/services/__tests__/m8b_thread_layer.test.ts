// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * M8-B Thread 层 — TDD tests.
 *  - buildThreadsLayer 纯函数（格式/排序/active-only/预算截断/空）
 *  - assembleContext 门控（空线逐字节回退；有线注入位置 + thread_tokens）
 *  - fact.thread_ids/thread_roles 全 6-hop 序列化（含 addFact/editFact 服务级 + batch + jsonl）
 *
 * 关键：服务级 addFact 测试（非手搓 op）才能抓 hop「createFact 转发 + 快照 + factFromPayload」
 * 整条链——M8-A 的测试手搓了 op payload，所以反而抓不到自己的 hop5 BLOCKER。
 */

import { describe, expect, it, beforeEach } from "vitest";
import { assembleContext, buildThreadsLayer } from "../context_assembler.js";
import { addFact, editFact } from "../facts_lifecycle.js";
import { rebuildFactsFromOps } from "../../ops/ops_projection.js";
import { createOpsEntry } from "../../domain/ops_entry.js";
import { createThread } from "../../domain/thread.js";
import { createFact } from "../../domain/fact.js";
import { createProject, createLLMConfig } from "../../domain/project.js";
import { createState } from "../../domain/state.js";
import { ThreadStatus, FactStatus } from "../../domain/enums.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";

const T = (over: Partial<ReturnType<typeof createThread>> = {}) =>
  createThread({
    id: "t1",
    title: "为父翻案",
    state: "准备面圣",
    status: ThreadStatus.ACTIVE,
    updated_at: "2026-06-20T00:00:00Z",
    ...over,
  });

// ===========================================================================
// buildThreadsLayer
// ===========================================================================

describe("buildThreadsLayer (M8-B)", () => {
  it("active threads → titled lines with state", () => {
    const text = buildThreadsLayer([T()], 10000, null, "zh");
    expect(text).toContain("当前剧情线");
    expect(text).toContain("【为父翻案】准备面圣");
  });

  it("empty / non-active only → ''", () => {
    expect(buildThreadsLayer([], 10000, null, "zh")).toBe("");
    expect(
      buildThreadsLayer(
        [T({ status: ThreadStatus.RESOLVED }), T({ id: "t2", status: ThreadStatus.DORMANT })],
        10000,
        null,
        "zh",
      ),
    ).toBe("");
  });

  it("only active threads are injected (resolved/dormant excluded)", () => {
    const text = buildThreadsLayer(
      [
        T({ id: "a", title: "活跃线", status: ThreadStatus.ACTIVE }),
        T({ id: "b", title: "已收束线", status: ThreadStatus.RESOLVED }),
      ],
      10000,
      null,
      "zh",
    );
    expect(text).toContain("活跃线");
    expect(text).not.toContain("已收束线");
  });

  it("sorts by updated_at desc (most recently advanced first)", () => {
    const text = buildThreadsLayer(
      [
        T({ id: "old", title: "旧线", updated_at: "2026-01-01T00:00:00Z" }),
        T({ id: "new", title: "新线", updated_at: "2026-06-01T00:00:00Z" }),
      ],
      10000,
      null,
      "zh",
    );
    expect(text.indexOf("新线")).toBeLessThan(text.indexOf("旧线"));
  });

  it("falls back to description when state empty; bare title when both empty", () => {
    expect(buildThreadsLayer([T({ state: "", description: "某描述" })], 10000, null, "zh")).toContain(
      "【为父翻案】某描述",
    );
    expect(buildThreadsLayer([T({ state: "", description: "" })], 10000, null, "zh")).toContain("【为父翻案】");
  });

  it("budget truncation drops tail threads", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      T({
        id: `t${i}`,
        title: `剧情线${i}`,
        state: "一段比较长的进展描述用于占用预算".repeat(2),
        updated_at: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      }),
    );
    const tight = buildThreadsLayer(many, 30, null, "zh");
    const all = buildThreadsLayer(many, 100000, null, "zh");
    expect(tight.split("\n").length).toBeLessThan(all.split("\n").length);
  });
});

// ===========================================================================
// assembleContext 门控
// ===========================================================================

describe("assembleContext thread injection (M8-B)", () => {
  let adapter: MockAdapter;
  let chapterRepo: FileChapterRepository;
  const project = () =>
    createProject({
      project_id: "p",
      au_id: "au",
      llm: createLLMConfig({ mode: "api" as never, model: "gpt-4o", context_window: 32000 }),
      chapter_length: 1500,
    });
  const state = () => createState({ au_id: "au", current_chapter: 1 });

  beforeEach(() => {
    adapter = new MockAdapter();
    chapterRepo = new FileChapterRepository(adapter);
  });

  it("threads=[] (explicit) → byte-identical to omitted threads + thread_tokens 0", async () => {
    const omitted = await assembleContext({
      project: project(),
      state: state(),
      user_input: "写",
      facts: [],
      chapter_repo: chapterRepo,
      au_id: "au",
    });
    const empty = await assembleContext({
      project: project(),
      state: state(),
      user_input: "写",
      facts: [],
      chapter_repo: chapterRepo,
      au_id: "au",
      rag_results: null,
      character_files: null,
      worldbuilding_files: null,
      language: "zh",
      threads: [],
    });
    expect(empty.messages[1].content).toBe(omitted.messages[1].content);
    expect(empty.budget_report.thread_tokens).toBe(0);
    // 全 P 层预算逐字节不变（防未来 thread 收集步错用 used 快照偷走 P2/P4/P5 预算）
    expect(empty.budget_report.p2_tokens).toBe(omitted.budget_report.p2_tokens);
    expect(empty.budget_report.p3_tokens).toBe(omitted.budget_report.p3_tokens);
    expect(empty.budget_report.p4_tokens).toBe(omitted.budget_report.p4_tokens);
    expect(empty.budget_report.p5_tokens).toBe(omitted.budget_report.p5_tokens);
  });

  it("active threads → injected into user message + thread_tokens > 0", async () => {
    const r = await assembleContext({
      project: project(),
      state: state(),
      user_input: "写",
      facts: [],
      chapter_repo: chapterRepo,
      au_id: "au",
      rag_results: null,
      character_files: null,
      worldbuilding_files: null,
      language: "zh",
      threads: [T()],
    });
    expect(r.messages[1].content).toContain("为父翻案");
    expect(r.messages[1].content).toContain("准备面圣");
    expect(r.budget_report.thread_tokens).toBeGreaterThan(0);
  });

  it("thread digest precedes the facts (P3) section in the assembled message", async () => {
    const facts = [
      createFact({ id: "f1", content_raw: "r", content_clean: "某条事实内容", status: FactStatus.ACTIVE, chapter: 1 }),
    ];
    const r = await assembleContext({
      project: project(),
      state: state(),
      user_input: "写",
      facts,
      chapter_repo: chapterRepo,
      au_id: "au",
      rag_results: null,
      character_files: null,
      worldbuilding_files: null,
      language: "zh",
      threads: [T()],
    });
    const msg = r.messages[1].content;
    // reversed 注入顺序 P5→P4→P2→thread→P3→P1：剧情线在事实表之前
    expect(msg.indexOf("为父翻案")).toBeLessThan(msg.indexOf("某条事实内容"));
  });
});

// ===========================================================================
// fact.thread_ids / thread_roles 全 6-hop 序列化
// ===========================================================================

describe("M8-B fact.thread_ids serialization across all hops", () => {
  let adapter: MockAdapter;
  let factRepo: FileFactRepository;
  let opsRepo: FileOpsRepository;
  let stateRepo: FileStateRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    factRepo = new FileFactRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);
    stateRepo = new FileStateRepository(adapter);
  });

  it("hop2 (jsonl): factRepo.append → listAll preserves thread_ids/thread_roles", async () => {
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "c",
      thread_ids: ["t1", "t2"],
      thread_roles: { t1: "turning_point" },
    });
    await factRepo.append("au", fact);
    const got = (await factRepo.listAll("au"))[0];
    expect(got.thread_ids).toEqual(["t1", "t2"]);
    expect(got.thread_roles).toEqual({ t1: "turning_point" });
  });

  it("hop3+5 (SERVICE addFact → ops rebuild): the M8-A-class chain", async () => {
    // 服务级 addFact（非手搓 op）——这才会跑 createFact 转发 + 快照 + factFromPayload 整条链
    const created = await addFact(
      "au",
      1,
      {
        content_raw: "r",
        content_clean: "皇帝赐毒",
        thread_ids: ["t_revenge", "t_plot"],
        thread_roles: { t_revenge: "trigger" },
      },
      factRepo,
      opsRepo,
    );
    expect(created.thread_ids).toEqual(["t_revenge", "t_plot"]);

    // 持久化（factToDict/dictToFact）
    const persisted = (await factRepo.listAll("au"))[0];
    expect(persisted.thread_ids).toEqual(["t_revenge", "t_plot"]);
    expect(persisted.thread_roles).toEqual({ t_revenge: "trigger" });

    // ops rebuild（add_fact 快照 → factFromPayload）—— M8-A 的 BLOCKER 正在此处
    const ops = await opsRepo.listAll("au");
    const rebuilt = rebuildFactsFromOps(ops);
    expect(rebuilt[0].thread_ids).toEqual(["t_revenge", "t_plot"]);
    expect(rebuilt[0].thread_roles).toEqual({ t_revenge: "trigger" });
  });

  it("hop4 (SERVICE editFact = setFactThreads → ops rebuild): EDITABLE_FIELDS", async () => {
    const created = await addFact("au", 1, { content_raw: "r", content_clean: "c" }, factRepo, opsRepo);
    // setFactThreads 等价：editFact 改 thread_ids
    await editFact("au", created.id, { thread_ids: ["t9"] }, factRepo, opsRepo, stateRepo);

    // live 应用
    const live = await factRepo.get("au", created.id);
    expect(live?.thread_ids).toEqual(["t9"]);

    // ops rebuild 必须经 EDITABLE_FIELDS 还原（否则 undo/rebuild 丢挂线）
    const ops = await opsRepo.listAll("au");
    const rebuilt = rebuildFactsFromOps(ops).find((f) => f.id === created.id);
    expect(rebuilt?.thread_ids).toEqual(["t9"]);
  });

  it("hop3 (batch_extract_facts shares factFromPayload): thread_ids preserved on rebuild", () => {
    const ops = [
      createOpsEntry({
        op_id: "b1",
        op_type: "batch_extract_facts",
        target_id: "batch",
        chapter_num: 1,
        timestamp: "2026-06-20T00:00:00Z",
        payload: {
          facts: [
            {
              id: "fb1",
              content_clean: "批量事实",
              content_raw: "r",
              chapter: 1,
              status: "active",
              type: "plot_event",
              thread_ids: ["tb"],
              thread_roles: { tb: "side" },
            },
          ],
        },
      }),
    ];
    const rebuilt = rebuildFactsFromOps(ops);
    expect(rebuilt[0].thread_ids).toEqual(["tb"]);
    expect(rebuilt[0].thread_roles).toEqual({ tb: "side" });
  });
});
