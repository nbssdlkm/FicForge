// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 审计 H5 判别性测试：真原子写（write-tmp-then-rename）+ 遗留 .tmp 恢复。
 *
 * 判别性设计（回退旧码必挂）：
 * - 旧版 atomicWrite 是「写 .tmp → 二次全量写正式路径 → 删 .tmp」——
 *   对正式路径的 writeFile 注入「写一半崩溃」，旧码会留下截断的正式文件；
 *   新码对正式路径只走 rename，不会触发注入点。
 * - 「rename 前崩溃」时新码保证正式文件保持旧内容完整（写入等于没发生）。
 * - read_jsonl 的 .tmp 恢复只在「主文件缺失/有坏行 + .tmp 严格更多合法行」启用。
 */

import { describe, expect, it, vi } from "vitest";
import { MockAdapter } from "./mock_adapter.js";
import { atomicWrite, read_jsonl } from "../../utils/file_utils.js";

/** 对**正式路径**（非 .tmp）的 writeFile 模拟「写一半掉电」：落半截内容后抛错。 */
class TruncatingCrashAdapter extends MockAdapter {
  crashOnMainWrite = false;

  override async writeFile(path: string, content: string): Promise<void> {
    if (this.crashOnMainWrite && !path.endsWith(".tmp")) {
      await super.writeFile(path, content.slice(0, Math.floor(content.length / 2)));
      throw new Error("simulated power loss mid-write");
    }
    return super.writeFile(path, content);
  }
}

/** rename 时崩溃（.tmp 已写全、尚未提交）。 */
class RenameCrashAdapter extends MockAdapter {
  crashOnRename = false;

  override async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.crashOnRename) throw new Error("simulated crash before rename");
    return super.rename(oldPath, newPath);
  }
}

const parseId = (d: Record<string, unknown>) => d.id as number;

describe("atomicWrite（write-tmp-then-rename）", () => {
  it("正常路径：新内容完整提交，无 .tmp 残留", async () => {
    const adapter = new MockAdapter();
    adapter.seed("data/file.yaml", "old: content\n");

    await atomicWrite(adapter, "data/file.yaml", "new: content\n");

    expect(adapter.raw("data/file.yaml")).toBe("new: content\n");
    expect(adapter.allFiles().filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("rename 前崩溃：正式文件保持旧内容完整，.tmp 保有新内容", async () => {
    const adapter = new RenameCrashAdapter();
    adapter.seed("data/file.yaml", "old: content\n");
    adapter.crashOnRename = true;

    await expect(atomicWrite(adapter, "data/file.yaml", "new: content\n")).rejects.toThrow();

    // 写入等于没发生 —— 不是旧版的「截断固化」
    expect(adapter.raw("data/file.yaml")).toBe("old: content\n");
    expect(adapter.raw("data/file.yaml.tmp")).toBe("new: content\n");
  });

  it("判别测试：正式路径 writeFile 中途崩溃不影响提交（新码只经 rename 提交；旧码直写正式路径必挂）", async () => {
    const adapter = new TruncatingCrashAdapter();
    adapter.seed("data/file.yaml", "old: content\n");
    adapter.crashOnMainWrite = true;

    await atomicWrite(adapter, "data/file.yaml", "new: content\n");

    // 旧版实现（二次全量写正式路径）会在这里留下半截内容并抛错
    expect(adapter.raw("data/file.yaml")).toBe("new: content\n");
    expect(adapter.allFiles().filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("read_jsonl 遗留 .tmp 恢复（迁移期兜底）", () => {
  it("主文件尾部截断 + .tmp 更完整：console.warn + 用 .tmp 重建主文件并返回完整内容", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const adapter = new MockAdapter();
      const fullText = '{"id":1}\n{"id":2}\n{"id":3}\n';
      // 旧版 atomicWrite 二次写中途崩溃的现场：主文件最后一行被截断
      adapter.seed("au/facts.jsonl", '{"id":1}\n{"id":2}\n{"id":3');
      adapter.seed("au/facts.jsonl.tmp", fullText);

      const [items, errors] = await read_jsonl(adapter, "au/facts.jsonl", parseId);

      expect(items).toEqual([1, 2, 3]);
      expect(errors).toEqual([]);
      expect(adapter.raw("au/facts.jsonl")).toBe(fullText); // 主文件已修复
      expect(adapter.raw("au/facts.jsonl.tmp")).toBeUndefined(); // .tmp 被消费
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("主文件缺失 + .tmp 完整：恢复并落盘", async () => {
    const adapter = new MockAdapter();
    adapter.seed("au/threads.jsonl.tmp", '{"id":7}\n{"id":8}\n');

    const [items] = await read_jsonl(adapter, "au/threads.jsonl", parseId);

    expect(items).toEqual([7, 8]);
    expect(adapter.raw("au/threads.jsonl")).toBe('{"id":7}\n{"id":8}\n');
  });

  it(".tmp 合法行数不多于主文件：不启用恢复，主文件与 .tmp 原样保留", async () => {
    const adapter = new MockAdapter();
    // 主文件 2 合法行 + 1 坏行；.tmp 只有 2 合法行 —— 不比主文件完整，不动
    adapter.seed("au/facts.jsonl", '{"id":1}\n{"id":2}\n{"id":3');
    adapter.seed("au/facts.jsonl.tmp", '{"id":1}\n{"id":2}\n');

    const [items, errors] = await read_jsonl(adapter, "au/facts.jsonl", parseId);

    expect(items).toEqual([1, 2]);
    expect(errors).toHaveLength(1);
    expect(adapter.raw("au/facts.jsonl")).toBe('{"id":1}\n{"id":2}\n{"id":3');
    expect(adapter.raw("au/facts.jsonl.tmp")).toBe('{"id":1}\n{"id":2}\n');
  });

  it("主文件健康：即使 .tmp 行数更多也不恢复（未提交写入不复活），零额外读取", async () => {
    const adapter = new MockAdapter();
    const mainText = '{"id":1}\n{"id":2}\n';
    // 新版 rename 前崩溃的现场：主文件完整（旧状态）+ .tmp 是未提交的新写入
    adapter.seed("au/facts.jsonl", mainText);
    adapter.seed("au/facts.jsonl.tmp", '{"id":1}\n{"id":2}\n{"id":3}\n');

    const [items, errors] = await read_jsonl(adapter, "au/facts.jsonl", parseId);

    expect(items).toEqual([1, 2]);
    expect(errors).toEqual([]);
    expect(adapter.raw("au/facts.jsonl")).toBe(mainText);
  });

  it("主文件与 .tmp 都缺失：维持原语义返回空", async () => {
    const adapter = new MockAdapter();
    const [items, errors] = await read_jsonl(adapter, "au/none.jsonl", parseId);
    expect(items).toEqual([]);
    expect(errors).toEqual([]);
  });
});
