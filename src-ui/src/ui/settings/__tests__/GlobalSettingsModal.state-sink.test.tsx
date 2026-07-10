// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * GlobalSettingsModal 状态下沉回归（长期债②第五块）：
 * 19 useState → 4 hooks（data / form / modals / extractionPref）后锁住的行为——
 * 关→开重新拉取并重灌（未保存编辑不残留）、提取开关的 hydrate / 乐观切换 / 失败回滚、
 * 加载失败时脏检查基线保持 null（取消直接关闭，不弹丢弃确认）。
 * 脏检查本体的行为锁在 GlobalSettingsModal.dirty.test.tsx。
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
  saveAppPreferences,
} from "../../../api/engine-client";

// model 故意不用推荐模型 id：避免选择器权威 ctx 自动校正改表单值造成「伪脏」
const settingsFixture = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

function renderModal(onClose: Mock, isOpen = true) {
  return render(
    <FeedbackProvider>
      <GlobalSettingsModal isOpen={isOpen} onClose={onClose} />
    </FeedbackProvider>,
  );
}

describe("GlobalSettingsModal — 状态下沉回归", () => {
  beforeEach(() => {
    (getSettingsForEditing as Mock).mockReset().mockResolvedValue(settingsFixture());
    (getDisplayDataDir as Mock).mockReset().mockResolvedValue("/data");
    (getDataDir as Mock).mockReset().mockReturnValue("/data");
    (getModelCatalog as Mock).mockReset().mockResolvedValue({ custom_providers: [], enabled_models: {} });
    (saveAppPreferences as Mock).mockReset().mockResolvedValue(undefined);
  });

  it("关→开：重新拉取并重灌，上一轮未保存编辑不残留", async () => {
    const onClose = vi.fn();
    const { rerender } = renderModal(onClose);
    await screen.findByDisplayValue("sk-old");

    // 制造未保存编辑后由父层直接关闭（不走 requestClose）
    fireEvent.change(screen.getByDisplayValue("sk-old"), { target: { value: "sk-dirty-edit" } });
    rerender(
      <FeedbackProvider>
        <GlobalSettingsModal isOpen={false} onClose={onClose} />
      </FeedbackProvider>,
    );

    (getSettingsForEditing as Mock).mockResolvedValue(
      settingsFixture({ default_llm: { mode: "api", model: "my-model", api_base: "https://api.deepseek.com", api_key: "sk-second", context_window: 131072 } }),
    );
    rerender(
      <FeedbackProvider>
        <GlobalSettingsModal isOpen onClose={onClose} />
      </FeedbackProvider>,
    );

    await screen.findByDisplayValue("sk-second");
    expect(screen.queryByDisplayValue("sk-dirty-edit")).toBeNull();
    expect(getSettingsForEditing).toHaveBeenCalledTimes(2);

    // 重灌后基线干净：取消直接关闭，不弹丢弃确认
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("放弃未保存的修改？")).toBeNull();
  });

  it("提取开关：从 settings hydrate（关闭态回显），切换即时落库", async () => {
    (getSettingsForEditing as Mock).mockResolvedValue(
      settingsFixture({ app: { react_extraction_enabled: false } }),
    );
    const onClose = vi.fn();
    renderModal(onClose);
    await screen.findByDisplayValue("sk-old");

    const select = screen.getByDisplayValue("关闭") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "on" } });

    await waitFor(() => expect(saveAppPreferences).toHaveBeenCalledWith({ react_extraction_enabled: true }));
    expect(screen.getByDisplayValue("开启（推荐）")).toBeTruthy();
  });

  it("提取开关落库失败：乐观值回滚", async () => {
    (saveAppPreferences as Mock).mockRejectedValue(new Error("disk full"));
    const onClose = vi.fn();
    renderModal(onClose);
    await screen.findByDisplayValue("sk-old");

    const select = screen.getByDisplayValue("开启（推荐）") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "off" } });

    // 失败后回滚到开启；开关不计脏，取消仍直接关闭
    await screen.findByDisplayValue("开启（推荐）");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("放弃未保存的修改？")).toBeNull();
  });

  it("settings 加载失败：基线保持 null（不脏），取消直接关闭", async () => {
    (getSettingsForEditing as Mock).mockRejectedValue(new Error("boom"));
    const onClose = vi.fn();
    renderModal(onClose);

    const cancel = await screen.findByRole("button", { name: "取消" });
    // 编辑默认表单也不算脏（基线未建立），关闭不弹确认
    fireEvent.change(screen.getByPlaceholderText("sk-..."), { target: { value: "sk-typed" } });
    fireEvent.click(cancel);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("放弃未保存的修改？")).toBeNull();
    // 保存按钮因 settings 缺失而禁用
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
