// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it } from "vitest";
import { getEngine, initEngine } from "../engine-instance";
import { createAu, createFandom, deleteAu, deleteFandom, getFandomDisplayInfo, listFandoms } from "../engine-fandoms";
import { listTrash, restoreTrash } from "../engine-trash";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";

/** 测试用确定性 embedding provider（种向量用，不走网络）。 */
const fakeEmb = {
  embed: async (texts: string[]) => texts.map((_, i) => [1, 0, 0, i / 10]),
  get_dimension: () => 4,
  get_model_name: () => "fake-embed",
};

describe("engine-fandom deleteFandom", () => {
  const dataDir = "/data";
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
    initEngine(adapter, dataDir);
  });

  it("moves the whole fandom tree to global trash and restores it", async () => {
    const fandom = await createFandom("Naruto");
    const au = await createAu(fandom.name, "Canon", fandom.path);
    adapter.seed(`${fandom.path}/core_worldbuilding/village.md`, "# Konoha");
    adapter.seed(`${au.path}/chapters/main/ch0001.md`, "# Chapter 1");

    const result = await deleteFandom(fandom.dir_name);

    expect(await listFandoms()).toEqual([]);
    expect(adapter.raw(`${fandom.path}/core_worldbuilding/village.md`)).toBeUndefined();
    expect(adapter.raw(`${au.path}/project.yaml`)).toBeUndefined();
    expect(adapter.raw(`${au.path}/chapters/main/ch0001.md`)).toBeUndefined();

    const trashEntries = await listTrash("fandom", `${dataDir}/fandoms`);
    expect(trashEntries).toHaveLength(1);
    expect(trashEntries[0].trash_id).toBe(result.trash_id);
    expect(trashEntries[0].entity_type).toBe("fandom");
    expect(trashEntries[0].metadata.is_directory).toBe(true);

    await restoreTrash("fandom", `${dataDir}/fandoms`, result.trash_id);

    const restored = await listFandoms();
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe("Naruto");
    expect(restored[0].aus).toEqual([{ name: "Canon", dir_name: "Canon", chapter_count: 0, has_dirty: false }]);
    expect(adapter.raw(`${fandom.path}/core_worldbuilding/village.md`)).toBe("# Konoha");
    expect(adapter.raw(`${au.path}/project.yaml`)).toContain("Canon");
    expect(adapter.raw(`${au.path}/chapters/main/ch0001.md`)).toBe("# Chapter 1");
  });

  it("preserves display names while sanitizing directory names to a WebDAV-safe whitelist", async () => {
    const fandom = await createFandom("Detroit: Become Human / RK800?");
    const au = await createAu(fandom.name, "Ch.1 - Prologue: 100%?", fandom.path);
    const displayInfo = await getFandomDisplayInfo(fandom.path);

    const listed = await listFandoms();

    expect(fandom.name).toBe("Detroit: Become Human / RK800?");
    expect(au.name).toBe("Ch.1 - Prologue: 100%?");
    expect(fandom.dir_name).toMatch(/^[\p{L}\p{N}._ -]+$/u);
    expect(au.dir_name).toMatch(/^[\p{L}\p{N}._ -]+$/u);
    expect(fandom.dir_name).not.toMatch(/[\\/:*?"<>|#%]/);
    expect(au.dir_name).not.toMatch(/[\\/:*?"<>|#%]/);
    expect(displayInfo).toEqual({
      name: "Detroit: Become Human / RK800?",
      dir_name: fandom.dir_name,
      path: fandom.path,
    });
    expect(listed).toEqual([
      {
        name: "Detroit: Become Human / RK800?",
        dir_name: fandom.dir_name,
        aus: [{ name: "Ch.1 - Prologue: 100%?", dir_name: au.dir_name, chapter_count: 0, has_dirty: false }],
      },
    ]);
  });

  it("uses display names in fandom trash entries", async () => {
    const fandom = await createFandom("My/Fandom");

    await deleteFandom(fandom.dir_name);

    const trashEntries = await listTrash("fandom", `${dataDir}/fandoms`);
    expect(trashEntries).toHaveLength(1);
    expect(trashEntries[0].entity_name).toBe("My/Fandom");
  });

  it("H9c: deleteFandom unloads any in-memory vector index of AUs under the tree", async () => {
    const fandom = await createFandom("Naruto");
    const au = await createAu(fandom.name, "Canon", fandom.path);
    const e = getEngine();
    await e.ragManager.indexChapter(au.path, 1, "第一章正文。足够长的文本以生成chunk数据用于测试。", fakeEmb);
    expect(e.ragManager.loadedAu).toBe(au.path);

    await deleteFandom(fandom.dir_name);

    expect(e.ragManager.loadedAu).toBeNull();
  });
});

describe("engine-fandom deleteAu 向量卸载（H9c）", () => {
  const dataDir = "/data";
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
    initEngine(adapter, dataDir);
  });

  it("deleteAu 卸载内存向量;同名重建不继承;trash 恢复后从磁盘重载原向量", async () => {
    const fandom = await createFandom("Naruto");
    const au = await createAu(fandom.name, "Canon", fandom.path);
    const e = getEngine();

    await e.ragManager.indexChapter(au.path, 1, "第一章正文。足够长的文本以生成chunk数据用于测试。", fakeEmb);
    expect(e.ragManager.loadedAu).toBe(au.path);
    const seededCount = e.ragManager.chunkCountFor(au.path);
    expect(seededCount).toBeGreaterThan(0);

    const deleted = await deleteAu(fandom.dir_name, au.dir_name);
    // 内存索引已卸载,不残留已删作品的向量
    expect(e.ragManager.loadedAu).toBeNull();

    // 同名重建:ensureLoaded 必须从磁盘 load(空索引),不复用旧内存 chunks
    const recreated = await createAu(fandom.name, "Canon", fandom.path);
    expect(recreated.path).toBe(au.path);
    await e.ragManager.ensureLoaded(recreated.path);
    expect(e.ragManager.chunkCountFor(au.path)).toBe(0);

    // 对称性:删掉重建的占位 AU 后恢复原 AU → 首次 ensureLoaded 从磁盘载回原 chunks
    await deleteAu(fandom.dir_name, recreated.dir_name);
    await restoreTrash("au", fandom.path, deleted.trash_id);
    await e.ragManager.ensureLoaded(au.path);
    expect(e.ragManager.chunkCountFor(au.path)).toBe(seededCount);
  });
});
