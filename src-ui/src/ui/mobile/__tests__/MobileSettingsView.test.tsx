// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * MobileSettingsView — 设定助手会话 LLM 透传（审计 M14）。
 *
 * 判别性契约（回退到「不传 sessionLlm/disabled/onBusyChange」旧实现即挂）：
 *  1. SettingsChatPanel 拿到与桌面同源的 sessionLlm payload（用户会话选的模型生效）
 *  2. busy 期间点返回不关 overlay（防卸载杀掉执行中的设定操作），并 toast 提示
 *  3. busy 结束后可正常关闭
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { feedbackMock } from "../../../test/mocks/feedback";

vi.mock("../../../i18n/useAppTranslation", async () =>
  (await import("../../../test/mocks/i18n")).mockUseAppTranslation(),
);

vi.mock("../../../hooks/useFeedback", async () => (await import("../../../test/mocks/feedback")).mockUseFeedback());
const { showToast } = feedbackMock;

vi.mock("../../library/AuLoreLayout", () => ({ AuLoreLayout: () => <div /> }));

interface CapturedPanelProps {
  sessionLlm?: unknown;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}
const panelProps: CapturedPanelProps = {};
vi.mock("../../shared/settings-chat/SettingsChatPanel", () => ({
  SettingsChatPanel: (props: CapturedPanelProps) => {
    panelProps.sessionLlm = props.sessionLlm;
    panelProps.disabled = props.disabled;
    panelProps.onBusyChange = props.onBusyChange;
    return <div data-testid="stub-settings-chat" />;
  },
}));

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>("../../../api/engine-client");
  return {
    ...actual,
    getState: vi.fn(),
    getWriterProjectContext: vi.fn(),
    getWriterSessionConfig: vi.fn(),
    saveGlobalModelParams: vi.fn(),
    saveProjectModelParamsOverride: vi.fn(),
  };
});

import * as engineClient from "../../../api/engine-client";
import { MobileSettingsView } from "../MobileSettingsView";

const mocked = vi.mocked(engineClient as unknown as Record<string, ReturnType<typeof vi.fn>>);
const AU = "/data/fandoms/F/aus/A1";

beforeEach(() => {
  vi.clearAllMocks();
  panelProps.sessionLlm = undefined;
  panelProps.disabled = undefined;
  panelProps.onBusyChange = undefined;
  mocked.getState.mockResolvedValue({ current_chapter: 2 });
  mocked.getWriterProjectContext.mockResolvedValue({
    name: "Test AU",
    llm: { mode: "api", model: "session-model", has_api_key: true, has_override: true },
  });
  mocked.getWriterSessionConfig.mockResolvedValue({
    default_llm: { mode: "api", model: "global-model", has_api_key: true },
    model_params: {},
  });
});

async function openOverlay() {
  const user = userEvent.setup();
  render(<MobileSettingsView auPath={AU} currentChapter={1} />);
  await waitFor(() => expect(mocked.getWriterProjectContext).toHaveBeenCalled());
  await user.click(screen.getByText("settingsMode.title"));
  await screen.findByTestId("stub-settings-chat");
  return user;
}

describe("MobileSettingsView 设定助手透传（审计 M14）", () => {
  it("SettingsChatPanel 拿到会话 LLM payload（AU override 生效）+ disabled/onBusyChange", async () => {
    await openOverlay();

    await waitFor(() => {
      expect(panelProps.sessionLlm).toMatchObject({ mode: "api", model: "session-model" });
    });
    // context 加载完成后面板可用
    expect(panelProps.disabled).toBe(false);
    expect(panelProps.onBusyChange).toBeTypeOf("function");
  });

  it("busy 期间点返回不关 overlay + toast 提示；busy 结束后可关", async () => {
    const user = await openOverlay();

    act(() => panelProps.onBusyChange!(true));
    await user.click(screen.getByText("common.actions.back"));
    // overlay 未关（卸载会杀掉执行中的设定操作）
    expect(screen.getByTestId("stub-settings-chat")).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith("settingsMode.busyCloseBlocked", "warning");

    act(() => panelProps.onBusyChange!(false));
    await user.click(screen.getByText("common.actions.back"));
    await waitFor(() => {
      expect(screen.queryByTestId("stub-settings-chat")).toBeNull();
    });
  });
});
