// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * MobileFandomView 状态下沉回归（长期债②收尾块）：
 * 17 useState → 3 hooks（files / editor / chrome）后锁住的行为——
 * 列表加载与分类切换、文件读取/编辑/保存 payload、新建后自动打开、
 * 删除回列表并刷新，以及新增的「切圈子详情态复位」。
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MobileFandomView } from "../MobileFandomView";

// 重型子组件与本测试无关，剪掉其 API 面
vi.mock("../../shared/TrashPanel", () => ({ TrashPanel: () => null }));
vi.mock("../../shared/settings-chat/SettingsChatPanel", () => ({ SettingsChatPanel: () => null }));
vi.mock("../../shared/SettingsMarkdown", () => ({
  SettingsMarkdown: ({ content }: { content: string }) => <div data-testid="markdown-preview">{content}</div>,
}));

vi.mock("../../../api/engine-client", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getFandomDisplayInfo: vi.fn(),
    listFandomFiles: vi.fn(),
    readFandomFile: vi.fn(),
    saveLore: vi.fn(),
    deleteLore: vi.fn(),
  };
});

import {
  getFandomDisplayInfo,
  listFandomFiles,
  readFandomFile,
  saveLore,
  deleteLore,
} from "../../../api/engine-client";

const FANDOM_PATH = "fandoms/圈子目录";

const filesFixture = () => ({
  characters: [{ filename: "康纳.md", name: "康纳" }],
  worldbuilding: [{ filename: "设定集.md", name: "设定集" }],
});

async function renderView(fandomPath = FANDOM_PATH) {
  const onNavigate = vi.fn();
  const utils = render(<MobileFandomView fandomPath={fandomPath} onNavigate={onNavigate} />);
  await screen.findByText("康纳");
  return { onNavigate, ...utils };
}

/** 点开角色文件并等读取完成（详情头出现文件名）。 */
async function openConnorFile() {
  fireEvent.click(screen.getByText("康纳"));
  await screen.findByTestId("markdown-preview");
}

describe("MobileFandomView — 状态下沉回归", () => {
  beforeEach(() => {
    (getFandomDisplayInfo as Mock).mockReset().mockResolvedValue({ name: "底特律" });
    (listFandomFiles as Mock).mockReset().mockResolvedValue(filesFixture());
    (readFandomFile as Mock)
      .mockReset()
      .mockResolvedValue({ filename: "康纳.md", category: "core_characters", content: "# 康纳\n\n原型机" });
    (saveLore as Mock).mockReset().mockResolvedValue(undefined);
    (deleteLore as Mock).mockReset().mockResolvedValue(undefined);
  });

  it("加载后列出角色文件、显示圈子名，切世界观 tab 换列表", async () => {
    await renderView();

    expect(screen.getByText("Fandom：底特律")).toBeTruthy();
    expect(listFandomFiles).toHaveBeenCalledWith("圈子目录");
    expect(screen.queryByText("设定集")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /世界观/ }));
    expect(screen.getByText("设定集")).toBeTruthy();
    expect(screen.queryByText("康纳")).toBeNull();
  });

  it("点开文件 → 预览读到内容 → 编辑改动 → 保存 payload 来自最新编辑", async () => {
    await renderView();
    await openConnorFile();

    expect(readFandomFile).toHaveBeenCalledWith("圈子目录", "core_characters", "康纳.md");
    expect(screen.getByTestId("markdown-preview").textContent).toContain("原型机");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByDisplayValue(/原型机/), { target: { value: "# 康纳\n\n觉醒了" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(saveLore).toHaveBeenCalledTimes(1));
    expect(saveLore).toHaveBeenCalledWith({
      fandom_path: FANDOM_PATH,
      category: "core_characters",
      filename: "康纳.md",
      content: "# 康纳\n\n觉醒了",
    });
  });

  it("新建：重名校验 → 落统一模板文件 → 刷新列表 → 自动打开新文件", async () => {
    await renderView();
    (readFandomFile as Mock).mockResolvedValue({
      filename: "汉克.md",
      category: "core_characters",
      content: "# 汉克\n\n[]",
    });

    fireEvent.click(screen.getByRole("button", { name: "添加角色" }));
    fireEvent.change(screen.getByPlaceholderText(/角色名/), { target: { value: "汉克" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(saveLore).toHaveBeenCalledTimes(1));
    // 模板走 lore-utils.buildDefaultFandomLoreContent（与桌面同源，合并审阅后统一）
    expect(saveLore).toHaveBeenCalledWith({
      fandom_path: FANDOM_PATH,
      category: "core_characters",
      filename: "汉克.md",
      content: "# 汉克\n\n[]",
    });
    // 列表调用：初始 1 次 + 新建前重名校验 1 次 + 新建后刷新 1 次
    await waitFor(() => expect(listFandomFiles).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(readFandomFile).toHaveBeenCalledWith("圈子目录", "core_characters", "汉克.md"));
    await screen.findByTestId("markdown-preview");
  });

  it("新建重名（含大小写/空格变体）：拦截告警，不落盘", async () => {
    await renderView();

    fireEvent.click(screen.getByRole("button", { name: "添加角色" }));
    fireEvent.change(screen.getByPlaceholderText(/角色名/), { target: { value: "康纳" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    // 重名校验拉一次列表后拦下：saveLore 不被调用
    await waitFor(() => expect(listFandomFiles).toHaveBeenCalledTimes(2));
    expect(saveLore).not.toHaveBeenCalled();
  });

  it("删除：确认后回列表并刷新", async () => {
    await renderView();
    await openConnorFile();

    // 详情头唯一的无名按钮 = 删除（垃圾桶 icon）
    const iconOnlyButton = screen.getAllByRole("button").find((b) => !b.textContent?.trim());
    expect(iconOnlyButton).toBeTruthy();
    fireEvent.click(iconOnlyButton!);
    await screen.findByText("确认删除资料");
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(deleteLore).toHaveBeenCalledTimes(1));
    expect(deleteLore).toHaveBeenCalledWith({
      fandom_path: FANDOM_PATH,
      category: "core_characters",
      filename: "康纳.md",
    });
    // 回列表视图并重拉
    await screen.findByText("Fandom：底特律");
    await waitFor(() => expect(listFandomFiles).toHaveBeenCalledTimes(2));
  });

  it("切圈子：详情态复位（不残留上一圈选中的文件）", async () => {
    const onNavigate = vi.fn();
    const { rerender } = render(<MobileFandomView fandomPath={FANDOM_PATH} onNavigate={onNavigate} />);
    await screen.findByText("康纳");
    await openConnorFile();
    expect(screen.getByRole("button", { name: "返回" })).toBeTruthy();

    (getFandomDisplayInfo as Mock).mockResolvedValue({ name: "另一圈" });
    rerender(<MobileFandomView fandomPath="fandoms/另一圈目录" onNavigate={onNavigate} />);

    // 详情 overlay 关闭，回到新圈子的列表视图
    await screen.findByText("Fandom：另一圈");
    expect(screen.queryByRole("button", { name: "返回" })).toBeNull();
    expect(listFandomFiles).toHaveBeenLastCalledWith("另一圈目录");
  });
});
