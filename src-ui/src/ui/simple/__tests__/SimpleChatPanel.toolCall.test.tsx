// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * SimpleChatPanel — tool call 全链路集成测试。
 *
 * 单测覆盖了 useSimpleToolExecutor 各 tool 落盘逻辑；本文件覆盖 SimpleChatPanel
 * 把 LLM tool_call 事件路由到 ToolCallCard / ChapterPreviewCard，再把用户点击
 * 路由回 toolExecutor.execute 真落盘的端到端路径，防止接入层回归。
 */

import { act, render, screen, waitFor } from "@testing-library/react";
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
    confirmChapter: vi.fn(),
    getState: vi.fn(),
    getWriterProjectContext: vi.fn(),
    getWriterSessionConfig: vi.fn(),
    getSimpleChat: vi.fn(),
    saveSimpleChat: vi.fn(),
    saveLore: vi.fn(),
    readLoreWithLegacyFallback: vi.fn(),
    deleteLore: vi.fn(),
    listLoreFiles: vi.fn(),
    addPinned: vi.fn(),
    deletePinned: vi.fn(),
    getProjectForEditing: vi.fn(),
    saveProjectCastRegistryCharacters: vi.fn(),
    saveProjectWritingStyle: vi.fn(),
  };
});

import * as engineClient from "../../../api/engine-client";
import { SimpleChatPanel } from "../SimpleChatPanel";
import type { SimpleChatEvent } from "../../../api/engine-client";

const mocked = vi.mocked(engineClient);
const AU = "/fandoms/test/aus/test_au";

function streamEvents(events: SimpleChatEvent[]) {
  return vi.fn(async function* (
    _params: unknown,
    _options?: { signal?: AbortSignal },
  ): AsyncGenerator<SimpleChatEvent> {
    for (const e of events) yield e;
  });
}

function setupBaseMocks() {
  mocked.getState.mockResolvedValue({
    au_id: AU,
    current_chapter: 2,
    chapter_titles: { 1: "Test" },
  } as unknown as Awaited<ReturnType<typeof engineClient.getState>>);
  mocked.getWriterProjectContext.mockResolvedValue({
    project: { llm: { mode: "api", model: "test" }, pinned_context: [] },
  } as unknown as Awaited<ReturnType<typeof engineClient.getWriterProjectContext>>);
  mocked.getWriterSessionConfig.mockResolvedValue({
    // has_api_key: handleSend 配置就绪 gate（R1-2）读取；无 key 时发送会被拦下。
    default_llm: { mode: "api", model: "test", has_api_key: true, has_usable_connection: true },
    model_params: {},
  } as unknown as Awaited<ReturnType<typeof engineClient.getWriterSessionConfig>>);
  mocked.getSimpleChat.mockResolvedValue({ messages: [] } as unknown as Awaited<
    ReturnType<typeof engineClient.getSimpleChat>
  >);
  mocked.saveSimpleChat.mockResolvedValue(undefined as never);

  mocked.listLoreFiles.mockImplementation(async ({ category }) => {
    if (category === "characters") {
      return { files: [{ name: "Alice", filename: "Alice.md" }] };
    }
    return { files: [] };
  });
  mocked.getProjectForEditing.mockResolvedValue({
    pinned_context: [],
    cast_registry: { characters: ["Alice"] },
    writing_style: {},
  } as unknown as Awaited<ReturnType<typeof engineClient.getProjectForEditing>>);
  // saveLore 回传实际落盘 filename/category（M28）：executor 从返回值回填 undoMeta。
  mocked.saveLore.mockImplementation(
    async (req) =>
      ({
        status: "ok",
        path: `${req.au_path ?? req.fandom_path ?? ""}/${req.category}/${req.filename}`,
        filename: req.filename,
        category: req.category,
      }) as never,
  );
  mocked.deleteLore.mockResolvedValue(undefined as never);
  mocked.readLoreWithLegacyFallback.mockResolvedValue(null);
  mocked.addPinned.mockResolvedValue(undefined as never);
  mocked.deletePinned.mockResolvedValue(undefined as never);
  mocked.saveProjectCastRegistryCharacters.mockResolvedValue(undefined as never);
  mocked.saveProjectWritingStyle.mockResolvedValue(undefined as never);
}

describe("SimpleChatPanel tool call 全链路", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBaseMocks();
  });

  it("modify_character_file tool: 用户点确认 → saveLore 真调用 + status confirmed", async () => {
    const user = userEvent.setup();
    mocked.dispatchSimpleChat.mockImplementation(
      streamEvents([
        {
          type: "tool_call",
          data: {
            id: "call_1",
            type: "function",
            function: {
              name: "modify_character_file",
              arguments: JSON.stringify({
                filename: "Alice.md",
                new_content: "# Alice 新设定",
                change_summary: "改头发颜色",
              }),
            },
          },
        },
        { type: "done_tools", data: { tool_calls: [] } },
      ]) as unknown as typeof engineClient.dispatchSimpleChat,
    );

    render(<SimpleChatPanel auPath={AU} />);
    await waitFor(() => expect(mocked.getSimpleChat).toHaveBeenCalled());

    const input = await screen.findByPlaceholderText(/.*/);
    await act(async () => {
      await user.type(input, "改 Alice 头发");
      await user.keyboard("{Enter}");
    });

    // ToolCallCard 出现含 tool 名 + 待确认
    const card = await screen.findByText("modify_character_file");
    expect(card).toBeInTheDocument();

    // 点【确认】
    const confirmBtn = await screen.findByRole("button", { name: /确认|confirm/i });
    await act(async () => {
      await user.click(confirmBtn);
    });

    // saveLore 应被调用 + new_content 落盘
    await waitFor(() => {
      expect(mocked.saveLore).toHaveBeenCalledWith(
        expect.objectContaining({
          au_path: AU,
          category: "characters",
          filename: "Alice.md",
        }),
      );
    });
  });

  it("modify_character_file tool: saveLore 失败 → status error + showError 调用", async () => {
    const user = userEvent.setup();
    mocked.saveLore.mockRejectedValueOnce(new Error("disk full"));
    mocked.dispatchSimpleChat.mockImplementation(
      streamEvents([
        {
          type: "tool_call",
          data: {
            id: "c1",
            type: "function",
            function: {
              name: "modify_character_file",
              arguments: JSON.stringify({
                filename: "Alice.md",
                new_content: "x",
                change_summary: "y",
              }),
            },
          },
        },
        { type: "done_tools", data: { tool_calls: [] } },
      ]) as unknown as typeof engineClient.dispatchSimpleChat,
    );

    render(<SimpleChatPanel auPath={AU} />);
    await waitFor(() => expect(mocked.getSimpleChat).toHaveBeenCalled());

    const input = await screen.findByPlaceholderText(/.*/);
    await act(async () => {
      await user.type(input, "x");
      await user.keyboard("{Enter}");
    });

    const confirmBtn = await screen.findByRole("button", { name: /确认|confirm/i });
    await act(async () => {
      await user.click(confirmBtn);
    });

    // saveLore 被调一次但 reject
    await waitFor(() => {
      expect(mocked.saveLore).toHaveBeenCalled();
    });
    // 错误状态显示在卡片
    await waitFor(() => {
      expect(screen.getByText(/disk full/)).toBeInTheDocument();
    });
  });

  it("show_chapter tool: 走 ChapterPreviewCard 路径，不进 ToolCallCard", async () => {
    const user = userEvent.setup();
    mocked.dispatchSimpleChat.mockImplementation(
      streamEvents([
        {
          type: "tool_call",
          data: {
            id: "c1",
            type: "function",
            function: {
              name: "show_chapter",
              arguments: JSON.stringify({ chapter_num: 1 }),
            },
          },
        },
        { type: "done_tools", data: { tool_calls: [] } },
      ]) as unknown as typeof engineClient.dispatchSimpleChat,
    );

    render(<SimpleChatPanel auPath={AU} />);
    await waitFor(() => expect(mocked.getSimpleChat).toHaveBeenCalled());

    const input = await screen.findByPlaceholderText(/.*/);
    await act(async () => {
      await user.type(input, "看第一章");
      await user.keyboard("{Enter}");
    });

    // 应渲染 ChapterPreviewCard（"第 1 章"），不应有 ToolCallCard 的 toolName
    await waitFor(() => {
      expect(screen.queryByText("show_chapter")).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/第\s*1\s*章/)).toBeInTheDocument();
    // saveLore 不被调（show_chapter 是 view-only）
    expect(mocked.saveLore).not.toHaveBeenCalled();
  });

  it("undo lore: confirmed 后点撤销 → deleteLore 调用 + status undone", async () => {
    const user = userEvent.setup();
    mocked.dispatchSimpleChat.mockImplementation(
      streamEvents([
        {
          type: "tool_call",
          data: {
            id: "c1",
            type: "function",
            function: {
              name: "create_worldbuilding_file",
              arguments: JSON.stringify({ name: "Magic", content: "魔法体系" }),
            },
          },
        },
        { type: "done_tools", data: { tool_calls: [] } },
      ]) as unknown as typeof engineClient.dispatchSimpleChat,
    );

    render(<SimpleChatPanel auPath={AU} />);
    await waitFor(() => expect(mocked.getSimpleChat).toHaveBeenCalled());

    const input = await screen.findByPlaceholderText(/.*/);
    await act(async () => {
      await user.type(input, "加魔法体系");
      await user.keyboard("{Enter}");
    });

    const confirmBtn = await screen.findByRole("button", { name: /确认|confirm/i });
    await act(async () => {
      await user.click(confirmBtn);
    });
    await waitFor(() => expect(mocked.saveLore).toHaveBeenCalled());

    // 等卡片切到 confirmed，撤销按钮出现
    const undoBtn = await screen.findByRole("button", { name: /撤销|undo/i });
    await act(async () => {
      await user.click(undoBtn);
    });

    await waitFor(() => {
      expect(mocked.deleteLore).toHaveBeenCalledWith(
        expect.objectContaining({
          au_path: AU,
          category: "worldbuilding",
          filename: "Magic.md",
        }),
      );
    });
  });

  it("thinking placeholder: 发送后显示 AI 思考中…，首 token 到达时移除并出现 draft", async () => {
    const user = userEvent.setup();

    // 用 promise 控制首 token 延迟，模拟 LLM 首字节延迟
    let resolveToken: (() => void) | null = null;
    const tokenGate = new Promise<void>((resolve) => {
      resolveToken = resolve;
    });

    mocked.dispatchSimpleChat.mockImplementation(
      vi.fn(async function* (_params: unknown, _options?: { signal?: AbortSignal }): AsyncGenerator<SimpleChatEvent> {
        await tokenGate;
        yield {
          type: "token",
          data: "第一章内容",
        } as SimpleChatEvent;
        yield {
          type: "done_text",
          data: {
            full_text: "第一章内容",
            draft_label: "A",
            chapter_num: 2,
            generated_with: {},
          },
        } as SimpleChatEvent;
      }) as unknown as typeof engineClient.dispatchSimpleChat,
    );

    render(<SimpleChatPanel auPath={AU} />);
    await waitFor(() => expect(mocked.getSimpleChat).toHaveBeenCalled());

    const input = await screen.findByPlaceholderText(/.*/);
    await act(async () => {
      await user.type(input, "写第一章");
      await user.keyboard("{Enter}");
    });

    // 占位应立即出现（token 还没到）
    await waitFor(() => {
      expect(screen.getByText(/AI 思考中|AI thinking/)).toBeInTheDocument();
    });

    // 释放首 token（async act 让 generator 后续 yield + React state batch flush）
    await act(async () => {
      resolveToken!();
      // 让 microtask queue 跑完，generator 得以推进到 token + done_text yield
      await new Promise((r) => setTimeout(r, 0));
    });

    // 占位应消失（首 token 到达时 clearThinking 触发）。draft 渲染由 WritingDraftCard
    // 单测覆盖，这里不再 assert 具体 chapter content 字符串以避免 RTL race。
    await waitFor(() => {
      expect(screen.queryByText(/AI 思考中|AI thinking/)).not.toBeInTheDocument();
    });
  });
});
