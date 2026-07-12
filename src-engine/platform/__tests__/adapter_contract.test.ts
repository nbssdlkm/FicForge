// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * L11（审计第二轮）：三端 PlatformAdapter 文件 I/O 语义契约测试。
 *
 * 补齐「平台 adapter 文件 I/O 零覆盖」缺口——此前 4 个 platform 测试只测 secret storage。
 * 以 platform/adapter.ts 的文档注释为契约基准，参数化跑在多个 adapter 上，钉住三端语义一致：
 *   - 写读 round-trip（中文 / 二进制）
 *   - rename 覆盖语义 + 源不存在抛错
 *   - 不存在文件的 read / delete / exists 行为
 *   - listDir 不存在目录
 *   - mkdir 幂等
 *
 * 覆盖范围（为何是这两个）：
 *   - MockAdapter：测试真相源，全引擎测试的文件后端，必须与真 adapter 同语义。
 *   - WebAdapter（fake-indexeddb）：PWA/iOS 唯一后端，真实 IndexedDB 语义。
 *   - Tauri / Capacitor **未纳入**：其文件 I/O 走 @tauri-apps/plugin-fs / @capacitor/filesystem
 *     动态导入，现有 platform 测试只 mock 了 secret-storage 的 invoke，没有可复用的内存 FS
 *     mock。为这两端手写一套有真实语义（自动建目录 / listDir / rename 覆盖 / stat）的 in-memory
 *     FS mock 成本高、且 mock 本身的语义正确性无从校验（等于自证）。故只钉 Mock + Web 两端，
 *     真机语义靠 e2e 兜底。若将来引入 FS plugin 的官方内存实现，可把它们参数化进来。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { PlatformAdapter } from "../adapter.js";
import { WebAdapter } from "../web_adapter.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";

interface AdapterCase {
  name: string;
  make: () => Promise<PlatformAdapter>;
  teardown?: () => void;
}

const cases: AdapterCase[] = [
  {
    name: "MockAdapter",
    make: async () => new MockAdapter(),
  },
  {
    name: "WebAdapter (fake-indexeddb)",
    make: async () => {
      (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
      const a = new WebAdapter("dev");
      await a.init();
      return a;
    },
    teardown: () => {
      delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
    },
  },
];

for (const c of cases) {
  describe(`PlatformAdapter 契约 — ${c.name}`, () => {
    let a: PlatformAdapter;
    beforeEach(async () => {
      a = await c.make();
    });
    afterEach(() => {
      c.teardown?.();
    });

    it("writeFile/readFile round-trip（中文）", async () => {
      await a.writeFile("d/sub/file.md", "第一章：夜色如墨。");
      await expect(a.readFile("d/sub/file.md")).resolves.toBe("第一章：夜色如墨。");
    });

    it("writeBinary/readBinary round-trip（二进制含 0 / 255）", async () => {
      const bytes = new Uint8Array([0, 1, 127, 128, 255]);
      await a.writeBinary("d/bin.dat", bytes);
      const out = await a.readBinary("d/bin.dat");
      expect([...out]).toEqual([...bytes]);
    });

    it("rename 覆盖已存在目标（POSIX 覆盖语义）", async () => {
      await a.writeFile("d/from.md", "new-content");
      await a.writeFile("d/to.md", "old-content-should-be-overwritten");
      await a.rename("d/from.md", "d/to.md");
      await expect(a.readFile("d/to.md")).resolves.toBe("new-content");
      // 源已移走
      await expect(a.exists("d/from.md")).resolves.toBe(false);
    });

    it("rename 源不存在 → 抛错", async () => {
      await expect(a.rename("d/nonexistent.md", "d/dest.md")).rejects.toBeTruthy();
    });

    it("readFile 不存在文件 → 抛错", async () => {
      await expect(a.readFile("d/missing.md")).rejects.toBeTruthy();
    });

    // 注：deleteFile(不存在) 的语义在三端漂移——此处 Web/内存为静默幂等；Tauri/Capacitor 会抛错
    // （见 adapter.ts 顶部漂移说明）。本套只跑 Web/内存，故断言其幂等语义。
    it("deleteFile 不存在文件 → 静默不抛（Web/内存幂等语义）", async () => {
      await expect(a.deleteFile("d/never-existed.md")).resolves.toBeUndefined();
    });

    it("exists：文件在返回 true、不在返回 false、目录前缀存在返回 true", async () => {
      await a.writeFile("d/dir/f.md", "x");
      await expect(a.exists("d/dir/f.md")).resolves.toBe(true);
      await expect(a.exists("d/dir/absent.md")).resolves.toBe(false);
      // 目录存在性：有子文件即视为存在
      await expect(a.exists("d/dir")).resolves.toBe(true);
    });

    // 注：listDir(不存在目录) 同样漂移——Web/内存返回 []；Tauri/Capacitor 抛错（见 adapter.ts）。
    it("listDir 不存在目录 → 返回空数组（Web/内存语义）", async () => {
      await expect(a.listDir("d/no-such-dir")).resolves.toEqual([]);
    });

    it("listDir 列出直接子项名（去重目录 + 文件）", async () => {
      await a.writeFile("root/a.md", "1");
      await a.writeFile("root/sub/b.md", "2");
      await a.writeFile("root/sub/c.md", "3");
      const names = (await a.listDir("root")).sort();
      expect(names).toEqual(["a.md", "sub"]);
    });

    it("mkdir 幂等（重复调用不抛）", async () => {
      await expect(a.mkdir("d/newdir")).resolves.toBeUndefined();
      await expect(a.mkdir("d/newdir")).resolves.toBeUndefined();
    });

    it("getFileSize：存在返回字节数、不存在返回 -1", async () => {
      await a.writeFile("d/size.md", "abc"); // 3 bytes ascii
      await expect(a.getFileSize("d/size.md")).resolves.toBe(3);
      await expect(a.getFileSize("d/absent.md")).resolves.toBe(-1);
    });
  });
}
