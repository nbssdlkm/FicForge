import { describe, expect, it, beforeEach } from "vitest";
import { undo_latest_chapter } from "../../src-engine/services/undo_chapter.js";
import { confirm_chapter } from "../../src-engine/services/confirm_chapter.js";
import { add_fact, update_fact_status } from "../../src-engine/services/facts_lifecycle.js";
import { FactStatus } from "../../src-engine/domain/enums.js";
import { createDraft } from "../../src-engine/domain/draft.js";
import { createState } from "../../src-engine/domain/state.js";
import { MockAdapter } from "../../src-engine/repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../src-engine/repositories/implementations/file_chapter.js";
import { FileDraftRepository } from "../../src-engine/repositories/implementations/file_draft.js";
import { FileStateRepository } from "../../src-engine/repositories/implementations/file_state.js";
import { FileOpsRepository } from "../../src-engine/repositories/implementations/file_ops.js";
import { FileFactRepository } from "../../src-engine/repositories/implementations/file_fact.js";

describe("probe", () => {
  let adapter, chapterRepo, draftRepo, stateRepo, opsRepo, factRepo;
  const cast = { characters: ["Alice"] };
  beforeEach(() => {
    adapter = new MockAdapter();
    chapterRepo = new FileChapterRepository(adapter);
    draftRepo = new FileDraftRepository(adapter);
    stateRepo = new FileStateRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);
    factRepo = new FileFactRepository(adapter);
  });
  async function confirmChapter(num, content) {
    const state = await stateRepo.get("au1");
    state.current_chapter = num;
    await stateRepo.save(state);
    await draftRepo.save(createDraft({ au_id: "au1", chapter_num: num, variant: "A", content }));
    await confirm_chapter({ au_id: "au1", chapter_num: num, draft_id: `ch${String(num).padStart(4,"0")}_draft_A.md`, cast_registry: cast, chapter_repo: chapterRepo, draft_repo: draftRepo, state_repo: stateRepo, ops_repo: opsRepo });
  }
  async function doUndo() {
    return undo_latest_chapter({ au_id: "au1", cast_registry: cast, chapter_repo: chapterRepo, draft_repo: draftRepo, state_repo: stateRepo, ops_repo: opsRepo, fact_repo: factRepo });
  }
  it("dump ops", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    const f1 = await add_fact("au1", 0, { content_raw: "r", content_clean: "背景事实", status: "active", type: "backstory" }, factRepo, opsRepo);
    await confirmChapter(1, "内容。");
    await update_fact_status("au1", f1.id, "deprecated", 1, factRepo, opsRepo, stateRepo);
    await doUndo();
    await confirmChapter(1, "内容2。");
    await doUndo();
    const ops = await opsRepo.list_all("au1");
    for (const op of ops.filter(o => o.op_type === "update_fact_status")) {
      console.log("STATUS_OP", op.chapter_num, "lc=", op.lamport_clock, op.payload.old_status, "->", op.payload.new_status, "reason=", op.payload.reason);
    }
    console.log("FINAL fact status:", (await factRepo.get("au1", f1.id)).status);
  });
});
