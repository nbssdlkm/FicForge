// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TD-015 UI-API 纯函数：bundleFromRawFiles 路径归一化 + parseAuBundle 解析/版本守卫。
 * （exportAuBundle / restoreAuBundle 需要 live engine，由 engine 层 au_bundle.test.ts
 * 覆盖核心语义，这里只测不依赖 engine 实例的纯逻辑。）
 */

import { beforeEach, describe, expect, it } from "vitest";
import { AU_BUNDLE_VERSION, type AuBundle } from "@ficforge/engine";
import { bundleFromRawFiles, parseAuBundle, restoreAuBundle } from "../engine-export";
import { initEngine } from "../engine-instance";
import { createFandom } from "../engine-fandoms";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";

describe("bundleFromRawFiles (TD-015 raw-folder import)", () => {
  it("normalizes relpaths and counts chapters", () => {
    const bundle = bundleFromRawFiles(
      [
        { relpath: "./chapters/main/ch0001.md", content: "a" },
        { relpath: "chapters\\main\\ch0002.md", content: "b" }, // windows 分隔符
        { relpath: "state.yaml", content: "current_chapter: 2" },
        { relpath: "chapters/main/ch0001.summary.jsonl", content: "{}" }, // 不算章节
      ],
      { au_name: "我的故事", fandom: "原创" },
    );

    expect(Object.keys(bundle.files).sort()).toEqual([
      "chapters/main/ch0001.md",
      "chapters/main/ch0001.summary.jsonl",
      "chapters/main/ch0002.md",
      "state.yaml",
    ]);
    expect(bundle.manifest.chapter_count).toBe(2);
    expect(bundle.manifest.file_count).toBe(4);
    expect(bundle.manifest.au_name).toBe("我的故事");
    expect(bundle.manifest.bundle_version).toBe(AU_BUNDLE_VERSION);
  });

  it("drops empty/garbage relpaths", () => {
    const bundle = bundleFromRawFiles([
      { relpath: "./", content: "x" },
      { relpath: "facts.jsonl", content: "{}" },
    ]);
    expect(Object.keys(bundle.files)).toEqual(["facts.jsonl"]);
  });

  it("excludes .vectors/.drafts so manifest counts match what will actually be written", () => {
    const bundle = bundleFromRawFiles([
      { relpath: "chapters/main/ch0001.md", content: "a" },
      { relpath: ".vectors/index.json", content: "{}" },
      { relpath: "chapters/.drafts/ch0002_draft_A.md", content: "draft" },
    ]);
    expect(Object.keys(bundle.files)).toEqual(["chapters/main/ch0001.md"]);
    expect(bundle.manifest.file_count).toBe(1); // 不把将被跳过的 .vectors/.drafts 算进去
  });
});

describe("parseAuBundle (TD-015)", () => {
  const valid = JSON.stringify({
    manifest: {
      bundle_version: AU_BUNDLE_VERSION,
      exported_at: "t",
      au_name: "x",
      fandom: "y",
      chapter_count: 0,
      file_count: 0,
      excluded_dirs: [],
    },
    files: {},
  });

  it("parses a valid bundle", () => {
    expect(parseAuBundle(valid).manifest.au_name).toBe("x");
  });

  it("throws a friendly error on non-JSON", () => {
    expect(() => parseAuBundle("not json {")).toThrow(/JSON/);
  });

  it("throws on an incompatible major version", () => {
    const bad = JSON.stringify({
      manifest: {
        bundle_version: "9.0.0",
        exported_at: "t",
        au_name: "",
        fandom: "",
        chapter_count: 0,
        file_count: 0,
        excluded_dirs: [],
      },
      files: {},
    });
    expect(() => parseAuBundle(bad)).toThrow();
  });
});

describe("restoreAuBundle integration (review fix #6 — the load-bearing migration fn)", () => {
  let adapter: MockAdapter;
  beforeEach(() => {
    adapter = new MockAdapter();
    initEngine(adapter, "/data");
  });

  function realisticBundle(): AuBundle {
    return {
      manifest: {
        bundle_version: AU_BUNDLE_VERSION,
        exported_at: "2026-06-23T00:00:00Z",
        au_name: "迁回的文",
        fandom: "原创",
        chapter_count: 1,
        file_count: 4,
        excluded_dirs: [],
      },
      files: {
        "project.yaml": "name: 迁回的文\nfandom: 原创\nllm:\n  api_key: <secure>\n",
        "state.yaml": "current_chapter: 7\nindex_status: ready\ncharacters_last_seen:\n  阿离: 6\n",
        "facts.jsonl": '{"id":"f1","status":"active","content_clean":"背景"}\n',
        "chapters/main/ch0001.md": "---\nchapter_id: c1\n---\n第一章正文。",
      },
    };
  }

  it("creates a new AU, lets the bundle win over createAu defaults, forces index_status=stale, and reports counts", async () => {
    const fandom = await createFandom("原创");
    const result = await restoreAuBundle(fandom.name, fandom.path, "迁回的文", realisticBundle());

    expect(result.chapterCount).toBe(1);
    expect(result.fileCount).toBe(4);
    expect(result.skipped).toEqual([]);

    const auPath = result.auPath;
    // bundle 的 project.yaml 覆盖了 createAu 写的默认（保留故事名等）
    expect(adapter.raw(`${auPath}/project.yaml`)).toContain("name: 迁回的文");
    // state.yaml：current_chapter / 未知结构保留，index_status 被无损置 stale
    const state = adapter.raw(`${auPath}/state.yaml`) as string;
    expect(state).toContain("current_chapter: 7");
    expect(state).toContain("阿离: 6");
    expect(state).toContain("index_status: stale");
    expect(state).not.toContain("index_status: ready");
    // facts + 章节按字节落地
    expect(adapter.raw(`${auPath}/facts.jsonl`)).toContain('"id":"f1"');
    expect(adapter.raw(`${auPath}/chapters/main/ch0001.md`)).toContain("第一章正文。");
  });

  it("rolls back the half-created AU when import fails (no orphan left in the library)", async () => {
    const fandom = await createFandom("原创");
    // 注入一个会让 importAuBundle 抛错的 bundle：用 validateBundle 之后、写入阶段失败。
    // 这里通过让 adapter.writeFile 对某路径抛错来模拟中途失败。
    const orig = adapter.writeFile.bind(adapter);
    // 只在写这个具体章节文件时炸（importAuBundle 中途失败），其余写入（含回滚 trash 拷贝）正常。
    adapter.writeFile = async (path: string, content: string) => {
      if (path.endsWith("chapters/main/ch0001.md")) throw new Error("disk full");
      return orig(path, content);
    };

    await expect(restoreAuBundle(fandom.name, fandom.path, "失败的文", realisticBundle())).rejects.toThrow();

    adapter.writeFile = orig;
    // 半张 AU 不应留在 fandom/aus 下（已回滚进回收站）
    expect(adapter.raw(`${fandom.path}/aus/失败的文/project.yaml`)).toBeUndefined();
  });
});
