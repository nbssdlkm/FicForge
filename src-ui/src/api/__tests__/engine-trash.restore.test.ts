// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * engine-trash restoreTrash — 章节恢复生命周期补挂（R1-5，终审 1-B）。
 *
 * 回收站恢复章节文件绕过了 confirm/undo 的记忆生命周期：正文不在向量索引里、
 * 旧摘要陈旧、state 派生字段（last_scene_ending 等）没跟上。判别契约：
 *  1. AU 内恢复章文件 → index_status=STALE + 该章摘要文件被删 + recalcState 已跑
 *  2. 非章文件条目（lore）恢复 → 不动 index_status（不误伤 lore 恢复的 UX）
 *  3. chapterNumFromTrashEntry 路径判据（chapters/main/chNNNN.md 单一真相源）
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDraft, IndexStatus, createChapterSummary } from "@ficforge/engine";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";
import { confirmChapter } from "../engine-chapters";
import { chapterNumFromTrashEntry, restoreTrash } from "../engine-trash";
import { createAu, createFandom } from "../engine-fandom";
import { getEngine, initEngine } from "../engine-instance";
import { deleteLore, saveLore } from "../engine-lore";

describe("engine-trash 章节恢复生命周期（R1-5）", () => {
  let auPath: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    initEngine(new MockAdapter(), "/data");
    const fandom = await createFandom("Naruto");
    const au = await createAu(fandom.name, "Canon", fandom.path);
    auPath = au.path;
    await getEngine().repos.draft.save(
      createDraft({
        au_id: auPath,
        chapter_num: 1,
        variant: "A",
        content: "Alice走进了房间。\n\n她看到了Bob。\n\n夜色渐深。",
      }),
    );
    await confirmChapter(auPath, 1, "ch0001_draft_A.md");
  });

  it("恢复章文件 → index_status=STALE + 摘要删除 + recalcState 重算派生字段", async () => {
    const e = getEngine();
    // 预置：摘要文件在、索引 READY、派生字段被人为弄脏（证明 recalc 真跑了）
    await e.repos.chapterSummary.save(
      auPath,
      1,
      createChapterSummary({
        standard: { version: 1, text: "旧摘要", generated_at: "t", source_chapter_hash: "h" },
      }),
    );
    await e.repos.state.update(auPath, (st) => {
      st.index_status = IndexStatus.READY;
      st.last_scene_ending = "__STALE_SENTINEL__";
    });

    // 把已确认的章移入回收站（= import pipeline 替换章的真实路径与 entity_type）
    const entry = await e.trash.move_to_trash(auPath, "chapters/main/ch0001.md", "chapter", "1");

    await restoreTrash("au", auPath, entry.trash_id);

    // 章回到原位
    await expect(e.repos.chapter.exists(auPath, 1)).resolves.toBe(true);
    // 1) 摘要已删（宁缺勿旧，对齐编辑路径口径）
    await expect(e.repos.chapterSummary.get(auPath, 1)).resolves.toBeNull();
    // 2) 索引降级 STALE（恢复正文不在向量索引里）
    const st = await e.repos.state.get(auPath);
    expect(st.index_status).toBe(IndexStatus.STALE);
    // 3) recalcState 真跑：last_scene_ending 从哨兵值被重算为章尾内容
    expect(st.last_scene_ending).not.toBe("__STALE_SENTINEL__");
    expect(st.last_scene_ending.length).toBeGreaterThan(0);
  });

  it("恢复非章文件（lore）→ 不动 index_status，不删摘要", async () => {
    const e = getEngine();
    await e.adapter.writeFile(`${auPath}/characters/Alice.md`, "# Alice\n设定内容");
    await e.repos.chapterSummary.save(
      auPath,
      1,
      createChapterSummary({
        standard: { version: 1, text: "摘要", generated_at: "t", source_chapter_hash: "h" },
      }),
    );
    await e.repos.state.update(auPath, (st) => {
      st.index_status = IndexStatus.READY;
    });

    const entry = await e.trash.move_to_trash(auPath, "characters/Alice.md", "lore_file", "Alice");
    await restoreTrash("au", auPath, entry.trash_id);

    const st = await e.repos.state.get(auPath);
    expect(st.index_status).toBe(IndexStatus.READY);
    await expect(e.repos.chapterSummary.get(auPath, 1)).resolves.not.toBeNull();
  });

  it("chapterNumFromTrashEntry：只认 chapters/main/chNNNN.md 布局", () => {
    expect(chapterNumFromTrashEntry({ original_path: "chapters/main/ch0003.md" })).toBe(3);
    expect(chapterNumFromTrashEntry({ original_path: "chapters/main/ch0042.md" })).toBe(42);
    expect(chapterNumFromTrashEntry({ original_path: "characters/Alice.md" })).toBeNull();
    expect(chapterNumFromTrashEntry({ original_path: "chapters/main/ch3.md" })).toBeNull();
    expect(chapterNumFromTrashEntry({ original_path: "chapters/backups/ch0003_v1.md" })).toBeNull();
    expect(chapterNumFromTrashEntry({ original_path: "chapters/main/ch0000.md" })).toBeNull();
  });

  it("overwrite 恢复角色卡（同名同签名）→ 别名表缓存失效，不吃陈旧表", async () => {
    const e = getEngine();
    // v1 入库 → 删除进回收站 → 同名重建 v2 → 缓存热（新称）
    await saveLore({
      au_path: auPath,
      category: "characters",
      filename: "沈砚.md",
      content: "---\nname: 沈砚\naliases: [旧称]\n---\n",
    });
    const del = await deleteLore({ au_path: auPath, category: "characters", filename: "沈砚.md" });
    await saveLore({
      au_path: auPath,
      category: "characters",
      filename: "沈砚.md",
      content: "---\nname: 沈砚\naliases: [新称]\n---\n",
    });
    await expect(e.characterAliases.get(auPath)).resolves.toEqual({ 沈砚: ["新称"] });

    // overwrite 恢复：磁盘回到 v1，但文件名集合（签名）不变 —— 只有 restore 后置
    // 失效 hook 能让表跟上（否则命中陈旧缓存拿到「新称」）
    await restoreTrash("au", auPath, del.trash_id, "overwrite");
    await expect(e.characterAliases.get(auPath)).resolves.toEqual({ 沈砚: ["旧称"] });
  });
});
