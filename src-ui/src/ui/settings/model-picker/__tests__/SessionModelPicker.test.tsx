// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionModelPicker } from "../SessionModelPicker";
import type { PickerModelOption } from "../model-picker-utils";

const options: PickerModelOption[] = [
  {
    id: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    type: "chat",
    ctx: { source: "authoritative", value: 1_000_000 },
    origin: "recommended",
  },
  {
    id: "deepseek-pulled",
    displayName: "deepseek-pulled",
    type: "chat",
    ctx: { source: "unknown" },
    origin: "enabled",
  },
];

describe("SessionModelPicker", () => {
  it("生效层级 badge 三态文案", () => {
    const { rerender } = render(
      <SessionModelPicker model="a" onModelChange={() => {}} layer="session" options={options} />,
    );
    expect(screen.getByTestId("session-layer-badge").textContent).toBe("会话临时");

    rerender(<SessionModelPicker model="a" onModelChange={() => {}} layer="au" options={options} />);
    expect(screen.getByTestId("session-layer-badge").textContent).toBe("本篇覆盖中");

    rerender(<SessionModelPicker model="a" onModelChange={() => {}} layer="global" options={options} />);
    expect(screen.getByTestId("session-layer-badge").textContent).toBe("全局默认");
  });

  it("下拉选项 = 生效供应商模型（带 ctx 缩写），选择触发 onModelChange", () => {
    const onModelChange = vi.fn();
    render(<SessionModelPicker model="deepseek-v4-flash" onModelChange={onModelChange} layer="global" options={options} />);

    const select = screen.getByLabelText("模型") as HTMLSelectElement;
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toContain("DeepSeek V4 Flash · 1M");
    fireEvent.change(select, { target: { value: "deepseek-pulled" } });
    expect(onModelChange).toHaveBeenCalledWith("deepseek-pulled");
  });

  it("手填切换：输入自由模型名；options 为空时直接呈现手填输入", () => {
    const onModelChange = vi.fn();
    const { rerender } = render(
      <SessionModelPicker model="deepseek-v4-flash" onModelChange={onModelChange} layer="global" options={options} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "手填" }));
    fireEvent.change(screen.getByPlaceholderText(/输入模型 id/), { target: { value: "my-model" } });
    expect(onModelChange).toHaveBeenCalledWith("my-model");

    // options 空（生效配置非 api 模式 / base 未匹配）→ 无下拉，直接手填
    rerender(<SessionModelPicker model="x" onModelChange={onModelChange} layer="global" options={[]} />);
    expect(screen.getByPlaceholderText(/输入模型 id/)).toBeTruthy();
    expect(screen.queryByLabelText("模型")).toBeNull();
  });
});
