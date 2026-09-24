// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * SettingsChatPanel 会话底座回归（settings-chat-sessions）：
 * 首挂载自愈建会话并加载消息、发送后防抖持久化、切会话换消息、
 * 会话条 UI 可见可展开。
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
    listSettingsChatSessions: vi.fn(),
    createSettingsChatSession: vi.fn(),
    renameSettingsChatSession: vi.fn(),
    deleteSettingsChatSession: vi.fn(),
    getSettingsChatSession: vi.fn(),
    saveSettingsChatSession: vi.fn(),
  };
});

import {
  sendSettingsChat,
  listLoreFiles,
  getProjectForEditing,
  listSettingsChatSessions,
  createSettingsChatSession,
  getSettingsChatSession,
  saveSettingsChatSession,
} from "../../../../api/engine-client";

const FANDOM_PATH = "fandoms/f1";

const emptyProject = () => ({
  name: "测试",
  chapter_length: 3000,
  writing_style: { perspective: "first_person", emotion_style: "explicit", custom_instructions: "" },
  pinned_context: [],
  core_always_include: [],
  cast_registry: { characters: [] },
  llm: { mode: "api", model: "", api_base: "", api_key: "", local_model_path: "", ollama_model: "" },
  embedding_lock: {},
});

const sessionMeta = (id: string, title: string, messageCount = 0) => ({
  id,
  title,
  created_at: "2026-09-14T01:00:00Z",
  updated_at: "2026-09-14T01:00:00Z",
  message_count: messageCount,
});

const sessionFile = (messages: Record<string, unknown>[]) => ({
  version: 1,
  context_path: FANDOM_PATH,
  created_at: "2026-09-14T01:00:00Z",
  updated_at: "2026-09-14T01:00:00Z",
  messages,
});

function renderPanel() {
  return render(
    <FeedbackProvider>
      <SettingsChatPanel mode="fandom" basePath={FANDOM_PATH} fandomPath={FANDOM_PATH} placeholder="说点什么" />
    </FeedbackProvider>,
  );
}

describe("SettingsChatPanel · 会话底座", () => {
  beforeAll(() => {
    // jsdom 未实现 scrollIntoView（SettingsChatHistory 滚到底部用）
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (listLoreFiles as Mock).mockResolvedValue({ files: [] });
    (getProjectForEditing as Mock).mockResolvedValue(emptyProject());
    (getSettingsChatSession as Mock).mockResolvedValue(sessionFile([]));
    (saveSettingsChatSession as Mock).mockResolvedValue(undefined);
  });

  it("无会话时自愈建第一个并加载其消息", async () => {
    (listSettingsChatSessions as Mock).mockResolvedValue([]);
    (createSettingsChatSession as Mock).mockResolvedValue(sessionMeta("cs_1", "Session"));
    (getSettingsChatSession as Mock).mockResolvedValue(
      sessionFile([{ id: "m1", role: "user", content: "旧消息还在" }]),
    );

    renderPanel();

    await waitFor(() => expect(createSettingsChatSession).toHaveBeenCalledWith(FANDOM_PATH));
    await waitFor(() => expect(getSettingsChatSession).toHaveBeenCalledWith(FANDOM_PATH, "cs_1"));
    expect(await screen.findByText("旧消息还在")).toBeInTheDocument();
  });

  it("发送成功后防抖持久化到当前会话", async () => {
    (listSettingsChatSessions as Mock).mockResolvedValue([sessionMeta("cs_1", "设定聊")]);
    (sendSettingsChat as Mock).mockResolvedValue({ content: "收到", tool_calls: [] });

    renderPanel();
    await waitFor(() => expect(getSettingsChatSession).toHaveBeenCalledWith(FANDOM_PATH, "cs_1"));

    fireEvent.change(screen.getByPlaceholderText("说点什么"), { target: { value: "帮我建角色卡" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(screen.getByText("收到")).toBeInTheDocument());
    await waitFor(
      () => {
        expect(saveSettingsChatSession).toHaveBeenCalledWith(
          FANDOM_PATH,
          "cs_1",
          expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "帮我建角色卡" }),
            expect.objectContaining({ role: "assistant", content: "收到" }),
          ]),
        );
      },
      { timeout: 3000 },
    );
  });

  it("切会话 → 加载目标会话消息（会话条展开后点击）", async () => {
    (listSettingsChatSessions as Mock).mockResolvedValue([
      sessionMeta("cs_new", "第二个会话"),
      sessionMeta("cs_old", "第一个会话"),
    ]);
    (getSettingsChatSession as Mock).mockImplementation((_path: string, id: string) =>
      Promise.resolve(
        id === "cs_old" ? sessionFile([{ id: "m1", role: "user", content: "第一个会话的消息" }]) : sessionFile([]),
      ),
    );

    renderPanel();
    // 默认选最近（cs_new），消息为空
    await waitFor(() => expect(getSettingsChatSession).toHaveBeenCalledWith(FANDOM_PATH, "cs_new"));

    // 展开会话条 → 点第一个会话
    fireEvent.click(screen.getByRole("button", { name: /第二个会话/ }));
    fireEvent.click(await screen.findByRole("button", { name: /第一个会话的消息|第一个会话/ }));

    await waitFor(() => expect(getSettingsChatSession).toHaveBeenCalledWith(FANDOM_PATH, "cs_old"));
    expect(await screen.findByText("第一个会话的消息")).toBeInTheDocument();
  });
});
