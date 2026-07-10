// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useState } from "react";
import {
  testConnection,
  testEmbeddingConnection,
  type TestConnectionResponse,
} from "../api/engine-client";
import { useActiveRequestGuard } from "./useActiveRequestGuard";
import { useTranslation } from "../i18n/useAppTranslation";
import { buildLlmConnectionTestRequest, type LlmConfigFields } from "../ui/shared/llm-config";

/**
 * testConnection 只回 error_code、不带 message 的失败分支（local / Ollama 探测），
 * 在此统一映射 i18n —— API 层不做 i18n，各调用方也不必逐个复刻映射。
 * code 值即 error_messages.* 的 key（unsupported_mode / connection_failed）。
 */
const TEST_CONNECTION_CODE_I18N: Record<string, string> = {
  unsupported_mode: "error_messages.unsupported_mode",
  connection_failed: "error_messages.connection_failed",
};

export type ConnectionTestStatus = "idle" | "testing" | "success" | "error";

export interface EmbeddingConnectionFields {
  model: string;
  apiBase: string;
  apiKey: string;
}

type EmbeddingConnectionResponse = {
  success: boolean;
  model?: string;
  message?: string;
  dimension?: number;
  warning_code?: "plaintext_http";
};

interface ConnectionTestOptions<TParams, TResult extends { success: boolean }> {
  runTest: (params: TParams) => Promise<TResult>;
  getSuccessMessage: (result: TResult, params: TParams) => string;
  getFailureMessage: (result: TResult, params: TParams) => string;
  getExceptionMessage: (error: unknown, params: TParams) => string;
}

function useConnectionTestState<TParams, TResult extends { success: boolean }>(
  options: ConnectionTestOptions<TParams, TResult>,
) {
  const requestGuard = useActiveRequestGuard("connection-test");
  const [status, setStatus] = useState<ConnectionTestStatus>("idle");
  const [message, setMessage] = useState("");

  const reset = useCallback(() => {
    requestGuard.start();
    setStatus("idle");
    setMessage("");
  }, [requestGuard]);

  const run = useCallback(async (params: TParams) => {
    const token = requestGuard.start();
    setStatus("testing");
    setMessage("");
    try {
      const result = await options.runTest(params);
      if (requestGuard.isStale(token)) return;
      if (result.success) {
        setStatus("success");
        setMessage(options.getSuccessMessage(result, params));
      } else {
        setStatus("error");
        setMessage(options.getFailureMessage(result, params));
      }
    } catch (error) {
      if (requestGuard.isStale(token)) return;
      setStatus("error");
      setMessage(options.getExceptionMessage(error, params));
    }
  }, [options, requestGuard]);

  return { status, message, reset, run };
}

export function useLlmConnectionTest(
  options: Omit<ConnectionTestOptions<LlmConfigFields, TestConnectionResponse>, "runTest">,
) {
  const { t } = useTranslation();
  return useConnectionTestState<LlmConfigFields, TestConnectionResponse>({
    ...options,
    runTest: (params) => testConnection(buildLlmConnectionTestRequest(params)),
    // 成功但有安全告警（明文 HTTP 远端）：在成功文案后追加告警句 —— 单点接管，
    // 各调用方（设置/引导/移动端）无需各自处理（盲审 2026-07-11 安全维）
    getSuccessMessage: (result, params) => {
      const base = options.getSuccessMessage(result, params);
      if (result.warning_code === "plaintext_http") {
        return `${base} ${t("error_messages.plaintext_http_warning")}`;
      }
      return base;
    },
    getFailureMessage: (result, params) => {
      if (!result.message && result.error_code && TEST_CONNECTION_CODE_I18N[result.error_code]) {
        return t(TEST_CONNECTION_CODE_I18N[result.error_code]);
      }
      return options.getFailureMessage(result, params);
    },
  });
}

export function useEmbeddingConnectionTest(
  options: Omit<ConnectionTestOptions<EmbeddingConnectionFields, EmbeddingConnectionResponse>, "runTest">,
) {
  const { t } = useTranslation();
  return useConnectionTestState<EmbeddingConnectionFields, EmbeddingConnectionResponse>({
    ...options,
    runTest: (params) => testEmbeddingConnection({
      api_base: params.apiBase,
      api_key: params.apiKey,
      model: params.model,
    }),
    // 与 LLM 侧同口径：明文 HTTP 远端 → 成功文案追加告警（B2 对抗审：embedding 通路补齐）
    getSuccessMessage: (result, params) => {
      const base = options.getSuccessMessage(result, params);
      if (result.warning_code === "plaintext_http") {
        return `${base} ${t("error_messages.plaintext_http_warning")}`;
      }
      return base;
    },
  });
}
