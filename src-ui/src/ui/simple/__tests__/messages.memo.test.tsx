// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AssistantMessage } from "../messages/AssistantMessage";
import { UserMessage } from "../messages/UserMessage";
import { SystemMessage } from "../messages/SystemMessage";
import { WritingDraftCard } from "../messages/WritingDraftCard";
import { ToolCallCard } from "../messages/ToolCallCard";
import { ChapterPreviewCard } from "../messages/ChapterPreviewCard";
import { SettingPreviewCard } from "../messages/SettingPreviewCard";

vi.mock("../../../i18n/useAppTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

// ── AssistantMessage ──────────────────────────────────────────────

describe("AssistantMessage memo", () => {
  test("same message ref → output stable across rerenders", () => {
    const message = {
      id: "m1",
      kind: "assistant" as const,
      timestamp: "2026-05-05T00:00:00Z",
      content: "hello",
    };
    const { rerender, container } = render(<AssistantMessage message={message} />);
    const html1 = container.innerHTML;
    rerender(<AssistantMessage message={message} />);
    expect(container.innerHTML).toBe(html1);
  });

  test("changed message content → re-renders new content", () => {
    const m1 = {
      id: "m1",
      kind: "assistant" as const,
      timestamp: "2026-05-05T00:00:00Z",
      content: "hello",
    };
    const { rerender, container } = render(<AssistantMessage message={m1} />);
    const m2 = { ...m1, content: "hello world" };
    rerender(<AssistantMessage message={m2} />);
    expect(container.textContent).toContain("hello world");
  });
});

// ── UserMessage ───────────────────────────────────────────────────

describe("UserMessage memo", () => {
  test("same message ref → output stable across rerenders", () => {
    const message = {
      id: "m2",
      kind: "user" as const,
      timestamp: "2026-05-05T00:00:00Z",
      content: "hello user",
    };
    const { rerender, container } = render(<UserMessage message={message} />);
    const html1 = container.innerHTML;
    rerender(<UserMessage message={message} />);
    expect(container.innerHTML).toBe(html1);
  });

  test("changed message content → re-renders new content", () => {
    const m1 = {
      id: "m2",
      kind: "user" as const,
      timestamp: "2026-05-05T00:00:00Z",
      content: "hello",
    };
    const { rerender, container } = render(<UserMessage message={m1} />);
    const m2 = { ...m1, content: "hello user" };
    rerender(<UserMessage message={m2} />);
    expect(container.textContent).toContain("hello user");
  });
});

// ── SystemMessage ─────────────────────────────────────────────────

describe("SystemMessage memo", () => {
  test("same message ref → output stable across rerenders", () => {
    const message = {
      id: "m3",
      kind: "system" as const,
      timestamp: "2026-05-05T00:00:00Z",
      tone: "info" as const,
      content: "system message",
    };
    const { rerender, container } = render(<SystemMessage message={message} />);
    const html1 = container.innerHTML;
    rerender(<SystemMessage message={message} />);
    expect(container.innerHTML).toBe(html1);
  });

  test("changed message content → re-renders new content", () => {
    const m1 = {
      id: "m3",
      kind: "system" as const,
      timestamp: "2026-05-05T00:00:00Z",
      tone: "info" as const,
      content: "old",
    };
    const { rerender, container } = render(<SystemMessage message={m1} />);
    const m2 = { ...m1, content: "new system message" };
    rerender(<SystemMessage message={m2} />);
    expect(container.textContent).toContain("new system message");
  });
});

// ── WritingDraftCard ──────────────────────────────────────────────

describe("WritingDraftCard memo", () => {
  const baseMessage = {
    id: "m4",
    kind: "writing-draft" as const,
    timestamp: "2026-05-05T00:00:00Z",
    chapterNum: 1,
    draftLabel: "A",
    content: "draft content here",
    status: "pending" as const,
  };

  test("same props → output stable across rerenders", () => {
    const cb = vi.fn();
    const props = {
      message: baseMessage,
      isStreaming: false,
      onAccept: cb,
      onRegenerate: cb,
      onDiscard: cb,
    };
    const { rerender, container } = render(<WritingDraftCard {...props} />);
    const html1 = container.innerHTML;
    rerender(<WritingDraftCard {...props} />);
    expect(container.innerHTML).toBe(html1);
  });

  test("changed message content → re-renders new content", () => {
    const cb = vi.fn();
    const { rerender, container } = render(
      <WritingDraftCard message={baseMessage} isStreaming={false} onAccept={cb} onRegenerate={cb} onDiscard={cb} />,
    );
    const m2 = { ...baseMessage, content: "updated draft" };
    rerender(
      <WritingDraftCard message={m2} isStreaming={false} onAccept={cb} onRegenerate={cb} onDiscard={cb} />,
    );
    expect(container.textContent).toContain("updated draft");
  });

  test("changed onAccept ref → new callback fires on click", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cbShared = vi.fn();
    const { rerender } = render(
      <WritingDraftCard message={baseMessage} isStreaming={false} onAccept={cb1} onRegenerate={cbShared} onDiscard={cbShared} />,
    );
    rerender(
      <WritingDraftCard message={baseMessage} isStreaming={false} onAccept={cb2} onRegenerate={cbShared} onDiscard={cbShared} />,
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
    toolName: "modify_chapter",
    toolArgs: { chapterNum: 1 },
    status: "pending" as const,
  };

  test("same props → output stable across rerenders", () => {
    const cb = vi.fn();
    const props = {
      message: baseMessage,
      globalBusy: false,
      onConfirm: cb,
      onSkip: cb,
      onUndo: cb,
    };
    const { rerender, container } = render(<ToolCallCard {...props} />);
    const html1 = container.innerHTML;
    rerender(<ToolCallCard {...props} />);
    expect(container.innerHTML).toBe(html1);
  });

  test("changed message toolArgs → re-renders new args", () => {
    const cb = vi.fn();
    const { rerender, container } = render(
      <ToolCallCard message={baseMessage} globalBusy={false} onConfirm={cb} onSkip={cb} onUndo={cb} />,
    );
    const m2 = { ...baseMessage, toolArgs: { chapterNum: 2, extra: true } };
    rerender(
      <ToolCallCard message={m2} globalBusy={false} onConfirm={cb} onSkip={cb} onUndo={cb} />,
    );
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
    chapterNum: 1,
    expanded: false,
  };

  test("same props → output stable across rerenders", () => {
    const cb = vi.fn();
    const { rerender, container } = render(
      <ChapterPreviewCard message={baseMessage} auPath="/au/test" onToggleExpanded={cb} />,
    );
    const html1 = container.innerHTML;
    rerender(
      <ChapterPreviewCard message={baseMessage} auPath="/au/test" onToggleExpanded={cb} />,
    );
    expect(container.innerHTML).toBe(html1);
  });

  // chapterNum / filePath 经 t() 插值，mock 不插值 → 输出不随数据变。
  // expanded toggle 会触发 fetch 副作用（getChapterContent / readLore），
  // jsdom 下不易 mock。保基础 stable-output 测试即可——memo 正确性由
  // 其他组件的 changed-prop 测试覆盖。
});

// ── SettingPreviewCard ────────────────────────────────────────────

describe("SettingPreviewCard memo", () => {
  const baseMessage = {
    id: "m7",
    kind: "setting-preview" as const,
    timestamp: "2026-05-05T00:00:00Z",
    filePath: "characters/Alice.md",
    expanded: false,
  };

  test("same props → output stable across rerenders", () => {
    const cb = vi.fn();
    const { rerender, container } = render(
      <SettingPreviewCard message={baseMessage} auPath="/au/test" onToggleExpanded={cb} />,
    );
    const html1 = container.innerHTML;
    rerender(
      <SettingPreviewCard message={baseMessage} auPath="/au/test" onToggleExpanded={cb} />,
    );
    expect(container.innerHTML).toBe(html1);
  });

  test("changed message filePath → re-renders new path", () => {
    const cb = vi.fn();
    const { rerender, container } = render(
      <SettingPreviewCard message={baseMessage} auPath="/au/test" onToggleExpanded={cb} />,
    );
    const m2 = { ...baseMessage, filePath: "worldbuilding/Magic.md" };
    rerender(
      <SettingPreviewCard message={m2} auPath="/au/test" onToggleExpanded={cb} />,
    );
    expect(container.textContent).toContain("worldbuilding/Magic.md");
  });
});
