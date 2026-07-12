// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * atomicWrite 契约测试（E5 对抗审 codex 采纳）：写 .tmp → rename 的失败语义——
 * 任一步失败正式路径不被触碰（旧内容完好）、错误原样上抛；成功路径 .tmp 被 rename 消费。
 * 固定 .tmp 命名 + `atomicWrite:` 前缀锁的并发前提见函数 docstring。
 */

import { describe, expect, it } from "vitest";
import { atomicWrite } from "../file_utils.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";

const PATH = "fandoms/F/aus/A/chapters/main/ch0001.md";

describe("atomicWrite 契约", () => {
  it("成功路径：正式文件 = 新内容，.tmp 被 rename 消费", async () => {
    const a = new MockAdapter();
    await a.writeFile(PATH, "旧内容");
    await atomicWrite(a, PATH, "新内容");
    expect(a.raw(PATH)).toBe("新内容");
    expect(a.raw(`${PATH}.tmp`)).toBeUndefined();
  });

  it(".tmp 写入失败：错误上抛，正式文件旧内容完好", async () => {
    class TmpFailAdapter extends MockAdapter {
      override async writeFile(path: string, content: string): Promise<void> {
        if (path.endsWith(".tmp")) throw new Error("disk full");
        return super.writeFile(path, content);
      }
    }
    const a = new TmpFailAdapter();
    await a.writeFile(PATH, "旧内容"); // 非 .tmp 路径不被拦，直接种旧内容
    await expect(atomicWrite(a, PATH, "新内容")).rejects.toThrow("disk full");
    expect(a.raw(PATH)).toBe("旧内容");
  });

  it("rename 失败：错误上抛，正式文件旧内容完好（.tmp 残留可被下次覆盖）", async () => {
    class RenameFailAdapter extends MockAdapter {
      override async rename(): Promise<void> {
        throw new Error("rename EACCES");
      }
    }
    const a = new RenameFailAdapter();
    await a.writeFile(PATH, "旧内容");
    await expect(atomicWrite(a, PATH, "新内容")).rejects.toThrow("rename EACCES");
    expect(a.raw(PATH)).toBe("旧内容");
    // .tmp 残留（新内容）——readJsonl 的遗留恢复逻辑正是以此为食
    expect(a.raw(`${PATH}.tmp`)).toBe("新内容");
  });

  it("同路径并发 atomicWrite 串行化（atomicWrite: 前缀锁），后写者胜", async () => {
    const a = new MockAdapter();
    await Promise.all([atomicWrite(a, PATH, "A"), atomicWrite(a, PATH, "B")]);
    // 锁保证两次完整先后执行（无 .tmp 交错崩溃）；后完成者内容留存
    expect(["A", "B"]).toContain(a.raw(PATH));
    expect(a.raw(`${PATH}.tmp`)).toBeUndefined();
  });
});
