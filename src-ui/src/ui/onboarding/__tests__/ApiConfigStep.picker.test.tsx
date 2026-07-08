// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * R2-7：新手引导 LLM 配置步复用 ProviderModelPicker（与全局设置同源组件）——
 * 引导步渲染选择器、选服务商/模型后 ctx 随权威值带出，测试通过后
 * onNext 的 config（即 onboarding 保存 payload 的来源）携带完整字段。
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApiConfigStep } from "../ApiConfigStep";
import { FeedbackProvider } from "../../../hooks/useFeedback";

// 保留真实 engine-client（FeedbackProvider 依赖 ApiError），只覆盖目录 / 测试连接 api。
vi.mock("../../../api/engine-client", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getModelCatalog: vi.fn(),
    getCustomProviderApiKey: vi.fn(),
    testConnection: vi.fn(),
  };
});

import { getModelCatalog, testConnection } from "../../../api/engine-client";

function renderStep(onNext: Mock) {
  return render(
    <FeedbackProvider>
      <ApiConfigStep onNext={onNext} onPrev={() => {}} />
    </FeedbackProvider>,
  );
}

describe("ApiConfigStep — ProviderModelPicker 接线（R2-7）", () => {
  beforeEach(() => {
    (getModelCatalog as Mock).mockReset().mockResolvedValue({ custom_providers: [], enabled_models: {} });
    (testConnection as Mock).mockReset().mockResolvedValue({ success: true, model: "deepseek-v4-flash" });
  });

  it("引导步渲染选择器：服务商/模型下拉存在，无旧「模型名手填」输入", async () => {
    renderStep(vi.fn());
    expect(await screen.findByLabelText("服务商")).toBeTruthy();
    expect(screen.getByLabelText("模型")).toBeTruthy();
    // 旧的自由文本模型输入（modelPlaceholder「按官网文档填写」）已被选择器取代
    expect(screen.queryByPlaceholderText("按官网文档填写")).toBeNull();
  });

  it("选服务商 → apiBase 自动填；选模型 → ctx 权威值带出；测试成功后 onNext 携带完整 payload", async () => {
    const onNext = vi.fn();
    renderStep(onNext);

    fireEvent.change(await screen.findByLabelText("服务商"), { target: { value: "deepseek" } });
    const apiBaseInput = screen.getByPlaceholderText("https://api.deepseek.com") as HTMLInputElement;
    expect(apiBaseInput.value).toBe("https://api.deepseek.com");

    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "deepseek-v4-flash" } });
    const ctxInput = screen.getByLabelText("一次能读多少字 (context window)") as HTMLInputElement;
    expect(ctxInput.value).toBe("1000000");

    fireEvent.change(screen.getByPlaceholderText("sk-..."), { target: { value: "sk-test" } });
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(testConnection).toHaveBeenCalled());
    // 测试请求走 buildLlmConnectionTestRequest：默认路径下不带 chat_path
    expect((testConnection as Mock).mock.calls[0][0]).toMatchObject({
      mode: "api",
      model: "deepseek-v4-flash",
      api_base: "https://api.deepseek.com",
      api_key: "sk-test",
    });

    const next = await screen.findByRole("button", { name: "下一步 →" });
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(next);

    // onNext 的 config 即 OnboardingFlow 保存 payload 的来源（buildDefaultLlmSettingsInput）
    expect(onNext).toHaveBeenCalledWith(expect.objectContaining({
      mode: "api",
      model: "deepseek-v4-flash",
      api_base: "https://api.deepseek.com",
      api_key: "sk-test",
      context_window: "1000000",
      chat_path: "",
    }));
  });
});
