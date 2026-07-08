// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * SimpleChatPanel — R1-1 常驻面板配置边沿刷新 + R1-2 发送配置就绪 gate。
 *
 * R1-1（终审 1-A）：面板常驻挂载后配置四件套只在挂载时快照 —— settings tab 改 LLM
 * 配置 / 开关「增强事实提取」后切回对话 tab，必须在 isActiveTab false→true 边沿重拉，
 * 否则 dispatch payload 与 canAutoExtract gate 永久 stale。判别：mock 两次返回不同
 * 配置，边沿切回后 gate 用新值（旧值不触发提取 → 新值触发）。
 *
 * R1-2：settingsInfo 未加载 / resolve 无可用连接时 handleSend 直接 toast 指路，
 * 不发出捏造 payload（dispatchSimpleChat 不被调用）。
 *
 * mock 套路对齐 SimpleChatPanel.extract.test.tsx。
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  }
});

const showErrorSpy = vi.fn();
const showToastSpy = vi.fn();
vi.mock("../../../hooks/useFeedback", () => ({
  useFeedback: () => ({
    showError: showErrorSpy,
    showSuccess: vi.fn(),
    showToast: showToastSpy,
  }),
}));

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>(
    "../../../api/engine-client",
  );
  return {
    ...actual,
    dispatchSimpleChat: vi.fn(),
    confirmChapter: vi.fn(),
    getState: vi.fn(),
    getWriterProjectContext: vi.fn(),
    getWriterSessionConfig: vi.fn(),
    getSimpleChat: vi.fn(),
    saveSimpleChat: vi.fn(),
    getSettingsSummary: vi.fn(),
    getFactsExtractionReadiness: vi.fn(),
    extractFacts: vi.fn(),
    getChapterContent: vi.fn(),
    markSimpleChatDraftAccepted: vi.fn(),
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

function mockWriteDraftStream() {
  mocked.dispatchSimpleChat.mockImplementation(
    streamEvents([
      { type: "token", data: "第二章正文" } as SimpleChatEvent,
      {
        type: "done_text",
        data: { full_text: "第二章正文", draft_label: "A", chapter_num: 2, generated_with: {} },
      } as SimpleChatEvent,
    ]) as unknown as typeof engineClient.dispatchSimpleChat,
  );
}

function setupBaseMocks(opts: { usableKey?: boolean } = {}) {
  const usableKey = opts.usableKey ?? true;
  mocked.getState.mockResolvedValue({
    au_id: AU,
    current_chapter: 2,
    chapter_titles: { 1: "Test" },
  } as unknown as Awaited<ReturnType<typeof engineClient.getState>>);
  mocked.getWriterProjectContext.mockResolvedValue({
    // llm 顶层（真实 WriterProjectContext 形状）：mode 空 → 回退 settings default_llm
    llm: { mode: "", model: "", has_api_key: false },
  } as unknown as Awaited<ReturnType<typeof engineClient.getWriterProjectContext>>);
  mocked.getWriterSessionConfig.mockResolvedValue({
    default_llm: { mode: "api", model: "test", has_api_key: usableKey, has_usable_connection: usableKey },
    model_params: {},
  } as unknown as Awaited<ReturnType<typeof engineClient.getWriterSessionConfig>>);
  mocked.getSimpleChat.mockResolvedValue({ messages: [] } as unknown as Awaited<
    ReturnType<typeof engineClient.getSimpleChat>
  >);
  mocked.saveSimpleChat.mockResolvedValue(undefined as never);
  mocked.confirmChapter.mockResolvedValue({ revision: 2 } as unknown as Awaited<
    ReturnType<typeof engineClient.confirmChapter>
  >);
  mocked.getSettingsSummary.mockResolvedValue({
    default_llm: { has_usable_connection: usableKey },
    embedding: {},
    app: { language: "zh", fonts: {}, react_extraction_enabled: true },
  } as unknown as Awaited<ReturnType<typeof engineClient.getSettingsSummary>>);
  mocked.getFactsExtractionReadiness.mockResolvedValue({ has_usable_connection: usableKey });
  mocked.extractFacts.mockResolvedValue({ facts: [] });
  mocked.getChapterContent.mockRejectedValue(new Error("Chapter not found"));
  mocked.markSimpleChatDraftAccepted.mockResolvedValue(undefined as never);
}

async function typeAndSend(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByPlaceholderText(/.*/);
  // 先排干配置加载的 microtask 链，保证 handleSend 的 gate 读到已落地的 settingsInfo
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => {
    await user.type(input, "写第二章");
    await user.keyboard("{Enter}");
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("SimpleChatPanel R1-1 — 常驻面板配置边沿刷新", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBaseMocks();
    mockWriteDraftStream();
  });

  it("isActiveTab false→true 边沿重拉配置四件套（settings tab 改配置后切回不再 stale）", async () => {
    const { rerender } = render(<SimpleChatPanel auPath={AU} isActiveTab={true} />);
    await waitFor(() => {
      expect(mocked.getWriterSessionConfig).toHaveBeenCalledTimes(1);
      expect(mocked.getSettingsSummary).toHaveBeenCalledTimes(1);
      expect(mocked.getFactsExtractionReadiness).toHaveBeenCalledTimes(1);
    });

    // 用户去 settings tab（面板隐藏但常驻挂载）
    rerender(<SimpleChatPanel auPath={AU} isActiveTab={false} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // 隐藏期不刷（挂载时那次之外没有新调用）
    expect(mocked.getWriterSessionConfig).toHaveBeenCalledTimes(1);

    // 切回对话 tab：边沿重拉全部四件套
    rerender(<SimpleChatPanel auPath={AU} isActiveTab={true} />);
    await waitFor(() => {
      expect(mocked.getWriterSessionConfig).toHaveBeenCalledTimes(2);
      expect(mocked.getWriterProjectContext).toHaveBeenCalledTimes(2);
      expect(mocked.getSettingsSummary).toHaveBeenCalledTimes(2);
      expect(mocked.getFactsExtractionReadiness).toHaveBeenCalledTimes(2);
    });
  });

  it("配置变更 → 边沿切回 → gate 用新值：提取从不可用翻到可用后，接受触发提取", async () => {
    const user = userEvent.setup();
    // 初始：LLM 未就位（readiness=false）→ 若停在挂载快照，接受后永远不会提取
    mocked.getFactsExtractionReadiness.mockResolvedValue({ has_usable_connection: false });

    const { rerender } = render(<SimpleChatPanel auPath={AU} isActiveTab={true} />);
    await waitFor(() => expect(mocked.getFactsExtractionReadiness).toHaveBeenCalledTimes(1));

    // 用户在 settings tab 配好了 LLM（引擎侧 readiness 翻 true）
    mocked.getFactsExtractionReadiness.mockResolvedValue({ has_usable_connection: true });
    rerender(<SimpleChatPanel auPath={AU} isActiveTab={false} />);
    rerender(<SimpleChatPanel auPath={AU} isActiveTab={true} />);
    await waitFor(() => expect(mocked.getFactsExtractionReadiness).toHaveBeenCalledTimes(2));

    // 发送 → 接受：gate 读到边沿刷新后的新值，自动触发提取。
    // 回退旧码（无边沿刷新）此处必挂：extractionReady 停在 false，extractFacts 不会被调。
    await typeAndSend(user);
    const acceptBtn = await screen.findByRole("button", { name: /接受为第/ });
    await act(async () => { await user.click(acceptBtn); });

    await waitFor(() => {
      expect(mocked.extractFacts).toHaveBeenCalledWith(AU, 2, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });
  });
});

describe("SimpleChatPanel R1-2 — 发送配置就绪 gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteDraftStream();
  });

  it("api 模式无可用 key：发送被拦，toast 指路，不发捏造 payload", async () => {
    const user = userEvent.setup();
    setupBaseMocks({ usableKey: false });

    render(<SimpleChatPanel auPath={AU} isActiveTab={true} />);
    await waitFor(() => expect(mocked.getWriterSessionConfig).toHaveBeenCalled());

    await typeAndSend(user);

    expect(mocked.dispatchSimpleChat).not.toHaveBeenCalled();
    expect(showErrorSpy).toHaveBeenCalled();
  });

  it("配置就位时发送正常走 dispatch（gate 不误伤）", async () => {
    const user = userEvent.setup();
    setupBaseMocks({ usableKey: true });

    render(<SimpleChatPanel auPath={AU} isActiveTab={true} />);
    await waitFor(() => expect(mocked.getWriterSessionConfig).toHaveBeenCalled());

    await typeAndSend(user);

    await waitFor(() => expect(mocked.dispatchSimpleChat).toHaveBeenCalledTimes(1));
    expect(showErrorSpy).not.toHaveBeenCalled();
  });
});
