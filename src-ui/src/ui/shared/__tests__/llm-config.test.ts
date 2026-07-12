// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * llm-config 构建/转换辅助：
 *   - buildLlmConnectionTestRequest 的 chat_path 接线（R2-2：仅 api 模式携带）
 *   - buildDefaultLlmSettingsInput 的 ctx/chat_path 省略语义（R2-3/R2-7）
 *   - formCtxToSaveInput / persistedCtxToForm 对称闭环（R2-3 单一真相源）
 */

import { describe, expect, it } from "vitest";
import {
  buildDefaultLlmSettingsInput,
  buildLlmConnectionTestRequest,
  formCtxToSaveInput,
  persistedCtxToForm,
  type LlmConfigFields,
} from "../llm-config";

const apiFields: LlmConfigFields = {
  mode: "api",
  model: "m",
  apiBase: "https://gw.example/v1",
  apiKey: "sk-x",
  localModelPath: "",
  ollamaModel: "",
  chatPath: "/relay/chat",
};

describe("buildLlmConnectionTestRequest — chat_path 接线", () => {
  it("api 模式且 chatPath 非空 → 请求带 chat_path", () => {
    expect(buildLlmConnectionTestRequest(apiFields).chat_path).toBe("/relay/chat");
  });

  it("chatPath 空 → 不带 chat_path 字段（回退默认路径）", () => {
    expect("chat_path" in buildLlmConnectionTestRequest({ ...apiFields, chatPath: "" })).toBe(false);
  });

  it("非 api 模式（ollama）→ 不带 chat_path（其端点恒为标准路径）", () => {
    const req = buildLlmConnectionTestRequest({ ...apiFields, mode: "ollama", ollamaModel: "llama3" });
    expect("chat_path" in req).toBe(false);
  });
});

describe("buildDefaultLlmSettingsInput — ctx / chat_path 省略语义", () => {
  it("ctx 缺省 → 省略 context_window；chatPath 带上", () => {
    const input = buildDefaultLlmSettingsInput(apiFields, undefined);
    expect("context_window" in input).toBe(false);
    expect(input.chat_path).toBe("/relay/chat");
  });

  it("ctx 显式 → 写入 context_window", () => {
    expect(buildDefaultLlmSettingsInput(apiFields, 131072).context_window).toBe(131072);
  });
});

describe("formCtxToSaveInput / persistedCtxToForm — 对称闭环", () => {
  it("表单 → 保存：正数解析、空/0/负数/非数字 → undefined", () => {
    expect(formCtxToSaveInput("131072")).toBe(131072);
    expect(formCtxToSaveInput(" 128000 ")).toBe(128000);
    for (const bad of ["", "0", "-5", "abc", "  "]) {
      expect(formCtxToSaveInput(bad)).toBeUndefined();
    }
  });

  it('持久层 → 表单：正数字符串化、0/undefined → ""', () => {
    expect(persistedCtxToForm(131072)).toBe("131072");
    expect(persistedCtxToForm(0)).toBe("");
    expect(persistedCtxToForm(undefined)).toBe("");
  });

  it("round-trip：form → persisted → form 不漂移", () => {
    for (const v of ["", "131072", "0"]) {
      const persisted = formCtxToSaveInput(v) ?? 0;
      expect(persistedCtxToForm(persisted)).toBe(v === "0" ? "" : v);
    }
  });
});
