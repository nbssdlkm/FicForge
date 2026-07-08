// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * R2-5：全局设置弹窗脏检查 —— 连接与模型选择字段有未保存修改时，
 * 点 X / 取消先弹确认；干净状态直接关闭；保存成功后基线重置。
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GlobalSettingsModal } from "../GlobalSettingsModal";
import { FeedbackProvider } from "../../../hooks/useFeedback";

// 重型子区块与本测试无关，剪掉其 API 面
vi.mock("../FontSettingsSection", () => ({ FontSettingsSection: () => null }));
vi.mock("../DebugLogsSection", () => ({ DebugLogsSection: () => null }));
vi.mock("../../shared/SecretStorageNotice", () => ({ SecretStorageNotice: () => null }));

vi.mock("../../../api/engine-client", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getSettingsForEditing: vi.fn(),
    getDisplayDataDir: vi.fn(),
    getDataDir: vi.fn(),
    getModelCatalog: vi.fn(),
    getCustomProviderApiKey: vi.fn(),
    saveGlobalSettingsForEditing: vi.fn(),
    saveAppPreferences: vi.fn(),
    testConnection: vi.fn(),
    testEmbeddingConnection: vi.fn(),
  };
});

import {
  getSettingsForEditing,
  getDisplayDataDir,
  getDataDir,
  getModelCatalog,
  saveGlobalSettingsForEditing,
} from "../../../api/engine-client";

// model 故意不用推荐模型 id：避免选择器权威 ctx 自动校正改表单值造成「伪脏」
const settingsFixture = {
  default_llm: {
    mode: "api",
    model: "my-model",
    api_base: "https://api.deepseek.com",
    api_key: "sk-old",
    context_window: 131072,
  },
  embedding: { model: "", api_base: "", api_key: "" },
  model_params: {},
  app: { react_extraction_enabled: true },
};

async function renderModal(onClose: Mock) {
  render(
    <FeedbackProvider>
      <GlobalSettingsModal isOpen onClose={onClose} />
    </FeedbackProvider>,
  );
  // hydrate 完成（api key 回显）
  await screen.findByDisplayValue("sk-old");
}

describe("GlobalSettingsModal — 脏检查（R2-5）", () => {
  beforeEach(() => {
    (getSettingsForEditing as Mock).mockReset().mockResolvedValue(settingsFixture);
    (getDisplayDataDir as Mock).mockReset().mockResolvedValue("/data");
    (getDataDir as Mock).mockReset().mockReturnValue("/data");
    (getModelCatalog as Mock).mockReset().mockResolvedValue({ custom_providers: [], enabled_models: {} });
    (saveGlobalSettingsForEditing as Mock).mockReset().mockResolvedValue(settingsFixture);
  });

  it("未改动 → 点取消直接关闭，不弹确认", async () => {
    const onClose = vi.fn();
    await renderModal(onClose);

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("放弃未保存的修改？")).toBeNull();
  });

  it("ctx 单独漂移不计脏（选择器权威校正是系统行为，防「打开就脏」误报）", async () => {
    const onClose = vi.fn();
    await renderModal(onClose);

    const ctxInput = screen.getByLabelText("一次能读多少字 (context window)") as HTMLInputElement;
    expect(ctxInput.value).toBe("131072");
    fireEvent.change(ctxInput, { target: { value: "999999" } });

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText("放弃未保存的修改？")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("改了 api key → 点取消弹确认；确认后才关闭", async () => {
    const onClose = vi.fn();
    await renderModal(onClose);

    fireEvent.change(screen.getByDisplayValue("sk-old"), { target: { value: "sk-new" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    // 弹确认、尚未关闭
    expect(await screen.findByText(/有未保存的修改，确定放弃？/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("保存成功后基线重置 → 再点取消不再弹确认", async () => {
    const onClose = vi.fn();
    await renderModal(onClose);

    fireEvent.change(screen.getByDisplayValue("sk-old"), { target: { value: "sk-new" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(saveGlobalSettingsForEditing).toHaveBeenCalled());
    // 保存 payload 带上新 key（顺带验证保存链路仍通）
    expect((saveGlobalSettingsForEditing as Mock).mock.calls[0][0].default_llm.api_key).toBe("sk-new");

    await screen.findByText("全局设置已保存");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("放弃未保存的修改？")).toBeNull();
  });
});
