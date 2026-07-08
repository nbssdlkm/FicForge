// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * ctx=0 哨兵写读对称（审计鲜眼 R2-3）：
 *   持久层 0/undefined（= 按模型推断）↔ 表单 ""（窗口未知）双向映射，
 *   逐环 round-trip：hydrate → build → API save → 引擎读回 → hydrate 仍为空，
 *   不再被 `|| DEFAULT_CONTEXT_WINDOW` 吞成 128000 回显并固化。
 *   同时保证存量用户的显式 128000 原样保留。
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { ProjectInfo, SettingsInfo } from "../../../api/engine-client";
import {
  buildAuSettingsSaveInput,
  buildGlobalSettingsSaveInput,
  createDefaultAuSettingsFormState,
  hydrateAuSettingsForm,
  hydrateGlobalSettingsForm,
} from "../form-mappers";
import { initEngine } from "../../../api/engine-instance";
import { getSettingsForEditing, saveGlobalSettingsForEditing } from "../../../api/engine-settings";
import { MockAdapter } from "../../../../../src-engine/repositories/__tests__/mock_adapter.js";

function settingsWithCtx(context_window: number | undefined): SettingsInfo {
  return {
    default_llm: { mode: "api", model: "m", api_base: "https://api/v1", ...(context_window !== undefined ? { context_window } : {}) },
    model_params: {},
  } as unknown as SettingsInfo;
}

describe("form-mappers ctx — hydrate（持久层 → 表单）", () => {
  it("0 哨兵 → \"\"（窗口未知，不补 128000）", () => {
    expect(hydrateGlobalSettingsForm(settingsWithCtx(0)).contextWindow).toBe("");
  });

  it("undefined → \"\"", () => {
    expect(hydrateGlobalSettingsForm(settingsWithCtx(undefined)).contextWindow).toBe("");
  });

  it("显式 128000（存量用户）→ \"128000\" 原样回显", () => {
    expect(hydrateGlobalSettingsForm(settingsWithCtx(128000)).contextWindow).toBe("128000");
  });
});

describe("form-mappers ctx — build（表单 → 保存入参）", () => {
  it("\"\" → 省略 context_window（引擎按模型推断）", () => {
    const form = hydrateGlobalSettingsForm(settingsWithCtx(0));
    expect("context_window" in buildGlobalSettingsSaveInput(form).default_llm).toBe(false);
  });

  it("\"128000\" → 128000（显式值不动）", () => {
    const form = hydrateGlobalSettingsForm(settingsWithCtx(128000));
    expect(buildGlobalSettingsSaveInput(form).default_llm.context_window).toBe(128000);
  });

  it("非法输入（非正数 / 非数字）→ 一律视为未知省略", () => {
    const form = hydrateGlobalSettingsForm(settingsWithCtx(128000));
    for (const bad of ["0", "-5", "abc", "   "]) {
      form.contextWindow = bad;
      expect("context_window" in buildGlobalSettingsSaveInput(form).default_llm).toBe(false);
    }
  });
});

describe("form-mappers ctx — AU 覆盖同链", () => {
  function projectWithCtx(context_window: number | undefined): ProjectInfo {
    return {
      llm: { mode: "api", model: "m", api_base: "https://au/v1", ...(context_window !== undefined ? { context_window } : {}) },
      writing_style: {},
      chapter_length: 2000,
      pinned_context: [],
      core_always_include: [],
      embedding_lock: {},
    } as unknown as ProjectInfo;
  }

  it("hydrate：0 哨兵 → \"\"；显式值原样", () => {
    expect(hydrateAuSettingsForm(projectWithCtx(0)).contextWindow).toBe("");
    expect(hydrateAuSettingsForm(projectWithCtx(64000)).contextWindow).toBe("64000");
  });

  it("build：\"\" → 省略；显式值写回", () => {
    const empty = createDefaultAuSettingsFormState();
    empty.isLlmOverride = true;
    expect("context_window" in buildAuSettingsSaveInput(empty).llm_override).toBe(false);

    const explicit = hydrateAuSettingsForm(projectWithCtx(64000));
    expect(buildAuSettingsSaveInput(explicit).llm_override.context_window).toBe(64000);
  });
});

describe("ctx 全链 round-trip（表单 → API 落盘 → 引擎读回 → 表单）", () => {
  beforeEach(async () => {
    initEngine(new MockAdapter(), "");
    await getSettingsForEditing();
  });

  it("写「未知」（省略）→ 引擎存 0 哨兵 → 读回 hydrate 仍为空", async () => {
    const form = hydrateGlobalSettingsForm(settingsWithCtx(0));
    await saveGlobalSettingsForEditing(buildGlobalSettingsSaveInput(form));

    const persisted = await getSettingsForEditing();
    expect(persisted.default_llm.context_window || 0).toBe(0);
    expect(hydrateGlobalSettingsForm(persisted as unknown as SettingsInfo).contextWindow).toBe("");
  });

  it("写显式 131072 → 读回仍 131072（存量显式值不受哨兵链影响）", async () => {
    const form = hydrateGlobalSettingsForm(settingsWithCtx(131072));
    await saveGlobalSettingsForEditing(buildGlobalSettingsSaveInput(form));

    const persisted = await getSettingsForEditing();
    expect(persisted.default_llm.context_window).toBe(131072);
    expect(hydrateGlobalSettingsForm(persisted as unknown as SettingsInfo).contextWindow).toBe("131072");
  });
});
