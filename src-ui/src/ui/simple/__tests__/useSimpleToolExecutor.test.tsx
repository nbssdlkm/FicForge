// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useSimpleToolExecutor — 6 个 modify tool 的 dispatch 落盘验证。
 * Mock engine-client API；hook 内部应按 tool 派发到正确 API。
 */

import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>(
    "../../../api/engine-client",
  );
  return {
    ...actual,
    listLoreFiles: vi.fn(),
    getProjectForEditing: vi.fn(),
    saveLore: vi.fn(),
    deleteLore: vi.fn(),
    readLoreWithLegacyFallback: vi.fn(),
    addPinned: vi.fn(),
    deletePinned: vi.fn(),
    saveProjectCastRegistryCharacters: vi.fn(),
    saveProjectWritingStyle: vi.fn(),
  };
});

import * as engineClient from "../../../api/engine-client";
import { useSimpleToolExecutor } from "../useSimpleToolExecutor";

const mocked = vi.mocked(engineClient);

const AU = "/fandoms/test/aus/test_au";

function setupBaseMocks(opts?: {
  characters?: { name: string; filename: string }[];
  worldbuilding?: { name: string; filename: string }[];
  pinned?: string[];
  castCharacters?: string[];
  writingStyle?: Record<string, unknown>;
}) {
  mocked.listLoreFiles.mockImplementation(async ({ category }) => {
    if (category === "characters") {
      return { files: opts?.characters ?? [] };
    }
    return { files: opts?.worldbuilding ?? [] };
  });
  mocked.getProjectForEditing.mockResolvedValue({
    pinned_context: opts?.pinned ?? [],
    cast_registry: { characters: opts?.castCharacters ?? [] },
    writing_style: opts?.writingStyle ?? {},
  } as unknown as Awaited<ReturnType<typeof engineClient.getProjectForEditing>>);
  // saveLore 回传实际落盘 filename/category（M28）。ASCII 文件名 sanitize 后不变，
  // 直接 echo 传入值即可覆盖 executor 从返回值回填 undoMeta 的新路径。
  mocked.saveLore.mockImplementation(async (req) => ({
    status: "ok",
    path: `${req.au_path ?? req.fandom_path ?? ""}/${req.category}/${req.filename}`,
    filename: req.filename,
    category: req.category,
  }) as never);
  mocked.deleteLore.mockResolvedValue(undefined as never);
  mocked.addPinned.mockResolvedValue(undefined as never);
  mocked.deletePinned.mockResolvedValue(undefined as never);
  mocked.saveProjectCastRegistryCharacters.mockResolvedValue(undefined as never);
  mocked.saveProjectWritingStyle.mockResolvedValue(undefined as never);
  // readLoreWithLegacyFallback 返回 string | null（null = 旧文件不存在，直接用新内容）。
  mocked.readLoreWithLegacyFallback.mockResolvedValue(null);
}

describe("useSimpleToolExecutor — execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBaseMocks();
  });

  it("create_character_file: saveLore 落盘 + cast_registry 同步 + 返回 lore undoMeta", async () => {
    setupBaseMocks({ castCharacters: ["Bob"] });
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    let res!: Awaited<ReturnType<typeof result.current.execute>>;
    await act(async () => {
      res = await result.current.execute("create_character_file", {
        name: "Alice",
        content: "# Alice\n核心特质：聪明",
      });
    });

    expect(mocked.saveLore).toHaveBeenCalledWith(
      expect.objectContaining({
        au_path: AU,
        category: "characters",
        filename: "Alice.md",
      }),
    );
    expect(mocked.saveProjectCastRegistryCharacters).toHaveBeenCalledWith(
      AU,
      expect.arrayContaining(["Bob", "Alice"]),
    );
    expect(res.undoMeta).toEqual({ kind: "lore", category: "characters", filename: "Alice.md" });
  });

  it("M28: create_character_file 用 saveLore 回传的磁盘真名回填 undoMeta（含 sanitize 差异）", async () => {
    // 模拟 saveLore 把全角标点 sanitize 掉，返回与传入 filename 不同的磁盘真名。
    // executor 必须以返回值（磁盘真名）回填 undoMeta，否则 undo 的 deleteLore 找不到文件。
    setupBaseMocks();
    mocked.saveLore.mockImplementationOnce(async (req) => ({
      status: "ok",
      path: `${req.au_path}/${req.category}/林黛玉_初见_.md`,
      filename: "林黛玉_初见_.md", // sanitize 后与传入 "林黛玉：初见？.md" 不同
      category: req.category,
    }) as never);
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    let res!: Awaited<ReturnType<typeof result.current.execute>>;
    await act(async () => {
      res = await result.current.execute("create_character_file", {
        name: "林黛玉：初见？",
        content: "# 林黛玉",
      });
    });

    // undoMeta.filename = 磁盘真名（saveLore 返回值），不是 executor 本地算的传入名。
    expect(res.undoMeta).toEqual({ kind: "lore", category: "characters", filename: "林黛玉_初见_.md" });
    expect((res.undoMeta as { filename: string }).filename).not.toContain("：");
  });

  it("create_character_file: cast_registry save 失败 → rollback 删 lore", async () => {
    setupBaseMocks();
    mocked.saveProjectCastRegistryCharacters.mockRejectedValueOnce(new Error("registry fail"));
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    await act(async () => {
      await expect(
        result.current.execute("create_character_file", {
          name: "Alice",
          content: "x",
        }),
      ).rejects.toThrow();
    });

    expect(mocked.saveLore).toHaveBeenCalledTimes(1);
    expect(mocked.deleteLore).toHaveBeenCalledWith(
      expect.objectContaining({ au_path: AU, category: "characters", filename: "Alice.md" }),
    );
  });

  it("modify_character_file: 守护 frontmatter（preserveManagedFrontmatter）", async () => {
    setupBaseMocks({ characters: [{ name: "Alice", filename: "Alice.md" }] });
    mocked.readLoreWithLegacyFallback.mockResolvedValueOnce(
      "---\nname: Alice\naliases:\n  - Al\nimportance: main\n---\n# 旧正文",
    );
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    await act(async () => {
      await result.current.execute("modify_character_file", {
        filename: "Alice.md",
        new_content: "# 新正文 没有 frontmatter",
        change_summary: "rewrite",
      });
    });

    expect(mocked.readLoreWithLegacyFallback).toHaveBeenCalledWith(
      expect.objectContaining({ au_path: AU, category: "characters", diskFilename: "Alice.md" }),
    );
    const savedContent = (mocked.saveLore.mock.calls[0][0] as { content: string }).content;
    // preserveManagedFrontmatter 应把 name/aliases/importance 重新塞回去
    // yaml dump 可能加引号（"Alice"），用 looser pattern
    expect(savedContent).toMatch(/name:\s*"?Alice"?/);
    expect(savedContent).toMatch(/importance:\s*"?main"?/);
    expect(savedContent).toContain("# 新正文 没有 frontmatter");
  });

  it("modify_character_file: 旧文件不存在时直接用新内容（不阻断）", async () => {
    setupBaseMocks({ characters: [{ name: "Alice", filename: "Alice.md" }] });
    mocked.readLoreWithLegacyFallback.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    await act(async () => {
      await result.current.execute("modify_character_file", {
        filename: "Alice.md",
        new_content: "新内容",
        change_summary: "x",
      });
    });

    expect(mocked.saveLore).toHaveBeenCalledWith(
      expect.objectContaining({ content: "新内容" }),
    );
  });

  it("F9: modify_character_file legacy 全角标点名 → sanitize 名 read miss 时回退原名读到、frontmatter 受管字段保留、写落 sanitize 名", async () => {
    // 预置：磁盘上的 legacy 文件名是未清洗的 "苏：黛.md"（validateExistingPathSegment 允许），
    // LLM modify 时给同名 → sanitize 后 diskFilename="苏_黛.md"。readLoreWithLegacyFallback 收到
    // diskFilename + legacyFilename，内部先按 disk 名读 miss、回退 legacy 名读到旧 frontmatter。
    // 这里直接断言 hook 把两个名都透传给 fallback helper，且读到的 frontmatter 被 preserve、
    // saveLore 落 sanitize 名。回退旧码（用原名 read 无 fallback）时 helper 参数形状会变、断言挂。
    setupBaseMocks({ characters: [{ name: "苏黛", filename: "苏：黛.md" }] });
    mocked.readLoreWithLegacyFallback.mockResolvedValueOnce(
      "---\nname: 苏黛\nimportance: main\n---\n# 旧正文",
    );
    // saveLore echo，验证写路径落 sanitize 名。
    mocked.saveLore.mockImplementationOnce(async (req) => ({
      status: "ok",
      path: `${req.au_path}/${req.category}/${req.filename}`,
      filename: req.filename,
      category: req.category,
    }) as never);
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    await act(async () => {
      await result.current.execute("modify_character_file", {
        filename: "苏：黛",
        new_content: "# 全新正文",
        change_summary: "rewrite",
      });
    });

    // helper 同时收到 disk 名（sanitize：： → _）与 legacy 原名，供 miss 时回退。
    expect(mocked.readLoreWithLegacyFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        au_path: AU,
        category: "characters",
        diskFilename: "苏_黛.md",
        legacyFilename: "苏：黛.md",
      }),
    );
    const savedCall = mocked.saveLore.mock.calls[0][0] as { filename: string; content: string };
    // 写落 sanitize 名（迁移语义：新写统一新名）。
    expect(savedCall.filename).toBe("苏_黛.md");
    // 受管 frontmatter 从 legacy 旧文件保留下来（守护未失效）。
    expect(savedCall.content).toMatch(/name:\s*"?苏黛"?/);
    expect(savedCall.content).toMatch(/importance:\s*"?main"?/);
    expect(savedCall.content).toContain("# 全新正文");
  });

  it("create_worldbuilding_file: saveLore 落盘 + lore undoMeta", async () => {
    setupBaseMocks();
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    let res!: Awaited<ReturnType<typeof result.current.execute>>;
    await act(async () => {
      res = await result.current.execute("create_worldbuilding_file", {
        name: "Magic",
        content: "# 魔法体系",
      });
    });

    expect(mocked.saveLore).toHaveBeenCalledWith(
      expect.objectContaining({
        au_path: AU,
        category: "worldbuilding",
        filename: "Magic.md",
      }),
    );
    expect(res.undoMeta).toEqual({ kind: "lore", category: "worldbuilding", filename: "Magic.md" });
  });

  it("modify_worldbuilding_file: saveLore（无 frontmatter 守护）", async () => {
    setupBaseMocks({ worldbuilding: [{ name: "Magic", filename: "Magic.md" }] });
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    await act(async () => {
      await result.current.execute("modify_worldbuilding_file", {
        filename: "Magic.md",
        new_content: "新魔法",
        change_summary: "x",
      });
    });

    expect(mocked.readLoreWithLegacyFallback).not.toHaveBeenCalled(); // 世界观不守护 frontmatter
    expect(mocked.saveLore).toHaveBeenCalledWith(
      expect.objectContaining({ content: "新魔法" }),
    );
  });

  it("add_pinned_context: addPinned 调用 + pinned undoMeta 含 index/content", async () => {
    setupBaseMocks({ pinned: ["主角不死"] });
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    let res!: Awaited<ReturnType<typeof result.current.execute>>;
    await act(async () => {
      res = await result.current.execute("add_pinned_context", {
        content: "魔法不能复活",
      });
    });

    expect(mocked.addPinned).toHaveBeenCalledWith(AU, "魔法不能复活");
    expect(res.undoMeta).toEqual({
      kind: "pinned",
      pinnedIndex: 1, // 已有 1 条所以新条 index = 1
      pinnedContent: "魔法不能复活",
    });
  });

  it("update_writing_style: 合并保留旧字段 + saveProjectWritingStyle 调用", async () => {
    setupBaseMocks({
      writingStyle: { perspective: "third_person", emotion_style: "implicit" },
    });
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    await act(async () => {
      await result.current.execute("update_writing_style", {
        field: "perspective",
        value: "first_person",
      });
    });

    expect(mocked.saveProjectWritingStyle).toHaveBeenCalledWith(AU, {
      perspective: "first_person",
      emotion_style: "implicit", // 旧字段保留
    });
  });

  it("validation 失败：modify_character_file 没 filename → throws", async () => {
    setupBaseMocks();
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    await act(async () => {
      await expect(
        result.current.execute("modify_character_file", { new_content: "x", change_summary: "x" }),
      ).rejects.toThrow();
    });
    expect(mocked.saveLore).not.toHaveBeenCalled();
  });

  it("unsupported tool: throws", async () => {
    setupBaseMocks();
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    await act(async () => {
      await expect(
        result.current.execute("nonexistent_tool", {}),
      ).rejects.toThrow();
    });
  });

  it("missingTarget: modify_character_file 文件不存在 → throws（不调 saveLore）", async () => {
    setupBaseMocks({ characters: [] });
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    await act(async () => {
      await expect(
        result.current.execute("modify_character_file", {
          filename: "Ghost.md",
          new_content: "x",
          change_summary: "x",
        }),
      ).rejects.toThrow();
    });
    expect(mocked.saveLore).not.toHaveBeenCalled();
  });

  it("overwriteWarning: create_character_file 同名已存在 → throws", async () => {
    setupBaseMocks({ characters: [{ name: "Alice", filename: "Alice.md" }] });
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    await act(async () => {
      await expect(
        result.current.execute("create_character_file", {
          name: "Alice",
          content: "x",
        }),
      ).rejects.toThrow();
    });
    expect(mocked.saveLore).not.toHaveBeenCalled();
  });
});

describe("useSimpleToolExecutor — undo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBaseMocks();
  });

  it("undo lore: deleteLore 删除文件", async () => {
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    await act(async () => {
      await result.current.undo({
        kind: "lore",
        category: "characters",
        filename: "Alice.md",
      });
    });

    expect(mocked.deleteLore).toHaveBeenCalledWith(
      expect.objectContaining({ au_path: AU, category: "characters", filename: "Alice.md" }),
    );
  });

  it("undo pinned by content: index 漂移时按 content lastIndexOf 重定位", async () => {
    setupBaseMocks({ pinned: ["新加的", "魔法不能复活", "另一条"] });
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    await act(async () => {
      // 当时 add 时 index 是 0，但现在被前置插入 1 条，实际 index = 1
      await result.current.undo({
        kind: "pinned",
        pinnedIndex: 0,
        pinnedContent: "魔法不能复活",
      });
    });

    expect(mocked.deletePinned).toHaveBeenCalledWith(AU, 1);
  });

  it("undo pinned: content 找不到 → throws", async () => {
    setupBaseMocks({ pinned: ["完全不一样的"] });
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    await act(async () => {
      await expect(
        result.current.undo({
          kind: "pinned",
          pinnedIndex: 0,
          pinnedContent: "已经被删了的",
        }),
      ).rejects.toThrow();
    });
    expect(mocked.deletePinned).not.toHaveBeenCalled();
  });

  it("undo unsupported (modify_*): throws", async () => {
    const { result } = renderHook(() => useSimpleToolExecutor({ auPath: AU }));

    await act(async () => {
      await expect(
        result.current.undo({ kind: "unsupported", note: "x" }),
      ).rejects.toThrow();
    });
  });
});
