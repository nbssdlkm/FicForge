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
import { buildLlmConnectionTestRequest, type LlmConfigFields } from "../ui/shared/llm-config";

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
  return useConnectionTestState<LlmConfigFields, TestConnectionResponse>({
    ...options,
    runTest: (params) => testConnection(buildLlmConnectionTestRequest(params)),
  });
}

export function useEmbeddingConnectionTest(
  options: Omit<ConnectionTestOptions<EmbeddingConnectionFields, EmbeddingConnectionResponse>, "runTest">,
) {
  return useConnectionTestState<EmbeddingConnectionFields, EmbeddingConnectionResponse>({
    ...options,
    runTest: (params) => testEmbeddingConnection({
      api_base: params.apiBase,
      api_key: params.apiKey,
      model: params.model,
    }),
  });
}
