// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 审计 H5 裸写收编回归测试：核心数据文件的写盘全部改走 atomicWrite
 * （write-tmp-then-rename）后，每类文件至少一条 round-trip —— 证明写路径
 * 换轨后读回不变，且成功写入后不残留 .tmp。
 */

import { describe, expect, it } from "vitest";
import { MockAdapter } from "./mock_adapter.js";
import { FileChapterRepository } from "../implementations/file_chapter.js";
import { FileChapterSummaryRepository } from "../implementations/file_chapter_summary.js";
import { FileDraftRepository } from "../implementations/file_draft.js";
import { FileFandomRepository } from "../implementations/file_fandom.js";
import { FileProjectRepository } from "../implementations/file_project.js";
import { FileSettingsRepository } from "../implementations/file_settings.js";
import { FileSimpleChatRepository } from "../implementations/file_simple_chat.js";
import { FileStateRepository } from "../implementations/file_state.js";
import { createChapter } from "../../domain/chapter.js";
import { createChapterSummary } from "../../domain/chapter_summary.js";
import { createDraft } from "../../domain/draft.js";
import { createFandom } from "../../domain/fandom.js";
import { createProject } from "../../domain/project.js";
import { createSettings } from "../../domain/settings.js";
import { createState } from "../../domain/state.js";

function expectNoTmpResidue(adapter: MockAdapter): void {
  expect(adapter.allFiles().filter((f) => f.endsWith(".tmp"))).toEqual([]);
}

describe("原子写收编 round-trip（每类核心数据文件）", () => {
  it("chapter：save → get 且无 .tmp 残留（含 backup_chapter）", async () => {
    const adapter = new MockAdapter();
    const repo = new FileChapterRepository(adapter);
    await repo.save(createChapter({ au_id: "au1", chapter_num: 1, content: "第一章正文" }));

    const loaded = await repo.get("au1", 1);
    expect(loaded.content).toBe("第一章正文");

    const dest = await repo.backup_chapter("au1", 1);
    expect(await adapter.readFile(dest)).toContain("第一章正文");
    expectNoTmpResidue(adapter);
  });

  it("settings：save → get 且无 .tmp 残留", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");
    const settings = createSettings({});
    settings.app.language = "en";
    await repo.save(settings);

    const loaded = await repo.get();
    expect(loaded.app.language).toBe("en");
    expectNoTmpResidue(adapter);
  });

  it("state：save / update → get 且无 .tmp 残留", async () => {
    const adapter = new MockAdapter();
    const repo = new FileStateRepository(adapter);
    await repo.save(createState({ au_id: "au1", current_chapter: 3 }));
    await repo.update("au1", (s) => {
      s.current_chapter = 4;
    });

    const loaded = await repo.get("au1");
    expect(loaded.current_chapter).toBe(4);
    expectNoTmpResidue(adapter);
  });

  it("chapter summary：save → get 且无 .tmp 残留", async () => {
    const adapter = new MockAdapter();
    const repo = new FileChapterSummaryRepository(adapter);
    const summary = createChapterSummary({
      standard: { version: 1, text: "本章摘要", generated_at: "t", source_chapter_hash: "h" },
    });
    await repo.save("au1", 1, summary);

    const loaded = await repo.get("au1", 1);
    expect(loaded?.standard?.text).toBe("本章摘要");
    expectNoTmpResidue(adapter);
  });

  it("draft：save → get 且无 .tmp 残留", async () => {
    const adapter = new MockAdapter();
    const repo = new FileDraftRepository(adapter);
    await repo.save(createDraft({ au_id: "au1", chapter_num: 2, variant: "a", content: "草稿内容" }));

    const loaded = await repo.get("au1", 2, "a");
    // matter.stringify 会补尾部换行（草稿 get 不做 trim，与 chapter 不同）—— 既有行为，与原子写无关
    expect(loaded.content.trimEnd()).toBe("草稿内容");
    expectNoTmpResidue(adapter);
  });

  it("fandom：save → get 且无 .tmp 残留", async () => {
    const adapter = new MockAdapter();
    const repo = new FileFandomRepository(adapter, "");
    await repo.save("fandoms/hp", createFandom({ name: "HP" }));

    const loaded = await repo.get("fandoms/hp");
    expect(loaded.name).toBe("HP");
    expectNoTmpResidue(adapter);
  });

  it("project：save → get 且无 .tmp 残留", async () => {
    const adapter = new MockAdapter();
    const repo = new FileProjectRepository(adapter);
    const auPath = "fandoms/hp/aus/au1";
    await repo.save(createProject({ au_id: auPath, project_id: "p1", name: "AU One", fandom: "HP" }));

    const loaded = await repo.get(auPath);
    expect(loaded.name).toBe("AU One");
    expectNoTmpResidue(adapter);
  });

  it("simple chat：save / update → get 且无 .tmp 残留", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSimpleChatRepository(adapter);
    await repo.save("au1", [{ id: "m1", timestamp: "t1", kind: "user", content: "你好" }]);
    await repo.update("au1", (msgs) => [...msgs, { id: "m2", timestamp: "t2", kind: "system" }]);

    const loaded = await repo.get("au1");
    expect(loaded.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expectNoTmpResidue(adapter);
  });
});
