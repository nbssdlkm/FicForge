// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * SimpleChatPanel — AU 切换状态清空回归（长期债②同族状态下沉后锁行为）。
 *
 * 13 useState + 手写 12 字段集中 reset 块下沉进 6 个 hook 后，每个 hook 自己
 * `useEffect(() => { reset }, [auPath])`（铁律②）。本文件锁住可从渲染面观测的
 * 「切 AU 必须归零/重拉」的可观察行为 —— 回退成「reset 集中在组件」或漏掉某个
 * hook 的 reset 时对应用例必挂：
 *  - flow：输入框清空、thinking 占位消失
 *  - chrome：设置抽屉关闭、清空确认 dialog 关闭
 *  - chapterContext：章节计数按新 AU 重拉（header 数字翻新）
 *  - config：配置四件套按新 AU 路径重拉
 *
 * mock 套路对齐 SimpleChatPanel.configRefresh.test.tsx。
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  }
});

vi.mock("../../../hooks/useFeedback", async () => (await import("../../../test/mocks/feedback")).mockUseFeedback());

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
import type { SimpleChatEvent } from "../../../api/engine-client";

const mocked = vi.mocked(engineClient);
const AU_A = "/fandoms/test/aus/au_a";
const AU_B = "/fandoms/test/aus/au_b";

function setupBaseMocks() {
  // 章节进度按 AU 区分：A 在第 5 章（已确认 4 章）、B 在第 2 章（已确认 1 章），
  // 让「切 AU 后 header 重拉」有判别性数字可断言。
  mocked.getState.mockImplementation(
    async (auPath: string) =>
      ({
        au_id: auPath,
        current_chapter: auPath === AU_A ? 5 : 2,
        chapter_titles: {},
      }) as unknown as Awaited<ReturnType<typeof engineClient.getState>>,
  );
  mocked.getWriterProjectContext.mockResolvedValue({
    llm: { mode: "", model: "", has_api_key: false },
  } as unknown as Awaited<ReturnType<typeof engineClient.getWriterProjectContext>>);
  mocked.getWriterSessionConfig.mockResolvedValue({
    default_llm: { mode: "api", model: "test", has_api_key: true, has_usable_connection: true },
    model_params: {},
  } as unknown as Awaited<ReturnType<typeof engineClient.getWriterSessionConfig>>);
  mocked.getSettingsSummary.mockResolvedValue({
    default_llm: { has_usable_connection: true },
    embedding: {},
    app: { language: "zh", fonts: {} },
  } as unknown as Awaited<ReturnType<typeof engineClient.getSettingsSummary>>);
  mocked.getFactsExtractionReadiness.mockResolvedValue({ has_usable_connection: true });
  mocked.getSimpleChat.mockResolvedValue({ messages: [] } as unknown as Awaited<
    ReturnType<typeof engineClient.getSimpleChat>
  >);
  mocked.saveSimpleChat.mockResolvedValue(undefined as never);
}

/** 预置一条历史消息（清空按钮在空对话时 disabled，chrome 用例需要它可点）。 */
function mockChatWithOneMessage() {
  mocked.getSimpleChat.mockResolvedValue({
    messages: [{ id: "m1", kind: "user", timestamp: "2026-01-01T00:00:00Z", content: "历史消息" }],
  } as unknown as Awaited<ReturnType<typeof engineClient.getSimpleChat>>);
}

function renderPanel(auPath: string) {
  return render(<SimpleChatPanel auPath={auPath} isActiveTab={true} />);
}

function switchAu(rerender: (ui: React.ReactElement) => void, auPath: string) {
  rerender(<SimpleChatPanel auPath={auPath} isActiveTab={true} />);
}

describe("SimpleChatPanel — AU 切换各 hook 状态清空", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBaseMocks();
  });

  it("flow：输入框文本在 AU 切换后清空", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel(AU_A);
    const input = await screen.findByPlaceholderText<HTMLTextAreaElement>(/.*/);

    await act(async () => {
      await user.type(input, "写到一半的指令");
    });
    expect(input.value).toBe("写到一半的指令");

    switchAu(rerender, AU_B);
    await waitFor(() => {
      expect((screen.getByPlaceholderText(/.*/) as HTMLTextAreaElement).value).toBe("");
    });
  });

  // 名实注（C1 对抗审）：本用例锁的是「切 AU 后 thinking 不残留」这一用户可见行为 ——
  // 其兜底有两层（flow 的 auPath reset + useSimpleDispatch cleanup 的 onCancelled→clearThinking），
  // 只删 flow reset 时 dispatch 兜底仍会让本用例过；它守行为，不单独守 flow reset 实现。
  // acceptingDraftId / executingToolId 两个纯内部 busy 态的 reset 无独立可观测面，未单测（接受窄覆盖）。
  it("flow：thinking 占位在 AU 切换后消失（不残留到新 AU 的对话流）", async () => {
    const user = userEvent.setup();
    // 永不产出事件的流，thinking 占位保持挂起
    mocked.dispatchSimpleChat.mockImplementation(
      vi.fn(async function* (): AsyncGenerator<SimpleChatEvent> {
        await new Promise(() => {
          /* 永不 resolve */
        });
      }) as unknown as typeof engineClient.dispatchSimpleChat,
    );

    const { rerender } = renderPanel(AU_A);
    const input = await screen.findByPlaceholderText(/.*/);
    // 排干配置加载 microtask，让 handleSend 的就绪 gate 读到已落地的 settingsInfo
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      await user.type(input, "写下一章");
      await user.keyboard("{Enter}");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findByText(/AI 思考中|AI thinking/)).toBeInTheDocument();

    switchAu(rerender, AU_B);
    await waitFor(() => {
      expect(screen.queryByText(/AI 思考中|AI thinking/)).not.toBeInTheDocument();
    });
  });

  it("chrome：设置抽屉在 AU 切换后关闭", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel(AU_A);
    await screen.findByPlaceholderText(/.*/);

    await act(async () => {
      await user.click(screen.getByLabelText("打开续写设置"));
    });
    expect(await screen.findByText("续写设置")).toBeInTheDocument();

    switchAu(rerender, AU_B);
    await waitFor(() => {
      expect(screen.queryByText("续写设置")).not.toBeInTheDocument();
    });
  });

  it("chrome：清空确认 dialog 在 AU 切换后关闭", async () => {
    const user = userEvent.setup();
    mockChatWithOneMessage();
    const { rerender } = renderPanel(AU_A);
    await screen.findByText("历史消息");

    await act(async () => {
      await user.click(screen.getByLabelText("清空对话"));
    });
    expect(await screen.findByText("清空当前 AU 的所有对话历史？此操作不可撤销。")).toBeInTheDocument();

    switchAu(rerender, AU_B);
    await waitFor(() => {
      expect(screen.queryByText("清空当前 AU 的所有对话历史？此操作不可撤销。")).not.toBeInTheDocument();
    });
  });

  it("chapterContext：章节计数按新 AU 重拉（header 数字翻新，不残留旧 AU）", async () => {
    const { rerender } = renderPanel(AU_A);
    // AU A：current_chapter=5 → Chapters 4 / Next 5
    await screen.findByText("4");
    expect(screen.getByText("5")).toBeInTheDocument();

    switchAu(rerender, AU_B);
    // AU B：current_chapter=2 → Chapters 1 / Next 2；旧 AU 的数字必须消失
    await screen.findByText("1");
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("4")).not.toBeInTheDocument();
    expect(screen.queryByText("5")).not.toBeInTheDocument();
    expect(mocked.getState).toHaveBeenLastCalledWith(AU_B);
  });

  it("chapterContext：isActiveTab false→true 边沿重拉 getState（对抗审 F3 半边，与 config 边沿对称）", async () => {
    const { rerender } = renderPanel(AU_A);
    await waitFor(() => expect(mocked.getState).toHaveBeenCalled());
    const callsAfterMount = mocked.getState.mock.calls.length;

    // 切去别的 tab 再切回来：写文页 confirm/undo 可能已推进 current_chapter
    rerender(<SimpleChatPanel auPath={AU_A} isActiveTab={false} />);
    rerender(<SimpleChatPanel auPath={AU_A} isActiveTab={true} />);

    await waitFor(() => {
      expect(mocked.getState.mock.calls.length).toBeGreaterThan(callsAfterMount);
    });
  });

  it("config：配置四件套按新 AU 路径重拉", async () => {
    const { rerender } = renderPanel(AU_A);
    await waitFor(() => {
      expect(mocked.getWriterProjectContext).toHaveBeenCalledWith(AU_A);
      expect(mocked.getFactsExtractionReadiness).toHaveBeenCalledWith(AU_A);
    });

    switchAu(rerender, AU_B);
    await waitFor(() => {
      expect(mocked.getWriterProjectContext).toHaveBeenLastCalledWith(AU_B);
      expect(mocked.getFactsExtractionReadiness).toHaveBeenLastCalledWith(AU_B);
      expect(mocked.getSettingsSummary).toHaveBeenCalledTimes(2);
      expect(mocked.getWriterSessionConfig).toHaveBeenCalledTimes(2);
    });
  });
});
