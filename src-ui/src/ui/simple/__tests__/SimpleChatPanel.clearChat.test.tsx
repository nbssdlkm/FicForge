// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * SimpleChatPanel — 「清空对话」应用内 ConfirmDialog（审计 M13）。
 *
 * 判别性契约（回退到 window.confirm 旧实现即挂）：
 *  1. 点清空按钮弹应用内 Modal（不调 window.confirm —— wry/Tauri 对它支持不完整）
 *  2. Modal 内确认 → 消息清空
 *  3. Modal 内取消 → 消息保留
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom 不实现 Element.prototype.scrollTo，SimpleChatHistory 自动滚动会抛 TypeError。
beforeAll(() => {
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  }
});

vi.mock("../../../hooks/useFeedback", () => ({
  useFeedback: () => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showToast: vi.fn(),
  }),
}));

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>("../../../api/engine-client");
  return {
    ...actual,
    dispatchSimpleChat: vi.fn(),
    getState: vi.fn(),
    getWriterProjectContext: vi.fn(),
    getWriterSessionConfig: vi.fn(),
    getSettingsSummary: vi.fn(),
    getFactsExtractionReadiness: vi.fn(),
    getSimpleChat: vi.fn(),
    saveSimpleChat: vi.fn(),
  };
});

import * as engineClient from "../../../api/engine-client";
import { SimpleChatPanel } from "../SimpleChatPanel";

const mocked = vi.mocked(engineClient);
const AU = "/fandoms/test/aus/test_au";

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getState.mockResolvedValue({
    au_id: AU,
    current_chapter: 1,
  } as unknown as Awaited<ReturnType<typeof engineClient.getState>>);
  mocked.getWriterProjectContext.mockResolvedValue(
    null as unknown as Awaited<ReturnType<typeof engineClient.getWriterProjectContext>>,
  );
  mocked.getWriterSessionConfig.mockResolvedValue(
    null as unknown as Awaited<ReturnType<typeof engineClient.getWriterSessionConfig>>,
  );
  mocked.getSettingsSummary.mockResolvedValue(
    null as unknown as Awaited<ReturnType<typeof engineClient.getSettingsSummary>>,
  );
  mocked.getFactsExtractionReadiness.mockResolvedValue(
    null as unknown as Awaited<ReturnType<typeof engineClient.getFactsExtractionReadiness>>,
  );
  mocked.getSimpleChat.mockResolvedValue({
    messages: [{ id: "m1", kind: "user", timestamp: "2026-01-01T00:00:00Z", content: "写第一章" }],
  } as unknown as Awaited<ReturnType<typeof engineClient.getSimpleChat>>);
  mocked.saveSimpleChat.mockResolvedValue(undefined as never);
});

describe("SimpleChatPanel 清空对话 ConfirmDialog（审计 M13）", () => {
  it("点清空 → 应用内 Modal 出现，不走 window.confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<SimpleChatPanel auPath={AU} />);
    await screen.findByText("写第一章");

    await user.click(screen.getByLabelText("清空对话"));

    // 应用内 dialog 文案出现（旧实现走 window.confirm，DOM 里不会有这段文案）
    expect(await screen.findByText("清空当前 AU 的所有对话历史？此操作不可撤销。")).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
    // 消息还在（还没确认）
    expect(screen.getByText("写第一章")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("Modal 内确认 → 消息清空", async () => {
    const user = userEvent.setup();
    render(<SimpleChatPanel auPath={AU} />);
    await screen.findByText("写第一章");

    await user.click(screen.getByLabelText("清空对话"));
    await screen.findByText("清空当前 AU 的所有对话历史？此操作不可撤销。");
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(screen.queryByText("写第一章")).toBeNull();
    });
  });

  it("Modal 内取消 → 消息保留", async () => {
    const user = userEvent.setup();
    render(<SimpleChatPanel auPath={AU} />);
    await screen.findByText("写第一章");

    await user.click(screen.getByLabelText("清空对话"));
    await screen.findByText("清空当前 AU 的所有对话历史？此操作不可撤销。");
    await user.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(screen.queryByText("清空当前 AU 的所有对话历史？此操作不可撤销。")).toBeNull();
    });
    expect(screen.getByText("写第一章")).toBeInTheDocument();
  });
});
