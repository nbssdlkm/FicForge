// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FetchModelsSheet } from "../FetchModelsSheet";

vi.mock("../../../../api/engine-client", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    fetchProviderModels: vi.fn(),
  };
});

import { fetchProviderModels } from "../../../../api/engine-client";

function renderSheet(overrides: Partial<Parameters<typeof FetchModelsSheet>[0]> = {}) {
  return render(
    <FetchModelsSheet
      isOpen
      onClose={() => {}}
      apiBase="https://api.deepseek.com"
      apiKey="sk-test"
      existingEntries={[]}
      onConfirm={() => {}}
      {...overrides}
    />,
  );
}

describe("FetchModelsSheet", () => {
  beforeEach(() => {
    (fetchProviderModels as Mock).mockReset();
  });

  it("拉取成功：按系列分组展示 + embedding id 自动标向量胶囊", async () => {
    (fetchProviderModels as Mock).mockResolvedValue({
      ids: ["deepseek-v4-flash", "deepseek-v4-pro", "BAAI/bge-m3", "some-random-model"],
    });
    renderSheet();

    expect(await screen.findByText("deepseek-v4-flash")).toBeTruthy();
    expect(fetchProviderModels).toHaveBeenCalledWith({ api_base: "https://api.deepseek.com", api_key: "sk-test" });
    // 分组头
    expect(screen.getByText("DeepSeek")).toBeTruthy();
    expect(screen.getByText("Embedding 向量")).toBeTruthy();
    expect(screen.getByText("其他")).toBeTruthy();
    // embedding 胶囊
    expect(screen.getByText("向量")).toBeTruthy();
  });

  it("搜索过滤 + 过滤内全选 → 确认写入勾选（embedding 类型自动预标）", async () => {
    (fetchProviderModels as Mock).mockResolvedValue({
      ids: ["deepseek-v4-flash", "deepseek-v4-pro", "BAAI/bge-m3"],
    });
    const onConfirm = vi.fn();
    renderSheet({ onConfirm });

    await screen.findByText("deepseek-v4-flash");
    // 搜索过滤到 bge
    fireEvent.change(screen.getByPlaceholderText("搜索模型…"), { target: { value: "bge" } });
    expect(screen.queryByText("deepseek-v4-flash")).toBeNull();
    // 过滤内全选
    fireEvent.click(screen.getByRole("button", { name: "全选过滤结果" }));
    // 清空搜索 → deepseek 条目仍未被勾选
    fireEvent.change(screen.getByPlaceholderText("搜索模型…"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存勾选" }));

    // F-4：第二参数 = 本次 sheet 可见宇宙（拉取返回 ∪ 打开时已启用），与搜索过滤无关
    expect(onConfirm).toHaveBeenCalledWith(
      [{ id: "BAAI/bge-m3", displayName: "BAAI/bge-m3", type: "embedding" }],
      new Set(["deepseek-v4-flash", "deepseek-v4-pro", "BAAI/bge-m3"]),
    );
  });

  it("已启用条目保留元数据（手填 ctx 不丢）；未返回的旧条目单列分组、默认保持勾选", async () => {
    (fetchProviderModels as Mock).mockResolvedValue({ ids: ["deepseek-v4-flash"] });
    const onConfirm = vi.fn();
    renderSheet({
      onConfirm,
      existingEntries: [
        { id: "deepseek-v4-flash", displayName: "deepseek-v4-flash", contextWindow: 131_072, type: "chat" },
        { id: "legacy-model", displayName: "legacy-model", type: "chat" },
      ],
    });

    // 旧条目单列「已启用但本次未返回」分组
    expect(await screen.findByText("已启用但本次未返回")).toBeTruthy();
    expect(screen.getByText("legacy-model")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存勾选" }));
    const models = onConfirm.mock.calls[0][0] as { id: string; contextWindow?: number }[];
    // 两条都默认保持勾选；已有条目的手填 ctx 原样保留
    expect(models.map((m) => m.id).sort()).toEqual(["deepseek-v4-flash", "legacy-model"]);
    expect(models.find((m) => m.id === "deepseek-v4-flash")!.contextWindow).toBe(131_072);
    // F-4：可见宇宙含拉取返回 + 未返回的旧启用条目
    expect(onConfirm.mock.calls[0][1]).toEqual(new Set(["deepseek-v4-flash", "legacy-model"]));
  });

  it("拉取失败 → 错误提示（含 message），确认按钮禁用", async () => {
    (fetchProviderModels as Mock).mockRejectedValue(new Error("HTTP 401"));
    renderSheet();

    expect(await screen.findByText(/获取失败：HTTP 401/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "保存勾选" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
