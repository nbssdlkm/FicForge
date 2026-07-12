// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * MobileLayout — 写文面板 keep-mounted（审计 M9）+ embedding stale banner
 * （审计 M10）+ 外部章节变更接线。
 *
 * WriterLayout / SimpleChatPanel 等子面板 stub 掉（它们的真实行为分别由
 * WriterLayout.integration / AuWorkspaceLayout.keepMounted 测试钉住），
 * 这里只钉 MobileLayout 的挂载策略与 props 接线。
 */

import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../i18n/useAppTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
    i18n: { resolvedLanguage: "zh" },
  }),
}));

interface StubWriterProps {
  isActiveTab?: boolean;
  externalChaptersVersion?: number;
}
const writerProps: StubWriterProps = {};
let writerUnmountCount = 0;
vi.mock("../../writer/WriterLayout", () => ({
  WriterLayout: (props: StubWriterProps) => {
    writerProps.isActiveTab = props.isActiveTab;
    writerProps.externalChaptersVersion = props.externalChaptersVersion;
    // 用副作用探针记录卸载：keep-mounted 契约 = 切 tab 不得触发 unmount。
    // 组件体在 render 时求值，闭包引用顶层 useEffect import 不受 vi.mock 提升影响。
    useEffect(
      () => () => {
        writerUnmountCount += 1;
      },
      [],
    );
    return <div data-testid="stub-writer" />;
  },
}));

const chatProps: { onChaptersChanged?: () => void; isActiveTab?: boolean } = {};
vi.mock("../../simple/SimpleChatPanel", () => ({
  SimpleChatPanel: (props: { onChaptersChanged?: () => void; isActiveTab?: boolean }) => {
    chatProps.onChaptersChanged = props.onChaptersChanged;
    chatProps.isActiveTab = props.isActiveTab;
    return <div data-testid="stub-chat" />;
  },
}));
vi.mock("../MobileChapterList", () => ({ MobileChapterList: () => <div data-testid="stub-chapters" /> }));
vi.mock("../MobileSettingsView", () => ({ MobileSettingsView: () => <div /> }));
vi.mock("../MobileManageView", () => ({ MobileManageView: () => <div /> }));

import { MobileLayout } from "../MobileLayout";

const baseProps = {
  activePage: "writer" as const,
  auPath: "/data/fandoms/F/aus/A1",
  auName: "Test AU",
  chapters: [],
  loadingChapters: false,
  currentChapter: 1,
  selectedChapter: null,
  onNavigate: vi.fn(),
  onSelectChapter: vi.fn(),
  onClearViewChapter: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  writerUnmountCount = 0;
  writerProps.isActiveTab = undefined;
  writerProps.externalChaptersVersion = undefined;
  chatProps.onChaptersChanged = undefined;
  chatProps.isActiveTab = undefined;
});

describe("MobileLayout 写文 keep-mounted（审计 M9）", () => {
  it("切到对话 tab 后 WriterLayout 不卸载，只被 CSS 隐藏", async () => {
    const user = userEvent.setup();
    render(<MobileLayout {...baseProps} />);
    expect(screen.getByTestId("stub-writer")).toBeInTheDocument();
    expect(writerProps.isActiveTab).toBe(true);

    // 底栏切到对话 tab
    await user.click(screen.getByText('simple.tabs.chat:{"defaultValue":"对话"}'));

    // 旧实现（条件渲染）此处 writer 已卸载 → unmount 探针 +1、查询失败
    expect(writerUnmountCount).toBe(0);
    const writer = screen.getByTestId("stub-writer");
    expect(writer).toBeInTheDocument();
    expect(writer.closest(".hidden")).not.toBeNull();
    expect(writerProps.isActiveTab).toBe(false);
    expect(chatProps.isActiveTab).toBe(true);
  });

  it("外部章节版本与外部回调透传：chat 面板拿 external 回调，writer 拿版本号", async () => {
    const onChaptersChanged = vi.fn();
    const onChaptersChangedExternal = vi.fn();
    render(
      <MobileLayout
        {...baseProps}
        onChaptersChanged={onChaptersChanged}
        onChaptersChangedExternal={onChaptersChangedExternal}
        externalChaptersVersion={7}
      />,
    );
    expect(writerProps.externalChaptersVersion).toBe(7);

    // 对话面板的通知必须走 external 通道（bump 版本号让隐藏的 writer 重载）
    chatProps.onChaptersChanged!();
    expect(onChaptersChangedExternal).toHaveBeenCalledTimes(1);
    expect(onChaptersChanged).not.toHaveBeenCalled();
  });
});

describe("MobileLayout embedding stale banner（审计 M10）", () => {
  it("embeddingStale=true 渲染 banner，两个动作各自接线", async () => {
    const user = userEvent.setup();
    const onRebuild = vi.fn();
    const onDismiss = vi.fn();
    render(
      <MobileLayout {...baseProps} embeddingStale onEmbeddingRebuild={onRebuild} onEmbeddingDismiss={onDismiss} />,
    );

    expect(screen.getByText(/embedding\.staleTitle/)).toBeInTheDocument();
    await user.click(screen.getByText("embedding.rebuild"));
    expect(onRebuild).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText("embedding.skipRebuild"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("embeddingStale 未设置时不渲染 banner", () => {
    render(<MobileLayout {...baseProps} />);
    expect(screen.queryByText(/embedding\.staleTitle/)).toBeNull();
  });
});
