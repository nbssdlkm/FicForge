// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProviderModelPicker } from "../ProviderModelPicker";
import { FeedbackProvider } from "../../../../hooks/useFeedback";
import { buildGlobalSettingsSaveInput, createDefaultGlobalSettingsFormState } from "../../form-mappers";

// 保留真实 engine-client（FeedbackProvider 依赖 ApiError），只覆盖目录/拉取相关 api。
vi.mock("../../../../api/engine-client", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getModelCatalog: vi.fn(),
    getCustomProviderApiKey: vi.fn(),
    saveEnabledModels: vi.fn(),
    saveCustomProvider: vi.fn(),
    deleteCustomProvider: vi.fn(),
    fetchProviderModels: vi.fn(),
  };
});

import {
  getModelCatalog,
  getCustomProviderApiKey,
  fetchProviderModels,
  saveEnabledModels,
} from "../../../../api/engine-client";

const emptyCatalog = { custom_providers: [], enabled_models: {} };

const catalogWithCustom = {
  custom_providers: [
    {
      id: "custom-r1",
      displayName: "我的中转站",
      baseUrl: "https://relay.example.com/v1",
      has_api_key: true,
      models: [],
    },
  ],
  enabled_models: {},
};

/** 一个带 chatPath 的自定义供应商 + 一个不带的，用于验证「切换时带出 / 清旧值」。 */
const catalogWithChatPath = {
  custom_providers: [
    {
      id: "custom-gw",
      displayName: "非标网关",
      baseUrl: "https://gateway.example.com",
      chatPath: "/openai/v1/chat",
      has_api_key: false,
      models: [],
    },
    {
      id: "custom-plain",
      displayName: "标准中转",
      baseUrl: "https://plain.example.com/v1",
      has_api_key: false,
      models: [],
    },
  ],
  enabled_models: {},
};

function renderPicker(ui: React.ReactElement) {
  return render(<FeedbackProvider>{ui}</FeedbackProvider>);
}

/** 受控 harness：模拟 GlobalSettingsModal 的表单态接线。 */
function ControlledPicker({
  spies,
}: {
  spies: {
    onModelChange?: Mock;
    onApiBaseAutoFill?: Mock;
    onContextWindowChange?: Mock;
    onApiKeyAutoFill?: Mock;
    onChatPathAutoFill?: Mock;
  };
}) {
  const [model, setModel] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [ctx, setCtx] = useState("");
  return (
    <ProviderModelPicker
      kind="chat"
      model={model}
      onModelChange={(m) => {
        spies.onModelChange?.(m);
        setModel(m);
      }}
      apiBase={apiBase}
      onApiBaseAutoFill={(b) => {
        spies.onApiBaseAutoFill?.(b);
        setApiBase(b);
      }}
      onChatPathAutoFill={spies.onChatPathAutoFill}
      apiKey=""
      onApiKeyAutoFill={spies.onApiKeyAutoFill}
      contextWindow={ctx}
      onContextWindowChange={(v) => {
        spies.onContextWindowChange?.(v);
        setCtx(v);
      }}
    />
  );
}

describe("ProviderModelPicker", () => {
  beforeEach(() => {
    (getModelCatalog as Mock).mockReset().mockResolvedValue(emptyCatalog);
    (getCustomProviderApiKey as Mock).mockReset().mockResolvedValue("");
  });

  it("供应商切换 → 自动填该供应商 baseUrl", async () => {
    const onApiBaseAutoFill = vi.fn();
    renderPicker(<ControlledPicker spies={{ onApiBaseAutoFill }} />);

    const providerSelect = await screen.findByLabelText("服务商");
    fireEvent.change(providerSelect, { target: { value: "deepseek" } });
    expect(onApiBaseAutoFill).toHaveBeenCalledWith("https://api.deepseek.com");

    fireEvent.change(providerSelect, { target: { value: "zhipu" } });
    expect(onApiBaseAutoFill).toHaveBeenLastCalledWith("https://open.bigmodel.cn/api/paas/v4");
  });

  it("选择推荐模型 → 模型 + 权威 ctx 一并带出，ctx 可编辑（per-model 覆盖）+ 标注官方值", async () => {
    const onModelChange = vi.fn();
    const onContextWindowChange = vi.fn();
    renderPicker(<ControlledPicker spies={{ onModelChange, onContextWindowChange }} />);

    fireEvent.change(await screen.findByLabelText("服务商"), { target: { value: "deepseek" } });
    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "deepseek-v4-flash" } });

    expect(onModelChange).toHaveBeenCalledWith("deepseek-v4-flash");
    expect(onContextWindowChange).toHaveBeenCalledWith("1000000");
    const ctxInput = screen.getByLabelText("一次能读多少字 (context window)") as HTMLInputElement;
    // per-model 覆盖：权威模型的 ctx 现在也可编辑（不再只读），默认带出官方值
    expect(ctxInput.readOnly).toBe(false);
    expect(ctxInput.value).toBe("1000000");
    expect(screen.getByText(/官方标定/)).toBeInTheDocument();
    // 推荐模型标签胶囊
    expect(screen.getByText("便宜")).toBeInTheDocument();
    expect(screen.getByText("长上下文")).toBeInTheDocument();
  });

  it("覆盖权威模型 ctx → 显示「已覆盖官方默认」+「恢复默认」还原（per-model 编辑，数据链末端进 context_window）", async () => {
    const onContextWindowChange = vi.fn();
    renderPicker(<ControlledPicker spies={{ onContextWindowChange }} />);

    fireEvent.change(await screen.findByLabelText("服务商"), { target: { value: "deepseek" } });
    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "deepseek-v4-flash" } });
    const ctxInput = screen.getByLabelText("一次能读多少字 (context window)") as HTMLInputElement;

    // 用户改小窗口（如为省 token / 服务商实际限额）
    fireEvent.change(ctxInput, { target: { value: "200000" } });
    expect(onContextWindowChange).toHaveBeenLastCalledWith("200000");
    // 覆盖提示 + 恢复默认按钮
    expect(screen.getByText(/已覆盖官方默认/)).toBeInTheDocument();
    const resetBtn = screen.getByRole("button", { name: "恢复官方默认" });
    fireEvent.click(resetBtn);
    expect(onContextWindowChange).toHaveBeenLastCalledWith("1000000"); // 还原官方值

    // 数据链末端：覆盖值 → buildGlobalSettingsSaveInput → default_llm.context_window（生成端 getContextWindow 优先认它）
    const form = createDefaultGlobalSettingsFormState();
    form.contextWindow = "200000";
    expect(buildGlobalSettingsSaveInput(form).default_llm.context_window).toBe(200000);
  });

  it("手填未知模型 → ctx 可编辑 + 未知警示；手改 ctx 进 onContextWindowChange（保存 payload 链）", async () => {
    const onContextWindowChange = vi.fn();
    renderPicker(<ControlledPicker spies={{ onContextWindowChange }} />);

    fireEvent.change(await screen.findByLabelText("服务商"), { target: { value: "deepseek" } });
    // 切手填输入
    fireEvent.click(screen.getByRole("button", { name: "手填" }));
    const modelInput = screen.getByPlaceholderText(/输入模型 id/);
    fireEvent.change(modelInput, { target: { value: "made-up-model-9000" } });

    expect(screen.getByText(/查不到这个模型/)).toBeInTheDocument();
    const ctxInput = screen.getByLabelText("一次能读多少字 (context window)") as HTMLInputElement;
    expect(ctxInput.readOnly).toBe(false);
    fireEvent.change(ctxInput, { target: { value: "256000" } });
    expect(onContextWindowChange).toHaveBeenLastCalledWith("256000");

    // 数据链末端：表单 ctx → buildGlobalSettingsSaveInput → default_llm.context_window
    const form = createDefaultGlobalSettingsFormState();
    form.contextWindow = "256000";
    expect(buildGlobalSettingsSaveInput(form).default_llm.context_window).toBe(256000);
  });

  it("手填 fuzzy 可推的模型 → 显式「按 XXk 估算」提示（禁静默 fallback）", async () => {
    renderPicker(<ControlledPicker spies={{}} />);

    fireEvent.change(await screen.findByLabelText("服务商"), { target: { value: "deepseek" } });
    fireEvent.click(screen.getByRole("button", { name: "手填" }));
    fireEvent.change(screen.getByPlaceholderText(/输入模型 id/), { target: { value: "kimi-k2.6" } });

    expect(screen.getByText(/估算/)).toBeInTheDocument();
  });

  it("kind=embedding：模型下拉只出现 embedding 类型（无 ctx 行）", async () => {
    renderPicker(<FetchlessEmbeddingHarness />);
    fireEvent.change(await screen.findByLabelText("服务商"), { target: { value: "siliconflow" } });

    const modelSelect = screen.getByLabelText("模型") as HTMLSelectElement;
    const optionValues = [...modelSelect.querySelectorAll("option")].map((o) => o.value).filter(Boolean);
    expect(optionValues).toEqual(["BAAI/bge-m3"]);
    expect(screen.queryByLabelText("一次能读多少字 (context window)")).toBeNull();
  });

  it("apiBase 命中自定义供应商 → 选中它；选中带 key 的自定义供应商 → 自动带出已存 key", async () => {
    (getModelCatalog as Mock).mockResolvedValue(catalogWithCustom);
    (getCustomProviderApiKey as Mock).mockResolvedValue("sk-stored-relay");
    const onApiKeyAutoFill = vi.fn();
    renderPicker(<ControlledPicker spies={{ onApiKeyAutoFill }} />);

    const providerSelect = await screen.findByLabelText("服务商");
    await waitFor(() => {
      expect([...providerSelect.querySelectorAll("option")].some((o) => o.value === "custom-r1")).toBe(true);
    });
    fireEvent.change(providerSelect, { target: { value: "custom-r1" } });
    await waitFor(() => expect(onApiKeyAutoFill).toHaveBeenCalledWith("sk-stored-relay"));
  });

  it("F-3: 两个同 baseUrl 供应商 → 选第二个不被同步效应弹回首个命中；拉取保存挂到所选 id", async () => {
    (getModelCatalog as Mock).mockResolvedValue({
      custom_providers: [
        { id: "custom-m1", displayName: "镜像一", baseUrl: "https://mirror.example.com/v1", models: [] },
        { id: "custom-m2", displayName: "镜像二", baseUrl: "https://mirror.example.com/v1", models: [] },
      ],
      enabled_models: {},
    });
    (fetchProviderModels as Mock).mockReset().mockResolvedValue({ ids: ["model-x"] });
    (saveEnabledModels as Mock).mockReset().mockResolvedValue(undefined);
    renderPicker(<ControlledPicker spies={{}} />);

    const providerSelect = (await screen.findByLabelText("服务商")) as HTMLSelectElement;
    await waitFor(() => {
      expect([...providerSelect.querySelectorAll("option")].some((o) => o.value === "custom-m2")).toBe(true);
    });

    fireEvent.change(providerSelect, { target: { value: "custom-m2" } });
    // 同步效应对同 baseUrl 命中保持现选（旧实现会按 find 首个命中弹回 custom-m1）
    expect(providerSelect.value).toBe("custom-m2");
    await new Promise((r) => setTimeout(r, 0));
    expect(providerSelect.value).toBe("custom-m2");

    // 拉取 → 勾选 → 保存挂到正确的 custom-m2
    fireEvent.click(screen.getByRole("button", { name: "从 API 获取列表" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /model-x/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存勾选" }));
    await waitFor(() => expect(saveEnabledModels).toHaveBeenCalled());
    expect((saveEnabledModels as Mock).mock.calls[0][0]).toBe("custom-m2");
  });

  it("F-4: 跨槽位 stale 快照 —— 别槽已启用 A/B，本槽拉取勾 C 保存 → A/B 仍启用不被误清", async () => {
    const staleCatalog = { custom_providers: [], enabled_models: {} };
    const freshCatalog = {
      custom_providers: [],
      enabled_models: {
        siliconflow: [
          { id: "deepseek-ai/DeepSeek-V4", display_name: "deepseek-ai/DeepSeek-V4", type: "chat" },
          { id: "Qwen/Qwen3-Max", display_name: "Qwen/Qwen3-Max", type: "chat" },
        ],
      },
    };
    // 挂载读到 stale 快照；sheet 打开 / 确认前的新读拿到别槽（chat 槽）已保存的 fresh enabled
    (getModelCatalog as Mock).mockResolvedValueOnce(staleCatalog).mockResolvedValue(freshCatalog);
    (fetchProviderModels as Mock).mockReset().mockResolvedValue({ ids: ["BAAI/bge-large-zh"] });
    (saveEnabledModels as Mock).mockReset().mockResolvedValue(undefined);

    renderPicker(<FetchlessEmbeddingHarness />);
    fireEvent.change(await screen.findByLabelText("服务商"), { target: { value: "siliconflow" } });

    fireEvent.click(screen.getByRole("button", { name: "从 API 获取列表" }));
    // fresh enabled 的 A/B 出现在「未返回」分组并默认保持勾选
    expect(await screen.findByText("deepseek-ai/DeepSeek-V4")).toBeTruthy();
    expect(screen.getByText("Qwen/Qwen3-Max")).toBeInTheDocument();
    // 新拉到的 C 勾上
    fireEvent.click(await screen.findByRole("checkbox", { name: /bge-large-zh/ }));

    fireEvent.click(screen.getByRole("button", { name: "保存勾选" }));
    await waitFor(() => expect(saveEnabledModels).toHaveBeenCalled());
    const [providerId, saved] = (saveEnabledModels as Mock).mock.calls[0] as [string, { id: string }[]];
    expect(providerId).toBe("siliconflow");
    expect(saved.map((m) => m.id).sort()).toEqual(["BAAI/bge-large-zh", "Qwen/Qwen3-Max", "deepseek-ai/DeepSeek-V4"]);
  });

  it("F-5: 下拉选中窗口未知模型 → 清空 ctx 表单值（不沿用上一模型 stale 大数）+ 未知警示照旧", async () => {
    (getModelCatalog as Mock).mockResolvedValue({
      custom_providers: [],
      enabled_models: {
        deepseek: [{ id: "made-up-model-9000", display_name: "made-up-model-9000", type: "chat" }],
      },
    });
    const onContextWindowChange = vi.fn();
    renderPicker(<ControlledPicker spies={{ onContextWindowChange }} />);

    fireEvent.change(await screen.findByLabelText("服务商"), { target: { value: "deepseek" } });
    const modelSelect = screen.getByLabelText("模型") as HTMLSelectElement;
    await waitFor(() => {
      expect([...modelSelect.querySelectorAll("option")].some((o) => o.value === "made-up-model-9000")).toBe(true);
    });

    // 先选权威大 ctx 模型（1M）
    fireEvent.change(modelSelect, { target: { value: "deepseek-v4-flash" } });
    expect(onContextWindowChange).toHaveBeenLastCalledWith("1000000");

    // 再选未知窗口模型 → ctx 清空为 ""（不残留 1M、不发 0 哨兵被 || 吞掉），警示文案照旧
    fireEvent.change(modelSelect, { target: { value: "made-up-model-9000" } });
    expect(onContextWindowChange).toHaveBeenLastCalledWith("");
    const ctxInput = screen.getByLabelText("一次能读多少字 (context window)") as HTMLInputElement;
    expect(ctxInput.value).toBe("");
    expect(screen.getByText(/查不到这个模型/)).toBeInTheDocument();
  });

  it("R2-4：开拉取 sheet 前的目录新读失败 → 阻断打开 + 报错（不再拿 stale 快照照常开门）", async () => {
    // 挂载读成功，开门前的 fresh 读失败
    (getModelCatalog as Mock).mockResolvedValueOnce(emptyCatalog).mockRejectedValueOnce(new Error("disk gone"));
    renderPicker(<ControlledPicker spies={{}} />);

    fireEvent.change(await screen.findByLabelText("服务商"), { target: { value: "deepseek" } });
    fireEvent.click(screen.getByRole("button", { name: "从 API 获取列表" }));

    // 错误提示出现，sheet 没开（无 sheet 标题）
    expect(await screen.findByText(/读取模型目录失败/)).toBeTruthy();
    expect(screen.queryByText("从 API 获取模型列表")).toBeNull();
  });

  it("选中带 chatPath 的供应商 → onChatPathAutoFill 带出该路径；切到无 chatPath 供应商 → 清空", async () => {
    (getModelCatalog as Mock).mockResolvedValue(catalogWithChatPath);
    const onChatPathAutoFill = vi.fn();
    renderPicker(<ControlledPicker spies={{ onChatPathAutoFill }} />);

    const providerSelect = await screen.findByLabelText("服务商");
    await waitFor(() => {
      expect([...providerSelect.querySelectorAll("option")].some((o) => o.value === "custom-gw")).toBe(true);
    });

    // 选中带 chatPath 的网关 → 路径随之带出
    fireEvent.change(providerSelect, { target: { value: "custom-gw" } });
    expect(onChatPathAutoFill).toHaveBeenLastCalledWith("/openai/v1/chat");

    // 切到不带 chatPath 的标准中转 → 传空串清掉旧路径（防残留）
    fireEvent.change(providerSelect, { target: { value: "custom-plain" } });
    expect(onChatPathAutoFill).toHaveBeenLastCalledWith("");
  });
});

/** embedding 槽位 harness（无 ctx 接线）。 */
function FetchlessEmbeddingHarness() {
  const [model, setModel] = useState("");
  const [apiBase, setApiBase] = useState("");
  return (
    <ProviderModelPicker
      kind="embedding"
      model={model}
      onModelChange={setModel}
      apiBase={apiBase}
      onApiBaseAutoFill={setApiBase}
      apiKey=""
    />
  );
}
