// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, vi } from "vitest";
import { FontDownloader, sha256Hex } from "../downloader.js";
import { FontError } from "../types.js";
import type { DownloadableFont } from "../types.js";

/** 构造一个 downloadable 字体条目，便于各测试用例复用。 */
function makeEntry(overrides: Partial<DownloadableFont> = {}): DownloadableFont {
  return {
    type: "downloadable",
    id: "test-font",
    family: "Test Font",
    displayName: { zh: "测试字体", en: "Test Font" },
    script: "latin",
    category: "serif",
    license: "SIL OFL 1.1",
    sizeBytes: 128,
    sha256: "",
    sources: [{ url: "https://primary.example.com/font.woff2", priority: 1 }],
    ...overrides,
  };
}

/** 构造一个模拟 Response，包含 ReadableStream body + Content-Length。 */
function mockResponse(data: Uint8Array, status = 200): Response {
  return new Response(data, {
    status,
    headers: { "Content-Length": String(data.byteLength) },
  });
}

describe("FontDownloader.download — single source", () => {
  it("downloads and returns bytes from a single source", async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(data));
    const downloader = new FontDownloader({ fetchImpl });

    const result = await downloader.download(makeEntry());

    expect(result).toEqual(data);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("https://primary.example.com/font.woff2", expect.any(Object));
  });

  it("invokes onProgress with loaded/total bytes", async () => {
    const data = new Uint8Array(100);
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(data));
    const downloader = new FontDownloader({ fetchImpl });
    const progressEvents: { loaded: number; total: number }[] = [];

    await downloader.download(makeEntry(), (p) => progressEvents.push(p));

    expect(progressEvents.length).toBeGreaterThan(0);
    const last = progressEvents[progressEvents.length - 1];
    expect(last.loaded).toBe(100);
    expect(last.total).toBe(100);
  });

  it("rejects with network error on HTTP 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("not found", { status: 404, statusText: "Not Found" }),
    );
    const downloader = new FontDownloader({ fetchImpl });

    await expect(downloader.download(makeEntry())).rejects.toMatchObject({
      name: "FontError",
      code: "network",
    });
  });
});

describe("FontDownloader.download — multi-source failover", () => {
  it("falls back to secondary source when primary fails", async () => {
    const data = new Uint8Array([10, 20, 30]);
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED primary"))
      .mockResolvedValueOnce(mockResponse(data));
    const downloader = new FontDownloader({ fetchImpl });

    const result = await downloader.download(makeEntry({
      sources: [
        { url: "https://primary.example.com/font.woff2", priority: 1 },
        { url: "https://backup.example.com/font.woff2", priority: 2 },
      ],
    }));

    expect(result).toEqual(data);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("tries sources in priority order (ascending)", async () => {
    const data = new Uint8Array([1]);
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(data));
    const downloader = new FontDownloader({ fetchImpl });

    await downloader.download(makeEntry({
      sources: [
        { url: "https://low.example.com/font.woff2", priority: 3 },
        { url: "https://high.example.com/font.woff2", priority: 1 },
        { url: "https://mid.example.com/font.woff2", priority: 2 },
      ],
    }));

    // priority=1 应首先被尝试
    expect(fetchImpl.mock.calls[0][0]).toBe("https://high.example.com/font.woff2");
  });

  it("rejects with network error when all sources fail", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const downloader = new FontDownloader({ fetchImpl });

    await expect(downloader.download(makeEntry({
      sources: [
        { url: "https://a.example.com/font.woff2", priority: 1 },
        { url: "https://b.example.com/font.woff2", priority: 2 },
      ],
    }))).rejects.toMatchObject({
      name: "FontError",
      code: "network",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("FontDownloader.download — SHA-256 verification", () => {
  it("accepts bytes whose sha256 matches manifest", async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const hash = await sha256Hex(data);
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(data));
    const downloader = new FontDownloader({ fetchImpl });

    const result = await downloader.download(makeEntry({ sha256: hash }));

    expect(result).toEqual(data);
  });

  it("rejects with checksum error when all sources fail checksum", async () => {
    const data = new Uint8Array([9, 9, 9]);
    // 每次调用返回新 Response：ReadableStream body 仅可消费一次。
    const fetchImpl = vi.fn().mockImplementation(async () => mockResponse(data));
    const downloader = new FontDownloader({ fetchImpl });

    await expect(downloader.download(makeEntry({
      sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      sources: [
        { url: "https://a.example.com/font.woff2", priority: 1 },
        { url: "https://b.example.com/font.woff2", priority: 2 },
      ],
    }))).rejects.toMatchObject({
      name: "FontError",
      code: "checksum",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to next source when primary's sha256 mismatches", async () => {
    const poisoned = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const clean = new Uint8Array([1, 2, 3, 4]);
    const cleanHash = await sha256Hex(clean);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mockResponse(poisoned))
      .mockResolvedValueOnce(mockResponse(clean));
    const downloader = new FontDownloader({ fetchImpl });

    const result = await downloader.download(makeEntry({
      sha256: cleanHash,
      sources: [
        { url: "https://poisoned.example.com/font.woff2", priority: 1 },
        { url: "https://clean.example.com/font.woff2", priority: 2 },
      ],
    }));

    expect(result).toEqual(clean);
  });

  it("skips checksum and warns when sha256 is empty (dev mode)", async () => {
    const data = new Uint8Array([1, 2, 3]);
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(data));
    const downloader = new FontDownloader({ fetchImpl });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await downloader.download(makeEntry({ sha256: "" }));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("缺少 sha256"));
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("FontDownloader.download — abort", () => {
  it("rejects immediately when signal is already aborted", async () => {
    const fetchImpl = vi.fn();
    const downloader = new FontDownloader({ fetchImpl });
    const controller = new AbortController();
    controller.abort();

    await expect(
      downloader.download(makeEntry(), undefined, controller.signal),
    ).rejects.toMatchObject({ name: "FontError", code: "aborted" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects with aborted when fetch throws AbortError mid-download", async () => {
    const abortErr = new DOMException("The user aborted", "AbortError");
    const fetchImpl = vi.fn().mockRejectedValue(abortErr);
    const downloader = new FontDownloader({ fetchImpl });

    await expect(downloader.download(makeEntry())).rejects.toMatchObject({
      name: "FontError",
      code: "aborted",
    });
  });

  it("does not fall back to other sources after abort", async () => {
    const abortErr = new DOMException("aborted", "AbortError");
    const fetchImpl = vi.fn().mockRejectedValue(abortErr);
    const downloader = new FontDownloader({ fetchImpl });

    await expect(downloader.download(makeEntry({
      sources: [
        { url: "https://a.example.com/font.woff2", priority: 1 },
        { url: "https://b.example.com/font.woff2", priority: 2 },
      ],
    }))).rejects.toMatchObject({ code: "aborted" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("FontDownloader.download — invalid manifest", () => {
  it("rejects with invalid-manifest when sources is empty", async () => {
    const fetchImpl = vi.fn();
    const downloader = new FontDownloader({ fetchImpl });

    await expect(
      downloader.download(makeEntry({ sources: [] })),
    ).rejects.toMatchObject({ name: "FontError", code: "invalid-manifest" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("sha256Hex", () => {
  it("returns lowercase hex of known input", async () => {
    const data = new TextEncoder().encode("abc");
    const hex = await sha256Hex(data);
    // 标准向量：SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(hex).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("FontDownloader.download — onProgress error isolation", () => {
  it("does not failover when user's onProgress throws", async () => {
    // 真 bug 的回归测试：onProgress 抛错以前会被归为"源失败"，误触发 failover。
    const data = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = vi.fn().mockImplementation(async () => mockResponse(data));
    const downloader = new FontDownloader({ fetchImpl });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwingProgress = vi.fn().mockImplementation(() => {
      throw new Error("simulated React setState bug");
    });

    try {
      const result = await downloader.download(
        makeEntry({
          sources: [
            { url: "https://a.example.com/font.woff2", priority: 1 },
            { url: "https://b.example.com/font.woff2", priority: 2 },
          ],
        }),
        throwingProgress,
      );
      expect(result).toEqual(data);
      expect(throwingProgress).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("onProgress callback threw"),
        expect.any(Error),
      );
      // 关键断言：仅命中主源，未触发 failover。
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("FontError", () => {
  it("preserves code and cause", () => {
    const cause = new Error("original");
    const err = new FontError("network", "failed", cause);
    expect(err.code).toBe("network");
    expect(err.message).toBe("failed");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("FontError");
    expect(err).toBeInstanceOf(Error);
  });
});
