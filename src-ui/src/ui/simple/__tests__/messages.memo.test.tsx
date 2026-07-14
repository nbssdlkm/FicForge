// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 对话消息卡 React.memo 判别性测试 —— 渲染计数法（R4 测试 L3）。
 *
 * 旧写法「same ref → innerHTML 稳定」是同义反复：无 memo 时，同 props 重渲也会得到
 * 同样的 HTML，断言恒真、测不到 memo。改为**渲染计数**：每个卡组件渲染时都会调
 * useTranslation().t，故把 t 换成 spy，同 props rerender 后断言 t 未再被调用（memo 命中
 * → 组件函数根本没跑）；改 props 后断言 t 再次被调用（memo 正确放行更新）。
 *
 * t 保留 defaultValue 口径（返回 defaultValue ?? key），使按钮按中文文案可被 getByRole
 * 定位——本文件的 memo 计数需求 + 按钮文案定位需求与共享工厂（JSON 口径、非 spy）不兼容，
 * 故自持专用 mock，不接共享 test/mocks/i18n。
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AssistantMessage } from "../messages/AssistantMessage";
import { UserMessage } from "../messages/UserMessage";
import { SystemMessage } from "../messages/SystemMessage";
import { WritingDraftCard } from "../messages/WritingDraftCard";
import { ToolCallCard } from "../messages/ToolCallCard";
import { ChapterPreviewCard } from "../messages/ChapterPreviewCard";
import { SettingPreviewCard } from "../messages/SettingPreviewCard";

// 渲染计数 spy：多数卡组件渲染时都会调 t()。defaultValue 口径保证按钮中文文案可定位。
// SystemMessage 不调 t（直接渲染 content），改用 CardStatusBanner 渲染 spy 计数。
const { t, statusBannerSpy } = vi.hoisted(() => ({
  t: vi.fn((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key),
  statusBannerSpy: vi.fn(),
}));

vi.mock("../../../i18n/useAppTranslation", () => ({
  useTranslation: () => ({ t }),
}));

// 部分 mock CardChrome：只把 CardStatusBanner 包一层渲染 spy（其余 chrome 保留 actual，
// WritingDraftCard / ChapterPreviewCard 用的 CardEyebrow/ExpandToggle/ActionFooter 不受影响）。
vi.mock("../messages/CardChrome", async () => {
  const actual = await vi.importActual<typeof import("../messages/CardChrome")>("../messages/CardChrome");
  const Real = actual.CardStatusBanner;
  return {
    ...actual,
    CardStatusBanner: (props: Record<string, unknown>) => {
      statusBannerSpy();
      return <Real {...(props as Parameters<typeof Real>[0])} />;
    },
  };
});

beforeEach(() => {
  t.mockClear();
  statusBannerSpy.mockClear();
});

// ── AssistantMessage ──────────────────────────────────────────────

describe("AssistantMessage memo", () => {
  const message = { id: "m1", kind: "assistant" as const, timestamp: "2026-05-05T00:00:00Z", content: "hello" };

  test("same message ref → memoized（重渲不触发组件函数：t 未再被调用）", () => {
    const { rerender } = render(<AssistantMessage message={message} />);
    t.mockClear();
    rerender(<AssistantMessage message={message} />);
    expect(t).not.toHaveBeenCalled();
  });

  test("changed message content → 重渲（t 再被调用）+ 新正文", () => {
    const { rerender, container } = render(<AssistantMessage message={message} />);
    t.mockClear();
    rerender(<AssistantMessage message={{ ...message, content: "hello world" }} />);
    expect(t).toHaveBeenCalled();
    expect(container.textContent).toContain("hello world");
  });
});

// ── UserMessage ───────────────────────────────────────────────────

describe("UserMessage memo", () => {
  const message = { id: "m2", kind: "user" as const, timestamp: "2026-05-05T00:00:00Z", content: "hello user" };

  test("same message ref → memoized（t 未再被调用）", () => {
    const { rerender } = render(<UserMessage message={message} />);
    t.mockClear();
    rerender(<UserMessage message={message} />);
    expect(t).not.toHaveBeenCalled();
  });

  test("changed message content → 重渲 + 新正文", () => {
    const { rerender, container } = render(<UserMessage message={{ ...message, content: "hello" }} />);
    t.mockClear();
    rerender(<UserMessage message={{ ...message, content: "hello user" }} />);
    expect(t).toHaveBeenCalled();
    expect(container.textContent).toContain("hello user");
  });
});

// ── SystemMessage ─────────────────────────────────────────────────

describe("SystemMessage memo", () => {
  const message = {
    id: "m3",
    kind: "system" as const,
    timestamp: "2026-05-05T00:00:00Z",
    tone: "info" as const,
    content: "system message",
  };

  // SystemMessage 不调 t，用 CardStatusBanner 渲染 spy 计数。
  test("same message ref → memoized（CardStatusBanner 未再渲染）", () => {
    const { rerender } = render(<SystemMessage message={message} />);
    statusBannerSpy.mockClear();
    rerender(<SystemMessage message={message} />);
    expect(statusBannerSpy).not.toHaveBeenCalled();
  });

  test("changed message content → 重渲（CardStatusBanner 再渲染）+ 新正文", () => {
    const { rerender, container } = render(<SystemMessage message={{ ...message, content: "old" }} />);
    statusBannerSpy.mockClear();
    rerender(<SystemMessage message={{ ...message, content: "new system message" }} />);
    expect(statusBannerSpy).toHaveBeenCalled();
    expect(container.textContent).toContain("new system message");
  });
});

// ── WritingDraftCard ──────────────────────────────────────────────

describe("WritingDraftCard memo", () => {
  const baseMessage = {
    id: "m4",
    kind: "writing-draft" as const,
    timestamp: "2026-05-05T00:00:00Z",
    chapter_num: 1,
    draft_label: "A",
    content: "draft content here",
    status: "pending" as const,
  };

  test("same props → memoized（t 未再被调用）", () => {
    const cb = vi.fn();
    const props = { message: baseMessage, isStreaming: false, onAccept: cb, onRegenerate: cb, onDiscard: cb };
    const { rerender } = render(<WritingDraftCard {...props} />);
    t.mockClear();
    rerender(<WritingDraftCard {...props} />);
    expect(t).not.toHaveBeenCalled();
  });

  test("changed message content → 重渲 + 新正文", () => {
    const cb = vi.fn();
    const { rerender, container } = render(
      <WritingDraftCard message={baseMessage} isStreaming={false} onAccept={cb} onRegenerate={cb} onDiscard={cb} />,
    );
    t.mockClear();
    const m2 = { ...baseMessage, content: "updated draft" };
    rerender(<WritingDraftCard message={m2} isStreaming={false} onAccept={cb} onRegenerate={cb} onDiscard={cb} />);
    expect(t).toHaveBeenCalled();
    expect(container.textContent).toContain("updated draft");
  });

  test("changed onAccept ref → new callback fires on click", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cbShared = vi.fn();
    const { rerender } = render(
      <WritingDraftCard
        message={baseMessage}
        isStreaming={false}
        onAccept={cb1}
        onRegenerate={cbShared}
        onDiscard={cbShared}
      />,
    );
    rerender(
      <WritingDraftCard
        message={baseMessage}
        isStreaming={false}
        onAccept={cb2}
        onRegenerate={cbShared}
        onDiscard={cbShared}
      />,
    );
    // mock t 不插值，defaultValue 原样返回 "接受为第 {{num}} 章"
    fireEvent.click(screen.getByRole("button", { name: "接受为第 {{num}} 章" }));
    expect(cb2).toHaveBeenCalledWith(baseMessage.id);
    expect(cb1).not.toHaveBeenCalled();
  });
});

// ── ToolCallCard ──────────────────────────────────────────────────

describe("ToolCallCard memo", () => {
  const baseMessage = {
    id: "m5",
    kind: "tool-call" as const,
    timestamp: "2026-05-05T00:00:00Z",
    tool_name: "modify_chapter",
    tool_args: { chapterNum: 1 },
    status: "pending" as const,
  };

  test("same props → memoized（t 未再被调用）", () => {
    const cb = vi.fn();
    const props = { message: baseMessage, globalBusy: false, onConfirm: cb, onSkip: cb, onUndo: cb };
    const { rerender } = render(<ToolCallCard {...props} />);
    t.mockClear();
    rerender(<ToolCallCard {...props} />);
    expect(t).not.toHaveBeenCalled();
  });

  test("changed message toolArgs → 重渲 + 新 args", () => {
    const cb = vi.fn();
    const { rerender, container } = render(
      <ToolCallCard message={baseMessage} globalBusy={false} onConfirm={cb} onSkip={cb} onUndo={cb} />,
    );
    t.mockClear();
    const m2 = { ...baseMessage, tool_args: { chapterNum: 2, extra: true } };
    rerender(<ToolCallCard message={m2} globalBusy={false} onConfirm={cb} onSkip={cb} onUndo={cb} />);
    expect(t).toHaveBeenCalled();
    expect(container.textContent).toContain('"chapterNum": 2');
  });

  test("changed onConfirm ref → new callback fires on click", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cbShared = vi.fn();
    const { rerender } = render(
      <ToolCallCard message={baseMessage} globalBusy={false} onConfirm={cb1} onSkip={cbShared} onUndo={cbShared} />,
    );
    rerender(
      <ToolCallCard message={baseMessage} globalBusy={false} onConfirm={cb2} onSkip={cbShared} onUndo={cbShared} />,
    );
    // 确认按钮文本 "确认"（mock t 返回 defaultValue）
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(cb2).toHaveBeenCalledWith(baseMessage.id);
    expect(cb1).not.toHaveBeenCalled();
  });
});

// ── ChapterPreviewCard ────────────────────────────────────────────

describe("ChapterPreviewCard memo", () => {
  const baseMessage = {
    id: "m6",
    kind: "chapter-preview" as const,
    timestamp: "2026-05-05T00:00:00Z",
    chapter_num: 1,
    expanded: false,
  };

  test("same props → memoized（t 未再被调用）", () => {
    const cb = vi.fn();
    const { rerender } = render(<ChapterPreviewCard message={baseMessage} auPath="/au/test" onToggleExpanded={cb} />);
    t.mockClear();
    rerender(<ChapterPreviewCard message={baseMessage} auPath="/au/test" onToggleExpanded={cb} />);
    expect(t).not.toHaveBeenCalled();
  });

  test("changed message（chapterNum）→ 重渲（t 再被调用）", () => {
    // chapterNum 经 t 插值，mock 不插值 → 文本不随数据变，故只断言重渲发生（memo 放行）。
    const cb = vi.fn();
    const { rerender } = render(<ChapterPreviewCard message={baseMessage} auPath="/au/test" onToggleExpanded={cb} />);
    t.mockClear();
    rerender(
      <ChapterPreviewCard message={{ ...baseMessage, chapter_num: 2 }} auPath="/au/test" onToggleExpanded={cb} />,
    );
    expect(t).toHaveBeenCalled();
  });
});

// ── SettingPreviewCard ────────────────────────────────────────────

describe("SettingPreviewCard memo", () => {
  const baseMessage = {
    id: "m7",
    kind: "setting-preview" as const,
    timestamp: "2026-05-05T00:00:00Z",
    file_path: "characters/Alice.md",
    expanded: false,
  };

  test("same props → memoized（t 未再被调用）", () => {
    const cb = vi.fn();
    const { rerender } = render(<SettingPreviewCard message={baseMessage} auPath="/au/test" onToggleExpanded={cb} />);
    t.mockClear();
    rerender(<SettingPreviewCard message={baseMessage} auPath="/au/test" onToggleExpanded={cb} />);
    expect(t).not.toHaveBeenCalled();
  });

  test("changed message filePath → 重渲 + 新路径", () => {
    const cb = vi.fn();
    const { rerender, container } = render(
      <SettingPreviewCard message={baseMessage} auPath="/au/test" onToggleExpanded={cb} />,
    );
    t.mockClear();
    const m2 = { ...baseMessage, file_path: "worldbuilding/Magic.md" };
    rerender(<SettingPreviewCard message={m2} auPath="/au/test" onToggleExpanded={cb} />);
    expect(t).toHaveBeenCalled();
    expect(container.textContent).toContain("worldbuilding/Magic.md");
  });
});
