// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FileFandomRepository 测试。
 *
 * 关键回归保护：
 * - 构造时允许空 dataDir（Capacitor/Web 平台约定 "" = 平台 Data 目录）
 * - list_fandoms 在空 dataDir 下正常工作，不抛 "data_dir must not be empty"
 *   （v0.3.0 审计批量加路径校验时的误用，Web/PWA 模式 Splash 刷屏回归）
 */

import { describe, it, expect } from "vitest";
import { FileFandomRepository } from "../implementations/file_fandom.js";
import { createFandom } from "../../domain/fandom.js";
import { MockAdapter } from "./mock_adapter.js";

describe("FileFandomRepository constructor", () => {
  it("允许空 dataDir（Capacitor/Web 平台约定）", () => {
    const adapter = new MockAdapter();
    expect(() => new FileFandomRepository(adapter, "")).not.toThrow();
  });

  it("允许 Tauri 绝对路径 dataDir", () => {
    const adapter = new MockAdapter();
    expect(() => new FileFandomRepository(adapter, "/tmp/app")).not.toThrow();
  });
});

describe("FileFandomRepository.list_fandoms (空 dataDir)", () => {
  it("无 fandoms 目录 → 返回 []，不抛错（回归保护）", async () => {
    const adapter = new MockAdapter();
    const repo = new FileFandomRepository(adapter, "");
    await expect(repo.list_fandoms()).resolves.toEqual([]);
  });

  it("列出所有含 fandom.yaml 的子目录", async () => {
    const adapter = new MockAdapter();
    adapter.seed("fandoms/HP/fandom.yaml", "name: HP\n");
    adapter.seed("fandoms/SNK/fandom.yaml", "name: SNK\n");
    const repo = new FileFandomRepository(adapter, "");
    expect(await repo.list_fandoms()).toEqual(["HP", "SNK"]);
  });

  it("过滤掉 fandom.yaml 已被 trash 的目录（deleteFandom 只 trash fandom.yaml）", async () => {
    const adapter = new MockAdapter();
    adapter.seed("fandoms/HP/fandom.yaml", "name: HP\n");
    // deleted fandom 只剩残留 AU，没 fandom.yaml
    adapter.seed("fandoms/deleted/aus/au1/project.yaml", "");
    const repo = new FileFandomRepository(adapter, "");
    expect(await repo.list_fandoms()).toEqual(["HP"]);
  });
});

describe("FileFandomRepository.list_fandoms (非空 dataDir)", () => {
  it("Tauri 绝对路径下正常扫描", async () => {
    const adapter = new MockAdapter();
    adapter.seed("/tmp/app/fandoms/HP/fandom.yaml", "name: HP\n");
    const repo = new FileFandomRepository(adapter, "/tmp/app");
    expect(await repo.list_fandoms()).toEqual(["HP"]);
  });

  it("不混淆不同 dataDir 下的 fandom（隔离）", async () => {
    const adapter = new MockAdapter();
    adapter.seed("/tmp/app/fandoms/HP/fandom.yaml", "name: HP\n");
    adapter.seed("fandoms/SNK/fandom.yaml", "name: SNK\n"); // 另一个根下
    const repo = new FileFandomRepository(adapter, "/tmp/app");
    expect(await repo.list_fandoms()).toEqual(["HP"]);
  });
});

describe("FileFandomRepository.get/save", () => {
  it("save 后能 get 回来", async () => {
    const adapter = new MockAdapter();
    const repo = new FileFandomRepository(adapter, "");
    const fandom = createFandom({
      name: "HP",
      created_at: "2026-04-18T00:00:00Z",
      core_characters: ["Harry", "Hermione"],
      wiki_source: "https://example.com",
    });
    await repo.save("fandoms/HP", fandom);

    const loaded = await repo.get("fandoms/HP");
    expect(loaded.name).toBe("HP");
    expect(loaded.core_characters).toEqual(["Harry", "Hermione"]);
    expect(loaded.wiki_source).toBe("https://example.com");
  });

  it("get 不存在的 fandom 抛错", async () => {
    const adapter = new MockAdapter();
    const repo = new FileFandomRepository(adapter, "");
    await expect(repo.get("fandoms/Missing")).rejects.toThrow(/not found/);
  });

  it("get/save 拒绝空 fandom_path（validateBasePath 守卫）", async () => {
    const adapter = new MockAdapter();
    const repo = new FileFandomRepository(adapter, "");
    await expect(repo.get("")).rejects.toThrow(/must not be empty/);
    await expect(repo.save("", createFandom())).rejects.toThrow(/must not be empty/);
  });
});

describe("FileFandomRepository.list_aus", () => {
  it("列出 fandom 下所有 AU 目录", async () => {
    const adapter = new MockAdapter();
    adapter.seed("fandoms/HP/aus/au_a/project.yaml", "");
    adapter.seed("fandoms/HP/aus/au_b/project.yaml", "");
    const repo = new FileFandomRepository(adapter, "");
    expect(await repo.list_aus("fandoms/HP")).toEqual(["au_a", "au_b"]);
  });

  it("没有 aus 目录时返回 []", async () => {
    const adapter = new MockAdapter();
    adapter.seed("fandoms/HP/fandom.yaml", "name: HP\n");
    const repo = new FileFandomRepository(adapter, "");
    expect(await repo.list_aus("fandoms/HP")).toEqual([]);
  });

  it("拒绝空 fandom_path", async () => {
    const adapter = new MockAdapter();
    const repo = new FileFandomRepository(adapter, "");
    await expect(repo.list_aus("")).rejects.toThrow(/must not be empty/);
  });
});
