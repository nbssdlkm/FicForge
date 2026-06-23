// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TD-015 全量 AU 备份导出/导入 round-trip + 安全/版本边界。
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  AU_BUNDLE_VERSION,
  AuBundleError,
  collectAuBundle,
  importAuBundle,
  validateBundle,
  type AuBundle,
} from "../au_bundle.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";

const AU = "data/fandoms/f1/aus/au1";

// 一个「真实形状」的 AU：源真相 + 派生(.vectors) + 临时(.drafts)。
async function seedAu(adapter: MockAdapter, root = AU) {
  await adapter.writeFile(`${root}/project.yaml`, "name: 我的故事\nfandom: 原创\nllm:\n  api_key: <secure>\n");
  await adapter.writeFile(`${root}/state.yaml`, "current_chapter: 3\nindex_status: ready\n");
  await adapter.writeFile(`${root}/facts.jsonl`, '{"id":"f1","status":"active"}\n');
  await adapter.writeFile(`${root}/threads.jsonl`, '{"id":"t1","title":"主线"}\n');
  await adapter.writeFile(`${root}/ops.jsonl`, '{"op_id":"o1","op_type":"add_fact"}\n');
  await adapter.writeFile(`${root}/chapters/main/ch0001.md`, "---\nchapter_id: c1\n---\n第一章正文。");
  await adapter.writeFile(`${root}/chapters/main/ch0002.md`, "---\nchapter_id: c2\n---\n第二章正文。");
  await adapter.writeFile(`${root}/chapters/main/ch0001.summary.jsonl`, '{"micro":{"text":"摘要"}}');
  await adapter.writeFile(`${root}/.well-known/simple-chat.yaml`, "version: 1\nmessages:\n  - id: m1\n");
  await adapter.writeFile(`${root}/worldbuilding/世界设定.md`, "# 设定\n魔法体系...");
  // —— 应被排除 ——
  await adapter.writeFile(`${root}/.vectors/index.json`, '{"model":"bge-m3","dimension":1024}');
  await adapter.writeFile(`${root}/.vectors/chapters/c1.json`, '{"embedding":[0.1]}');
  await adapter.writeFile(`${root}/chapters/.drafts/ch0003_draft_A.md`, "草稿");
}

describe("collectAuBundle (TD-015 export)", () => {
  let adapter: MockAdapter;
  beforeEach(async () => {
    adapter = new MockAdapter();
    await seedAu(adapter);
  });

  it("captures all source-of-truth files and excludes .vectors / .drafts", async () => {
    const bundle = await collectAuBundle(AU, adapter, { au_name: "我的故事", fandom: "原创" });
    const paths = Object.keys(bundle.files).sort();

    expect(paths).toContain("project.yaml");
    expect(paths).toContain("state.yaml");
    expect(paths).toContain("facts.jsonl");
    expect(paths).toContain("threads.jsonl");
    expect(paths).toContain("ops.jsonl");
    expect(paths).toContain("chapters/main/ch0001.md");
    expect(paths).toContain("chapters/main/ch0002.md");
    expect(paths).toContain("chapters/main/ch0001.summary.jsonl");
    expect(paths).toContain(".well-known/simple-chat.yaml");
    expect(paths).toContain("worldbuilding/世界设定.md");

    // 排除的派生/临时目录（任意层级）
    expect(paths.some((p) => p.startsWith(".vectors/"))).toBe(false);
    expect(paths.some((p) => p.includes(".drafts/"))).toBe(false);
  });

  it("builds a correct manifest", async () => {
    const bundle = await collectAuBundle(AU, adapter, {
      au_name: "我的故事", fandom: "原创", source_platform: "capacitor",
    });
    expect(bundle.manifest.bundle_version).toBe(AU_BUNDLE_VERSION);
    expect(bundle.manifest.au_name).toBe("我的故事");
    expect(bundle.manifest.fandom).toBe("原创");
    expect(bundle.manifest.chapter_count).toBe(2);              // ch0001 + ch0002, 不含 .summary
    expect(bundle.manifest.file_count).toBe(Object.keys(bundle.files).length);
    expect(bundle.manifest.source_platform).toBe("capacitor");
    expect(bundle.manifest.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("preserves exact file content", async () => {
    const bundle = await collectAuBundle(AU, adapter);
    expect(bundle.files["chapters/main/ch0001.md"]).toBe("---\nchapter_id: c1\n---\n第一章正文。");
    expect(bundle.files["state.yaml"]).toBe("current_chapter: 3\nindex_status: ready\n");
  });

  it("throws when the AU path does not exist", async () => {
    await expect(collectAuBundle("data/nope", adapter)).rejects.toThrow(AuBundleError);
  });
});

describe("importAuBundle (TD-015 import)", () => {
  it("round-trips: export A → import B → re-export B equals A (minus excluded)", async () => {
    const adapter = new MockAdapter();
    await seedAu(adapter);

    const bundleA = await collectAuBundle(AU, adapter, { au_name: "我的故事", fandom: "原创" });

    const TARGET = "data/fandoms/f2/aus/au2";
    const result = await importAuBundle(TARGET, bundleA, adapter);
    expect(result.file_count).toBe(Object.keys(bundleA.files).length);
    expect(result.chapter_count).toBe(2);
    expect(result.skipped).toEqual([]);

    const bundleB = await collectAuBundle(TARGET, adapter, { au_name: "我的故事", fandom: "原创" });
    expect(bundleB.files).toEqual(bundleA.files);

    // 内容真的写到目标路径下了
    expect(await adapter.readFile(`${TARGET}/chapters/main/ch0001.md`)).toBe(bundleA.files["chapters/main/ch0001.md"]);
    expect(await adapter.readFile(`${TARGET}/.well-known/simple-chat.yaml`)).toBe(bundleA.files[".well-known/simple-chat.yaml"]);
  });

  it("skips unsafe and excluded relative paths instead of writing them", async () => {
    const adapter = new MockAdapter();
    const bundle: AuBundle = {
      manifest: {
        bundle_version: AU_BUNDLE_VERSION, exported_at: "2026-06-23T00:00:00Z",
        au_name: "x", fandom: "y", chapter_count: 1, file_count: 4, excluded_dirs: [],
      },
      files: {
        "chapters/main/ch0001.md": "ok",
        "../evil.md": "escape",
        "/abs.md": "abs",
        ".vectors/index.json": "should-be-skipped",
      },
    };
    const TARGET = "data/aus/safe";
    const result = await importAuBundle(TARGET, bundle, adapter);

    expect(result.written).toEqual(["chapters/main/ch0001.md"]);
    expect(result.skipped.sort()).toEqual(["../evil.md", "/abs.md", ".vectors/index.json"].sort());
    // 越界文件没被写到任何地方
    expect(await adapter.exists("data/aus/evil.md")).toBe(false);
    expect(await adapter.exists("data/evil.md")).toBe(false);
  });
});

describe("collectAuBundle secret redaction (review fix)", () => {
  it("redacts a legacy plaintext api_key in project.yaml to the <secure> placeholder", async () => {
    const adapter = new MockAdapter();
    const root = "data/aus/legacy";
    await adapter.writeFile(`${root}/project.yaml`, "name: x\nllm:\n  api_key: sk-PLAINTEXT-SECRET-123\nembedding_lock:\n  api_key: emb-SECRET-456\n");
    await adapter.writeFile(`${root}/chapters/main/ch0001.md`, "正文");

    const bundle = await collectAuBundle(root, adapter);
    const proj = bundle.files["project.yaml"];
    expect(proj).not.toContain("sk-PLAINTEXT-SECRET-123");
    expect(proj).not.toContain("emb-SECRET-456");
    expect(proj).toContain("api_key: <secure>");
  });
});

describe("collectAuBundle aborts on unreadable files (review fix — no silent data loss)", () => {
  // 模拟真机：对一个存在的文件 listDir 抛错（确定是文件）且 readFile 也抛错（不可读）。
  const strip = (p: string) => p.replace(/\/+$/, "");
  class PoisonAdapter extends MockAdapter {
    constructor(private readonly poison: string) { super(); }
    async listDir(path: string): Promise<string[]> {
      if (strip(path) === strip(this.poison)) throw new Error("not a directory");
      return super.listDir(path);
    }
    async readFile(path: string): Promise<string> {
      if (strip(path) === strip(this.poison)) throw new Error("EIO");
      return super.readFile(path);
    }
  }

  it("throws instead of silently dropping a present-but-unreadable file", async () => {
    const root = "data/aus/p";
    const poison = `${root}/chapters/main/ch0002.md`;
    const adapter = new PoisonAdapter(poison);
    await adapter.writeFile(`${root}/state.yaml`, "current_chapter: 2");
    await adapter.writeFile(`${root}/chapters/main/ch0001.md`, "ok");
    await adapter.writeFile(poison, "this file will fail to read");

    await expect(collectAuBundle(root, adapter)).rejects.toThrow(AuBundleError);
  });
});

describe("importAuBundle staleIndexStatus (review fix — lossless flip)", () => {
  it("flips index_status to stale while preserving unknown/extra state.yaml keys", async () => {
    const adapter = new MockAdapter();
    const bundle: AuBundle = {
      manifest: {
        bundle_version: AU_BUNDLE_VERSION, exported_at: "t", au_name: "x", fandom: "y",
        chapter_count: 0, file_count: 1, excluded_dirs: [],
      },
      files: {
        "state.yaml": "current_chapter: 5\nindex_status: ready\nfuture_field_from_simple_fork: 42\n",
      },
    };
    const TARGET = "data/aus/restored";
    await importAuBundle(TARGET, bundle, adapter, { staleIndexStatus: true });

    const written = await adapter.readFile(`${TARGET}/state.yaml`);
    expect(written).toContain("index_status: stale");
    expect(written).not.toContain("index_status: ready");
    expect(written).toContain("current_chapter: 5");
    expect(written).toContain("future_field_from_simple_fork: 42");   // 未知字段无损保留
  });

  it("does not touch state.yaml when staleIndexStatus is off", async () => {
    const adapter = new MockAdapter();
    const bundle: AuBundle = {
      manifest: { bundle_version: AU_BUNDLE_VERSION, exported_at: "t", au_name: "", fandom: "", chapter_count: 0, file_count: 1, excluded_dirs: [] },
      files: { "state.yaml": "index_status: ready\n" },
    };
    await importAuBundle("data/aus/r2", bundle, adapter);
    expect(await adapter.readFile("data/aus/r2/state.yaml")).toBe("index_status: ready\n");
  });
});

describe("validateBundle (TD-015 version guard)", () => {
  const ok: AuBundle = {
    manifest: {
      bundle_version: AU_BUNDLE_VERSION, exported_at: "t", au_name: "", fandom: "",
      chapter_count: 0, file_count: 0, excluded_dirs: [],
    },
    files: {},
  };

  it("accepts a same-major bundle", () => {
    expect(() => validateBundle(ok)).not.toThrow();
    expect(() => validateBundle({ ...ok, manifest: { ...ok.manifest, bundle_version: "1.9.3" } })).not.toThrow();
  });

  it("rejects an incompatible major version", () => {
    expect(() => validateBundle({ ...ok, manifest: { ...ok.manifest, bundle_version: "2.0.0" } }))
      .toThrow(AuBundleError);
  });

  it("rejects structurally invalid bundles", () => {
    expect(() => validateBundle(null)).toThrow(AuBundleError);
    expect(() => validateBundle({ files: {} })).toThrow(AuBundleError);
    expect(() => validateBundle({ manifest: { bundle_version: "1.0.0" } })).toThrow(AuBundleError);
    expect(() => validateBundle({ manifest: {}, files: {} })).toThrow(AuBundleError);
  });
});
