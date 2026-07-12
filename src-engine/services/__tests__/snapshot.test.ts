// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * checkAndSnapshot 的 watermark 增量归档（盲审 2026-07-11 测试维：模块休眠零覆盖，
 * M6 接线后 watermark 数学一处 off-by-one 就会静默重复/漏归档 ops）。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { checkAndSnapshot, type Snapshot } from "../snapshot.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";
import { createOpsEntry } from "../../domain/ops_entry.js";
import { createState } from "../../domain/state.js";

const AU = "fandoms/F/aus/A";

describe("checkAndSnapshot — watermark 增量归档", () => {
  let adapter: MockAdapter;
  let opsRepo: FileOpsRepository;
  let stateRepo: FileStateRepository;
  let factRepo: FileFactRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    opsRepo = new FileOpsRepository(adapter);
    stateRepo = new FileStateRepository(adapter);
    factRepo = new FileFactRepository(adapter);
  });

  async function seed(currentChapter: number, opsCount: number) {
    await stateRepo.save(createState({ au_id: AU, current_chapter: currentChapter }));
    for (let i = 0; i < opsCount; i++) {
      await opsRepo.append(
        AU,
        createOpsEntry({
          op_id: `op${i}`,
          op_type: "confirm_chapter",
          chapter_num: i + 1,
          timestamp: `t${i}`,
        }),
      );
    }
  }

  function archiveLines(): string[] {
    const raw = adapter.raw(`${AU}/ops_archive.jsonl`);
    return raw ? raw.trim().split("\n") : [];
  }

  it("非 50 倍数章不触发", async () => {
    await seed(49, 10);
    expect(await checkAndSnapshot(AU, adapter, opsRepo, stateRepo, factRepo)).toBe(false);
    expect(adapter.raw(`${AU}/snapshots/snapshot_49.json`)).toBeUndefined();
  });

  it("第 50 章：建快照 + 全量归档，watermark = 当时 ops 总数", async () => {
    await seed(50, 7);
    expect(await checkAndSnapshot(AU, adapter, opsRepo, stateRepo, factRepo)).toBe(true);
    const snap = JSON.parse(adapter.raw(`${AU}/snapshots/snapshot_50.json`)!) as Snapshot;
    expect(snap.chapter).toBe(50);
    expect(snap.archivedOpsCount).toBe(7);
    expect(archiveLines()).toHaveLength(7);
    // ops.jsonl 不清空（watermark 策略：崩溃不丢数据）
    expect((await opsRepo.list_all(AU)).length).toBe(7);
  });

  it("同章幂等：已有快照则跳过、归档不重复追加", async () => {
    await seed(50, 7);
    await checkAndSnapshot(AU, adapter, opsRepo, stateRepo, factRepo);
    expect(await checkAndSnapshot(AU, adapter, opsRepo, stateRepo, factRepo)).toBe(false);
    expect(archiveLines()).toHaveLength(7);
  });

  it("第 100 章：只归档上一 watermark 之后的增量（无重复无遗漏）", async () => {
    await seed(50, 7);
    await checkAndSnapshot(AU, adapter, opsRepo, stateRepo, factRepo);

    // 50→100 章间又追加 5 条 ops
    for (let i = 7; i < 12; i++) {
      await opsRepo.append(
        AU,
        createOpsEntry({
          op_id: `op${i}`,
          op_type: "confirm_chapter",
          chapter_num: i + 1,
          timestamp: `t${i}`,
        }),
      );
    }
    await stateRepo.save(createState({ au_id: AU, current_chapter: 100 }));
    expect(await checkAndSnapshot(AU, adapter, opsRepo, stateRepo, factRepo)).toBe(true);

    const lines = archiveLines();
    expect(lines).toHaveLength(12); // 7（首轮）+ 5（增量）—— off-by-one 会是 11 或 13
    const ids = lines.map((l) => (JSON.parse(l) as { op_id: string }).op_id);
    expect(new Set(ids).size).toBe(12); // 无重复归档
    const snap100 = JSON.parse(adapter.raw(`${AU}/snapshots/snapshot_100.json`)!) as Snapshot;
    expect(snap100.archivedOpsCount).toBe(12);
  });

  it("上一快照损坏：回退全量归档（可重复但不丢）", async () => {
    await seed(50, 3);
    await checkAndSnapshot(AU, adapter, opsRepo, stateRepo, factRepo);
    await adapter.writeFile(`${AU}/snapshots/snapshot_50.json`, "{corrupted");

    await stateRepo.save(createState({ au_id: AU, current_chapter: 100 }));
    await checkAndSnapshot(AU, adapter, opsRepo, stateRepo, factRepo);
    // 3（首轮）+ 3（回退全量重归档）：宁可重复不可丢失
    expect(archiveLines()).toHaveLength(6);
  });
});
