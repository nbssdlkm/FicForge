// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * AuWorkspaceLayout — 桌面双常驻 tab（chat + writer）keep-mounted 契约（审计 M9
 * + plan 2.1 欠账的桌面恒渲染 UI 测试）。
 *
 * 判别性契约（回退到「writer 走 AnimatePresence 条件渲染」旧实现即挂）：
 *  1. 切到 chat tab 后 WriterLayout 不卸载（生成流 abort 挂在它的 unmount cleanup 上）
 *  2. 切回 writer 不触发重新 bootstrap（旧实现重挂 → 必然多打一轮 API）
 *  3. 对话接受章节（onChaptersChanged）→ 隐藏的 writer 挂起刷新，切回时重载
 *
 * WriterLayout 用真实现（它是被测对象）；SimpleChatPanel / facts 等兄弟面板 stub。
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../i18n/useAppTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
    i18n: { resolvedLanguage: "zh" },
  }),
}));

vi.mock("../../../hooks/useMediaQuery", () => ({
  useMediaQuery: () => false, // 桌面分支
}));

vi.mock("../../../hooks/useKV", () => ({
  useKV: (_key: string, defaultValue: string) => [defaultValue, vi.fn()],
}));

// 兄弟面板 stub：只留 SimpleChatPanel 的 onChaptersChanged 出口供测试触发
const chatPanelProps: { onChaptersChanged?: () => void; isActiveTab?: boolean } = {};
vi.mock("../../simple/SimpleChatPanel", () => ({
  SimpleChatPanel: (props: { onChaptersChanged?: () => void; isActiveTab?: boolean }) => {
    chatPanelProps.onChaptersChanged = props.onChaptersChanged;
    chatPanelProps.isActiveTab = props.isActiveTab;
    return <div data-testid="stub-chat-panel" />;
  },
}));
vi.mock("../../facts/FactsLayout", () => ({ FactsLayout: () => <div data-testid="stub-facts" /> }));
vi.mock("../../threads/ThreadsLayout", () => ({ ThreadsLayout: () => <div /> }));
vi.mock("../../library/AuLoreLayout", () => ({ AuLoreLayout: () => <div /> }));
vi.mock("../../settings/AuSettingsLayout", () => ({ AuSettingsLayout: () => <div /> }));

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>("../../../api/engine-client");
  return {
    ...actual,
    // workspace 层
    listChapters: vi.fn(),
    getWorkspaceSnapshot: vi.fn(),
    rebuildIndex: vi.fn(),
    updateChapterTitle: vi.fn(),
    // writer bootstrap 层
    getState: vi.fn(),
    listFacts: vi.fn(),
    getWriterProjectContext: vi.fn(),
    getWriterSessionConfig: vi.fn(),
    getChapterContent: vi.fn(),
    listDrafts: vi.fn(),
    getDraft: vi.fn(),
    saveDraft: vi.fn(),
    generateChapter: vi.fn(),
    isEngineReady: vi.fn(() => false),
  };
});

import { AuWorkspaceLayout } from "../AuWorkspaceLayout";
import * as engineClient from "../../../api/engine-client";

const mocked = vi.mocked(engineClient as unknown as Record<string, ReturnType<typeof vi.fn>>);

const AU = "/data/fandoms/F/aus/A1";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocked.listChapters.mockResolvedValue([]);
  mocked.getWorkspaceSnapshot.mockResolvedValue({ au_name: "Test AU", pinned_count: 0 });
  mocked.getState.mockResolvedValue({
    current_chapter: 1,
    chapter_focus: [],
    chapters_dirty: [],
    last_confirmed_chapter_focus: [],
    au_id: "/fandoms/F/aus/A1",
    index_status: "ready",
  });
  mocked.listFacts.mockResolvedValue([]);
  mocked.getWriterProjectContext.mockResolvedValue({
    name: "Test AU",
    llm: { mode: "api", model: "gpt-4", has_api_key: true },
  });
  mocked.getWriterSessionConfig.mockResolvedValue({
    default_llm: { mode: "api", model: "gpt-4", has_api_key: true },
    model_params: {},
  });
  mocked.getChapterContent.mockResolvedValue("");
  mocked.listDrafts.mockResolvedValue([]);
});

function renderWorkspace(activeTab: string) {
  const onNavigate = vi.fn();
  const utils = render(<AuWorkspaceLayout activeTab={activeTab} auPath={AU} onNavigate={onNavigate} />);
  return { ...utils, onNavigate };
}

async function waitForWriterBootstrap(times = 1) {
  await waitFor(() => {
    expect(mocked.getWriterProjectContext).toHaveBeenCalledTimes(times);
  });
}

describe("AuWorkspaceLayout 桌面双常驻 tab（审计 M9）", () => {
  it("切到 chat tab 后 WriterLayout 保持挂载（CSS 隐藏而非卸载）", async () => {
    const { rerender, onNavigate } = renderWorkspace("writer");
    await waitForWriterBootstrap();
    // writer 空态文案在场 = WriterLayout 已渲染
    await screen.findByText("writer.emptyContent");

    rerender(<AuWorkspaceLayout activeTab="chat" auPath={AU} onNavigate={onNavigate} />);

    // 旧实现（AnimatePresence 条件渲染）此处 WriterLayout 已卸载 → 查询失败
    const writerContent = screen.getByText("writer.emptyContent");
    expect(writerContent).toBeInTheDocument();
    // 且它藏在 display:none 容器里，不与 chat 抢布局
    expect(writerContent.closest(".hidden")).not.toBeNull();
    expect(screen.getByTestId("stub-chat-panel")).toBeInTheDocument();
  });

  it("writer → chat → writer 往返不触发重新 bootstrap，但边沿轻量刷新配置（R1-1）", async () => {
    const { rerender, onNavigate } = renderWorkspace("writer");
    await waitForWriterBootstrap(1);
    // 初次 bootstrap：state 就位后 draft 控制器 load 一次
    await waitFor(() => expect(mocked.listDrafts).toHaveBeenCalledTimes(1));

    rerender(<AuWorkspaceLayout activeTab="chat" auPath={AU} onNavigate={onNavigate} />);
    rerender(<AuWorkspaceLayout activeTab="writer" auPath={AU} onNavigate={onNavigate} />);

    // R1-1 新契约：切回边沿走 refreshSettingsModeData（配置不 stale）……
    await waitFor(() => {
      expect(mocked.getWriterSessionConfig).toHaveBeenCalledTimes(2);
      expect(mocked.getWriterProjectContext).toHaveBeenCalledTimes(2);
    });
    // ……但不是重挂/全量 bootstrap：草稿控制器不重载（旧实现重挂此处必是 2）
    expect(mocked.listDrafts).toHaveBeenCalledTimes(1);
  });

  it("chat tab 接受章节（onChaptersChanged）→ 隐藏 writer 挂起刷新，切回时重载", async () => {
    const { rerender, onNavigate } = renderWorkspace("writer");
    await waitForWriterBootstrap(1);

    rerender(<AuWorkspaceLayout activeTab="chat" auPath={AU} onNavigate={onNavigate} />);
    expect(chatPanelProps.onChaptersChanged).toBeTypeOf("function");

    // 模拟对话面板接受章节后的宿主通知
    chatPanelProps.onChaptersChanged!();

    // 隐藏期不偷跑 writer bootstrap（宿主自己的 listChapters 会刷）
    await waitFor(() => {
      // refreshChapters 至少被再调过一次
      expect(mocked.listChapters.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(mocked.getWriterProjectContext).toHaveBeenCalledTimes(1);

    // 切回 writer：挂起的外部刷新执行 → bootstrap 重载拿到新章号
    rerender(<AuWorkspaceLayout activeTab="writer" auPath={AU} onNavigate={onNavigate} />);
    await waitForWriterBootstrap(2);
  });

  it("facts 等其余 tab 维持按需挂载（不常驻）", async () => {
    const { rerender, onNavigate } = renderWorkspace("writer");
    await waitForWriterBootstrap();
    expect(screen.queryByTestId("stub-facts")).toBeNull();

    rerender(<AuWorkspaceLayout activeTab="facts" auPath={AU} onNavigate={onNavigate} />);
    await screen.findByTestId("stub-facts");

    rerender(<AuWorkspaceLayout activeTab="writer" auPath={AU} onNavigate={onNavigate} />);
    // AnimatePresence exit 动画结束后 facts 卸载
    await waitFor(() => {
      expect(screen.queryByTestId("stub-facts")).toBeNull();
    });
  });

  it("对话面板拿到 isActiveTab 标记（隐藏期提取完成走 toast 提示）", async () => {
    const { rerender, onNavigate } = renderWorkspace("chat");
    await waitFor(() => expect(chatPanelProps.isActiveTab).toBe(true));

    rerender(<AuWorkspaceLayout activeTab="writer" auPath={AU} onNavigate={onNavigate} />);
    await waitFor(() => expect(chatPanelProps.isActiveTab).toBe(false));
  });
});
