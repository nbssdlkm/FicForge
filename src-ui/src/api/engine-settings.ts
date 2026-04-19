// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Settings — getSettings, updateSettings, testConnection.
 */

import { OpenAICompatibleProvider, RemoteEmbeddingProvider, type Settings } from "@ficforge/engine";
import { getEngine } from "./engine-instance";

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
      // local 模式的续写生成需要 Python sidecar 扩展，当前版本未实现
      // （见 engine-generate.ts 的 UNSUPPORTED_MODE 拦截）。
      // 即使 sidecar /health 存活，实际生成仍会抛错 —— 为避免"测试成功、使用报错"
      // 的断层，这里和 create_provider 的行为保持一致。
      return {
        success: false,
        message: "local 模式续写生成暂未实现（需要 Python sidecar 扩展）",
        error_code: "mode_not_implemented",
      };
    }
    if (params.mode === "ollama") {
      // /api/tags 是 Ollama 原生端点，不在 OpenAI 兼容层 /v1 子路径下。
      // 若 api_base 按新约定带了 /v1，strip 掉再拼 /api/tags。
      const raw = (params.api_base || "http://localhost:11434/v1").replace(/\/+$/, "");
      const nativeBase = raw.replace(/\/v1$/, "");
      const resp = await fetch(`${nativeBase}/api/tags`);
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
