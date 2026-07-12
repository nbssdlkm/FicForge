// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * SimpleChatPanel — P2.3 对话接受接通 M9 事实提取。
 *
 * 覆盖「接受草稿 → confirmChapter 成功 → 自动触发提取 review」这条接线，以及双 gate：
 *   - react_extraction_enabled !== false（GlobalSettings「增强事实提取」，默认开）
 *   - default_llm.has_usable_connection（LLM 就位）
 * 两条都满足才自动弹 ExtractReviewModal + 调 extractFacts；任一不满足静默跳过（不弹不报错）。
 *
 * mock 套路对齐 SimpleChatPanel.toolCall.test.tsx（streamEvents 驱动 dispatch、partial
 * mock engine-client）。extractFacts 走 mock，不打真 LLM。
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
    getSettingsSummary: vi.fn(),
    getFactsExtractionReadiness: vi.fn(),
    extractFacts: vi.fn(),
    getChapterContent: vi.fn(),
    markSimpleChatDraftAccepted: vi.fn(),
  };
});

import * as engineClient from "../../../api/engine-client";
import { SimpleChatPanel } from "../SimpleChatPanel";
import type { SimpleChatEvent, ExtractedFactCandidate } from "../../../api/engine-client";

const mocked = vi.mocked(engineClient);
const AU = "/fandoms/test/aus/test_au";

const CANDIDATE: ExtractedFactCandidate = {
  content_raw: "主角觉醒了隐藏的力量",
  content_clean: "主角觉醒了隐藏的力量",
  characters: ["主角"],
  fact_type: "plot_event",
  narrative_weight: "high",
  status: "active",
  chapter: 2,
};

function streamEvents(events: SimpleChatEvent[]) {
  return vi.fn(async function* (
    _params: unknown,
    _options?: { signal?: AbortSignal },
  ): AsyncGenerator<SimpleChatEvent> {
    for (const e of events) yield e;
  });
}

// 一段标准「写章节」流：token + done_text → 产出 pending 草稿（chapter 2）。
function mockWriteDraftStream() {
  mocked.dispatchSimpleChat.mockImplementation(
    streamEvents([
      { type: "token", data: "第二章正文" } as SimpleChatEvent,
      {
        type: "done_text",
        data: {
          full_text: "第二章正文",
          draft_label: "A",
          chapter_num: 2,
          generated_with: {},
        },
      } as SimpleChatEvent,
    ]) as unknown as typeof engineClient.dispatchSimpleChat,
  );
}

/**
 * 设置 gate 相关的 settings summary（react 开关）+ 提取就位（readiness）。
 * gate ② 现读 getFactsExtractionReadiness（引擎按 project+settings 解析，审计④），
 * 故 opts.usable 同步驱动 readiness；settingsSummary.default_llm 仅保留形状，不再被 gate 读取。
 */
function mockSettingsSummary(opts: { reactEnabled?: boolean; usable: boolean }) {
  mocked.getSettingsSummary.mockResolvedValue({
    default_llm: { has_usable_connection: opts.usable },
    embedding: {},
    app: {
      language: "zh",
      fonts: {},
      ...(opts.reactEnabled === undefined ? {} : { react_extraction_enabled: opts.reactEnabled }),
    },
  } as unknown as Awaited<ReturnType<typeof engineClient.getSettingsSummary>>);
  mocked.getFactsExtractionReadiness.mockResolvedValue({ has_usable_connection: opts.usable });
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
  mocked.confirmChapter.mockResolvedValue({ revision: 2 } as unknown as Awaited<
    ReturnType<typeof engineClient.confirmChapter>
  >);
  // 默认提取就位（gate ② 通过）；各用例可经 mockSettingsSummary 或直接覆盖调整。
  mocked.getFactsExtractionReadiness.mockResolvedValue({ has_usable_connection: true });
  mocked.extractFacts.mockResolvedValue({ facts: [CANDIDATE] });
  // 对齐真实引擎语义：目标章尚不存在 → get_content_only 抛错（面板 .catch(()=>null)）。
  // R1-8 的 same-num guard 依赖这个区分（null=不存在 → 放行；""=存在空章 → 拦截）。
  mocked.getChapterContent.mockRejectedValue(new Error("Chapter not found"));
  mocked.markSimpleChatDraftAccepted.mockResolvedValue(undefined as never);
}

/** 预置一条 pending 草稿进 chat.yaml（模拟历史会话遗留），用于防重复接受用例。 */
function mockPreloadedPendingDraft(chapterNum: number, content: string) {
  mocked.getSimpleChat.mockResolvedValue({
    version: 1,
    au_path: AU,
    created_at: "t",
    updated_at: "t",
    messages: [
      {
        id: "draft-stale-1",
        timestamp: "t",
        kind: "writing-draft",
        chapterNum,
        draftLabel: "A",
        content,
        status: "pending",
      },
    ],
  } as unknown as Awaited<ReturnType<typeof engineClient.getSimpleChat>>);
}

/** 渲染 → 发送写章节指令 → 等草稿到 pending → 点接受。 */
async function sendAndAcceptDraft(user: ReturnType<typeof userEvent.setup>) {
  render(<SimpleChatPanel auPath={AU} />);
  await waitFor(() => expect(mocked.getSimpleChat).toHaveBeenCalled());

  const input = await screen.findByPlaceholderText(/.*/);
  await act(async () => {
    await user.type(input, "写第二章");
    await user.keyboard("{Enter}");
    // 让 generator 推进到 token + done_text，draft 落到 pending
    await new Promise((r) => setTimeout(r, 0));
  });

  const acceptBtn = await screen.findByRole("button", { name: /接受为第/ });
  await act(async () => {
    await user.click(acceptBtn);
  });
}

// 负例专用：等接受流程跑完（草稿切 accepted）后，再排干所有 microtask（confirm→refresh→gate
// 整条 resolved-promise 链都在 microtask 队列里，一个 setTimeout(0) 宏任务必在其后）。这样
// 「gate 已执行完」是确定性的——即便将来在 accept 与 gate 之间插入新的 await，断言也不会在 gate
// 之前抢跑。配合正例已证「同一 harness 能走到 gate 并触发 extractFacts」，负例才算可信。
async function settlePastGate() {
  await waitFor(() => {
    expect(screen.getByText(/已接受为第/)).toBeInTheDocument();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("SimpleChatPanel P2.3 — 接受草稿接通 M9 提取", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBaseMocks();
    mockWriteDraftStream();
  });

  it("react 开 + LLM 就位：接受后弹 ExtractReviewModal 并以正确章号调 extractFacts", async () => {
    const user = userEvent.setup();
    mockSettingsSummary({ reactEnabled: true, usable: true });

    await sendAndAcceptDraft(user);

    // confirm 走通
    await waitFor(() => {
      expect(mocked.confirmChapter).toHaveBeenCalledWith(
        AU,
        2,
        expect.any(String),
        expect.anything(),
        expect.any(String),
      );
    });
    // accepted 终态被引擎级直写落盘（审计 H3：不依赖组件存活）
    await waitFor(() => {
      expect(mocked.markSimpleChatDraftAccepted).toHaveBeenCalledWith(AU, expect.any(String), 2);
    });
    // extractFacts 以刚确认的章号被调用（带取消 signal，审计 H2）
    await waitFor(() => {
      expect(mocked.extractFacts).toHaveBeenCalledWith(
        AU,
        2,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    // 提取结果预览 modal 出现 + 候选内容可见
    expect(await screen.findByText("提取结果预览")).toBeInTheDocument();
    expect(await screen.findByText("主角觉醒了隐藏的力量")).toBeInTheDocument();
  });

  it("react_extraction_enabled 缺省（旧 yaml）+ LLM 就位：默认开，仍触发提取", async () => {
    const user = userEvent.setup();
    mockSettingsSummary({ reactEnabled: undefined, usable: true });

    await sendAndAcceptDraft(user);

    await waitFor(() => {
      expect(mocked.extractFacts).toHaveBeenCalledWith(
        AU,
        2,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    expect(await screen.findByText("提取结果预览")).toBeInTheDocument();
  });

  it("react 关：接受后不触发提取、不弹 modal", async () => {
    const user = userEvent.setup();
    mockSettingsSummary({ reactEnabled: false, usable: true });

    await sendAndAcceptDraft(user);
    await settlePastGate();

    expect(mocked.extractFacts).not.toHaveBeenCalled();
    expect(screen.queryByText("提取结果预览")).not.toBeInTheDocument();
  });

  it("LLM 未就位（readiness=false）：接受后不触发提取、不弹 modal", async () => {
    const user = userEvent.setup();
    // 全局与 project 都无可用连接 → 引擎 readiness=false → gate ② 关
    mockSettingsSummary({ reactEnabled: true, usable: false });

    await sendAndAcceptDraft(user);
    await settlePastGate();

    expect(mocked.extractFacts).not.toHaveBeenCalled();
    expect(screen.queryByText("提取结果预览")).not.toBeInTheDocument();
  });

  it("全局 default_llm 空但 AU 级独立配可用：readiness 为真仍触发提取（审计④ gate 口径修正）", async () => {
    const user = userEvent.setup();
    // 旧口径只看全局 default_llm.has_usable_connection=false → 会误判为不可提取而静默跳过。
    mockSettingsSummary({ reactEnabled: true, usable: false });
    // 新口径：引擎按 resolve_llm_config(project 优先) 解析后 readiness=true（AU 级独立配了 LLM）。
    mocked.getFactsExtractionReadiness.mockResolvedValue({ has_usable_connection: true });

    await sendAndAcceptDraft(user);

    // 修复后：与写文路径一致，能自动触发提取
    await waitFor(() => {
      expect(mocked.extractFacts).toHaveBeenCalledWith(
        AU,
        2,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    expect(await screen.findByText("提取结果预览")).toBeInTheDocument();
  });

  it("settings summary 加载失败（null）：fail-closed，不触发提取", async () => {
    const user = userEvent.setup();
    // 模拟 getSettingsSummary 拒绝 → 面板 .catch(()=>null) → summary 为 null → gate 关闭
    mocked.getSettingsSummary.mockRejectedValue(new Error("settings unavailable"));

    await sendAndAcceptDraft(user);
    await settlePastGate();

    expect(mocked.extractFacts).not.toHaveBeenCalled();
    expect(screen.queryByText("提取结果预览")).not.toBeInTheDocument();
  });

  it("提取进行中：接受后到 modal 弹出前显示「提取剧情笔记中…」指示", async () => {
    const user = userEvent.setup();
    mockSettingsSummary({ reactEnabled: true, usable: true });

    // 用 gate 控制 extractFacts 解析时机，模拟 ReAct 提取的多秒耗时
    let resolveExtract: ((v: { facts: ExtractedFactCandidate[] }) => void) | null = null;
    mocked.extractFacts.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExtract = resolve;
        }),
    );

    await sendAndAcceptDraft(user);

    // 提取在飞行中：指示可见，modal 还没出
    expect(await screen.findByText("提取剧情笔记中…")).toBeInTheDocument();
    expect(screen.queryByText("提取结果预览")).not.toBeInTheDocument();

    // 解析提取 → 指示消失、modal 弹出
    await act(async () => {
      resolveExtract!({ facts: [CANDIDATE] });
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => {
      expect(screen.queryByText("提取剧情笔记中…")).not.toBeInTheDocument();
    });
    expect(await screen.findByText("提取结果预览")).toBeInTheDocument();
  });

  // ==========================================================================
  // 审计 H3 — 防重复接受：接受只对「下一章」（current_chapter）合法
  // ==========================================================================

  it("防重复接受：目标章已被其他内容确认 → 拒绝，不 confirm 不提取（审计 H3）", async () => {
    const user = userEvent.setup();
    mockSettingsSummary({ reactEnabled: true, usable: true });
    // current_chapter=2 → 章 1 已确认；磁盘章 1 内容与草稿不同 → 必须拒绝
    mockPreloadedPendingDraft(1, "旧草稿正文");
    mocked.getChapterContent.mockResolvedValue("已确认的另一版正文");

    render(<SimpleChatPanel auPath={AU} />);
    const acceptBtn = await screen.findByRole("button", { name: /接受为第/ });
    await act(async () => {
      await user.click(acceptBtn);
    });

    await waitFor(() => {
      expect(mocked.getChapterContent).toHaveBeenCalledWith(AU, 1);
    });
    // 回退旧码（无章号 guard）此处必挂：confirmChapter 会被调用、覆写已确认章节
    expect(mocked.confirmChapter).not.toHaveBeenCalled();
    expect(mocked.extractFacts).not.toHaveBeenCalled();
    expect(mocked.markSimpleChatDraftAccepted).not.toHaveBeenCalled();
  });

  it("标记恢复：章内容与草稿逐字一致 → 补 accepted 标记而非重复 confirm（审计 H3）", async () => {
    const user = userEvent.setup();
    mockSettingsSummary({ reactEnabled: true, usable: true });
    // 章 1 此前已接受但标记丢失（切 tab 竞态遗留）：磁盘内容 == 草稿内容
    mockPreloadedPendingDraft(1, "旧草稿正文");
    mocked.getChapterContent.mockResolvedValue("旧草稿正文");

    render(<SimpleChatPanel auPath={AU} />);
    const acceptBtn = await screen.findByRole("button", { name: /接受为第/ });
    await act(async () => {
      await user.click(acceptBtn);
    });

    // 标记以 revision=null（未知）补写落盘，且不重复确认
    await waitFor(() => {
      expect(mocked.markSimpleChatDraftAccepted).toHaveBeenCalledWith(AU, "draft-stale-1", null);
    });
    expect(mocked.confirmChapter).not.toHaveBeenCalled();
    // UI 状态同步翻到 accepted
    expect(await screen.findByText(/已接受为第 1 章/)).toBeInTheDocument();
  });

  // ==========================================================================
  // R1-8 — num === expected 但该章已有不同内容：拒绝覆盖（专用文案，不再自相矛盾）
  // ==========================================================================

  it("R1-8：num===expected 且章已有不同内容 → 拒绝接受（不 confirm 不提取），草稿保持 pending", async () => {
    const user = userEvent.setup();
    mockSettingsSummary({ reactEnabled: true, usable: true });
    // current_chapter=2、草稿也是章 2（undo/confirm 半成功、回收站恢复等造成 ch2 文件已在）
    mockPreloadedPendingDraft(2, "旧草稿正文");
    mocked.getChapterContent.mockResolvedValue("另一份已存在的第 2 章内容");

    render(<SimpleChatPanel auPath={AU} />);
    const acceptBtn = await screen.findByRole("button", { name: /接受为第/ });
    await act(async () => {
      await user.click(acceptBtn);
    });

    await waitFor(() => {
      expect(mocked.getChapterContent).toHaveBeenCalledWith(AU, 2);
    });
    // 回退旧码（num===expected 无条件 confirm）此处必挂：已存在的 ch2 内容被静默覆盖
    expect(mocked.confirmChapter).not.toHaveBeenCalled();
    expect(mocked.extractFacts).not.toHaveBeenCalled();
    expect(mocked.markSimpleChatDraftAccepted).not.toHaveBeenCalled();
    // 草稿保持 pending，可在写文页处理完后重试
    expect(screen.getByRole("button", { name: /接受为第/ })).toBeInTheDocument();
  });

  it("R1-8：num===expected 且章内容与草稿一致（confirm 半成功后重试）→ 放行 confirm 修复进度", async () => {
    const user = userEvent.setup();
    mockSettingsSummary({ reactEnabled: true, usable: true });
    mockPreloadedPendingDraft(2, "旧草稿正文");
    mocked.getChapterContent.mockResolvedValue("旧草稿正文");

    render(<SimpleChatPanel auPath={AU} />);
    const acceptBtn = await screen.findByRole("button", { name: /接受为第/ });
    await act(async () => {
      await user.click(acceptBtn);
    });

    // 引擎带备份覆盖 + 推进 state，正是修复半成功所需 → 不能被 guard 误拦。
    // 注：预置草稿无 generatedWith（arg4 = undefined），逐参断言而非 expect.anything()。
    await waitFor(() => {
      expect(mocked.confirmChapter).toHaveBeenCalledTimes(1);
    });
    const call = mocked.confirmChapter.mock.calls[0];
    expect(call[0]).toBe(AU);
    expect(call[1]).toBe(2);
    expect(call[4]).toBe("旧草稿正文");
  });

  // ==========================================================================
  // R1-7 — 提取可用户取消：header 指示旁 × → abort 在飞提取 → 指示消失
  // ==========================================================================

  it("R1-7：提取中点 × → extractFacts 的 signal 被 abort，指示消失且不弹 modal", async () => {
    const user = userEvent.setup();
    mockSettingsSummary({ reactEnabled: true, usable: true });

    // 永不 resolve 的提取，捕获 signal 供断言
    let capturedSignal: AbortSignal | undefined;
    mocked.extractFacts.mockImplementation(((_au: string, _num: number, opts?: { signal?: AbortSignal }) => {
      capturedSignal = opts?.signal;
      return new Promise(() => {
        /* 永不 resolve，模拟多秒 LLM 调用 */
      });
    }) as unknown as typeof engineClient.extractFacts);

    await sendAndAcceptDraft(user);

    // 提取在飞：指示 + 取消按钮可见
    expect(await screen.findByText("提取剧情笔记中…")).toBeInTheDocument();
    const cancelBtn = await screen.findByRole("button", { name: "取消提取" });

    await act(async () => {
      await user.click(cancelBtn);
    });

    // 在飞请求被真实 abort（不是只藏指示继续烧 token）
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(true);
    // 指示消失、modal 不弹
    await waitFor(() => {
      expect(screen.queryByText("提取剧情笔记中…")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("提取结果预览")).not.toBeInTheDocument();
  });
});
