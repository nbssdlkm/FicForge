// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it } from "vitest";
import { initEngine } from "../engine-instance";
import { createAu, createFandom, deleteFandom, getFandomDisplayInfo, listFandoms } from "../engine-fandom";
import { listTrash, restoreTrash } from "../engine-trash";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";

describe("engine-fandom deleteFandom", () => {
  const dataDir = "/data";
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
    initEngine(adapter, dataDir);
  });

  it("moves the whole fandom tree to global trash and restores it", async () => {
    const fandom = await createFandom("Naruto");
    const au = await createAu(fandom.name, "Canon", fandom.path);
    adapter.seed(`${fandom.path}/core_worldbuilding/village.md`, "# Konoha");
    adapter.seed(`${au.path}/chapters/main/ch0001.md`, "# Chapter 1");

    const result = await deleteFandom(fandom.dir_name);

    expect(await listFandoms()).toEqual([]);
    expect(adapter.raw(`${fandom.path}/core_worldbuilding/village.md`)).toBeUndefined();
    expect(adapter.raw(`${au.path}/project.yaml`)).toBeUndefined();
    expect(adapter.raw(`${au.path}/chapters/main/ch0001.md`)).toBeUndefined();

    const trashEntries = await listTrash("fandom", `${dataDir}/fandoms`);
    expect(trashEntries).toHaveLength(1);
    expect(trashEntries[0].trash_id).toBe(result.trash_id);
    expect(trashEntries[0].entity_type).toBe("fandom");
    expect(trashEntries[0].metadata.is_directory).toBe(true);

    await restoreTrash("fandom", `${dataDir}/fandoms`, result.trash_id);

    const restored = await listFandoms();
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe("Naruto");
    expect(restored[0].aus).toEqual([{ name: "Canon", dir_name: "Canon" }]);
    expect(adapter.raw(`${fandom.path}/core_worldbuilding/village.md`)).toBe("# Konoha");
    expect(adapter.raw(`${au.path}/project.yaml`)).toContain("Canon");
    expect(adapter.raw(`${au.path}/chapters/main/ch0001.md`)).toBe("# Chapter 1");
  });

  it("preserves display names while sanitizing directory names to a WebDAV-safe whitelist", async () => {
    const fandom = await createFandom("Detroit: Become Human / RK800?");
    const au = await createAu(fandom.name, "Ch.1 - Prologue: 100%?", fandom.path);
    const displayInfo = await getFandomDisplayInfo(fandom.path);

    const listed = await listFandoms();

    expect(fandom.name).toBe("Detroit: Become Human / RK800?");
    expect(au.name).toBe("Ch.1 - Prologue: 100%?");
    expect(fandom.dir_name).toMatch(/^[\p{L}\p{N}._ -]+$/u);
    expect(au.dir_name).toMatch(/^[\p{L}\p{N}._ -]+$/u);
    expect(fandom.dir_name).not.toMatch(/[\\/:*?"<>|#%]/);
    expect(au.dir_name).not.toMatch(/[\\/:*?"<>|#%]/);
    expect(displayInfo).toEqual({
      name: "Detroit: Become Human / RK800?",
      dir_name: fandom.dir_name,
      path: fandom.path,
    });
    expect(listed).toEqual([
      {
        name: "Detroit: Become Human / RK800?",
        dir_name: fandom.dir_name,
        aus: [{ name: "Ch.1 - Prologue: 100%?", dir_name: au.dir_name }],
      },
    ]);
  });

  it("uses display names in fandom trash entries", async () => {
    const fandom = await createFandom("My/Fandom");

    await deleteFandom(fandom.dir_name);

    const trashEntries = await listTrash("fandom", `${dataDir}/fandoms`);
    expect(trashEntries).toHaveLength(1);
    expect(trashEntries[0].entity_name).toBe("My/Fandom");
  });
});
