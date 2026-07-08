// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * WebAdapter 文件 I/O — 用 fake-indexeddb 跑真实 IndexedDB 语义。
 *
 * 重点覆盖 L12（审计第二轮）：
 * - iOS Safari 后台回收连接 → 对旧连接 db.transaction() 同步抛 InvalidStateError →
 *   适配器重开 DB 重试一次，保存不再永久失败。
 * - 以及基本的写读 round-trip（中文/二进制），补齐「平台 adapter 文件 I/O 零覆盖」缺口。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { WebAdapter } from "../web_adapter.js";

// 每个用例给一个全新的 fake IndexedDB（隔离 DB 状态）。
function freshIdb() {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
}

describe("WebAdapter 文件 I/O (fake-indexeddb)", () => {
  let adapter: WebAdapter;

  beforeEach(async () => {
    freshIdb();
    adapter = new WebAdapter("dev");
    await adapter.init();
  });

  afterEach(() => {
    delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
  });

  it("writeFile/readFile round-trip 中文", async () => {
    await adapter.writeFile("au1/chapters/ch1.md", "夜色如墨，长街寂寂。");
    await expect(adapter.readFile("au1/chapters/ch1.md")).resolves.toBe("夜色如墨，长街寂寂。");
  });

  it("writeBinary/readBinary round-trip 二进制", async () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    await adapter.writeBinary("au1/font.bin", bytes);
    const out = await adapter.readBinary("au1/font.bin");
    expect([...out]).toEqual([...bytes]);
  });

  // ── L12: InvalidStateError（连接被回收）→ 重开 DB 重试一次 ──
  it("L12: db 连接被关闭后写入触发 InvalidStateError → 自动重开重试成功", async () => {
    // 先证明正常写入可行
    await adapter.writeFile("k", "v1");

    // 模拟 iOS Safari 后台回收：关闭适配器内部持有的连接。
    // 之后对该旧连接调 db.transaction() 会同步抛 InvalidStateError。
    (adapter as unknown as { _db: IDBDatabase })._db.close();

    // 旧代码：writeFile 直接抛 InvalidStateError（保存永久失败到手动刷新）。
    // 修复后：捕获 → 重开 DB → 重试一次 → 成功。
    await expect(adapter.writeFile("k", "v2")).resolves.toBeUndefined();
    // 数据真的落盘了（用新连接读回）
    await expect(adapter.readFile("k")).resolves.toBe("v2");
  });

  it("L12: 连接被关闭后读取也自动重开重试", async () => {
    await adapter.writeFile("k2", "hello");
    (adapter as unknown as { _db: IDBDatabase })._db.close();
    await expect(adapter.readFile("k2")).resolves.toBe("hello");
  });

  // ── R1-10: rename = get(old) → put(new) → delete(old) 三段 withDb，
  //    中途连接被回收（InvalidStateError）也要经重开重试完成 ──
  it("R1-10: rename 中途（get 成功后、put 之前）连接被回收 → withDb 重开重试，rename 完整完成", async () => {
    await adapter.writeFile("old/path.md", "章节正文");

    // 在第二段 withDb（put(new)）开始前关闭当前连接：该段对旧连接开 transaction 会
    // 同步抛 InvalidStateError → withDb 捕获 → 重开 DB → 用新连接重试完成。
    type WithDb = <T>(op: (db: IDBDatabase) => Promise<T>) => Promise<T>;
    const anyAdapter = adapter as unknown as { withDb: WithDb; _db: IDBDatabase };
    const realWithDb = anyAdapter.withDb.bind(adapter) as WithDb;
    let segment = 0;
    anyAdapter.withDb = ((op) => {
      segment += 1;
      if (segment === 2) {
        anyAdapter._db.close(); // 模拟 iOS Safari 在 rename 半路回收连接
      }
      return realWithDb(op);
    }) as WithDb;

    await expect(adapter.rename("old/path.md", "new/path.md")).resolves.toBeUndefined();
    // 新路径可读、旧路径已删（用重开后的活连接验证）
    await expect(adapter.readFile("new/path.md")).resolves.toBe("章节正文");
    await expect(adapter.readFile("old/path.md")).rejects.toThrow(/not found/i);
  });

  it("L12: 只重试一次——重开后仍失败则抛（不无限循环）", async () => {
    await adapter.writeFile("k3", "x");
    const closed = (adapter as unknown as { _db: IDBDatabase })._db;
    closed.close();
    // 让 openDB 重开后拿到的也是一个已关闭连接：monkeypatch indexedDB.open 返回关闭态。
    // 用一个会立刻 close 的连接模拟「重开后仍不可用」。
    const realOpen = (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB.open.bind(
      (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB,
    );
    (globalThis as unknown as { indexedDB: { open: unknown } }).indexedDB.open = ((name: string, ver?: number) => {
      const req = realOpen(name, ver);
      req.addEventListener("success", () => {
        // 重开成功后立刻关闭 → 后续 transaction 仍 InvalidStateError
        (req.result as IDBDatabase).close();
      });
      return req;
    }) as typeof realOpen;

    await expect(adapter.writeFile("k3", "y")).rejects.toBeInstanceOf(DOMException);
  });
});
