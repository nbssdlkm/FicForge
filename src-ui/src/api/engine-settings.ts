// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Settings — getSettings, updateSettings, testConnection.
 */

import { OpenAICompatibleProvider, RemoteEmbeddingProvider, type Settings } from "@ficforge/engine";
import { getEngine } from "./engine-client";
import { buildApiUrl } from "./client";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export async function getSettings() {
  const { settings } = getEngine().repos;
  const s = await settings.get();
  return s;
}

export async function updateSettings(updates: DeepPartial<Settings>) {
  const { settings } = getEngine().repos;
  const current = await settings.get();
  // 深合并嵌套对象，避免覆盖 app.theme 等未传入的字段
  const currentRec = current as unknown as Record<string, unknown>;
  const updatesRec = updates as Record<string, unknown>;
  for (const key of Object.keys(updatesRec)) {
    const val = updatesRec[key];
    if (val && typeof val === "object" && !Array.isArray(val) && typeof currentRec[key] === "object") {
      currentRec[key] = { ...(currentRec[key] as Record<string, unknown>), ...(val as Record<string, unknown>) };
    } else {
      currentRec[key] = val;
    }
  }
  await settings.save(current);
  return current;
}

export async function testEmbeddingConnection(params: { api_base: string; api_key: string; model: string }) {
  try {
    const provider = new RemoteEmbeddingProvider(params.api_base, params.api_key, params.model);
    await provider.embed(["connection test"]);
    return { success: true, model: params.model, dimension: provider.get_dimension() };
  } catch (e: unknown) {
    const err = e as { message?: string };
    return { success: false, message: err.message };
  }
}

export async function testConnection(params: { mode: string; model?: string; api_base?: string; api_key?: string; local_model_path?: string; ollama_model?: string }) {
  try {
    if (params.mode === "local") {
      // 本地模式：尝试连接 sidecar /health 端点（端口与 client.ts 一致）
      try {
        const healthUrl = buildApiUrl("/health");
        const resp = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) return { success: true, model: params.local_model_path ?? "local" };
        return { success: false, message: "Sidecar 无响应", error_code: "sidecar_unavailable" };
      } catch {
        return { success: false, message: "无法连接本地 Sidecar", error_code: "sidecar_unavailable" };
      }
    }
    if (params.mode === "ollama") {
      // Ollama 模式：尝试连接 Ollama API
      const base = params.api_base || "http://localhost:11434";
      const resp = await fetch(`${base}/api/tags`);
      if (resp.ok) {
        return { success: true, model: params.ollama_model ?? "ollama" };
      }
      return { success: false, message: "无法连接 Ollama 服务", error_code: "connection_failed" };
    }
    // API 模式：发送测试请求
    const provider = new OpenAICompatibleProvider(
      params.api_base ?? "",
      params.api_key ?? "",
      params.model ?? "",
    );
    const resp = await provider.generate({
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1,
      temperature: 0,
      top_p: 1,
    });
    return { success: true, model: resp.model };
  } catch (e: unknown) {
    const err = e as { message?: string; error_code?: string };
    return { success: false, message: err.message, error_code: err.error_code };
  }
}
