// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it } from "vitest";
import { FontStorage } from "../storage.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";

describe("FontStorage", () => {
  let adapter: MockAdapter;
  let storage: FontStorage;
  const sampleData = new Uint8Array([1, 2, 3, 4, 5]);

  beforeEach(() => {
    adapter = new MockAdapter();
    storage = new FontStorage(adapter);
  });

  describe("path convention", () => {
    it("stores at fonts/{id} without extension", async () => {
      await storage.write("my-font", sampleData);
      expect(await adapter.exists("fonts/my-font")).toBe(true);
      expect(await adapter.exists("fonts/my-font.woff2")).toBe(false);
    });
  });

  describe("write + read", () => {
    it("roundtrips bytes identically", async () => {
      await storage.write("font1", sampleData);
      const out = await storage.read("font1");
      expect(out).toEqual(sampleData);
    });

    it("overwrites existing content", async () => {
      await storage.write("x", new Uint8Array([1, 1, 1]));
      await storage.write("x", new Uint8Array([9, 9]));
      const out = await storage.read("x");
      expect(out).toEqual(new Uint8Array([9, 9]));
    });

    it("throws on read of missing file", async () => {
      await expect(storage.read("nope")).rejects.toThrow(/File not found/);
    });
  });

  describe("exists", () => {
    it("false before write", async () => {
      expect(await storage.exists("x")).toBe(false);
    });

    it("true after write", async () => {
      await storage.write("x", sampleData);
      expect(await storage.exists("x")).toBe(true);
    });

    it("false after remove", async () => {
      await storage.write("x", sampleData);
      await storage.remove("x");
      expect(await storage.exists("x")).toBe(false);
    });
  });

  describe("remove", () => {
    it("is idempotent on missing file", async () => {
      await expect(storage.remove("nope")).resolves.not.toThrow();
    });

    it("deletes only the target font", async () => {
      await storage.write("a", sampleData);
      await storage.write("b", sampleData);
      await storage.remove("a");
      expect(await storage.exists("a")).toBe(false);
      expect(await storage.exists("b")).toBe(true);
    });
  });

  describe("list", () => {
    it("returns empty array before any write (directory may not exist)", async () => {
      expect(await storage.list()).toEqual([]);
    });

    it("returns all written font ids", async () => {
      await storage.write("a", sampleData);
      await storage.write("b", sampleData);
      const ids = (await storage.list()).sort();
      expect(ids).toEqual(["a", "b"]);
    });

    it("does not include the fonts/ directory path prefix", async () => {
      await storage.write("x", sampleData);
      const ids = await storage.list();
      expect(ids).toEqual(["x"]);
    });
  });

  describe("sizeOf", () => {
    it("returns byte length after write", async () => {
      await storage.write("x", sampleData);
      expect(await storage.sizeOf("x")).toBe(5);
    });

    it("returns -1 for missing file", async () => {
      expect(await storage.sizeOf("nope")).toBe(-1);
    });
  });

  describe("totalSize", () => {
    it("returns 0 when no fonts stored", async () => {
      expect(await storage.totalSize()).toBe(0);
    });

    it("sums all fonts' byte lengths", async () => {
      await storage.write("a", new Uint8Array(100));
      await storage.write("b", new Uint8Array(200));
      expect(await storage.totalSize()).toBe(300);
    });
  });
});
