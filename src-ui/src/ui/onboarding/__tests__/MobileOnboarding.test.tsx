// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * MobileOnboarding 状态下沉回归（长期债②收尾块）：
 * 19 useState → 2 hooks（settingsForm / flow）后锁住的行为——
 * 默认配置水合回显、连接测试门控步进、六步走完提交 payload 来自表单、
 * 提交失败留在完成页显示错误且不触发 onComplete。
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MobileOnboarding } from "../MobileOnboarding";

// 重型子组件与本测试无关，剪掉其 API 面
vi.mock("../../settings/model-picker/ProviderModelPicker", () => ({ ProviderModelPicker: () => null }));
vi.mock("../../help/ApiSetupHelp", () => ({ ApiSetupHelp: () => null }));
vi.mock("../../shared/SecretStorageNotice", () => ({ SecretStorageNotice: () => null }));

vi.mock("../../../api/engine-client", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getOnboardingDefaults: vi.fn(),
    saveOnboardingSettings: vi.fn(),
    createFandom: vi.fn(),
    createAu: vi.fn(),
    testConnection: vi.fn(),
  };
});

import {
  getOnboardingDefaults,
  saveOnboardingSettings,
  createFandom,
  createAu,
  testConnection,
} from "../../../api/engine-client";

const defaultsFixture = () => ({
  default_llm: {
    mode: "api",
    model: "test-model-x",
    api_base: "https://gw.example.com/v1",
    api_key: "sk-test",
    local_model_path: "",
    ollama_model: "",
  },
  embedding: { mode: "api", model: "", api_base: "", api_key: "", ollama_model: "" },
});

async function renderOnboarding() {
  const onComplete = vi.fn();
  const onClose = vi.fn();
  render(<MobileOnboarding onComplete={onComplete} onClose={onClose} />);
  // 默认配置水合完成（step0 语言页出现）
  await screen.findByText("选择语言");
  return { onComplete, onClose };
}

/** 从 step0 一路走到最后一步（完成页），沿途覆盖连接测试门控与表单填写。 */
async function walkToCompletionStep() {
  const next = () => fireEvent.click(screen.getByRole("button", { name: /下一步/ }));

  // step0 语言 → step1 LLM
  next();
  await screen.findByText("连接AI写作模型");
  // 连接成功前下一步禁用
  expect((screen.getByRole("button", { name: /下一步/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  await screen.findByText("连接成功！模型：test-model-x");

  // step2 embedding（默认跳过态可直接过）
  next();
  await screen.findByText("让AI记住你的设定（可选）");

  // step3 首篇作品（默认 create，需填两个名字）
  next();
  await screen.findByText("创建你的第一个故事");
  expect((screen.getByRole("button", { name: /下一步/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByPlaceholderText(/原神/), { target: { value: "测试圈" } });
  fireEvent.change(screen.getByPlaceholderText(/现代校园/), { target: { value: "AU一号" } });

  // step4 伦理确认
  next();
  await screen.findByText("在开始之前");
  fireEvent.click(screen.getByRole("checkbox"));

  // step5 完成页
  next();
  await screen.findByText("一切就绪！");
}

describe("MobileOnboarding — 状态下沉回归", () => {
  beforeEach(() => {
    (getOnboardingDefaults as Mock).mockReset().mockResolvedValue(defaultsFixture());
    (saveOnboardingSettings as Mock).mockReset().mockResolvedValue(undefined);
    (createFandom as Mock).mockReset().mockResolvedValue({ name: "测试圈", path: "fandoms/测试圈" });
    (createAu as Mock).mockReset().mockResolvedValue({ path: "fandoms/测试圈/aus/AU一号" });
    (testConnection as Mock).mockReset().mockResolvedValue({ success: true, model: "test-model-x" });
  });

  it("加载后水合已有全局配置（api base 回显进表单）", async () => {
    await renderOnboarding();

    fireEvent.click(screen.getByRole("button", { name: /下一步/ }));
    await screen.findByText("连接AI写作模型");
    expect(screen.getByDisplayValue("https://gw.example.com/v1")).toBeTruthy();
    expect(screen.getByDisplayValue("sk-test")).toBeTruthy();
  });

  it("六步走完提交：payload 来自表单，建圈建 AU 后 onComplete 带 openAuPath", async () => {
    const { onComplete } = await renderOnboarding();
    await walkToCompletionStep();

    fireEvent.click(screen.getByRole("button", { name: "我已了解，开始使用" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const [savePayload] = (saveOnboardingSettings as Mock).mock.calls[0];
    expect(savePayload.default_llm.model).toBe("test-model-x");
    expect(savePayload.default_llm.api_base).toBe("https://gw.example.com/v1");
    expect(savePayload.default_llm.api_key).toBe("sk-test");
    expect(savePayload.embedding.model).toBe(""); // 跳过 embedding → 空字段
    expect(createFandom).toHaveBeenCalledWith("测试圈");
    expect(createAu).toHaveBeenCalledWith("测试圈", "AU一号", "fandoms/测试圈");
    expect(onComplete).toHaveBeenCalledWith({ openAuPath: "fandoms/测试圈/aus/AU一号", nextAction: undefined });
  });

  it("连接测试失败：错误信息展示且下一步保持禁用", async () => {
    (testConnection as Mock).mockResolvedValue({ success: false, message: "key 无效" });
    await renderOnboarding();

    fireEvent.click(screen.getByRole("button", { name: /下一步/ }));
    await screen.findByText("连接AI写作模型");
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    await screen.findByText("key 无效");
    expect((screen.getByRole("button", { name: /下一步/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("提交失败：留在完成页显示错误，不触发 onComplete，可重试", async () => {
    (saveOnboardingSettings as Mock).mockRejectedValue(new Error("磁盘满了"));
    const { onComplete } = await renderOnboarding();
    await walkToCompletionStep();

    fireEvent.click(screen.getByRole("button", { name: "我已了解，开始使用" }));

    await screen.findByText("磁盘满了");
    expect(onComplete).not.toHaveBeenCalled();
    // 提交完成后按钮恢复可点（submitting 复位）
    expect((screen.getByRole("button", { name: "我已了解，开始使用" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
