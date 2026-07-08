// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSessionParams } from "../useSessionParams";
import type { WriterProjectContext, WriterSessionConfig } from "../../../api/engine-client";

// ---------------------------------------------------------------------------
// F-1（第三波对抗审）：sessionLlmPayload.model 必须发会话层 sessionModel。
// 旧实现发 getConfiguredLlmModel(source) 优先 → 用户在会话下拉选的模型永远不生效，
// 而 badge（resolveSessionLayer）却显示「会话临时」—— payload 与 badge 口径分裂。
// ---------------------------------------------------------------------------

const AU_PATH = "/data/fandoms/F/aus/A1";

function makeSettingsInfo(): WriterSessionConfig {
  return {
    default_llm: {
      mode: "api",
      model: "deepseek-chat",
      api_base: "https://api.deepseek.com",
      has_api_key: true,
    },
    model_params: {},
    catalog: { custom_providers: [], enabled_models: {} },
  } as unknown as WriterSessionConfig;
}

function makeProjectInfo(overrides?: Partial<{ llm: Record<string, unknown> }>): WriterProjectContext {
  return {
    llm: { has_override: false },
    model_params_override: {},
    ...overrides,
  } as unknown as WriterProjectContext;
}

function renderParams(projectInfo: WriterProjectContext, settingsInfo: WriterSessionConfig) {
  return renderHook(() => useSessionParams(AU_PATH, projectInfo, settingsInfo, vi.fn(), vi.fn()));
}

describe("useSessionParams — sessionLlmPayload（F-1）", () => {
  it("未改会话模型（默认镜像配置层）→ payload.model = 配置模型（等价路径不回归）", () => {
    const { result } = renderParams(makeProjectInfo(), makeSettingsInfo());

    // bootstrap 派生效应把 sessionModel 镜像到配置层模型
    expect(result.current.sessionModel).toBe("deepseek-chat");
    expect(result.current.sessionLlmPayload).toMatchObject({
      mode: "api",
      model: "deepseek-chat",
      api_base: "https://api.deepseek.com",
    });
    expect(result.current.sessionLayer).toBe("global");
  });

  it("用户改了会话模型 → payload.model = 会话模型（与「会话临时」badge 同口径），连接字段仍取配置层", () => {
    const { result } = renderParams(makeProjectInfo(), makeSettingsInfo());

    act(() => {
      result.current.setSessionModel("deepseek-v4-pro");
    });

    expect(result.current.sessionLlmPayload?.model).toBe("deepseek-v4-pro");
    // api_base / mode 仍来自配置层（会话只换模型，不换连接）
    expect(result.current.sessionLlmPayload?.api_base).toBe("https://api.deepseek.com");
    expect(result.current.sessionLlmPayload?.mode).toBe("api");
    // badge 判「会话临时」—— payload 与 badge 必须同口径
    expect(result.current.sessionLayer).toBe("session");
  });

  it("AU 覆盖生效时：默认 payload.model = AU 配置模型；会话改动后 = 会话模型且沿用 AU 连接", () => {
    const projectInfo = makeProjectInfo({
      llm: {
        has_override: true,
        mode: "api",
        model: "glm-4.7",
        api_base: "https://open.bigmodel.cn/api/paas/v4",
      },
    });
    const { result } = renderParams(projectInfo, makeSettingsInfo());

    expect(result.current.sessionModel).toBe("glm-4.7");
    expect(result.current.sessionLlmPayload).toMatchObject({
      model: "glm-4.7",
      api_base: "https://open.bigmodel.cn/api/paas/v4",
    });
    expect(result.current.sessionLayer).toBe("au");

    act(() => {
      result.current.setSessionModel("glm-4.7-air");
    });
    expect(result.current.sessionLlmPayload).toMatchObject({
      model: "glm-4.7-air",
      api_base: "https://open.bigmodel.cn/api/paas/v4",
    });
    expect(result.current.sessionLayer).toBe("session");
  });

  it("sessionModel 为空 → payload 为 null（守卫不受影响）", () => {
    const { result } = renderParams(makeProjectInfo(), makeSettingsInfo());
    act(() => {
      result.current.setSessionModel("");
    });
    expect(result.current.sessionLlmPayload).toBeNull();
  });
});
