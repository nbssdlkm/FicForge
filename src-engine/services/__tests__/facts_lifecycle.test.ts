// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { addFact, editFact, updateFactStatus, setChapterFocus, FactsLifecycleError } from "../facts_lifecycle.js";
import { FactStatus, TimeKind, SuspenseType } from "../../domain/enums.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";

describe("Facts Lifecycle", () => {
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

  it("addFact appends and returns fact", async () => {
    const fact = await addFact(
      "au1",
      1,
      {
        content_raw: "Alice met Bob",
        content_clean: "Alice met Bob",
        characters: ["Alice", "Bob"],
        status: "active",
        type: "plot_event",
      },
      factRepo,
      opsRepo,
    );

    expect(fact.id).toMatch(/^f_/);
    expect(fact.content_clean).toBe("Alice met Bob");
    expect(fact.characters).toEqual(["Alice", "Bob"]);

    const all = await factRepo.listAll("au1");
    expect(all).toHaveLength(1);

    const ops = await opsRepo.listAll("au1");
    expect(ops).toHaveLength(1);
    expect(ops[0].op_type).toBe("add_fact");
  });

  it("add_fact with alias normalization", async () => {
    const fact = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
        characters: ["小明", "Bob"],
      },
      factRepo,
      opsRepo,
      "manual",
      { 明华: ["小明"] },
    );

    expect(fact.characters).toEqual(["明华", "Bob"]);
  });

  it("addFact triggers resolves forward cascade", async () => {
    const f1 = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "unresolved thing",
        status: "unresolved",
      },
      factRepo,
      opsRepo,
    );

    await addFact(
      "au1",
      2,
      {
        content_raw: "r",
        content_clean: "resolves the thing",
        status: "active",
        resolves: f1.id,
      },
      factRepo,
      opsRepo,
    );

    const updated = await factRepo.get("au1", f1.id);
    expect(updated!.status).toBe(FactStatus.RESOLVED);
  });

  it("editFact removes resolves → reverse cascade", async () => {
    const f1 = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "mystery",
        status: "unresolved",
      },
      factRepo,
      opsRepo,
    );

    const f2 = await addFact(
      "au1",
      2,
      {
        content_raw: "r",
        content_clean: "answer",
        resolves: f1.id,
      },
      factRepo,
      opsRepo,
    );

    // f1 should be RESOLVED now
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.RESOLVED);

    // Remove resolves
    await editFact("au1", f2.id, { resolves: null }, factRepo, opsRepo, stateRepo);

    // f1 should revert to UNRESOLVED
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.UNRESOLVED);
  });

  it("editFact 拒绝非法枚举值（防静默写坏 status 让 fact 从所有筛选视图消失）", async () => {
    const f = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "原内容",
        status: "active",
      },
      factRepo,
      opsRepo,
    );

    // status:"resloved"（拼错）非法 + content_clean 合法：旧代码 `v as FactStatus` 会把 "resloved"
    // 直接写进 facts.jsonl，fact 从此从 listByStatus / 上下文组装里消失。新代码拒绝非法枚举、保留原值。
    await editFact("au1", f.id, { status: "resloved", content_clean: "改后内容" }, factRepo, opsRepo, stateRepo);

    const got = await factRepo.get("au1", f.id);
    expect(got!.status).toBe(FactStatus.ACTIVE); // 非法 status 被拒，保留原合法值
    expect(got!.content_clean).toBe("改后内容"); // 合法字段照常生效

    // op 只记实际生效字段，不把垃圾 status 写进 ops.jsonl（rebuild 时不会重新引入）
    const ops = await opsRepo.listAll("au1");
    const editOp = ops.find((o) => o.op_type === "edit_fact")!;
    const uf = editOp.payload.updated_fields as Record<string, unknown>;
    expect(uf.status).toBeUndefined();
    expect(uf.content_clean).toBe("改后内容");
  });

  it("editFact keeps RESOLVED if other fact still resolves", async () => {
    const f1 = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "mystery",
        status: "unresolved",
      },
      factRepo,
      opsRepo,
    );

    const f2 = await addFact(
      "au1",
      2,
      {
        content_raw: "r",
        content_clean: "partial answer",
        resolves: f1.id,
      },
      factRepo,
      opsRepo,
    );

    await addFact(
      "au1",
      3,
      {
        content_raw: "r",
        content_clean: "another answer",
        resolves: f1.id,
      },
      factRepo,
      opsRepo,
    );

    // Remove resolves from f2 only
    await editFact("au1", f2.id, { resolves: null }, factRepo, opsRepo, stateRepo);

    // f1 should stay RESOLVED (f3 still resolves it)
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.RESOLVED);
  });

  it("editFact throws on missing fact", async () => {
    await expect(editFact("au1", "nonexistent", {}, factRepo, opsRepo, stateRepo)).rejects.toThrow(FactsLifecycleError);
  });

  it("updateFactStatus changes status and cleans focus", async () => {
    const f1 = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
        status: "unresolved",
      },
      factRepo,
      opsRepo,
    );

    // Set as focus
    await setChapterFocus("au1", [f1.id], factRepo, opsRepo, stateRepo);

    // Deprecate
    const result = await updateFactStatus("au1", f1.id, "deprecated", 1, factRepo, opsRepo, stateRepo);
    expect(result.focus_warning).toBe(true);

    // Focus should be empty now
    const state = await stateRepo.get("au1");
    expect(state.chapter_focus).toEqual([]);
  });

  // TD-014: 作废一个 resolver → 若没有别的 fact 仍 resolve 其目标，目标退回 UNRESOLVED。
  // 此前 deprecate 路径漏了反向级联（揭示者作废但伏笔仍挂 RESOLVED → LLM 上下文脱节）。
  it("updateFactStatus deprecate resolver → target reverts to UNRESOLVED (TD-014)", async () => {
    const f1 = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "mystery",
        status: "unresolved",
      },
      factRepo,
      opsRepo,
    );
    const f2 = await addFact(
      "au1",
      2,
      {
        content_raw: "r",
        content_clean: "answer",
        resolves: f1.id,
      },
      factRepo,
      opsRepo,
    );
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.RESOLVED);

    // 作废揭示者 f2
    await updateFactStatus("au1", f2.id, "deprecated", 2, factRepo, opsRepo, stateRepo);

    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.UNRESOLVED);
  });

  it("updateFactStatus deprecate resolver but another resolver remains → target stays RESOLVED (TD-014)", async () => {
    const f1 = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "mystery",
        status: "unresolved",
      },
      factRepo,
      opsRepo,
    );
    const f2 = await addFact(
      "au1",
      2,
      {
        content_raw: "r",
        content_clean: "partial answer",
        resolves: f1.id,
      },
      factRepo,
      opsRepo,
    );
    await addFact(
      "au1",
      3,
      {
        content_raw: "r",
        content_clean: "another answer",
        resolves: f1.id,
      },
      factRepo,
      opsRepo,
    );

    // 只作废 f2；f3 仍 resolve f1
    await updateFactStatus("au1", f2.id, "deprecated", 2, factRepo, opsRepo, stateRepo);

    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.RESOLVED);
  });

  it("updateFactStatus deprecate resolver whose target isn't RESOLVED → no-op (TD-014)", async () => {
    // target 当前不是 RESOLVED（手动维持 unresolved）→ 反向级联应 no-op，不冒出多余 op
    const f1 = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "mystery",
        status: "unresolved",
      },
      factRepo,
      opsRepo,
    );
    const f2 = await addFact(
      "au1",
      2,
      {
        content_raw: "r",
        content_clean: "answer",
        resolves: f1.id,
      },
      factRepo,
      opsRepo,
    );
    // 强制 f1 回到 unresolved（模拟 target 不在 RESOLVED 态）
    await updateFactStatus("au1", f1.id, "unresolved", 1, factRepo, opsRepo, stateRepo);
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.UNRESOLVED);
    const opsBefore = (await opsRepo.listAll("au1")).length;

    await updateFactStatus("au1", f2.id, "deprecated", 2, factRepo, opsRepo, stateRepo);

    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.UNRESOLVED);
    // 只多了 f2 自己的 deprecate op，没有反向级联 op
    expect((await opsRepo.listAll("au1")).length).toBe(opsBefore + 1);
  });

  it("updateFactStatus re-deprecate is idempotent → target stays UNRESOLVED, no double-revert (TD-014)", async () => {
    const f1 = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "mystery",
        status: "unresolved",
      },
      factRepo,
      opsRepo,
    );
    const f2 = await addFact(
      "au1",
      2,
      {
        content_raw: "r",
        content_clean: "answer",
        resolves: f1.id,
      },
      factRepo,
      opsRepo,
    );

    await updateFactStatus("au1", f2.id, "deprecated", 2, factRepo, opsRepo, stateRepo);
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.UNRESOLVED);

    // 再次作废已作废的 f2 → f1 已是 UNRESOLVED（collectResolvesReverse 仅当 target RESOLVED 才动）→ 不变
    await updateFactStatus("au1", f2.id, "deprecated", 2, factRepo, opsRepo, stateRepo);
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.UNRESOLVED);
  });

  it("setChapterFocus validates max 2", async () => {
    const f1 = await addFact(
      "au1",
      1,
      { content_raw: "r", content_clean: "c", status: "unresolved" },
      factRepo,
      opsRepo,
    );
    const f2 = await addFact(
      "au1",
      1,
      { content_raw: "r", content_clean: "c", status: "unresolved" },
      factRepo,
      opsRepo,
    );
    const f3 = await addFact(
      "au1",
      1,
      { content_raw: "r", content_clean: "c", status: "unresolved" },
      factRepo,
      opsRepo,
    );

    await expect(setChapterFocus("au1", [f1.id, f2.id, f3.id], factRepo, opsRepo, stateRepo)).rejects.toThrow(
      "最多 2 个",
    );
  });

  it("setChapterFocus validates unresolved only", async () => {
    const f1 = await addFact("au1", 1, { content_raw: "r", content_clean: "c", status: "active" }, factRepo, opsRepo);

    await expect(setChapterFocus("au1", [f1.id], factRepo, opsRepo, stateRepo)).rejects.toThrow("只能选 unresolved");
  });

  // ----------------------------------------------------------
  // M8-A BLOCKER: addFact forwards all M8-A fields to createFact
  // ----------------------------------------------------------

  it("addFact forwards M8-A layer-2 fields to the persisted fact", async () => {
    const fact = await addFact(
      "au1",
      3,
      {
        content_raw: "r",
        content_clean: "Alice 在御书房中决裂",
        characters: ["Alice"],
        status: "active",
        // Layer 2
        location: "御书房",
        story_time_tag: "Y1 冬末",
        story_time_order: 42,
        time_kind: TimeKind.FLASHBACK,
        action_verb: "决裂",
        caused_by: ["f_prev_001"],
      },
      factRepo,
      opsRepo,
    );

    // Returned fact must have M8-A fields
    expect(fact.location).toBe("御书房");
    expect(fact.story_time_tag).toBe("Y1 冬末");
    expect(fact.story_time_order).toBe(42);
    expect(fact.time_kind).toBe(TimeKind.FLASHBACK);
    expect(fact.action_verb).toBe("决裂");
    expect(fact.caused_by).toEqual(["f_prev_001"]);

    // Persisted fact (round-trip via repo) must also have them
    const stored = await factRepo.get("au1", fact.id);
    expect(stored!.location).toBe("御书房");
    expect(stored!.story_time_tag).toBe("Y1 冬末");
    expect(stored!.story_time_order).toBe(42);
    expect(stored!.time_kind).toBe(TimeKind.FLASHBACK);
    expect(stored!.action_verb).toBe("决裂");
    expect(stored!.caused_by).toEqual(["f_prev_001"]);

    // ops payload must carry the fields too (ops rebuild parity)
    const ops = await opsRepo.listAll("au1");
    const addOp = ops.find((o) => o.op_type === "add_fact");
    expect(addOp).toBeDefined();
    expect(addOp!.payload.fact.location).toBe("御书房");
    expect(addOp!.payload.fact.time_kind).toBe(TimeKind.FLASHBACK);
  });

  it("addFact forwards M8-A layer-3 fields to the persisted fact", async () => {
    const fact = await addFact(
      "au1",
      2,
      {
        content_raw: "r",
        content_clean: "Bob 知道秘密",
        status: "unresolved",
        // Layer 3
        known_to: ["Bob"],
        hidden_from: ["Alice"],
        suspense_type: SuspenseType.SECRET,
      },
      factRepo,
      opsRepo,
    );

    expect(fact.known_to).toEqual(["Bob"]);
    expect(fact.hidden_from).toEqual(["Alice"]);
    expect(fact.suspense_type).toBe(SuspenseType.SECRET);

    const stored = await factRepo.get("au1", fact.id);
    expect(stored!.known_to).toEqual(["Bob"]);
    expect(stored!.hidden_from).toEqual(["Alice"]);
    expect(stored!.suspense_type).toBe(SuspenseType.SECRET);
  });

  it("addFact: illegal time_kind falls to null (not stored as garbage)", async () => {
    const fact = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
        time_kind: "teleport", // illegal
      },
      factRepo,
      opsRepo,
    );

    expect(fact.time_kind).toBeNull();
    const stored = await factRepo.get("au1", fact.id);
    expect(stored!.time_kind).toBeNull();
  });

  it("addFact: illegal suspense_type falls to null", async () => {
    const fact = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
        suspense_type: "cliffhanger_typo", // illegal
      },
      factRepo,
      opsRepo,
    );

    expect(fact.suspense_type).toBeNull();
  });

  it("addFact: known_to string value 'all' is preserved", async () => {
    const fact = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
        known_to: "all",
      },
      factRepo,
      opsRepo,
    );

    expect(fact.known_to).toBe("all");
    const stored = await factRepo.get("au1", fact.id);
    expect(stored!.known_to).toBe("all");
  });

  it("addFact: known_to array filters non-strings and normalizes aliases", async () => {
    const fact = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
        known_to: ["小明", 42, "Bob"] as unknown as string[], // 42 must be filtered
      },
      factRepo,
      opsRepo,
      "manual",
      { 明华: ["小明"] },
    );

    // 42 filtered, 小明 normalized to 明华
    expect(Array.isArray(fact.known_to)).toBe(true);
    expect(fact.known_to).toContain("明华");
    expect(fact.known_to).toContain("Bob");
    expect((fact.known_to as string[]).some((v) => typeof v !== "string")).toBe(false);
  });

  it("addFact: _confidence is forwarded to the fact", async () => {
    const confidence = { location: "high" as const, time_kind: "medium" as const };
    const fact = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
        location: "花园",
        _confidence: confidence,
      },
      factRepo,
      opsRepo,
    );

    expect(fact._confidence).toEqual(confidence);
    const stored = await factRepo.get("au1", fact.id);
    expect(stored!._confidence).toEqual(confidence);
  });
});

// ===========================================================================
// M3 批一：知情字段消毒（单一真相源）+ 人改升 high + 空编辑早退 + 回放对称
// ===========================================================================

describe("Facts Lifecycle — M3 批一：editFact 知情字段硬化", () => {
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

  it("known_to 非法形状（数字）→ 拒绝保留原值；合法数组 → trim/去重/过滤后生效", async () => {
    const f = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
        known_to: ["王妃"],
      },
      factRepo,
      opsRepo,
    );

    await editFact("au1", f.id, { known_to: 42 }, factRepo, opsRepo, stateRepo);
    expect((await factRepo.get("au1", f.id))!.known_to).toEqual(["王妃"]); // 垃圾被拒

    await editFact("au1", f.id, { known_to: [" 稳婆 ", "", 7, "稳婆"] }, factRepo, opsRepo, stateRepo);
    expect((await factRepo.get("au1", f.id))!.known_to).toEqual(["稳婆"]); // 消毒后生效
  });

  it("known_to 空数组折叠为 null（消除 []/null 双重「无信息」表示）；裸字符串折叠单人名单", async () => {
    const f = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
        known_to: ["王妃"],
      },
      factRepo,
      opsRepo,
    );

    await editFact("au1", f.id, { known_to: [] }, factRepo, opsRepo, stateRepo);
    expect((await factRepo.get("au1", f.id))!.known_to).toBeNull();

    await editFact("au1", f.id, { known_to: "皇帝" }, factRepo, opsRepo, stateRepo);
    expect((await factRepo.get("au1", f.id))!.known_to).toEqual(["皇帝"]);
  });

  it("hidden_from 非数组 → 拒绝；数组 → 过滤非字符串 + trim；null → 清空为 []", async () => {
    const f = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
        hidden_from: ["王爷"],
      },
      factRepo,
      opsRepo,
    );

    await editFact("au1", f.id, { hidden_from: "abc" }, factRepo, opsRepo, stateRepo);
    expect((await factRepo.get("au1", f.id))!.hidden_from).toEqual(["王爷"]); // 非数组拒绝

    await editFact("au1", f.id, { hidden_from: [1, " 太后 ", ""] }, factRepo, opsRepo, stateRepo);
    expect((await factRepo.get("au1", f.id))!.hidden_from).toEqual(["太后"]);

    await editFact("au1", f.id, { hidden_from: null }, factRepo, opsRepo, stateRepo);
    expect((await factRepo.get("au1", f.id))!.hidden_from).toEqual([]);
  });

  it("拒绝外部直写 _confidence（引擎自管）；由此产生的空编辑早退：不落 op 不 bump revision", async () => {
    const f = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
      },
      factRepo,
      opsRepo,
    );
    const opsBefore = (await opsRepo.listAll("au1")).length;
    const revBefore = (await factRepo.get("au1", f.id))!.revision;

    const returned = await editFact("au1", f.id, { _confidence: { location: "high" } }, factRepo, opsRepo, stateRepo);

    expect(returned._confidence).toBeUndefined(); // 直写被拒
    expect((await factRepo.get("au1", f.id))!.revision).toBe(revBefore); // revision 不空转
    expect((await opsRepo.listAll("au1")).length).toBe(opsBefore); // 不落空 op
  });

  it("人改升 high：有 _confidence 的 fact 编辑 known_to/hidden_from → 对应键升 high 并入 op；其余键不动", async () => {
    const f = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
        known_to: ["A"],
        hidden_from: ["B"],
        location: "御书房",
        _confidence: { known_to: "low", hidden_from: "medium", location: "low" },
      },
      factRepo,
      opsRepo,
    );

    await editFact("au1", f.id, { known_to: ["甲"], hidden_from: ["乙"] }, factRepo, opsRepo, stateRepo);

    const got = (await factRepo.get("au1", f.id))!;
    expect(got.known_to).toEqual(["甲"]);
    expect(got._confidence!.known_to).toBe("high"); // 人改 → 必然过门控
    expect(got._confidence!.hidden_from).toBe("high");
    expect(got._confidence!.location).toBe("low"); // 未编辑字段不动

    const editOp = (await opsRepo.listAll("au1")).find((o) => o.op_type === "edit_fact")!;
    const uf = editOp.payload.updated_fields as Record<string, unknown>;
    expect((uf._confidence as Record<string, string>).known_to).toBe("high"); // 升级并入同一条 op
  });

  it("无 _confidence 的 fact（手动 ground truth）人改后不凭空造 _confidence", async () => {
    const f = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
        known_to: ["A"],
      },
      factRepo,
      opsRepo,
    );

    await editFact("au1", f.id, { known_to: ["乙"] }, factRepo, opsRepo, stateRepo);
    expect((await factRepo.get("au1", f.id))!._confidence).toBeUndefined();
  });

  it("空编辑早退：全部键被拒时不落 op、不 bump revision、级联不触发", async () => {
    const f = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
        status: "active",
      },
      factRepo,
      opsRepo,
    );
    const opsBefore = (await opsRepo.listAll("au1")).length;
    const revBefore = (await factRepo.get("au1", f.id))!.revision;

    await editFact("au1", f.id, {}, factRepo, opsRepo, stateRepo);
    await editFact("au1", f.id, { status: "resloved", known_to: 42 }, factRepo, opsRepo, stateRepo);

    expect((await factRepo.get("au1", f.id))!.revision).toBe(revBefore);
    expect((await opsRepo.listAll("au1")).length).toBe(opsBefore);
  });

  it("editFact 别名归一化经消毒器统一生效（known_to/hidden_from/characters 同表）", async () => {
    // 两张名单用不同角色 —— 同名同现的矛盾化解另有专测（对抗审 MED-3），此处纯测归一化
    const aliases = { 明华: ["小明"], 泰王: ["小王"] };
    const f = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
      },
      factRepo,
      opsRepo,
      "manual",
      aliases,
    );

    await editFact(
      "au1",
      f.id,
      { known_to: ["小明"], hidden_from: ["小王", "泰王"] },
      factRepo,
      opsRepo,
      stateRepo,
      aliases,
    );

    const got = (await factRepo.get("au1", f.id))!;
    expect(got.known_to).toEqual(["明华"]);
    expect(got.hidden_from).toEqual(["泰王"]); // 别名折主名后去重
  });
});

describe("Facts Lifecycle — M3 批一：ops 回放与写路径消毒对称", () => {
  it("历史垃圾 edit_fact op（写侧校验上线前落盘）回放时同样被挡，不污染重建", async () => {
    const { rebuildFactsFromOps } = await import("../../ops/ops_projection.js");
    const { createOpsEntry } = await import("../../domain/ops_entry.js");

    const ops = [
      createOpsEntry({
        op_id: "op_1",
        op_type: "add_fact",
        target_id: "f_1",
        chapter_num: 1,
        timestamp: "2026-01-01T00:00:00Z",
        payload: {
          fact: {
            id: "f_1",
            content_raw: "r",
            content_clean: "c",
            characters: [],
            chapter: 1,
            status: "active",
            type: "plot_event",
            narrative_weight: "medium",
            source: "manual",
            timeline: "",
            story_time: "",
            resolves: null,
            revision: 1,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            known_to: ["王妃"],
            hidden_from: ["王爷"],
          },
        },
      }),
      // 垃圾形状：写侧新校验会拒绝，但历史 op 可能已带着它们躺在 ops.jsonl 里
      createOpsEntry({
        op_id: "op_2",
        op_type: "edit_fact",
        target_id: "f_1",
        timestamp: "2026-01-01T00:01:00Z",
        payload: { updated_fields: { known_to: 42, hidden_from: "abc", _confidence: "banana" } },
      }),
      // 合法编辑：正常消毒生效
      createOpsEntry({
        op_id: "op_3",
        op_type: "edit_fact",
        target_id: "f_1",
        timestamp: "2026-01-01T00:02:00Z",
        payload: { updated_fields: { hidden_from: [" 太后 ", 3] } },
      }),
    ];

    const rebuilt = rebuildFactsFromOps(ops);
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0].known_to).toEqual(["王妃"]); // 垃圾 op 不生效
    expect(rebuilt[0].hidden_from).toEqual(["太后"]); // 合法 op 消毒后生效
    expect(rebuilt[0]._confidence).toBeUndefined(); // "banana" 被挡
  });
});

describe("Facts Lifecycle — 对抗审整改（codex R1）", () => {
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

  it("MED-2 同值编辑：原样保存不落 op、不涨 revision、不把 low 误升 high", async () => {
    const f = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "原文",
        narrative_weight: "medium",
        known_to: ["王妃"],
        _confidence: { known_to: "low" },
      },
      factRepo,
      opsRepo,
    );
    const opsBefore = (await opsRepo.listAll("au1")).length;
    const revBefore = (await factRepo.get("au1", f.id))!.revision;

    // UI 非受控表单的典型行为：把全部字段原样发回
    await editFact(
      "au1",
      f.id,
      {
        content_clean: "原文",
        content_raw: "r",
        narrative_weight: "medium",
        known_to: ["王妃"],
      },
      factRepo,
      opsRepo,
      stateRepo,
    );

    const got = (await factRepo.get("au1", f.id))!;
    expect(got.revision).toBe(revBefore);
    expect((await opsRepo.listAll("au1")).length).toBe(opsBefore);
    expect(got._confidence!.known_to).toBe("low"); // 未经人工实际修改，不得认证为 high
  });

  it("MED-3 矛盾化解（add 入口）：同名同现两名单 → 瞒着方胜；all+hidden → all 退位 null", async () => {
    const f1 = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c1",
        known_to: ["王爷", "王妃"],
        hidden_from: ["王爷"],
      },
      factRepo,
      opsRepo,
    );
    expect(f1.known_to).toEqual(["王妃"]);
    expect(f1.hidden_from).toEqual(["王爷"]);

    const f2 = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c2",
        known_to: "all",
        hidden_from: ["王爷"],
      },
      factRepo,
      opsRepo,
    );
    expect(f2.known_to).toBeNull();
    expect(f2.hidden_from).toEqual(["王爷"]);

    const f3 = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c3",
        known_to: "reader_only",
        hidden_from: ["王爷"], // 不矛盾：角色全不知，子集强调保留
      },
      factRepo,
      opsRepo,
    );
    expect(f3.known_to).toBe("reader_only");
    expect(f3.hidden_from).toEqual(["王爷"]);
  });

  it("MED-3 矛盾化解（edit 入口）：把已瞒角色加进知情名单 → 写侧化解并入同条 op；未触碰知情字段的编辑不动存量矛盾", async () => {
    const f = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
        known_to: ["王妃"],
        hidden_from: ["王爷"],
      },
      factRepo,
      opsRepo,
    );

    await editFact("au1", f.id, { known_to: ["王妃", "王爷"] }, factRepo, opsRepo, stateRepo);
    const got = (await factRepo.get("au1", f.id))!;
    expect(got.known_to).toEqual(["王妃"]); // 王爷被瞒着 → 从知情名单剔除
    const editOp = (await opsRepo.listAll("au1")).filter((o) => o.op_type === "edit_fact").pop()!;
    expect((editOp.payload.updated_fields as Record<string, unknown>).known_to).toEqual(["王妃"]);
  });

  it("LOW-2 保留字 trim：' all ' / ' reader_only ' 不被误当角色名", async () => {
    const f = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
        known_to: " all ",
      },
      factRepo,
      opsRepo,
    );
    expect(f.known_to).toBe("all");

    await editFact("au1", f.id, { known_to: " reader_only " }, factRepo, opsRepo, stateRepo);
    expect((await factRepo.get("au1", f.id))!.known_to).toBe("reader_only");
  });

  it("HIGH-驳回锁定：add 快照回放的垃圾降级与磁盘读回逐字对齐（rebuild==disk 平价，勿改成更激进的消毒）", async () => {
    const { rebuildFactsFromOps } = await import("../../ops/ops_projection.js");
    const { createOpsEntry } = await import("../../domain/ops_entry.js");

    // 历史垃圾 add 快照（写侧消毒上线前落盘的形态）
    const ops = [
      createOpsEntry({
        op_id: "op_g",
        op_type: "add_fact",
        target_id: "f_g",
        chapter_num: 1,
        timestamp: "2026-01-01T00:00:00Z",
        payload: {
          fact: {
            id: "f_g",
            content_raw: "r",
            content_clean: "c",
            characters: [],
            chapter: 1,
            status: "active",
            type: "plot_event",
            narrative_weight: "medium",
            source: "manual",
            timeline: "",
            story_time: "",
            resolves: null,
            revision: 1,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            known_to: "皇帝", // 裸串：磁盘读回(dictToFact)原样保留 → 回放也保留
            hidden_from: "abc", // 非数组：磁盘读回折 [] → 回放同折 []
            _confidence: "banana", // 非对象：磁盘读回折 undefined → 回放同折
          },
        },
      }),
    ];

    const rebuilt = rebuildFactsFromOps(ops);
    expect(rebuilt[0].known_to).toBe("皇帝"); // 与 dictToFact 同口径：legacy 裸串透传（渲染端兜）
    expect(rebuilt[0].hidden_from).toEqual([]);
    expect(rebuilt[0]._confidence).toBeUndefined();
  });
});
