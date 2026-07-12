// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FactsLayout 拆分回归（长期债②：896 行 god 组件拆分）。
 * god 组件拆为 useFactsData + FactsFilterBar / FactsListControls / FactsList / FactsModals /
 * FactEditorForm 后锁住的行为——加载渲染、状态 tab 服务端重拉、搜索客户端过滤、切 AU 复位
 *（关编辑器 + 重拉新 AU）、新建入口弹窗。
 *
 * mock 姿势对齐 AuLoreLayout.test.tsx：整体 spread 真实 engine-client，只桩 listFacts /
 * getState / mutation + getEngine（useFactsExtraction 挂载会读 taskRunner）。
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FactsLayout } from "../FactsLayout";
import { FeedbackProvider } from "../../../hooks/useFeedback";

vi.mock("../../../api/engine-client", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    listFacts: vi.fn(),
    getState: vi.fn(),
    updateFactStatus: vi.fn(),
    unarchiveFact: vi.fn(),
    // useFactsExtraction 挂载 effect 会读 taskRunner 的 active/completed 任务；桩成空列表。
    getEngine: () => ({
      taskRunner: {
        getActiveTasks: () => [],
        getCompletedTasks: () => [],
        onEvent: () => () => {},
        cancel: () => {},
      },
    }),
  };
});

import { listFacts, getState } from "../../../api/engine-client";

const AU_PATH = "fandoms/f/aus/a";

/** 最小可渲染 Fact（listFacts 被桩，字段只需覆盖 FactsLayout / FactCard 读取到的部分）。 */
function makeFact(over: Record<string, unknown> = {}) {
  return {
    id: "f_alpha_0001",
    content_raw: "raw",
    content_clean: "主角与反派初次交锋",
    characters: ["主角"],
    timeline: "main",
    story_time: "",
    chapter: 1,
    status: "active",
    type: "plot_event",
    resolves: null,
    narrative_weight: "medium",
    source: "manual",
    revision: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function renderLayout(auPath = AU_PATH) {
  return render(
    <FeedbackProvider>
      <FactsLayout auPath={auPath} />
    </FeedbackProvider>,
  );
}

describe("FactsLayout — 拆分回归", () => {
  beforeEach(() => {
    (listFacts as Mock).mockReset().mockResolvedValue([makeFact()]);
    (getState as Mock).mockReset().mockResolvedValue({ current_chapter: 5, index_status: "fresh" });
  });

  it("加载渲染：拉取事实并渲染卡片；初次显示集不带状态、另有一次全量拉计数", async () => {
    renderLayout();

    expect(await screen.findByText("剧情笔记")).toBeTruthy();
    expect(await screen.findByText("主角与反派初次交锋")).toBeTruthy();

    expect(listFacts).toHaveBeenCalledWith(AU_PATH, undefined); // 显示集
    expect(listFacts).toHaveBeenCalledWith(AU_PATH); // 全量算 tab 计数
    expect(getState).toHaveBeenCalledWith(AU_PATH);
  });

  it("过滤（状态 tab）：点「待填坑」→ 服务端按 unresolved 重拉", async () => {
    renderLayout();
    await screen.findByText("主角与反派初次交锋");
    (listFacts as Mock).mockClear();

    // 桌面状态 tab 是 <span>「待填坑 (0)」；用整段文本正则精确匹配该 span（容器文本以「全部」起头不撞车）。
    fireEvent.click(screen.getByText(/^待填坑 \(\d+\)$/));

    await waitFor(() => expect(listFacts).toHaveBeenCalledWith(AU_PATH, "unresolved"));
  });

  it("过滤（搜索）：输入关键词，客户端过滤掉不匹配的卡片", async () => {
    (listFacts as Mock).mockResolvedValue([
      makeFact(),
      makeFact({ id: "f_beta_0002", content_clean: "支线角色登场", characters: ["配角"] }),
    ]);
    renderLayout();
    expect(await screen.findByText("主角与反派初次交锋")).toBeTruthy();
    expect(screen.getByText("支线角色登场")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("搜索剧情笔记或关联角色…"), { target: { value: "支线" } });

    expect(screen.queryByText("主角与反派初次交锋")).toBeNull();
    expect(screen.getByText("支线角色登场")).toBeTruthy();
  });

  it("切 AU 复位：关闭上一篇打开的编辑器并重拉新 AU", async () => {
    const { rerender } = renderLayout(AU_PATH);
    await screen.findByText("主角与反派初次交锋");
    expect(screen.getByText("还没有选中剧情笔记")).toBeTruthy();

    // 点卡片进入编辑态 → 右栏不再显示「还没有选中」
    fireEvent.click(screen.getByText("主角与反派初次交锋"));
    await waitFor(() => expect(screen.queryByText("还没有选中剧情笔记")).toBeNull());

    rerender(
      <FeedbackProvider>
        <FactsLayout auPath="fandoms/f/aus/b" />
      </FeedbackProvider>,
    );

    await waitFor(() => expect(listFacts).toHaveBeenCalledWith("fandoms/f/aus/b", undefined));
    // 复位：编辑器关闭，右栏回到「还没有选中」
    await waitFor(() => expect(screen.getByText("还没有选中剧情笔记")).toBeTruthy());
  });

  it("新建入口：点「记一笔」打开新建弹窗（含提交按钮）", async () => {
    renderLayout();
    await screen.findByText("主角与反派初次交锋");

    fireEvent.click(screen.getByRole("button", { name: "记一笔" }));

    // 弹窗打开：createModal 专属的提交按钮出现
    expect(await screen.findByText("安全记下这笔")).toBeTruthy();
  });
});
