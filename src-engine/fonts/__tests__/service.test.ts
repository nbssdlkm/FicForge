// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FontsService } from "../service.js";
import { FontStorage } from "../storage.js";
import { FontDownloader } from "../downloader.js";
import { NoopFontRegistry } from "../registry.js";
import type { FontRegistry } from "../registry.js";
import { FONT_MANIFEST, getFontById } from "../manifest.js";
import { FontError } from "../types.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";

// manifest 中已知的 id（测试依赖这两条 entry 存在）
const BUILTIN_ID = "lxgw-wenkai-screen";
const DOWNLOADABLE_ID = "lxgw-wenkai-gb";

// mock 数据
const MOCK_FONT_BYTES = new Uint8Array([1, 2, 3]);

function makeResponse(data: Uint8Array, status = 200): Response {
  return new Response(data, {
    status,
    headers: { "Content-Length": String(data.byteLength) },
  });
}

describe("FontsService", () => {
  let adapter: MockAdapter;
  let storage: FontStorage;
  let registry: NoopFontRegistry;
  let downloader: FontDownloader;
  let service: FontsService;

  beforeEach(() => {
    adapter = new MockAdapter();
    storage = new FontStorage(adapter);
    registry = new NoopFontRegistry();
    downloader = new FontDownloader({
      fetchImpl: vi.fn().mockImplementation(async () =>
        makeResponse(MOCK_FONT_BYTES),
      ),
    });
    // Spy download() 返回 mock 字节，跳过内部 sha256 校验（checksum 逻辑已有专门的 downloader 单测覆盖）。
    vi.spyOn(downloader, "download").mockResolvedValue(MOCK_FONT_BYTES);
    service = new FontsService(storage, downloader, registry);
  });

  describe("listAvailable", () => {
    it("returns the full manifest", () => {
      expect(service.listAvailable()).toBe(FONT_MANIFEST);
    });
  });

  describe("statusOf", () => {
    it("returns not-installed for unknown id", async () => {
      expect(await service.statusOf("no-such-font")).toBe("not-installed");
    });

    it("returns installed for builtin unconditionally (HTML static load)", async () => {
      // 内置字体由 index.html 静态加载，不经过 Registry；Service 一律报 installed。
      expect(await service.statusOf(BUILTIN_ID)).toBe("installed");
    });

    it("returns installed for downloadable when file exists on disk", async () => {
      await storage.write(DOWNLOADABLE_ID, new Uint8Array([1]));
      expect(await service.statusOf(DOWNLOADABLE_ID)).toBe("installed");
    });

    it("returns not-installed for downloadable when file absent", async () => {
      expect(await service.statusOf(DOWNLOADABLE_ID)).toBe("not-installed");
    });
  });

  describe("uninstall", () => {
    it("throws not-found on unknown id", async () => {
      await expect(service.uninstall("no-such-font")).rejects.toMatchObject({
        name: "FontError",
        code: "not-found",
      });
    });

    it("throws unsupported on builtin font", async () => {
      await expect(service.uninstall(BUILTIN_ID)).rejects.toMatchObject({
        name: "FontError",
        code: "unsupported",
      });
    });

    it("removes file + unregisters for downloadable", async () => {
      const entry = getFontById(DOWNLOADABLE_ID)!;
      await storage.write(DOWNLOADABLE_ID, new Uint8Array([1]));
      await registry.registerFromData(entry, new Uint8Array([1]));
      expect(registry.isRegistered(DOWNLOADABLE_ID)).toBe(true);

      await service.uninstall(DOWNLOADABLE_ID);

      expect(await storage.exists(DOWNLOADABLE_ID)).toBe(false);
      expect(registry.isRegistered(DOWNLOADABLE_ID)).toBe(false);
    });

    it("is idempotent on non-installed downloadable", async () => {
      await expect(service.uninstall(DOWNLOADABLE_ID)).resolves.not.toThrow();
    });
  });

  describe("hydrateAll", () => {
    it("skips builtin fonts (HTML static load)", async () => {
      // 内置字体不经过 Service.hydrate，不进 registry。
      await service.hydrateAll();
      const builtinIds = FONT_MANIFEST
        .filter((f) => f.type === "builtin")
        .map((f) => f.id);
      for (const id of builtinIds) {
        expect(registry.isRegistered(id)).toBe(false);
      }
    });

    it("registers downloadable fonts already on disk", async () => {
      await storage.write(DOWNLOADABLE_ID, new Uint8Array([1, 2]));
      await service.hydrateAll();
      expect(registry.isRegistered(DOWNLOADABLE_ID)).toBe(true);
    });

    it("filters out files that are not in the manifest", async () => {
      await storage.write("ghost-not-in-manifest", new Uint8Array([1]));
      await service.hydrateAll();
      expect(registry.isRegistered("ghost-not-in-manifest")).toBe(false);
    });

    it("does not hydrate downloadable fonts absent from disk", async () => {
      await service.hydrateAll();
      expect(registry.isRegistered(DOWNLOADABLE_ID)).toBe(false);
    });
  });

  describe("install", () => {
    it("throws not-found for unknown id", async () => {
      await expect(service.install("no-such-font")).rejects.toMatchObject({
        code: "not-found",
      });
    });

    it("is a no-op for builtin fonts (HTML static load handles them)", async () => {
      await service.install(BUILTIN_ID);
      // Service 不调用 registry 也不写 storage —— HTML 负责。
      expect(registry.isRegistered(BUILTIN_ID)).toBe(false);
      expect(await storage.exists(BUILTIN_ID)).toBe(false);
    });

    it("downloads, stores, and registers a downloadable font", async () => {
      await service.install(DOWNLOADABLE_ID);
      expect(await storage.exists(DOWNLOADABLE_ID)).toBe(true);
      expect(registry.isRegistered(DOWNLOADABLE_ID)).toBe(true);
    });

    it("tracks pending downloads via isDownloading + rejects concurrent install", async () => {
      // 慢速 fetch：pending 直到 signal abort 才 reject（保证测试能清理退出）。
      const slowFetch = vi.fn().mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const slowService = new FontsService(
        storage,
        new FontDownloader({ fetchImpl: slowFetch }),
        registry,
      );

      const controller = new AbortController();
      const first = slowService.install(DOWNLOADABLE_ID, { signal: controller.signal });
      // 推进 microtasks 让 install 进入 pending 状态
      await new Promise((r) => setTimeout(r, 0));

      expect(slowService.isDownloading(DOWNLOADABLE_ID)).toBe(true);

      // 并发 install 同一字体应立即拒绝
      await expect(slowService.install(DOWNLOADABLE_ID)).rejects.toMatchObject({
        code: "network",
      });

      // 清理第一次下载
      controller.abort();
      await first.catch(() => {});
      expect(slowService.isDownloading(DOWNLOADABLE_ID)).toBe(false);
    });

    it("respects external abort signal", async () => {
      // fetch 实现：通过 init.signal 监听中断并 reject。
      const cancelFetch = vi.fn().mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const svc = new FontsService(
        storage,
        new FontDownloader({ fetchImpl: cancelFetch }),
        registry,
      );
      const controller = new AbortController();
      const promise = svc.install(DOWNLOADABLE_ID, { signal: controller.signal });
      await new Promise((r) => setTimeout(r, 0));
      controller.abort();
      await expect(promise).rejects.toMatchObject({ code: "aborted" });
      expect(svc.isDownloading(DOWNLOADABLE_ID)).toBe(false);
    });
  });

  describe("abort", () => {
    it("is no-op when no download in progress", () => {
      expect(() => service.abort(DOWNLOADABLE_ID)).not.toThrow();
    });
  });

  describe("totalStorageSize", () => {
    it("returns 0 when no fonts are downloaded", async () => {
      expect(await service.totalStorageSize()).toBe(0);
    });

    it("sums byte sizes of all downloaded fonts", async () => {
      await storage.write("font-a", new Uint8Array(100));
      await storage.write("font-b", new Uint8Array(200));
      await storage.write("font-c", new Uint8Array(50));
      expect(await service.totalStorageSize()).toBe(350);
    });

    it("decreases after uninstall", async () => {
      await storage.write(DOWNLOADABLE_ID, new Uint8Array(500));
      expect(await service.totalStorageSize()).toBe(500);
      await service.uninstall(DOWNLOADABLE_ID);
      expect(await service.totalStorageSize()).toBe(0);
    });
  });

  describe("install — rollback on registry failure", () => {
    it("deletes storage file when registerFromData throws", async () => {
      // 真 bug 的回归测试：以前 register 失败后文件仍落盘，statusOf 误报
      // "installed" 但 CSS 用不到。现在必须回滚存储。
      const failingRegistry: FontRegistry = {
        registerFromData: vi.fn().mockRejectedValue(
          new FontError("registry", "simulated FontFace.load failure"),
        ),
        registerFromUrl: vi.fn().mockResolvedValue(undefined),
        unregister: vi.fn(),
        isRegistered: () => false,
        listRegistered: () => [],
      };
      const svc = new FontsService(storage, downloader, failingRegistry);

      await expect(svc.install(DOWNLOADABLE_ID)).rejects.toMatchObject({
        code: "registry",
      });

      // 关键断言：storage 被回滚，不留半状态。
      expect(await storage.exists(DOWNLOADABLE_ID)).toBe(false);
      expect(failingRegistry.registerFromData).toHaveBeenCalledTimes(1);
    });

    it("does not leave pending flag after rollback", async () => {
      const failingRegistry: FontRegistry = {
        registerFromData: vi.fn().mockRejectedValue(new FontError("registry", "boom")),
        registerFromUrl: vi.fn().mockResolvedValue(undefined),
        unregister: vi.fn(),
        isRegistered: () => false,
        listRegistered: () => [],
      };
      const svc = new FontsService(storage, downloader, failingRegistry);

      await expect(svc.install(DOWNLOADABLE_ID)).rejects.toBeDefined();
      expect(svc.isDownloading(DOWNLOADABLE_ID)).toBe(false);
    });
  });
});
