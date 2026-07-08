// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * chat_path（自定义供应商非标聊天路径）在 form-mappers 的双向映射：
 *   hydrate*  —— 从持久化视图读出 chat_path 进表单态（chatPath）
 *   build*    —— 从表单态写回 save input 的 chat_path
 * 覆盖全局默认 + AU 覆盖两条路径。判别性：缺省场景不凭空造值。
 */

import { describe, expect, it } from "vitest";
import type { ProjectInfo, SettingsInfo } from "../../../api/engine-client";
import {
  buildAuSettingsSaveInput,
  buildGlobalSettingsSaveInput,
  createDefaultAuSettingsFormState,
  createDefaultGlobalSettingsFormState,
  hydrateAuSettingsForm,
  hydrateGlobalSettingsForm,
} from "../form-mappers";

describe("form-mappers chat_path — 全局默认（global）", () => {
  it("hydrate：settings.default_llm.chat_path 读进 form.chatPath", () => {
    const settings = {
      default_llm: { mode: "api", model: "m", api_base: "https://gw/v1", chat_path: "/openai/v1/chat" },
      model_params: {},
    } as unknown as SettingsInfo;
    const form = hydrateGlobalSettingsForm(settings);
    expect(form.chatPath).toBe("/openai/v1/chat");
  });

  it("hydrate：缺 chat_path → form.chatPath 为空串（不造默认路径）", () => {
    const settings = {
      default_llm: { mode: "api", model: "m", api_base: "https://api/v1" },
      model_params: {},
    } as unknown as SettingsInfo;
    expect(hydrateGlobalSettingsForm(settings).chatPath).toBe("");
  });

  it("build：form.chatPath 写回 default_llm.chat_path", () => {
    const form = createDefaultGlobalSettingsFormState();
    form.chatPath = "/gateway/completions";
    expect(buildGlobalSettingsSaveInput(form).default_llm.chat_path).toBe("/gateway/completions");
  });

  it("round-trip：hydrate → build 保持 chat_path 一致", () => {
    const settings = {
      default_llm: { mode: "api", model: "m", api_base: "https://gw/v1", chat_path: "/relay/chat" },
      model_params: {},
    } as unknown as SettingsInfo;
    const form = hydrateGlobalSettingsForm(settings);
    expect(buildGlobalSettingsSaveInput(form).default_llm.chat_path).toBe("/relay/chat");
  });
});

describe("form-mappers chat_path — AU 覆盖（au override）", () => {
  function projectWithLlm(llm: Record<string, unknown>): ProjectInfo {
    return {
      llm,
      writing_style: {},
      chapter_length: 2000,
      pinned_context: [],
      core_always_include: [],
      embedding_lock: {},
    } as unknown as ProjectInfo;
  }

  it("hydrate：project.llm.chat_path 读进 form.chatPath，且识别为覆盖开启", () => {
    const form = hydrateAuSettingsForm(projectWithLlm({ mode: "api", model: "m", chat_path: "/au/chat" }));
    expect(form.chatPath).toBe("/au/chat");
    expect(form.isLlmOverride).toBe(true);
  });

  it("hydrate：只设了 chat_path（其余沿用全局）也算覆盖开启", () => {
    // model / api_base 都空，仅 chat_path 非空 —— 覆盖检测须把 chat_path 计入真值。
    const form = hydrateAuSettingsForm(projectWithLlm({ mode: "api", model: "", api_base: "", chat_path: "/only/path" }));
    expect(form.isLlmOverride).toBe(true);
    expect(form.chatPath).toBe("/only/path");
  });

  it("hydrate：无 llm 覆盖 → chatPath 走默认空串", () => {
    const form = hydrateAuSettingsForm(projectWithLlm({ mode: "api", model: "", api_base: "" }));
    expect(form.isLlmOverride).toBe(false);
    expect(form.chatPath).toBe("");
  });

  it("build：form.chatPath 写回 llm_override.chat_path", () => {
    const form = createDefaultAuSettingsFormState();
    form.isLlmOverride = true;
    form.chatPath = "/au/gateway/chat";
    expect(buildAuSettingsSaveInput(form).llm_override.chat_path).toBe("/au/gateway/chat");
  });

  it("round-trip：hydrate → build 保持 AU chat_path 一致", () => {
    const form = hydrateAuSettingsForm(projectWithLlm({ mode: "api", model: "m", chat_path: "/rt/chat" }));
    expect(buildAuSettingsSaveInput(form).llm_override.chat_path).toBe("/rt/chat");
  });
});
