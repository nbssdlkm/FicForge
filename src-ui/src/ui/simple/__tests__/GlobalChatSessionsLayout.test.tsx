// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * GlobalChatSessionsLayout 回归：
 * 三类会话（AU 对话 tab / AU 设定助手 / fandom 助手）混排分组、kind 徽标、
 * 删除按 kind 分发到正确仓储 API。
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GlobalChatSessionsLayout } from "../GlobalChatSessionsLayout";

vi.mock("../../../api/engine-client", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getDataDir: vi.fn(() => "/data"),
    listFandoms: vi.fn(),
    listChatSessions: vi.fn(),
    listSettingsChatSessions: vi.fn(),
    deleteChatSession: vi.fn(),
    deleteSettingsChatSession: vi.fn(),
    renameChatSession: vi.fn(),
    renameSettingsChatSession: vi.fn(),
  };
});

import {
  listFandoms,
  listChatSessions,
  listSettingsChatSessions,
  deleteChatSession,
  deleteSettingsChatSession,
} from "../../../api/engine-client";

const meta = (id: string, title: string) => ({
  id,
  title,
  created_at: "2026-09-14T01:00:00Z",
  updated_at: "2026-09-14T02:00:00Z",
  message_count: 2,
});

describe("GlobalChatSessionsLayout · 三类会话混排", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listFandoms as Mock).mockResolvedValue([
      {
        name: "测试圈",
        dir_name: "f1",
        aus: [{ name: "狮院日常", dir_name: "au1" }],
      },
    ]);
    // 对话 tab：仅 AU 有；设定助手：fandom 与 AU 各一
    (listChatSessions as Mock).mockResolvedValue([meta("c1", "第四章构思")]);
    (listSettingsChatSessions as Mock).mockImplementation((path: string) =>
      Promise.resolve([
        meta(path.includes("/aus/") ? "s-au" : "s-fa", path.includes("/aus/") ? "AU设定聊" : "fandom设定聊"),
      ]),
    );
    (deleteChatSession as Mock).mockResolvedValue(undefined);
    (deleteSettingsChatSession as Mock).mockResolvedValue(undefined);
  });

  it("列出三类会话并带 kind 徽标", async () => {
    render(<GlobalChatSessionsLayout onNavigate={() => {}} />);

    expect(await screen.findByText("第四章构思")).toBeInTheDocument();
    expect(screen.getByText("AU设定聊")).toBeInTheDocument();
    expect(screen.getByText("fandom设定聊")).toBeInTheDocument();

    // kind 徽标：对话 / 设定助手 / Fandom 助手各出现
    expect(screen.getByText("对话", { selector: "span.rounded-sm" })).toBeInTheDocument();
    expect(screen.getByText("设定助手")).toBeInTheDocument();
    expect(screen.getByText("Fandom 助手")).toBeInTheDocument();

    // 分组标题：AU 组 fandom/au，fandom 级组只挂 fandom 名
    expect(screen.getByText(/测试圈 \/ 狮院日常/)).toBeInTheDocument();
  });

  it("删除按 kind 分发：fandom 助手会话走 settings 仓储", async () => {
    render(<GlobalChatSessionsLayout onNavigate={() => {}} />);
    await screen.findByText("fandom设定聊");

    const deleteButtons = await screen.findAllByRole("button", { name: "删除对话" });
    // 行序 = 加载序：fandom 助手在前（fandom 级先于 AU 枚举）
    fireEvent.click(deleteButtons[0]);
    // 确认弹窗
    const confirm = await screen.findByRole("button", { name: "确认" });
    fireEvent.click(confirm);

    await waitFor(() => expect(deleteSettingsChatSession).toHaveBeenCalledWith("/data/fandoms/f1", "s-fa"));
    expect(deleteChatSession).not.toHaveBeenCalled();
  });

  it("点 fandom 助手会话跳 fandom_lore，点对话会话跳 chat", async () => {
    const navigations: [string, string | undefined][] = [];
    render(<GlobalChatSessionsLayout onNavigate={(page, ctx) => navigations.push([page, ctx])} />);

    fireEvent.click(await screen.findByText("fandom设定聊"));
    expect(navigations[0]).toEqual(["fandom_lore", "/data/fandoms/f1"]);

    fireEvent.click(await screen.findByText("第四章构思"));
    expect(navigations[1]).toEqual(["chat", "/data/fandoms/f1/aus/au1"]);
  });
});
