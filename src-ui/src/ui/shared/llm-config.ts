// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { DefaultLlmSettingsInput } from "../../api/engine-client";
import { DEFAULT_OLLAMA_BASE_URL } from "../../config/defaults";

export interface LlmConfigFields {
  mode: string;
  model: string;
  apiBase: string;
  apiKey: string;
  localModelPath: string;
  ollamaModel: string;
  /** 非标聊天补全路径（表单态；空 = 默认 /chat/completions）。 */
  chatPath?: string;
}

export function buildLlmConnectionTestRequest(fields: LlmConfigFields) {
  return {
    mode: fields.mode,
    model: fields.mode === "ollama" ? fields.ollamaModel : fields.model,
    api_base: fields.mode === "ollama" ? fields.apiBase || DEFAULT_OLLAMA_BASE_URL : fields.apiBase,
    api_key: fields.mode === "api" ? fields.apiKey : "",
    local_model_path: fields.mode === "local" ? fields.localModelPath : "",
    ollama_model: fields.mode === "ollama" ? fields.ollamaModel : "",
    // 测试连接与真实生成同 URL：自定义 chatPath 网关下不测默认路径（审计 5b）。
    // 归一化（trim / 空 → 缺省）在 API 层 testConnection 内做，与保存路径同源。
    ...(fields.mode === "api" && fields.chatPath ? { chat_path: fields.chatPath } : {}),
  };
}

export function canTestLlmConnection(fields: LlmConfigFields): boolean {
  if (fields.mode === "api") {
    return Boolean(fields.apiKey.trim());
  }
  if (fields.mode === "local") {
    return Boolean(fields.localModelPath.trim());
  }
  if (fields.mode === "ollama") {
    return Boolean(fields.ollamaModel.trim());
  }
  return false;
}

export function buildDefaultLlmSettingsInput(
  fields: LlmConfigFields,
  /** 缺省 = 窗口未知（引擎按模型推断），不补 UI 默认值。 */
  contextWindow?: number,
): DefaultLlmSettingsInput {
  return {
    mode: fields.mode,
    model: fields.mode === "api" ? fields.model : "",
    api_base: fields.apiBase,
    api_key: fields.mode === "api" ? fields.apiKey : "",
    local_model_path: fields.mode === "local" ? fields.localModelPath : "",
    ollama_model: fields.mode === "ollama" ? fields.ollamaModel : "",
    ...(contextWindow !== undefined ? { context_window: contextWindow } : {}),
    ...(fields.mode === "api" && fields.chatPath ? { chat_path: fields.chatPath } : {}),
  };
}

/**
 * 表单态 ctx（字符串；"" = 未知）→ 保存入参（number | undefined）。
 * 单一真相源：GlobalSettings / AU 覆盖 / 引导页 共用同一转换，禁各处手写 parseInt || 默认。
 */
export function formCtxToSaveInput(value: string): number | undefined {
  const n = parseInt(value.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * 持久层 ctx（number；0/undefined = 未知哨兵）→ 表单态字符串（"" = 未知）。
 * 与 formCtxToSaveInput 构成 round-trip 闭环：写 0/空 → 读回仍空。
 */
export function persistedCtxToForm(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? String(value) : "";
}
