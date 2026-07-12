// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
//
// 真 LLM 探针共享配置读取（单一真相源）。
// 之前 3 个 probe 各自 hardcode `https://api.deepseek.com` + `deepseek-v4-flash`，
// 而 `~/.deepseek/config.toml` 已切到火山方舟（Volces Ark）网关：
//   base_url = https://ark.cn-beijing.volces.com/api/v3
//   flash_model = deepseek-v4-flash-260425   （官方 deepseek-chat 2026-07-24 停用）
// hardcode 与实际 key 归属的网关不一致会让探针直接 401/404。这里统一从 config.toml
// 读 base_url / flash_model / default_model / api_key，probe 只 import 不再各自解析。
//
// 环境变量覆盖（不改 config 也能临时切）：
//   DEEPSEEK_PROBE_BASE_URL / DEEPSEEK_PROBE_MODEL（等价旧 M8_PROBE_MODEL/M9_PROBE_MODEL）

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { OpenAICompatibleProvider } from "../llm/openai_compatible.js";

interface DeepseekProbeConfig {
  baseUrl: string;
  apiKey: string;
  flashModel: string;
  proModel: string;
}

function readField(toml: string, key: string): string | null {
  const m = toml.match(new RegExp(`${key}\\s*=\\s*"([^"]+)"`));
  return m ? m[1] : null;
}

/** 读 ~/.deepseek/config.toml，解析出探针要用的网关 / 模型 / key（单一真相源）。 */
export function loadDeepseekProbeConfig(): DeepseekProbeConfig {
  const toml = readFileSync(join(homedir(), ".deepseek", "config.toml"), "utf8");
  const apiKey = readField(toml, "api_key");
  if (!apiKey) throw new Error("~/.deepseek/config.toml 缺 api_key");
  // base_url 缺省回落官方 deepseek（老配置兼容）；flash/default 模型同理留缺省。
  const baseUrl = readField(toml, "base_url") ?? "https://api.deepseek.com";
  const flashModel = readField(toml, "flash_model") ?? "deepseek-v4-flash";
  const proModel = readField(toml, "default_model") ?? "deepseek-v4-pro";
  return { baseUrl, apiKey, flashModel, proModel };
}

/**
 * 构造探针用的 LLM provider。默认用 config 里的 flash_model（贴近用户出章场景）。
 * 优先级：显式 modelOverride > 环境变量 DEEPSEEK_PROBE_MODEL/legacyEnvVar > config.flash_model。
 * base_url 优先级：环境变量 DEEPSEEK_PROBE_BASE_URL > config.base_url。
 */
export function makeDeepseekProbeProvider(opts?: { modelOverride?: string; legacyEnvVar?: string }): {
  provider: OpenAICompatibleProvider;
  model: string;
  baseUrl: string;
} {
  const cfg = loadDeepseekProbeConfig();
  const baseUrl = process.env.DEEPSEEK_PROBE_BASE_URL || cfg.baseUrl;
  const model =
    opts?.modelOverride ||
    process.env.DEEPSEEK_PROBE_MODEL ||
    (opts?.legacyEnvVar ? process.env[opts.legacyEnvVar] : undefined) ||
    cfg.flashModel;
  return {
    provider: new OpenAICompatibleProvider(baseUrl, cfg.apiKey, model),
    model,
    baseUrl,
  };
}

/** 硅基流动 embedding key（bge-m3 用）。 */
export function siliconflowKey(): string {
  return readFileSync(join(homedir(), ".siliconflow", "api_key"), "utf8").trim();
}
