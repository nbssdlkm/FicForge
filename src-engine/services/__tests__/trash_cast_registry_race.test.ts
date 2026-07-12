// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 盲审 R3 M1 回归：project.yaml 的 cast_registry 有两条独立读改写路径
 * （设置保存链 withProjectFileLock ↔ TrashService.updateCastRegistry）。
 * 修前二者锁域不同 → 并发丢更新；修后共享 project.yaml 文件锁完全串行。
 */

import { describe, expect, it } from "vitest";
import { TrashService } from "../trash_service.js";
import { withProjectFileLock } from "../au_lock.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileProjectRepository } from "../../repositories/implementations/file_project.js";

const AU = "data/fandoms/f1/aus/au1";

async function readCast(adapter: MockAdapter): Promise<string[]> {
  const proj = await new FileProjectRepository(adapter).get(AU);
  return (proj?.cast_registry.characters ?? []).slice().sort();
}

describe("cast_registry 双写路径并发（盲审 R3 M1）", () => {
  it("设置侧持 project 文件锁期间，trash 的 cast 更新被阻塞（互斥，判别锁是否生效）", async () => {
    const adapter = new MockAdapter();
    const projectRepo = new FileProjectRepository(adapter);
    const trash = new TrashService(adapter);

    // 种子：名册 [A, B] + 角色文件 A（供 trash 读取角色名做 cast 联动）
    const proj = (await import("../../domain/project.js")).createProject({
      project_id: "p1",
      au_id: AU,
      name: "作品",
      fandom: "f1",
    });
    proj.cast_registry.characters = ["A", "B"];
    await projectRepo.save(proj);
    await adapter.writeFile(`${AU}/characters/A.md`, "---\nname: A\n---\nA 的档案。");

    let castSeenWhileLockHeld: string[] = [];
    let trashRemove: Promise<unknown> = Promise.resolve();

    // 持有 project 文件锁的临界区内并发启动 trash 删角色。updateCastRegistry 走同一把锁，
    // 必须被阻塞到本临界区结束 —— 期间名册仍应含 A。
    await withProjectFileLock(AU, async () => {
      trashRemove = trash.move_to_trash(AU, "characters/A.md", "lore_file", "A.md");
      for (let i = 0; i < 40; i++) await Promise.resolve(); // 给 trash 充分推进的窗口
      castSeenWhileLockHeld = await readCast(adapter);
    });
    await trashRemove;

    // 判别点：修前（trash 侧不持锁）trash 会在窗口内直接把 A 删掉 → 断言失败。
    // 修后：trash 被文件锁挡住，锁内看到的名册仍含 A。
    expect(castSeenWhileLockHeld).toContain("A");
    // 锁释放后 trash 完成，A 最终被移除。
    expect(await readCast(adapter)).toEqual(["B"]);
  });

  it("两次 trash 删角色并发（同锁）：两名都被移除", async () => {
    const adapter = new MockAdapter();
    const projectRepo = new FileProjectRepository(adapter);
    const trash = new TrashService(adapter);

    const proj = (await import("../../domain/project.js")).createProject({
      project_id: "p1",
      au_id: AU,
      name: "作品",
      fandom: "f1",
    });
    proj.cast_registry.characters = ["A", "B", "C"];
    await projectRepo.save(proj);
    await adapter.writeFile(`${AU}/characters/A.md`, "---\nname: A\n---\n");
    await adapter.writeFile(`${AU}/characters/B.md`, "---\nname: B\n---\n");

    await Promise.all([
      trash.move_to_trash(AU, "characters/A.md", "lore_file", "A.md"),
      trash.move_to_trash(AU, "characters/B.md", "lore_file", "B.md"),
    ]);

    expect(await readCast(adapter)).toEqual(["C"]);
  });
});
