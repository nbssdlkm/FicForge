// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * L11（审计第二轮）：PlatformAdapter 文件 I/O 语义契约测试。
 *
 * 补齐「平台 adapter 文件 I/O 零覆盖」缺口——此前 4 个 platform 测试只测 secret storage。
 * 以 platform/adapter.ts 的文档注释为契约基准，参数化跑在多个 adapter 上，钉住各端语义一致：
 *   - 写读 round-trip（中文 / 二进制）
 *   - rename 覆盖语义 + 源不存在抛错
 *   - 不存在文件的 read / delete / exists 行为
 *   - listDir 不存在目录
 *   - mkdir 幂等
 *
 * 覆盖范围：
 *   - MockAdapter：测试真相源，全引擎测试的文件后端，必须与真 adapter 同语义。
 *   - WebAdapter（fake-indexeddb）：PWA/iOS 唯一后端，真实 IndexedDB 语义。
 *   - TauriAdapter / CapacitorAdapter（盲审 R5 测试 M1 补齐）：其文件 I/O 走
 *     @tauri-apps/plugin-fs / @capacitor/filesystem 动态导入，这里用 vi.mock 挂一套内存 FS，
 *     **忠实建模两端插件的真实语义差异**（非纯 pass-through 自证）：
 *       ① rename 覆盖——Tauri（Rust std::fs::rename）目标存在时原子覆盖；Capacitor（原生
 *          moveItem/renameTo）目标存在时抛错，adapter 靠「先 stat+delete 目标再 rename」补齐。
 *          mock 的 Capacitor rename 目标存在即抛，逼出 CapacitorAdapter 的预删逻辑（atomicWrite
 *          正确性前提），删掉预删就会被 rename-覆盖用例抓到。
 *       ② 父目录自动创建——Tauri 的 writeFile/writeTextFile **不**递归建父目录（写前须 mkdir，
 *          否则 ENOENT）；Capacitor adapter 传 recursive:true 故自动建。mock 据此对 Tauri 写侧
 *          校验父目录、Capacitor 放行，用例写嵌套路径前显式 mkdir（贴合真机调用序）。
 *     局限：mock 语义是对插件文档的建模、非真机验证，真机端到端另由 e2e 兜底；此套锁的是
 *     「adapter 在符合语义的插件之上是否正确实现契约」+「两端 error 传播 / 覆盖 / 建目录序」。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { PlatformAdapter } from "../adapter.js";
import { WebAdapter } from "../web_adapter.js";
import { TauriAdapter } from "../tauri_adapter.js";
import { CapacitorAdapter } from "../capacitor_adapter.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";

// 内存 FS 与两端 mock 需在 import 求值前就位（vi.mock 工厂会闭包引用），故走 vi.hoisted。
const io = vi.hoisted(() => {
  type Store = Map<string, Uint8Array>;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const isDir = (s: Store, p: string) => [...s.keys()].some((k) => k.startsWith(`${p}/`));
  const existsP = (s: Store, p: string) => s.has(p) || isDir(s, p);
  const immediate = (s: Store, dir: string) => {
    const prefix = `${dir}/`;
    const names = new Set<string>();
    for (const k of s.keys()) {
      if (k.startsWith(prefix)) names.add(k.slice(prefix.length).split("/")[0]);
    }
    return [...names];
  };
  const b64enc = (u: Uint8Array) => Buffer.from(u).toString("base64");
  const b64dec = (b: string) => new Uint8Array(Buffer.from(b, "base64"));
  const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const addDirWithAncestors = (dirs: Set<string>, p: string) => {
    const parts = p.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  };
  return {
    tauri: new Map<string, Uint8Array>(),
    // Tauri 端建模「不自动建父目录」：真 @tauri-apps/plugin-fs 的 writeTextFile/writeFile 只建文件、
    // 不递归建父目录（与 Capacitor adapter 的 recursive:true 相反）。写前父目录须已 mkdir，否则 ENOENT。
    tauriDirs: new Set<string>(),
    cap: new Map<string, Uint8Array>(),
    encoder,
    decoder,
    existsP,
    immediate,
    b64enc,
    b64dec,
    parentOf,
    addDirWithAncestors,
  };
});

// @tauri-apps/plugin-fs：Rust std::fs 语义——rename 目标存在时原子覆盖；remove/rename 源缺失抛错。
vi.mock("@tauri-apps/plugin-fs", () => {
  const s = io.tauri;
  return {
    readTextFile: async (p: string) => {
      if (!s.has(p)) throw new Error("ENOENT");
      return io.decoder.decode(s.get(p));
    },
    writeTextFile: async (p: string, c: string) => {
      const parent = io.parentOf(p);
      if (parent && !io.tauriDirs.has(parent)) throw new Error("ENOENT: parent dir missing"); // Tauri 不自动建父目录
      s.set(p, io.encoder.encode(c));
    },
    remove: async (p: string) => {
      if (!s.has(p)) throw new Error("ENOENT");
      s.delete(p);
    },
    rename: async (from: string, to: string) => {
      if (!s.has(from)) throw new Error("ENOENT");
      s.set(to, s.get(from)!); // 目标存在则原子覆盖
      s.delete(from);
    },
    readFile: async (p: string) => {
      if (!s.has(p)) throw new Error("ENOENT");
      return s.get(p)!;
    },
    writeFile: async (p: string, d: Uint8Array) => {
      const parent = io.parentOf(p);
      if (parent && !io.tauriDirs.has(parent)) throw new Error("ENOENT: parent dir missing"); // Tauri 不自动建父目录
      s.set(p, new Uint8Array(d));
    },
    stat: async (p: string) => {
      if (!io.existsP(s, p)) throw new Error("ENOENT");
      const isFile = s.has(p);
      return { size: s.get(p)?.length ?? 0, isFile, isDirectory: !isFile };
    },
    readDir: async (p: string) => {
      if (!io.existsP(s, p)) throw new Error("ENOENT");
      return io.immediate(s, p).map((name) => ({ name }));
    },
    exists: async (p: string) => io.existsP(s, p),
    mkdir: async (p: string) => {
      io.addDirWithAncestors(io.tauriDirs, p); // recursive:true —— 记录目录供写前父目录校验
    },
  };
});

// @capacitor/filesystem：Directory.Data 为根（相对路径）；rename 目标存在时抛错（不覆盖）；
// readFile/writeFile 按 encoding 走 UTF8 文本 or base64 二进制。
vi.mock("@capacitor/filesystem", () => {
  const s = io.cap;
  const norm = (p: string) => p.replace(/^\/+/, "");
  return {
    Directory: { Data: "DATA" },
    Encoding: { UTF8: "utf8" },
    Filesystem: {
      readFile: async ({ path, encoding }: { path: string; encoding?: string }) => {
        const k = norm(path);
        if (!s.has(k)) throw new Error("ENOENT");
        const bytes = s.get(k)!;
        return { data: encoding ? io.decoder.decode(bytes) : io.b64enc(bytes) };
      },
      writeFile: async ({ path, data, encoding }: { path: string; data: string; encoding?: string }) => {
        s.set(norm(path), encoding ? io.encoder.encode(data) : io.b64dec(data));
      },
      deleteFile: async ({ path }: { path: string }) => {
        const k = norm(path);
        if (!s.has(k)) throw new Error("ENOENT");
        s.delete(k);
      },
      rename: async ({ from, to }: { from: string; to: string }) => {
        const f = norm(from);
        const t = norm(to);
        if (!s.has(f)) throw new Error("ENOENT");
        if (s.has(t)) throw new Error("EEXIST"); // 原生不覆盖——逼出 adapter 预删逻辑
        s.set(t, s.get(f)!);
        s.delete(f);
      },
      stat: async ({ path }: { path: string }) => {
        const k = norm(path);
        if (!io.existsP(s, k)) throw new Error("ENOENT");
        return { size: s.get(k)?.length ?? 0, type: s.has(k) ? "file" : "directory" };
      },
      readdir: async ({ path }: { path: string }) => {
        const k = norm(path);
        if (!io.existsP(s, k)) throw new Error("ENOENT");
        return { files: io.immediate(s, k).map((name) => ({ name })) };
      },
      mkdir: async () => {},
    },
  };
});

interface AdapterCase {
  name: string;
  make: () => Promise<PlatformAdapter>;
  teardown?: () => void;
  /** deleteFile(不存在) / listDir(不存在目录) 的语义在各端漂移——见 adapter.ts 顶部说明。 */
  deleteMissingThrows?: boolean;
  listDirMissingThrows?: boolean;
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
  {
    name: "TauriAdapter (mem plugin-fs)",
    make: async () => {
      io.tauri.clear();
      io.tauriDirs.clear();
      return new TauriAdapter("dev");
    },
    deleteMissingThrows: true,
    listDirMissingThrows: true,
  },
  {
    name: "CapacitorAdapter (mem filesystem)",
    make: async () => {
      io.cap.clear();
      return new CapacitorAdapter("dev");
    },
    deleteMissingThrows: true,
    listDirMissingThrows: true,
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
      await a.mkdir("d/sub"); // 写嵌套路径前先建目录（真机 Tauri 不自动建父目录）
      await a.writeFile("d/sub/file.md", "第一章：夜色如墨。");
      await expect(a.readFile("d/sub/file.md")).resolves.toBe("第一章：夜色如墨。");
    });

    it("writeBinary/readBinary round-trip（二进制含 0 / 255）", async () => {
      await a.mkdir("d");
      const bytes = new Uint8Array([0, 1, 127, 128, 255]);
      await a.writeBinary("d/bin.dat", bytes);
      const out = await a.readBinary("d/bin.dat");
      expect([...out]).toEqual([...bytes]);
    });

    it("rename 覆盖已存在目标（POSIX 覆盖语义）", async () => {
      await a.mkdir("d");
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

    // 注：deleteFile(不存在) 的语义在各端漂移——Web/内存静默幂等；Tauri/Capacitor 抛错
    // （见 adapter.ts 顶部漂移说明），故按 case 标记分流断言。
    it("deleteFile 不存在文件（幂等 or 抛错，按端语义）", async () => {
      if (c.deleteMissingThrows) {
        await expect(a.deleteFile("d/never-existed.md")).rejects.toBeTruthy();
      } else {
        await expect(a.deleteFile("d/never-existed.md")).resolves.toBeUndefined();
      }
    });

    it("exists：文件在返回 true、不在返回 false、目录前缀存在返回 true", async () => {
      await a.mkdir("d/dir");
      await a.writeFile("d/dir/f.md", "x");
      await expect(a.exists("d/dir/f.md")).resolves.toBe(true);
      await expect(a.exists("d/dir/absent.md")).resolves.toBe(false);
      // 目录存在性：有子文件即视为存在
      await expect(a.exists("d/dir")).resolves.toBe(true);
    });

    it("statEntry：文件→file、目录（有子文件）→directory、不存在→missing（盲审 R5 架构 M3）", async () => {
      await a.mkdir("d/dir");
      await a.writeFile("d/dir/f.md", "x");
      await expect(a.statEntry("d/dir/f.md")).resolves.toBe("file");
      await expect(a.statEntry("d/dir")).resolves.toBe("directory");
      await expect(a.statEntry("d/none")).resolves.toBe("missing");
    });

    // 注：listDir(不存在目录) 同样漂移——Web/内存返回 []；Tauri/Capacitor 抛错（见 adapter.ts）。
    it("listDir 不存在目录（空数组 or 抛错，按端语义）", async () => {
      if (c.listDirMissingThrows) {
        await expect(a.listDir("d/no-such-dir")).rejects.toBeTruthy();
      } else {
        await expect(a.listDir("d/no-such-dir")).resolves.toEqual([]);
      }
    });

    it("listDir 列出直接子项名（去重目录 + 文件）", async () => {
      await a.mkdir("root/sub"); // 建 root + root/sub
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
      await a.mkdir("d");
      await a.writeFile("d/size.md", "abc"); // 3 bytes ascii
      await expect(a.getFileSize("d/size.md")).resolves.toBe(3);
      await expect(a.getFileSize("d/absent.md")).resolves.toBe(-1);
    });

    // onVisibilityChange 契约（E4 审）：订阅返回退订函数、订阅不抛、重复退订幂等。
    // 无 DOM 的 Node 测试环境走 sharedOnVisibilityChange 的 `typeof document === "undefined"`
    // 分支（返回 no-op），故此处不驱动 cb，只钉订阅/退订的接口契约。
    it("onVisibilityChange：返回退订函数、订阅不抛、重复退订幂等", () => {
      let unsub: (() => void) | undefined;
      expect(() => {
        unsub = a.onVisibilityChange(() => {});
      }).not.toThrow();
      expect(typeof unsub).toBe("function");
      expect(() => unsub!()).not.toThrow();
      expect(() => unsub!()).not.toThrow(); // 重复退订幂等，不抛
    });
  });
}
