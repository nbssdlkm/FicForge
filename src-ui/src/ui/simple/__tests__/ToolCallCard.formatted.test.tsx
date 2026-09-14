// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * ToolCallCard 参数格式化渲染测试（2026-09-10 卡拉反馈：create_character_file 确认卡
 * 把 content 的 \n/##/** 以原始 JSON 转义形态糊成一坨，确认前没法审内容）。
 * 行为锁定：
 * - 多行/超长文本字段 → markdown 渲染（复用 SettingsMarkdown），无字面 \n；
 * - 短标量/数组 → 内联「字段名 + 值」；
 * - 超长字段默认折叠（max-h-60），展开后解除；
 * - 空参数对象不崩。
 */

import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToolCallCard } from "../messages/ToolCallCard";
import type { SimpleToolCallMessage } from "../types";

const { t } = vi.hoisted(() => ({
  t: vi.fn((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key),
}));

vi.mock("../../../i18n/useAppTranslation", () => ({
  useTranslation: () => ({ t }),
}));

const mkMessage = (tool_args: Record<string, unknown>): SimpleToolCallMessage => ({
  id: "m1",
  kind: "tool-call",
  timestamp: "2026-09-10T00:00:00Z",
  tool_name: "create_character_file",
  tool_args,
  status: "pending",
});

const noop = () => {};

const renderCard = (tool_args: Record<string, unknown>) =>
  render(
    <ToolCallCard message={mkMessage(tool_args)} globalBusy={false} onConfirm={noop} onSkip={noop} onUndo={noop} />,
  );

describe("ToolCallCard 参数格式化渲染", () => {
  test("多行 markdown 文本渲染出标题与加粗，无字面 \\n 残留", () => {
    const { container } = renderCard({
      name: "林夏",
      content: "# 林夏\n\n## 基本信息\n\n- 身份：研究生\n\n**严谨而有记录癖**",
    });
    expect(screen.getByRole("heading", { name: "林夏" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "基本信息" })).toBeInTheDocument();
    expect(screen.getByText("严谨而有记录癖").tagName).toBe("STRONG");
    expect(container.textContent).not.toContain("\\n");
  });

  test("短标量内联展示字段名与值；数组/对象保持 JSON 字面量", () => {
    const { container } = renderCard({ importance: "main", aliases: ["夏夏", "夏老师"] });
    expect(container.textContent).toContain("importance");
    expect(container.textContent).toContain("main");
    expect(container.textContent).toContain('["夏夏","夏老师"]');
  });

  test("超长文本默认折叠（max-h-60 + 展开按钮），点展开后解除折叠", () => {
    const { container } = renderCard({ content: "很长的一段设定。".repeat(80) });
    expect(container.querySelector(".max-h-60")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    expect(container.querySelector(".max-h-60")).toBeNull();
    expect(screen.getByRole("button", { name: "折叠" })).toBeInTheDocument();
  });

  test("短多行文本（不超过阈值）不折叠、无展开按钮", () => {
    renderCard({ content: "第一行\n第二行" });
    expect(screen.queryByRole("button", { name: "展开" })).toBeNull();
    expect(screen.getByText(/第一行/)).toBeInTheDocument();
  });

  test("空参数对象不渲染参区块、不崩", () => {
    const { container } = renderCard({});
    expect(container.textContent).toContain("create_character_file");
    expect(screen.getByRole("button", { name: "确认" })).toBeInTheDocument();
  });
});
