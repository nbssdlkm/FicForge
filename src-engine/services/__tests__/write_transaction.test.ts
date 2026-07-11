// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it } from "vitest";
import { createChapter } from "../../domain/chapter.js";
import { createOpsEntry } from "../../domain/ops_entry.js";
import { createState } from "../../domain/state.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import {
  PARTIAL_COMMIT_CHAPTER_MISSING,
  PARTIAL_COMMIT_OPS_ONLY,
  PartialCommitError,
  WriteTransaction,
} from "../write_transaction.js";

function normalizePath(path: string): string {
  return path.replace(/\/+/g, "/").replace(/\/$/, "");
}

class FailingWriteAdapter extends MockAdapter {
  private blockedWrites = new Set<string>();

  blockWrite(path: string): void {
    this.blockedWrites.add(normalizePath(path));
  }

  override async writeFile(path: string, content: string): Promise<void> {
    if (this.blockedWrites.has(normalizePath(path))) {
      throw new Error(`Injected write failure: ${path}`);
    }
    await super.writeFile(path, content);
  }

  // atomicWrite（审计 H5）后正式路径的落盘经 rename 提交 —— 注入点需同时拦
  // rename 目标路径，保持「对该路径的任何写入都失败」的模拟语义。
  override async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.blockedWrites.has(normalizePath(newPath))) {
      throw new Error(`Injected write failure: ${newPath}`);
    }
    await super.rename(oldPath, newPath);
  }
}

describe("WriteTransaction partial commit errors", () => {
  let adapter: FailingWriteAdapter;
  let chapterRepo: FileChapterRepository;
  let opsRepo: FileOpsRepository;
  let stateRepo: FileStateRepository;

  beforeEach(async () => {
    adapter = new FailingWriteAdapter();
    chapterRepo = new FileChapterRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);
    stateRepo = new FileStateRepository(adapter);

    await stateRepo.save(createState({ au_id: "au1", current_chapter: 1 }));
  });

  it("reports chapter-missing partial commits when ops succeed but chapter write fails", async () => {
    const tx = new WriteTransaction();
    tx.appendOp("au1", createOpsEntry({
      op_id: "op_1",
      op_type: "confirm_chapter",
      target_id: "chapter-1",
      chapter_num: 1,
      timestamp: "2026-04-20T00:00:00Z",
      payload: { title: "Chapter 1" },
    }));
    tx.saveChapter("au1", createChapter({
      au_id: "au1",
      chapter_num: 1,
      content: "confirmed chapter body",
      chapter_id: "chapter-1",
      confirmed_at: "2026-04-20T00:00:00Z",
      content_hash: "hash-1",
      provenance: "ai",
    }));
    tx.setState(createState({ au_id: "au1", current_chapter: 2 }));

    adapter.blockWrite("au1/chapters/main/ch0001.md");

    const error = await tx.commit(opsRepo, null, stateRepo, chapterRepo, null)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(PartialCommitError);
    expect((error as PartialCommitError).errorCode).toBe(PARTIAL_COMMIT_CHAPTER_MISSING);
    expect((error as PartialCommitError).completed).toEqual(["ops"]);
    expect((error as PartialCommitError).failed).toEqual(["chapters"]);
    expect((error as PartialCommitError).skipped).toEqual(["state"]);
    expect((error as PartialCommitError).message).toContain("chapter content may be missing on disk");
    expect((error as PartialCommitError).message).toContain("rebuildFromOps cannot restore chapter bodies");

    const ops = await opsRepo.list_all("au1");
    expect(ops).toHaveLength(1);
    expect(await chapterRepo.exists("au1", 1)).toBe(false);
    // 门控语义（盲审 R3 HIGH-1）：chapters 失败 → state 不推进，指针不越过缺失章
    expect((await stateRepo.get("au1")).current_chapter).toBe(1);
  });

  it("reports ops-only partial commits when later projection writes fail", async () => {
    const tx = new WriteTransaction();
    tx.appendOp("au1", createOpsEntry({
      op_id: "op_2",
      op_type: "confirm_chapter",
      target_id: "chapter-2",
      chapter_num: 2,
      timestamp: "2026-04-20T00:00:01Z",
      payload: { title: "Chapter 2" },
    }));
    tx.saveChapter("au1", createChapter({
      au_id: "au1",
      chapter_num: 2,
      content: "second confirmed chapter body",
      chapter_id: "chapter-2",
      confirmed_at: "2026-04-20T00:00:01Z",
      content_hash: "hash-2",
      provenance: "ai",
    }));
    tx.setState(createState({ au_id: "au1", current_chapter: 3 }));

    adapter.blockWrite("au1/state.yaml");

    const error = await tx.commit(opsRepo, null, stateRepo, chapterRepo, null)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(PartialCommitError);
    expect((error as PartialCommitError).errorCode).toBe(PARTIAL_COMMIT_OPS_ONLY);
    expect((error as PartialCommitError).completed).toEqual(["ops", "chapters"]);
    expect((error as PartialCommitError).failed).toEqual(["state"]);
    expect((error as PartialCommitError).message).toContain("Ops were committed and still describe the canonical state/facts projection");

    const ops = await opsRepo.list_all("au1");
    expect(ops).toHaveLength(1);
    expect(await chapterRepo.exists("au1", 2)).toBe(true);
    expect((await stateRepo.get("au1")).current_chapter).toBe(1);
  });
});

describe("WriteTransaction 写序与 facts/drafts 失败分支（盲审 2026-07-11 测试维）", () => {
  let adapter: FailingWriteAdapter;
  let chapterRepo: FileChapterRepository;
  let opsRepo: FileOpsRepository;
  let stateRepo: FileStateRepository;

  beforeEach(async () => {
    adapter = new FailingWriteAdapter();
    chapterRepo = new FileChapterRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);
    stateRepo = new FileStateRepository(adapter);
    await stateRepo.save(createState({ au_id: "au1", current_chapter: 1 }));
  });

  function stageAll(tx: WriteTransaction) {
    // 每阶段 ≥2 条写（state 除外，单值）—— 才能断言「阶段内全部写先于下阶段任何写」
    // 而不只是单条样本的阶段间顺序（B5/B6 对抗审 NIT）。
    tx.appendOp("au1", createOpsEntry({ op_id: "op1", op_type: "confirm_chapter", chapter_num: 1, timestamp: "t" }));
    tx.appendOp("au1", createOpsEntry({ op_id: "op2", op_type: "confirm_chapter", chapter_num: 2, timestamp: "t2" }));
    tx.saveChapter("au1", createChapter({ au_id: "au1", chapter_num: 1, content: "正文" }));
    tx.saveChapter("au1", createChapter({ au_id: "au1", chapter_num: 2, content: "正文二" }));
    tx.appendFact("au1", { fact_id: "f1", au_id: "au1", chapter: 1, content_clean: "线索", status: "active", revision: 0 } as never);
    tx.appendFact("au1", { fact_id: "f2", au_id: "au1", chapter: 2, content_clean: "线索二", status: "active", revision: 0 } as never);
    tx.deleteDraftByChapter("au1", 1);
    tx.deleteDraftByChapter("au1", 2);
    tx.setState(createState({ au_id: "au1", current_chapter: 2 }));
  }

  it("落盘顺序恒为 ops → chapters → facts → drafts → state（D-0036：ops 先行）", async () => {
    const order: string[] = [];
    const rec = (stage: string, obj: Record<string, unknown>, methods: string[]) => {
      const out: Record<string, unknown> = Object.create(obj);
      for (const m of methods) {
        out[m] = async (...a: unknown[]) => {
          order.push(stage);
          return (obj[m] as (...x: unknown[]) => unknown).apply(obj, a);
        };
      }
      return out;
    };
    const ops = rec("ops", opsRepo as never, ["append"]);
    const chapters = rec("chapters", chapterRepo as never, ["save", "delete"]);
    const facts = rec("facts", { append: async () => {}, update: async () => {}, delete_by_ids: async () => {} }, ["append", "update", "delete_by_ids"]);
    const drafts = rec("drafts", { delete_by_chapter: async () => {}, delete_from_chapter: async () => {} }, ["delete_by_chapter", "delete_from_chapter"]);
    const state = rec("state", stateRepo as never, ["save"]);

    const tx = new WriteTransaction();
    stageAll(tx);
    await tx.commit(ops as never, facts as never, state as never, chapters as never, drafts as never);

    // 每个阶段的**全部**写必须先于下一阶段的**任何**写 —— ops 作为审计源必须最先落盘
    expect(order).toEqual(["ops", "ops", "chapters", "chapters", "facts", "facts", "drafts", "drafts", "state"]);
  });

  it("facts 写失败：ops/chapters 已落，state 仍尝试写入，抛 PartialCommitError 且 failed 含 facts", async () => {
    const failingFacts = {
      append: async () => { throw new Error("facts io down"); },
      update: async () => {},
      delete_by_ids: async () => {},
    };
    const drafts = { delete_by_chapter: async () => {}, delete_from_chapter: async () => {} };

    const tx = new WriteTransaction();
    stageAll(tx);
    let caught: unknown;
    try {
      await tx.commit(opsRepo, failingFacts as never, stateRepo, chapterRepo, drafts as never);
    } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(PartialCommitError);
    const err = caught as PartialCommitError;
    expect(err.failed).toContain("facts");
    expect(err.completed).toEqual(expect.arrayContaining(["ops", "chapters", "state"]));
    // 记账语义：单阶段失败不连坐后续阶段 —— state 已推进
    const st = await stateRepo.get("au1");
    expect(st.current_chapter).toBe(2);
  });

  it("chapters 写失败：drafts 与 state 被门控跳过，facts 不连坐（盲审 R3 HIGH-1）", async () => {
    const facts = { append: async () => {}, update: async () => {}, delete_by_ids: async () => {} };
    let draftDeleteCalls = 0;
    const drafts = {
      delete_by_chapter: async () => { draftDeleteCalls += 1; },
      delete_from_chapter: async () => { draftDeleteCalls += 1; },
    };

    adapter.blockWrite("au1/chapters/main/ch0001.md");

    const tx = new WriteTransaction();
    stageAll(tx);
    let caught: unknown;
    try {
      await tx.commit(opsRepo, facts as never, stateRepo, chapterRepo, drafts as never);
    } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(PartialCommitError);
    const err = caught as PartialCommitError;
    expect(err.errorCode).toBe(PARTIAL_COMMIT_CHAPTER_MISSING);
    expect(err.failed).toEqual(["chapters"]);
    expect(err.skipped).toEqual(["drafts", "state"]);
    // 草稿删除一次都不能执行 —— 章节未确证落盘前草稿是唯一可恢复源
    expect(draftDeleteCalls).toBe(0);
    // state 不推进：指针不得越过缺失章
    expect((await stateRepo.get("au1")).current_chapter).toBe(1);
    // facts 是 ops-backed 投影，不被 chapters 失败连坐
    expect(err.completed).toEqual(expect.arrayContaining(["ops", "facts"]));
  });

  it("drafts 清理失败：failed 含 drafts，其余阶段照常完成", async () => {
    const facts = { append: async () => {}, update: async () => {}, delete_by_ids: async () => {} };
    const failingDrafts = {
      delete_by_chapter: async () => { throw new Error("drafts io down"); },
      delete_from_chapter: async () => {},
    };

    const tx = new WriteTransaction();
    stageAll(tx);
    let caught: unknown;
    try {
      await tx.commit(opsRepo, facts as never, stateRepo, chapterRepo, failingDrafts as never);
    } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(PartialCommitError);
    const err = caught as PartialCommitError;
    expect(err.failed).toEqual(["drafts"]);
    expect(err.completed).toEqual(expect.arrayContaining(["ops", "chapters", "facts", "state"]));
  });
});
