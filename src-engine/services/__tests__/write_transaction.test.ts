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
    expect((error as PartialCommitError).completed).toEqual(["ops", "state"]);
    expect((error as PartialCommitError).failed).toEqual(["chapters"]);
    expect((error as PartialCommitError).message).toContain("chapter content may be missing on disk");
    expect((error as PartialCommitError).message).toContain("rebuildFromOps cannot restore chapter bodies");

    const ops = await opsRepo.list_all("au1");
    expect(ops).toHaveLength(1);
    expect(await chapterRepo.exists("au1", 1)).toBe(false);
    expect((await stateRepo.get("au1")).current_chapter).toBe(2);
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
