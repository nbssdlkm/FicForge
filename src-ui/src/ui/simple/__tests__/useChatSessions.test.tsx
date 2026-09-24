// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useChatSessions（chat-sessions 底座）测试。
 * 判别性契约：
 *  - 空列表自愈建第一个会话并选中
 *  - 非空列表默认选最近（listSessions 倒序首项）
 *  - 删除选中会话 → 落最近其余会话；删光 → 自愈新建
 *  - AU 切换整体重载（旧 AU 会话不残留）
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>("../../../api/engine-client");
  return {
    ...actual,
    listChatSessions: vi.fn(),
    createChatSession: vi.fn(),
    deleteChatSession: vi.fn(),
    renameChatSession: vi.fn(),
  };
});

import * as engineClient from "../../../api/engine-client";
import type { ChatSessionMeta } from "../../../api/engine-client";
import { useChatSessions } from "../useChatSessions";

const mocked = vi.mocked(engineClient);

function meta(id: string, title: string, updated = "2026-09-13T10:00:00Z"): ChatSessionMeta {
  return { id, title, created_at: "2026-09-13T09:00:00Z", updated_at: updated, message_count: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.deleteChatSession.mockResolvedValue(undefined as never);
  mocked.renameChatSession.mockResolvedValue(undefined as never);
});

describe("useChatSessions", () => {
  it("空列表 → 自愈建第一个会话并选中（不传标题 = 仓储自动起名）", async () => {
    mocked.listChatSessions.mockResolvedValue([]);
    const created = meta("cs_new", "Session");
    mocked.createChatSession.mockResolvedValue(created);

    const { result } = renderHook(() => useChatSessions("au_a"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    // 不传标题 → 仓储落 title_auto，首条用户消息落盘后自动改写标题
    expect(mocked.createChatSession).toHaveBeenCalledWith("au_a");
    expect(result.current.sessions).toEqual([created]);
    expect(result.current.activeId).toBe("cs_new");
  });

  it("非空列表 → 默认选首项（updated_at 倒序 = 最近），不额外创建", async () => {
    mocked.listChatSessions.mockResolvedValue([
      meta("cs_recent", "最近"),
      meta("cs_old", "旧的", "2026-09-01T10:00:00Z"),
    ]);

    const { result } = renderHook(() => useChatSessions("au_a"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(mocked.createChatSession).not.toHaveBeenCalled();
    expect(result.current.activeId).toBe("cs_recent");
  });

  it("createNewSession → 置顶并选中", async () => {
    mocked.listChatSessions.mockResolvedValue([meta("cs_1", "旧会话")]);
    mocked.createChatSession.mockResolvedValue(meta("cs_2", "新对话"));

    const { result } = renderHook(() => useChatSessions("au_a"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.createNewSession();
    });
    expect(result.current.sessions.map((s) => s.id)).toEqual(["cs_2", "cs_1"]);
    expect(result.current.activeId).toBe("cs_2");
  });

  it("selectSession 切换选中", async () => {
    mocked.listChatSessions.mockResolvedValue([meta("cs_1", "A"), meta("cs_2", "B")]);
    const { result } = renderHook(() => useChatSessions("au_a"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => result.current.selectSession("cs_2"));
    expect(result.current.activeId).toBe("cs_2");
  });

  it("删除选中会话 → 落到最近的其余会话", async () => {
    mocked.listChatSessions.mockResolvedValue([meta("cs_1", "A"), meta("cs_2", "B")]);
    const { result } = renderHook(() => useChatSessions("au_a"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.removeSession("cs_1"); // cs_1 是当前选中
    });
    expect(mocked.deleteChatSession).toHaveBeenCalledWith("au_a", "cs_1");
    expect(result.current.sessions.map((s) => s.id)).toEqual(["cs_2"]);
    expect(result.current.activeId).toBe("cs_2");
  });

  it("删光所有会话 → 自愈新建一个并选中", async () => {
    mocked.listChatSessions.mockResolvedValue([meta("cs_1", "唯一")]);
    mocked.createChatSession.mockResolvedValue(meta("cs_fresh", "新对话"));
    const { result } = renderHook(() => useChatSessions("au_a"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.removeSession("cs_1");
    });
    expect(result.current.sessions.map((s) => s.id)).toEqual(["cs_fresh"]);
    expect(result.current.activeId).toBe("cs_fresh");
  });

  it("删除非选中会话 → 选中不变", async () => {
    mocked.listChatSessions.mockResolvedValue([meta("cs_1", "A"), meta("cs_2", "B")]);
    const { result } = renderHook(() => useChatSessions("au_a"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.removeSession("cs_2");
    });
    expect(result.current.activeId).toBe("cs_1");
    expect(result.current.sessions.map((s) => s.id)).toEqual(["cs_1"]);
  });

  it("renameSessionById → 标题即时更新", async () => {
    mocked.listChatSessions.mockResolvedValue([meta("cs_1", "旧名")]);
    const { result } = renderHook(() => useChatSessions("au_a"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.renameSessionById("cs_1", "第四章构思");
    });
    expect(mocked.renameChatSession).toHaveBeenCalledWith("au_a", "cs_1", "第四章构思");
    expect(result.current.sessions[0].title).toBe("第四章构思");
  });

  it("AU 切换 → 整体重载（旧 AU 会话不残留）", async () => {
    mocked.listChatSessions.mockImplementation((au: string) =>
      Promise.resolve(au === "au_a" ? [meta("cs_a", "A 的会话")] : [meta("cs_b", "B 的会话")]),
    );
    const { result, rerender } = renderHook(({ au }) => useChatSessions(au), { initialProps: { au: "au_a" } });
    await waitFor(() => expect(result.current.activeId).toBe("cs_a"));

    rerender({ au: "au_b" });
    await waitFor(() => expect(result.current.activeId).toBe("cs_b"));
    expect(result.current.sessions.map((s) => s.id)).toEqual(["cs_b"]);
  });

  it("并发连删两个会话 → 第二个删除读到最新列表，不残留 ghost（对抗审 2026-09-14）", async () => {
    mocked.listChatSessions.mockResolvedValue([meta("cs_a", "会话 A")]);
    let createSeq = 0;
    mocked.createChatSession.mockImplementation(async () => meta(`cs_new_${++createSeq}`, "新建"));
    const { result } = renderHook(({ au }) => useChatSessions(au), { initialProps: { au: "au_a" } });
    await waitFor(() => expect(result.current.activeId).toBe("cs_a"));
    act(() => {
      void result.current.createNewSession("第二个");
    });
    await waitFor(() => expect(result.current.sessions).toHaveLength(2));
    const [newest, oldest] = result.current.sessions.map((s) => s.id);
    // 不等第一个 await 完就发第二个删除（同一 act 里并发）
    await act(async () => {
      await Promise.all([result.current.removeSession(newest), result.current.removeSession(oldest)]);
    });
    // 两个都删光 → 自愈新建一个；绝不能残留任何旧 id
    expect(result.current.sessions.some((s) => s.id === newest || s.id === oldest)).toBe(false);
    expect(result.current.sessions.length).toBe(1);
  });
});
