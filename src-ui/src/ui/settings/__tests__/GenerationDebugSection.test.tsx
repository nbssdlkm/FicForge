// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * GenerationDebugSection 组件测试（开发者模式生成调试面板）。
 * 用引擎真实 debug capture 模块（纯内存，无 adapter 依赖）做端到端：
 * capture 进 → 面板列出 → 展开看详情 → 清空。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GenerationDebugSection } from "../GenerationDebugSection";
import { FeedbackProvider } from "../../../hooks/useFeedback";
import { captureDebugBundle, clearDebugBundles, setDebugCaptureEnabled } from "@ficforge/engine";
import { createGenerationDebugBundle } from "@ficforge/engine";

vi.mock("../../../i18n/useAppTranslation", async () =>
  (await import("../../../test/mocks/i18n")).mockUseAppTranslation(),
);

function renderSection() {
  return render(
    <FeedbackProvider>
      <GenerationDebugSection />
    </FeedbackProvider>,
  );
}

function seedBundle() {
  captureDebugBundle(
    createGenerationDebugBundle({
      path: "write",
      au_id: "au_hp",
      chapter_num: 3,
      model: "test-model",
      params: { max_tokens: 2000, temperature: 0.8, top_p: 0.95 },
      start_messages: [
        { role: "system", content: "系统提示内容" },
        { role: "user", content: "用户指令内容" },
      ],
      final_messages: [
        { role: "system", content: "系统提示内容" },
        { role: "user", content: "用户指令内容" },
      ],
      iterations: 1,
      result: { input_tokens: 100, output_tokens: 50, duration_ms: 1234, draft_label: "A" },
    }),
  );
}

describe("GenerationDebugSection", () => {
  beforeEach(() => {
    setDebugCaptureEnabled(true);
    clearDebugBundles();
  });

  it("空态：展开显示空提示", () => {
    renderSection();
    fireEvent.click(screen.getByText("settings.genDebug.title"));
    expect(screen.getByText("settings.genDebug.empty")).toBeTruthy();
  });

  it("有捕获：列表显示路径/AU/章节/模型/状态，展开显示 prompt 全文与预算表", () => {
    seedBundle();
    renderSection();
    fireEvent.click(screen.getByText("settings.genDebug.title"));

    // 列表行
    expect(screen.getByText("settings.genDebug.pathWrite")).toBeTruthy();
    expect(screen.getByText("au_hp · ch.3")).toBeTruthy();
    expect(screen.getByText("test-model")).toBeTruthy();
    expect(screen.getByText("settings.genDebug.statusOk")).toBeTruthy();

    // 展开详情
    fireEvent.click(screen.getByText("settings.genDebug.pathWrite"));
    expect(screen.getByText("系统提示内容")).toBeTruthy();
    expect(screen.getByText("用户指令内容")).toBeTruthy();
    expect(screen.getByText("settings.genDebug.budgetTitle")).toBeTruthy();
    expect(screen.getByText("1234 ms · A")).toBeTruthy();
    // 逐条复制按钮（spec 单条复制要求，实现审修复点）
    expect(screen.getAllByText("settings.genDebug.copyOne")).toHaveLength(2);
  });

  it("error bundle：状态标失败，展开显示错误码与消息", () => {
    captureDebugBundle(
      createGenerationDebugBundle({
        path: "chat",
        au_id: "au_x",
        chapter_num: 1,
        error: { code: "EMPTY_RESPONSE", message: "模型返回空响应" },
      }),
    );
    renderSection();
    fireEvent.click(screen.getByText("settings.genDebug.title"));
    expect(screen.getByText("settings.genDebug.statusError")).toBeTruthy();

    fireEvent.click(screen.getByText("settings.genDebug.pathChat"));
    expect(screen.getByText("EMPTY_RESPONSE")).toBeTruthy();
    expect(screen.getByText("模型返回空响应")).toBeTruthy();
    expect(screen.getByText("settings.genDebug.noBudget")).toBeTruthy();
  });

  it("多轮迭代：显示轮数徽标，start/final 分组都渲染", () => {
    captureDebugBundle(
      createGenerationDebugBundle({
        path: "chat",
        au_id: "au_x",
        chapter_num: 1,
        iterations: 2,
        start_messages: [{ role: "system", content: "sys" }],
        final_messages: [
          { role: "system", content: "sys" },
          { role: "assistant", content: "tool 交互" },
        ],
        result: { input_tokens: 1, output_tokens: 2, duration_ms: 10 },
      }),
    );
    renderSection();
    fireEvent.click(screen.getByText("settings.genDebug.title"));
    fireEvent.click(screen.getByText("settings.genDebug.pathChat"));
    expect(screen.getByText("settings.genDebug.messagesStart")).toBeTruthy();
    expect(screen.getByText("settings.genDebug.messagesFinal")).toBeTruthy();
    expect(screen.getByText("tool 交互")).toBeTruthy();
  });

  it("清空按钮：列表归零", () => {
    seedBundle();
    renderSection();
    fireEvent.click(screen.getByText("settings.genDebug.title"));
    expect(screen.queryByText("settings.genDebug.empty")).toBeNull();

    fireEvent.click(screen.getByText("settings.genDebug.clearAll"));
    expect(screen.getByText("settings.genDebug.empty")).toBeTruthy();
  });
});
