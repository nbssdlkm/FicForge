// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { TrashService } from "../trash_service.js";
import { recalc_state } from "../recalc_state.js";
import { confirm_chapter } from "../confirm_chapter.js";
import { createState } from "../../domain/state.js";
import { createDraft } from "../../domain/draft.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileDraftRepository } from "../../repositories/implementations/file_draft.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { FileProjectRepository } from "../../repositories/implementations/file_project.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";

/**
 * 可注入故障的 adapter：在指定路径的 writeFile / deleteFile 上抛错，
 * 用于验证 move_to_trash 的半成功回滚（审计①②）。
 */
class FaultyAdapter extends MockAdapter {
  failWrite: (path: string) => boolean = () => false;
  failDelete: (path: string) => boolean = () => false;
  /** 记录所有 deleteFile 调用（含失败的），用于断言「manifest 未落库前不删源」的顺序。 */
  deleteCalls: string[] = [];

  async writeFile(path: string, content: string): Promise<void> {
    if (this.failWrite(path)) throw new Error(`simulated write failure: ${path}`);
    return super.writeFile(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    this.deleteCalls.push(path);
    if (this.failDelete(path)) throw new Error(`simulated delete failure: ${path}`);
    return super.deleteFile(path);
  }
}

// ===========================================================================
// Trash Service
// ===========================================================================

describe("TrashService", () => {
  let adapter: MockAdapter;
  let trash: TrashService;

  beforeEach(() => {
    adapter = new MockAdapter();
    trash = new TrashService(adapter, 30);
  });

  it("move_to_trash and list_trash", async () => {
    adapter.seed("au1/characters/Alice.md", "---\nname: Alice\n---\n# Alice\nSetting");
    const entry = await trash.move_to_trash("au1", "characters/Alice.md", "character_file", "Alice");

    expect(entry.trash_id).toMatch(/^tr_/);
    expect(entry.original_path).toBe("characters/Alice.md");
    expect(entry.entity_type).toBe("character_file");

    // Original gone
    expect(adapter.raw("au1/characters/Alice.md")).toBeUndefined();

    // In trash
    const list = await trash.list_trash("au1");
    expect(list).toHaveLength(1);
    expect(list[0].trash_id).toBe(entry.trash_id);
  });

  it("restore from trash", async () => {
    adapter.seed("au1/characters/Bob.md", "# Bob");
    const entry = await trash.move_to_trash("au1", "characters/Bob.md", "character_file", "Bob");

    await trash.restore("au1", entry.trash_id);

    // Restored
    expect(adapter.raw("au1/characters/Bob.md")).toBe("# Bob");

    // Removed from manifest
    const list = await trash.list_trash("au1");
    expect(list).toHaveLength(0);
  });

  it("move_tree_to_trash restores AU directory entries", async () => {
    adapter.seed("fandom1/aus/AU1/project.yaml", "name: AU1");
    adapter.seed("fandom1/aus/AU1/chapters/main/ch0001.md", "# Chapter 1");

    const entry = await trash.move_tree_to_trash("fandom1", "aus/AU1", "au", "AU1");

    expect(adapter.raw("fandom1/aus/AU1/project.yaml")).toBeUndefined();
    expect(adapter.raw("fandom1/aus/AU1/chapters/main/ch0001.md")).toBeUndefined();

    const list = await trash.list_trash("fandom1");
    expect(list).toHaveLength(1);
    expect(list[0].metadata.is_directory).toBe(true);

    await trash.restore("fandom1", entry.trash_id);

    expect(adapter.raw("fandom1/aus/AU1/project.yaml")).toBe("name: AU1");
    expect(adapter.raw("fandom1/aus/AU1/chapters/main/ch0001.md")).toBe("# Chapter 1");
  });

  it("restore fails if original path exists", async () => {
    adapter.seed("au1/characters/C.md", "original");
    const entry = await trash.move_to_trash("au1", "characters/C.md", "character_file", "C");
    adapter.seed("au1/characters/C.md", "new file occupying the path");

    await expect(trash.restore("au1", entry.trash_id)).rejects.toThrow("原路径已存在");
  });

  it("permanent_delete removes from trash", async () => {
    adapter.seed("au1/test.md", "content");
    const entry = await trash.move_to_trash("au1", "test.md", "character_file", "test");

    await trash.permanent_delete("au1", entry.trash_id);

    const list = await trash.list_trash("au1");
    expect(list).toHaveLength(0);
  });

  it("purge_expired with force all", async () => {
    adapter.seed("au1/a.md", "a");
    adapter.seed("au1/b.md", "b");
    await trash.move_to_trash("au1", "a.md", "file", "a");
    await trash.move_to_trash("au1", "b.md", "file", "b");

    const purged = await trash.purge_expired("au1", 0);
    expect(purged).toHaveLength(2);

    const list = await trash.list_trash("au1");
    expect(list).toHaveLength(0);
  });

  it("path traversal blocked", async () => {
    await expect(
      trash.move_to_trash("au1", "../etc/passwd", "file", "bad"),
    ).rejects.toThrow("非法路径");
  });

  // --- 半成功回滚（审计①②）---

  it("move_to_trash: manifest 写失败时源不删、无孤儿、名册不动（审计①②）", async () => {
    const faulty = new FaultyAdapter();
    faulty.failWrite = (p) => p.includes("manifest.jsonl");
    faulty.seed("au1/characters/Zoe.md", "---\nname: Zoe\n---\n# Zoe");
    faulty.seed("au1/project.yaml", "cast_registry:\n  characters:\n    - Zoe\n    - Max\n");
    const t = new TrashService(faulty, 30);

    await expect(
      t.move_to_trash("au1", "characters/Zoe.md", "character_file", "Zoe"),
    ).rejects.toThrow("移动文件失败");

    // ① 源文件仍在（未丢失）——旧代码此时源已被删、manifest 无记录 = 孤儿
    expect(faulty.raw("au1/characters/Zoe.md")).toBe("---\nname: Zoe\n---\n# Zoe");
    // ① 无孤儿：.trash 下没有 Zoe 的残留副本，且 list_trash 为空
    expect(faulty.allFiles().filter((f) => f.includes(".trash") && /Zoe/.test(f))).toHaveLength(0);
    expect(await t.list_trash("au1")).toHaveLength(0);
    // ② 名册未被改：Zoe 仍在 cast_registry（旧代码在 appendManifest 前就删了它 → 永久丢失）
    expect(faulty.raw("au1/project.yaml")).toContain("Zoe");
  });

  it("move_to_trash: 删源失败时撤销 manifest 登记、清理副本、源保留（审计①）", async () => {
    const faulty = new FaultyAdapter();
    faulty.failDelete = (p) => p.endsWith("au1/notes/n.md"); // 仅源删除失败，回收站副本删除仍可成功
    faulty.seed("au1/notes/n.md", "content");
    const t = new TrashService(faulty, 30);

    await expect(
      t.move_to_trash("au1", "notes/n.md", "file", "n"),
    ).rejects.toThrow("移动文件失败");

    // 源仍在
    expect(faulty.raw("au1/notes/n.md")).toBe("content");
    // manifest 登记被撤销（无孤儿 entry）
    expect(await t.list_trash("au1")).toHaveLength(0);
    // .trash 副本被回滚清掉
    expect(faulty.allFiles().filter((f) => f.includes(".trash") && f.endsWith(".md"))).toHaveLength(0);
  });

  it("move_to_trash: 成功删除角色时仍从 cast_registry 移除（联动未被回滚改动破坏）", async () => {
    adapter.seed("au1/characters/Ann.md", "---\nname: Ann\n---\n# Ann");
    adapter.seed("au1/project.yaml", "cast_registry:\n  characters:\n    - Ann\n    - Ben\n");

    await trash.move_to_trash("au1", "characters/Ann.md", "character_file", "Ann");

    const proj = adapter.raw("au1/project.yaml")!;
    expect(proj).not.toContain("Ann");
    expect(proj).toContain("Ben");
    // 且确实进了回收站
    expect(await trash.list_trash("au1")).toHaveLength(1);
  });

  it("角色文件正文含 `---` 分割线：删除→恢复内容逐字节不丢、cast_registry 联动仍工作", async () => {
    adapter.seed("au1/project.yaml", "cast_registry:\n  characters:\n    - 阿离\n    - Ben\n");
    // 真 frontmatter（name 已知键）+ 正文以 `---` 场景分割线开头
    const body = "---\nname: 阿离\naliases: [离]\n---\n---\n\n场景一。\n\n---\n\n场景二。";
    adapter.seed("au1/characters/阿离.md", body);

    const entry = await trash.move_to_trash("au1", "characters/阿离.md", "character_file", "阿离");
    // safeMatter 从真 frontmatter 提取到 name → 名册移除
    expect(adapter.raw("au1/project.yaml")).not.toContain("阿离");

    await trash.restore("au1", entry.trash_id);
    // 内容经 trash 流转逐字节无损
    expect(adapter.raw("au1/characters/阿离.md")).toBe(body);
    // restore 侧的 readCharacterName 同样解析成功 → 名册加回
    expect(adapter.raw("au1/project.yaml")).toContain("阿离");
  });

  it("无 frontmatter、正文以 `---` 开头的角色文件：删除→恢复不抛错、内容不丢", async () => {
    // 裸 matter() 在这种形态会吞正文/对非法 YAML 抛错（H6 同族）；
    // safeMatter 零已知键整文回退 → name 判定为 null，流转纯走复制路径
    const body = "---\n\n夜色如墨。\n\n---\n\n第二场。";
    adapter.seed("au1/characters/未名.md", body);

    const entry = await trash.move_to_trash("au1", "characters/未名.md", "character_file", "未名");
    await trash.restore("au1", entry.trash_id);
    expect(adapter.raw("au1/characters/未名.md")).toBe(body);
  });

  it("move_to_trash: 同一路径重复删除时 trash_path 唯一(shortId)、副本互不覆盖（审计① defect 1）", async () => {
    adapter.seed("au1/dup.md", "v1");
    const e1 = await trash.move_to_trash("au1", "dup.md", "file", "dup");
    adapter.seed("au1/dup.md", "v2"); // 同名重建后再删
    const e2 = await trash.move_to_trash("au1", "dup.md", "file", "dup");

    // trash_path 必须不同（否则第二次副本覆盖第一次、且回滚会误删共享副本 → 孤儿）
    expect(e1.trash_path).not.toBe(e2.trash_path);
    expect(await trash.list_trash("au1")).toHaveLength(2);
    // 两份 .trash 副本都在
    const trashMd = adapter.allFiles().filter((f) => f.includes(".trash") && f.endsWith(".md"));
    expect(trashMd).toHaveLength(2);
  });

  // --- 整树删除回滚双失败（审计 H7）---

  it("move_tree_to_trash: 删源中断 + copy-back 双失败时，.trash 副本必须存活（审计 H7）", async () => {
    const faulty = new FaultyAdapter();
    faulty.seed("fandom1/aus/AU1/a.md", "A-content");
    faulty.seed("fandom1/aus/AU1/b.md", "B-content");
    // 删源阶段：a.md 删除成功后，b.md 删除失败 → 触发回滚
    faulty.failDelete = (p) => p === "fandom1/aus/AU1/b.md";
    // 回滚阶段：a.md 的 copy-back 写回原位失败（双失败叠加）
    faulty.failWrite = (p) => p === "fandom1/aus/AU1/a.md";
    const t = new TrashService(faulty, 30);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await expect(
        t.move_tree_to_trash("fandom1", "aus/AU1", "au", "AU1"),
      ).rejects.toThrow("simulated delete failure");

      // a.md：源已删、copy-back 失败 → .trash 副本是唯一幸存数据，必须保留。
      // 旧代码在 restoreCopiedTree 吞错后无条件 deleteCopiedTree = 源、副本双灭（永久丢失）。
      const aTrashCopies = faulty.allFiles().filter((f) => f.includes("/.trash/") && f.endsWith("/a.md"));
      expect(aTrashCopies).toHaveLength(1);
      expect(faulty.raw(aTrashCopies[0])).toBe("A-content");

      // b.md：源从未丢（删除失败）→ 冗余副本按回滚正常清理
      expect(faulty.raw("fandom1/aus/AU1/b.md")).toBe("B-content");
      expect(faulty.allFiles().filter((f) => f.includes("/.trash/") && f.endsWith("/b.md"))).toHaveLength(0);

      // manifest 登记被撤销：半成功状态不冒充「已入回收站」
      expect(await t.list_trash("fandom1")).toHaveLength(0);

      // copy-back 失败不再裸吞：console.warn 指路 .trash 副本
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(".trash"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("move_tree_to_trash: manifest 写失败发生在删源之前 → 源全程未动（审计 H7 顺序对齐审计①）", async () => {
    const faulty = new FaultyAdapter();
    faulty.seed("fandom1/aus/AU1/a.md", "A");
    faulty.seed("fandom1/aus/AU1/b.md", "B");
    faulty.failWrite = (p) => p.includes("manifest.jsonl");
    const t = new TrashService(faulty, 30);

    await expect(
      t.move_tree_to_trash("fandom1", "aus/AU1", "au", "AU1"),
    ).rejects.toThrow("simulated write failure");

    // 顺序判别：manifest 未落库前，任何源文件都不应被尝试删除
    // （旧顺序「copy→删源→append」在此场景已把源全删，只能靠 copy-back 救回）
    expect(faulty.deleteCalls.filter((p) => p.startsWith("fandom1/aus/AU1/"))).toHaveLength(0);
    // 源原样保留、冗余副本清理、manifest 无记录
    expect(faulty.raw("fandom1/aus/AU1/a.md")).toBe("A");
    expect(faulty.raw("fandom1/aus/AU1/b.md")).toBe("B");
    expect(faulty.allFiles().filter((f) => f.includes("/.trash/") && f.endsWith(".md"))).toHaveLength(0);
    expect(await t.list_trash("fandom1")).toHaveLength(0);
  });

  it("并发 move_to_trash 同一 scope：两条 entry 都保留、无 manifest 竞态丢失（审计②③串行化）", async () => {
    adapter.seed("au1/a.md", "A");
    adapter.seed("au1/b.md", "B");

    // 不逐个 await——并发触发，两个操作的 appendManifest 读改写会交错；
    // runExclusive 按 scopeRoot 串行化保证两条都落 manifest（否则后写者覆盖先写者=孤儿）。
    const [ea, eb] = await Promise.all([
      trash.move_to_trash("au1", "a.md", "file", "a"),
      trash.move_to_trash("au1", "b.md", "file", "b"),
    ]);

    const list = await trash.list_trash("au1");
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.trash_id).sort()).toEqual([ea.trash_id, eb.trash_id].sort());
    // 两源都删除、两副本都在
    expect(adapter.raw("au1/a.md")).toBeUndefined();
    expect(adapter.raw("au1/b.md")).toBeUndefined();
    expect(adapter.allFiles().filter((f) => f.includes(".trash") && f.endsWith(".md"))).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // M30：目录 restore 半途失败可续传；permanent_delete 不误删未恢复副本
  // ---------------------------------------------------------------------------
  it("M30: 目录 restore 逐文件写回中途失败 → 抛可续传错误 + 已恢复部分与 trash 均保留", async () => {
    const faulty = new FaultyAdapter();
    faulty.seed("fandom1/aus/AU1/a.md", "A-content");
    faulty.seed("fandom1/aus/AU1/b.md", "B-content");
    const t = new TrashService(faulty, 30);
    const entry = await t.move_tree_to_trash("fandom1", "aus/AU1", "au", "AU1");

    // restore 时 b.md 写回原位失败（a.md 先成功）→ 半成品状态。
    faulty.failWrite = (p) => p === "fandom1/aus/AU1/b.md";
    await expect(t.restore("fandom1", entry.trash_id)).rejects.toThrow(/未完成|续传/);

    // a.md 已恢复到原位；b.md 仍未恢复。两者的 trash 副本都还在（可续传）。
    expect(faulty.raw("fandom1/aus/AU1/a.md")).toBe("A-content");
    expect(faulty.raw("fandom1/aus/AU1/b.md")).toBeUndefined();
    expect(faulty.allFiles().filter((f) => f.includes("/.trash/") && f.endsWith(".md"))).toHaveLength(2);
    // manifest 仍在 —— 半成品未被误判为已恢复。
    expect(await t.list_trash("fandom1")).toHaveLength(1);

    // 修好写入后再次 restore：跳过已恢复的 a.md（预检不再撞自身冲突），只补 b.md → 成功。
    faulty.failWrite = () => false;
    await t.restore("fandom1", entry.trash_id);
    expect(faulty.raw("fandom1/aus/AU1/a.md")).toBe("A-content");
    expect(faulty.raw("fandom1/aus/AU1/b.md")).toBe("B-content");
    // trash 副本清空、manifest 移除。
    expect(faulty.allFiles().filter((f) => f.includes("/.trash/") && f.endsWith(".md"))).toHaveLength(0);
    expect(await t.list_trash("fandom1")).toHaveLength(0);
  });

  it("M30: 原位已有不同内容的同名文件 → 仍报真冲突（半成品放行不误伤真冲突）", async () => {
    const a = new MockAdapter();
    a.seed("fandom1/aus/AU1/a.md", "original");
    const t = new TrashService(a, 30);
    const entry = await t.move_tree_to_trash("fandom1", "aus/AU1", "au", "AU1");
    // 原位置放一个内容不同的同名文件（真冲突，不是半成品）。
    a.seed("fandom1/aus/AU1/a.md", "someone else's file");
    await expect(t.restore("fandom1", entry.trash_id)).rejects.toThrow("restore conflict");
    // trash 副本保留（未被破坏），可另行处理。
    expect(a.allFiles().filter((f) => f.includes("/.trash/") && f.endsWith(".md"))).toHaveLength(1);
  });

  it("M30: 半恢复态 permanent_delete 拒绝执行，未恢复文件的唯一副本不被销毁", async () => {
    const faulty = new FaultyAdapter();
    faulty.seed("fandom1/aus/AU1/a.md", "A-content");
    faulty.seed("fandom1/aus/AU1/b.md", "B-content");
    const t = new TrashService(faulty, 30);
    const entry = await t.move_tree_to_trash("fandom1", "aus/AU1", "au", "AU1");

    // 制造半恢复：a.md 恢复成功、b.md 失败。
    faulty.failWrite = (p) => p === "fandom1/aus/AU1/b.md";
    await expect(t.restore("fandom1", entry.trash_id)).rejects.toThrow(/未完成|续传/);
    faulty.failWrite = () => false;

    // 此时用户改用 permanent_delete「自救」——旧代码会删整棵 trash 树，把只在 trash 的 b.md 一并销毁。
    // 修复后：检测到半恢复态 → 拒绝，保住 b.md 的唯一副本。
    await expect(t.permanent_delete("fandom1", entry.trash_id)).rejects.toThrow(/半恢复|尚未恢复/);
    // b.md 的 trash 副本仍在（唯一版本未丢）；manifest 未被移除。
    expect(faulty.allFiles().filter((f) => f.includes("/.trash/") && f.endsWith("/b.md"))).toHaveLength(1);
    expect(await t.list_trash("fandom1")).toHaveLength(1);

    // 续传恢复后一切归位（验证拒绝不是死路，用户有出路）。
    await t.restore("fandom1", entry.trash_id);
    expect(faulty.raw("fandom1/aus/AU1/b.md")).toBe("B-content");
  });
});

// ===========================================================================
// Recalc State
// ===========================================================================

describe("recalc_state", () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  it("rebuilds state from chapters", async () => {
    const chapterRepo = new FileChapterRepository(adapter);
    const stateRepo = new FileStateRepository(adapter);
    const opsRepo = new FileOpsRepository(adapter);
    const draftRepo = new FileDraftRepository(adapter);
    const projectRepo = new FileProjectRepository(adapter);

    // Seed project.yaml so recalc can read cast_registry
    adapter.seed("au1/project.yaml", "project_id: p1\nau_id: au1\ncast_registry:\n  characters:\n    - Alice\n    - Bob\n");

    // Initialize and confirm 2 chapters
    await stateRepo.save(createState({ au_id: "au1" }));
    for (let i = 1; i <= 2; i++) {
      await draftRepo.save(createDraft({
        au_id: "au1", chapter_num: i, variant: "A",
        content: `Alice在第${i}章出场。Bob也在。`,
      }));
      const state = await stateRepo.get("au1");
      state.current_chapter = i;
      await stateRepo.save(state);
      await confirm_chapter({
        au_id: "au1", chapter_num: i,
        draft_id: `ch${String(i).padStart(4, "0")}_draft_A.md`,
        cast_registry: { characters: ["Alice", "Bob"] },
        chapter_repo: chapterRepo, draft_repo: draftRepo, state_repo: stateRepo, ops_repo: opsRepo,
      });
    }

    // Corrupt state
    const state = await stateRepo.get("au1");
    state.characters_last_seen = {};
    state.last_scene_ending = "";
    state.chapters_dirty = [99]; // stale dirty mark
    await stateRepo.save(state);

    // Recalc（不内部 save，调用方负责 save）
    const result = await recalc_state("au1", stateRepo, chapterRepo, projectRepo);

    expect(result.chapters_scanned).toBe(2);
    expect(result.characters_last_seen.Alice).toBe(2);
    expect(result.characters_last_seen.Bob).toBe(2);
    expect(result.last_scene_ending).toBeTruthy();
    expect(result.cleaned_dirty_count).toBe(1); // ch99 doesn't exist

    // 调用方 save 后验证持久化
    await stateRepo.save(result.state);
    const persisted = await stateRepo.get("au1");
    expect(persisted.characters_last_seen.Alice).toBe(2);
    expect(persisted.chapters_dirty).not.toContain(99);
  });

  it("empty AU returns clean state", async () => {
    const stateRepo = new FileStateRepository(adapter);
    const chapterRepo = new FileChapterRepository(adapter);
    const projectRepo = new FileProjectRepository(adapter);

    // No chapters exist, but we need project.yaml for projectRepo
    // projectRepo.get will throw, which is caught internally
    const result = await recalc_state("au1", stateRepo, chapterRepo, projectRepo);

    expect(result.chapters_scanned).toBe(0);
    expect(result.characters_last_seen).toEqual({});
  });
});
