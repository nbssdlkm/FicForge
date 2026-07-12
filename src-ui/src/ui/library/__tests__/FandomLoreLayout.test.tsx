// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FandomLoreLayout 状态下沉回归（长期债②第四块）：
 * 21 useState + 4 pending ref → 4 hooks（files / editor / chrome / dirtyGuard）后锁住的行为——
 * 加载回显、选中读入、保存 payload、脏编辑弃改确认（切文件/返回导航）、
 * 新建（含重名拦截 + 自动进编辑态）、删除级联清理、切 fandom 复位。
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FandomLoreLayout } from "../FandomLoreLayout";

// 重型子组件与本测试无关，剪掉其 API 面
vi.mock("../../shared/TrashPanel", () => ({ TrashPanel: () => null }));
vi.mock("../../shared/settings-chat/SettingsChatPanel", () => ({ SettingsChatPanel: () => null }));
vi.mock("../../shared/SettingsMarkdown", () => ({
  SettingsMarkdown: ({ content }: { content: string }) => <div data-testid="lore-preview">{content}</div>,
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

const FANDOM_PATH = "fandoms/底特律";

const fileListsFixture = () => ({
  characters: [{ name: "康纳", filename: "康纳.md" }],
  worldbuilding: [{ name: "仿生人条例", filename: "仿生人条例.md" }],
});

const emptyLists = () => ({ characters: [], worldbuilding: [] });

function renderLayout(fandomPath = FANDOM_PATH, onNavigate = vi.fn()) {
  const utils = render(<FandomLoreLayout fandomPath={fandomPath} onNavigate={onNavigate} />);
  return { ...utils, onNavigate };
}

/** 选中「康纳」并等待内容读入编辑器（preview 态） */
async function selectConnor() {
  fireEvent.click(screen.getByText("康纳"));
  await waitFor(() => expect(screen.getByTestId("lore-preview").textContent).toBe("康纳.md的内容"));
}

/** 进入编辑态并制造一处未保存修改 */
async function makeDirtyEdit() {
  await selectConnor();
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.change(screen.getByDisplayValue("康纳.md的内容"), { target: { value: "改过但未保存" } });
}

describe("FandomLoreLayout — 状态下沉回归", () => {
  beforeEach(() => {
    (getFandomDisplayInfo as Mock).mockReset().mockResolvedValue({ name: "底特律：变人" });
    (listFandomFiles as Mock).mockReset().mockResolvedValue(fileListsFixture());
    (readFandomFile as Mock)
      .mockReset()
      .mockImplementation((_dir: string, _category: string, filename: string) =>
        Promise.resolve({ content: `${filename}的内容` }),
      );
    (saveLore as Mock).mockReset().mockResolvedValue(undefined);
    (deleteLore as Mock).mockReset().mockResolvedValue(undefined);
  });

  it("加载后侧栏回显两类文件与 fandom 显示名", async () => {
    renderLayout();

    await screen.findByText("康纳");
    expect(screen.getByText("仿生人条例")).toBeTruthy();
    expect(screen.getByText("Fandom：底特律：变人")).toBeTruthy();
    expect(listFandomFiles).toHaveBeenCalledWith("底特律");
  });

  it("选中文件读入编辑器；编辑后保存 payload 来自最新内容", async () => {
    renderLayout();
    await screen.findByText("康纳");

    await selectConnor();
    expect(readFandomFile).toHaveBeenCalledWith("底特律", "core_characters", "康纳.md");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByDisplayValue("康纳.md的内容"), { target: { value: "# 康纳\n\n改过的设定" } });
    fireEvent.click(screen.getByRole("button", { name: "保存Fandom资料" }));

    await waitFor(() => expect(saveLore).toHaveBeenCalledTimes(1));
    expect((saveLore as Mock).mock.calls[0][0]).toEqual({
      fandom_path: FANDOM_PATH,
      category: "core_characters",
      filename: "康纳.md",
      content: "# 康纳\n\n改过的设定",
    });
  });

  it("脏编辑切文件：弹弃改确认，确认后加载目标文件", async () => {
    renderLayout();
    await screen.findByText("康纳");
    await makeDirtyEdit();

    fireEvent.click(screen.getByText("仿生人条例"));
    await screen.findByText("放弃未保存的修改？");

    fireEvent.click(screen.getByRole("button", { name: "放弃并继续" }));
    await screen.findByDisplayValue("仿生人条例.md的内容");
    expect(readFandomFile).toHaveBeenLastCalledWith("底特律", "core_worldbuilding", "仿生人条例.md");
  });

  it("脏编辑切文件：取消弃改则原地保留未保存内容", async () => {
    renderLayout();
    await screen.findByText("康纳");
    await makeDirtyEdit();
    expect(readFandomFile).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("仿生人条例"));
    await screen.findByText("放弃未保存的修改？");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByText("放弃未保存的修改？")).toBeNull());
    expect(screen.getByDisplayValue("改过但未保存")).toBeTruthy();
    expect(readFandomFile).toHaveBeenCalledTimes(1); // 未触发目标文件读取
  });

  it("脏编辑点返回：确认弃改后才导航", async () => {
    const { onNavigate } = renderLayout();
    await screen.findByText("康纳");
    await makeDirtyEdit();

    fireEvent.click(screen.getByTitle("返回"));
    expect(onNavigate).not.toHaveBeenCalled();
    await screen.findByText("放弃未保存的修改？");

    fireEvent.click(screen.getByRole("button", { name: "放弃并继续" }));
    expect(onNavigate).toHaveBeenCalledWith("library");
  });

  it("新建角色：落库 payload 带默认模板，自动选中并进编辑态，侧栏追加", async () => {
    (listFandomFiles as Mock).mockResolvedValue(emptyLists());
    renderLayout();
    await screen.findByText("还没有角色设定");

    fireEvent.click(screen.getByRole("button", { name: "添加角色" }));
    fireEvent.change(screen.getByPlaceholderText("角色名（如：康纳）"), { target: { value: "盖文" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(saveLore).toHaveBeenCalledTimes(1));
    expect((saveLore as Mock).mock.calls[0][0]).toEqual({
      fandom_path: FANDOM_PATH,
      category: "core_characters",
      filename: "盖文.md",
      content: "# 盖文\n\n[]",
    });
    // 新建后直接进编辑态回显默认模板（findByDisplayValue 会归一化空白，换行内容改为直接断言 value）
    await waitFor(() => {
      const boxes = screen.getAllByRole("textbox") as (HTMLInputElement | HTMLTextAreaElement)[];
      expect(boxes.some((el) => el.value === "# 盖文\n\n[]")).toBe(true);
    });
    // 侧栏乐观追加
    expect(screen.getByText("盖文")).toBeTruthy();
  });

  it("新建重名：按新建前重拉的最新列表拦截，不落库且弹窗保持打开", async () => {
    (listFandomFiles as Mock)
      .mockResolvedValueOnce(emptyLists()) // 首屏加载：空
      .mockResolvedValue(fileListsFixture()); // 新建前重拉：已有「康纳」
    renderLayout();
    await screen.findByText("还没有角色设定");

    fireEvent.click(screen.getByRole("button", { name: "添加角色" }));
    fireEvent.change(screen.getByPlaceholderText("角色名（如：康纳）"), { target: { value: "康纳" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await screen.findByText("「康纳.md」已经存在，先换个名字再创建。");
    expect(saveLore).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("角色名（如：康纳）")).toBeTruthy(); // 弹窗未关
  });

  it("删除：确认后落库、侧栏移除、编辑区回到未选中态", async () => {
    renderLayout();
    await screen.findByText("康纳");
    await selectConnor();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await screen.findByText("确认删除资料");
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(deleteLore).toHaveBeenCalledTimes(1));
    expect((deleteLore as Mock).mock.calls[0][0]).toEqual({
      fandom_path: FANDOM_PATH,
      category: "core_characters",
      filename: "康纳.md",
    });
    await waitFor(() => expect(screen.queryByText("康纳")).toBeNull());
    expect(screen.getByText("还没有角色设定")).toBeTruthy();
    expect(screen.getByText("从左边选一份资料开始编辑。")).toBeTruthy();
  });

  it("切 fandom：重新拉取、清空选中与编辑内容", async () => {
    (getFandomDisplayInfo as Mock).mockImplementation((path: string) =>
      Promise.resolve({ name: path === FANDOM_PATH ? "底特律：变人" : "星际牛仔" }),
    );
    const onNavigate = vi.fn();
    const { rerender } = render(<FandomLoreLayout fandomPath={FANDOM_PATH} onNavigate={onNavigate} />);
    await screen.findByText("康纳");
    await selectConnor();

    rerender(<FandomLoreLayout fandomPath="fandoms/星际" onNavigate={onNavigate} />);

    await screen.findByText("Fandom：星际牛仔");
    expect(listFandomFiles).toHaveBeenLastCalledWith("星际");
    expect(screen.getByText("从左边选一份资料开始编辑。")).toBeTruthy();
    expect(screen.queryByTestId("lore-preview")).toBeNull();
  });
});
