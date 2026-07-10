// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * SettingsChatPanel 状态下沉回归（长期债②第三块）：
 * 1026 行 God 组件 → 3 hooks（supportData / conversation / toolActions）
 * + execute-settings-tool 纯模块后锁住的行为——
 * 发消息出工具卡、确认执行（含执行后刷新 + onAfterMutation）、撤销、
 * 发送失败回滚用户消息（输入不丢）、切上下文清空会话。
 */

import { describe, it, expect, vi, beforeAll, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsChatPanel } from "../SettingsChatPanel";
import { FeedbackProvider } from "../../../../hooks/useFeedback";

vi.mock("../../../../api/engine-client", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    sendSettingsChat: vi.fn(),
    listLoreFiles: vi.fn(),
    getProjectForEditing: vi.fn(),
    addPinned: vi.fn(),
    deletePinned: vi.fn(),
  };
});

import {
  sendSettingsChat,
  listLoreFiles,
  getProjectForEditing,
  addPinned,
  deletePinned,
} from "../../../../api/engine-client";

const AU_PATH = "fandoms/f/aus/a";
const PINNED_CONTENT = "禁止角色OOC";

/** add_pinned_context 是唯一 undoMeta 可撤销（kind=pinned）的工具，覆盖确认+撤销全生命周期 */
const pinnedToolCall = (content: string) => ({
  id: "call-pinned-1",
  type: "function",
  function: { name: "add_pinned_context", arguments: JSON.stringify({ content }) },
});

// 可变 pinned 台账：addPinned / deletePinned 落账，getProjectForEditing 读账，
// 撤销路径（重新拉 project 定位 pinnedIndex）才走得通
let pinnedLedger: string[] = [];

const projectFixture = () => ({
  name: "测试AU",
  chapter_length: 3000,
  writing_style: { perspective: "first_person", emotion_style: "explicit", custom_instructions: "" },
  pinned_context: [...pinnedLedger],
  core_always_include: [],
  cast_registry: { characters: [] },
  llm: { mode: "api", model: "", api_base: "", api_key: "", local_model_path: "", ollama_model: "" },
  embedding_lock: {},
});

function renderPanel(props: Partial<Parameters<typeof SettingsChatPanel>[0]> = {}) {
  return render(
    <FeedbackProvider>
      <SettingsChatPanel mode="au" basePath={AU_PATH} placeholder="输入设定指令" {...props} />
    </FeedbackProvider>,
  );
}

async function sendUserMessage(text: string) {
  fireEvent.change(screen.getByPlaceholderText("输入设定指令"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(sendSettingsChat).toHaveBeenCalled());
}

describe("SettingsChatPanel — 状态下沉回归", () => {
  beforeAll(() => {
    // jsdom 未实现 scrollIntoView（SettingsChatHistory 滚到底部用）
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    pinnedLedger = [];
    (sendSettingsChat as Mock).mockReset().mockResolvedValue({
      content: "好的，帮你加一条写作底线。",
      tool_calls: [pinnedToolCall(PINNED_CONTENT)],
    });
    (listLoreFiles as Mock).mockReset().mockResolvedValue({ files: [] });
    (getProjectForEditing as Mock).mockReset().mockImplementation(() => Promise.resolve(projectFixture()));
    (addPinned as Mock).mockReset().mockImplementation((_path: string, content: string) => {
      pinnedLedger.push(content);
      return Promise.resolve(undefined);
    });
    (deletePinned as Mock).mockReset().mockImplementation((_path: string, index: number) => {
      pinnedLedger.splice(index, 1);
      return Promise.resolve(undefined);
    });
  });

  it("发消息：用户/助手气泡上屏，工具卡带确认按钮，历史按序发给引擎", async () => {
    renderPanel();
    await sendUserMessage("帮我加一条写作底线");

    expect(screen.getByText("帮我加一条写作底线")).toBeTruthy();
    await screen.findByText("好的，帮你加一条写作底线。");
    expect(screen.getByRole("button", { name: "确认" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "跳过" })).toBeTruthy();

    const [request] = (sendSettingsChat as Mock).mock.calls[0];
    expect(request.base_path).toBe(AU_PATH);
    expect(request.mode).toBe("au");
    expect(request.messages.at(-1)).toEqual({ role: "user", content: "帮我加一条写作底线" });
  });

  it("工具卡确认 → 撤销全生命周期：执行落库、刷新回调、撤销按台账索引删除", async () => {
    const onAfterMutation = vi.fn();
    renderPanel({ onAfterMutation });
    await sendUserMessage("帮我加一条写作底线");

    fireEvent.click(await screen.findByRole("button", { name: "确认" }));

    await waitFor(() => expect(addPinned).toHaveBeenCalledWith(AU_PATH, PINNED_CONTENT));
    await screen.findByText("✅ 已执行 · 写作底线");
    await waitFor(() => expect(onAfterMutation).toHaveBeenCalled());

    const undoButton = await screen.findByRole("button", { name: "撤销此项" });
    await waitFor(() => expect(undoButton).not.toBeDisabled());
    fireEvent.click(undoButton);

    await waitFor(() => expect(deletePinned).toHaveBeenCalledWith(AU_PATH, 0));
    await screen.findAllByText("↩️ 已撤销");
    expect(pinnedLedger).toEqual([]);
    // 撤销后 undoMeta 置空，撤销按钮消失
    expect(screen.queryByRole("button", { name: "撤销此项" })).toBeNull();
  });

  it("发送失败：回滚本条用户消息（回到空态），输入内容不丢", async () => {
    (sendSettingsChat as Mock).mockRejectedValue(new Error("网络错误"));
    renderPanel();
    await sendUserMessage("这条会失败");

    await screen.findByText("改设定模式已经准备好");
    // 气泡（p 元素）已回滚；textarea 里同文案是「输入不丢」的预期，限定 selector 避免误伤
    expect(screen.queryByText("这条会失败", { selector: "p" })).toBeNull();
    expect(screen.getByPlaceholderText("输入设定指令")).toHaveValue("这条会失败");
  });

  it("切上下文（basePath 变化）：会话与输入清空，支撑数据按新路径重拉", async () => {
    const { rerender } = renderPanel();
    await sendUserMessage("帮我加一条写作底线");
    await screen.findByText("好的，帮你加一条写作底线。");

    rerender(
      <FeedbackProvider>
        <SettingsChatPanel mode="au" basePath="fandoms/f/aus/b" placeholder="输入设定指令" />
      </FeedbackProvider>,
    );

    await screen.findByText("改设定模式已经准备好");
    expect(screen.queryByText("帮我加一条写作底线")).toBeNull();
    expect(screen.getByPlaceholderText("输入设定指令")).toHaveValue("");
    await waitFor(() => expect(getProjectForEditing).toHaveBeenLastCalledWith("fandoms/f/aus/b"));
  });
});
