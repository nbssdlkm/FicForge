// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { create_provider, resolve_llm_config, resolve_llm_params } from "../config_resolver.js";
import { OpenAICompatibleProvider } from "../openai_compatible.js";

describe("resolve_llm_config", () => {
  it("session_llm takes priority", () => {
    const result = resolve_llm_config(
      { mode: "api", model: "session-model", api_base: "http://session", api_key: "sk-session" },
      { llm: { mode: "api", model: "project-model", api_base: "http://project", api_key: "sk-project" } },
      { default_llm: { mode: "api", model: "settings-model", api_base: "http://settings", api_key: "sk-settings" } },
    );
    expect(result.model).toBe("session-model");
    expect(result.api_key).toBe("sk-session");
  });

  it("falls to project.llm when no session", () => {
    const result = resolve_llm_config(
      null,
      { llm: { mode: "api", model: "project-model", api_base: "http://project", api_key: "sk-project" } },
      { default_llm: { mode: "api", model: "settings-model" } },
    );
    expect(result.model).toBe("project-model");
  });

  it("falls to settings.default_llm when no session or project", () => {
    const result = resolve_llm_config(
      null,
      { llm: { mode: "api", model: "" } },
      { default_llm: { mode: "api", model: "settings-model", api_key: "sk-settings" } },
    );
    expect(result.model).toBe("settings-model");
  });

  it("masked api_key falls back to settings when the endpoint matches（同源，含尾斜杠/大小写归一）", () => {
    const result = resolve_llm_config(
      { mode: "api", model: "m", api_base: "http://x", api_key: "****xxxx" },
      {},
      { default_llm: { api_base: "HTTP://X/", api_key: "sk-real-key" } },
    );
    expect(result.api_key).toBe("sk-real-key");
  });

  // --- AU api_key override on the writer path (session_llm carries no key) ---

  it("session w/ no key + AU override has its own key → uses the AU key, not global", () => {
    // Mirrors the writer path: sessionLlmPayload sends the AU model/api_base but
    // strips api_key; the AU points at its own provider (own api_base + own key).
    // Must authenticate with the AU key, else requests hit the AU base with the
    // global key → 401 (the bug this fixes).
    const result = resolve_llm_config(
      { mode: "api", model: "au-model", api_base: "https://au.provider/v1" },
      { llm: { mode: "api", model: "au-model", api_base: "https://au.provider/v1", api_key: "sk-AU" } },
      { default_llm: { mode: "api", model: "g", api_base: "https://global/v1", api_key: "sk-GLOBAL" } },
    );
    expect(result.api_base).toBe("https://au.provider/v1");
    expect(result.api_key).toBe("sk-AU");
  });

  it("session w/ no key + AU override has NO key → falls back to the global key", () => {
    // Model-only / no-key override: the AU reuses the global account, so the
    // global key is correct.
    const result = resolve_llm_config(
      { mode: "api", model: "au-model", api_base: "" },
      { llm: { mode: "api", model: "au-model", api_base: "", api_key: "" } },
      { default_llm: { mode: "api", model: "g", api_base: "", api_key: "sk-GLOBAL" } },
    );
    expect(result.api_key).toBe("sk-GLOBAL");
  });

  it("session w/ no key + AU key 为占位符且 AU 端点 ≠ 全局端点 → 拒绝跨源回填全局 key（盲审 R3 HIGH-2）", () => {
    // 修前此场景回填 sk-GLOBAL —— 即全局密钥被发往 au.provider（泄漏形状本身）。
    // 修后宁缺勿漏：留空让下游按「未配置密钥」失败，用户为该端点显式配 key。
    const result = resolve_llm_config(
      { mode: "api", model: "au-model", api_base: "https://au.provider/v1" },
      { llm: { mode: "api", model: "au-model", api_base: "https://au.provider/v1", api_key: "<secure>" } },
      { default_llm: { mode: "api", model: "g", api_base: "", api_key: "sk-GLOBAL" } },
    );
    expect(result.api_key).toBe("");
  });

  // --- 同源门（盲审 R3 HIGH-2：恶意 bundle 泄漏全局 key）---

  it("恶意 bundle 攻击面回归：project 层带陌生 api_base + 占位 key → 全局 key 不回填", () => {
    // 攻击构造：导入的 AU 的 project.yaml 填 model 非空 + 攻击者 https 端点 + <secure>
    // 占位 key（keystore 无 per-AU 条目）。修前：isMasked → 回退全局 key →
    // Authorization: Bearer <全局密钥> 发往攻击者主机，https 下全程无告警。
    const result = resolve_llm_config(
      null,
      { llm: { mode: "api", model: "deepseek-chat", api_base: "https://attacker.example/v1", api_key: "<secure>" } },
      {
        default_llm: {
          mode: "api",
          model: "deepseek-chat",
          api_base: "https://api.deepseek.com",
          api_key: "sk-GLOBAL",
        },
      },
    );
    expect(result.api_base).toBe("https://attacker.example/v1");
    expect(result.api_key).toBe("");
  });

  it("project 层同端点 model-only 覆盖：全局 key 正常回填（同源允许，归一化判等）", () => {
    const result = resolve_llm_config(
      null,
      { llm: { mode: "api", model: "deepseek-reasoner", api_base: "HTTPS://API.deepseek.com/", api_key: "" } },
      {
        default_llm: {
          mode: "api",
          model: "deepseek-chat",
          api_base: "https://api.deepseek.com",
          api_key: "sk-GLOBAL",
        },
      },
    );
    expect(result.api_key).toBe("sk-GLOBAL");
  });

  it("session 指向全局端点时不误借 AU key（同源门双向：修 401 误配，也堵反向渗漏）", () => {
    const result = resolve_llm_config(
      { mode: "api", model: "g", api_base: "https://global/v1" },
      { llm: { mode: "api", model: "au-model", api_base: "https://au.provider/v1", api_key: "sk-AU" } },
      { default_llm: { mode: "api", model: "g", api_base: "https://global/v1", api_key: "sk-GLOBAL" } },
    );
    expect(result.api_key).toBe("sk-GLOBAL");
  });

  // --- chat_path 宿主注入（盲审 R3 HIGH-2 对抗审：同源门盲区）---

  it("宿主注入 chat_path（协议相对 //host）被拒，不带出 resolve 结果", () => {
    const result = resolve_llm_config(
      null,
      {
        llm: {
          mode: "api",
          model: "m",
          api_base: "https://api.deepseek.com",
          api_key: "sk-x",
          chat_path: "//attacker.example/v1/chat/completions",
        },
      },
      { default_llm: {} },
    );
    expect(result.chat_path).toBeUndefined();
  });

  it("绝对 URL / 反斜杠形态的 chat_path 一律被拒", () => {
    for (const bad of [
      "https://attacker/v1/chat",
      "http://x/y",
      "\\\\attacker\\path",
      "path\\with\\backslash",
      "x://y",
    ]) {
      const r = resolve_llm_config(
        null,
        { llm: { mode: "api", model: "m", api_base: "https://ok.example", api_key: "k", chat_path: bad } },
        { default_llm: {} },
      );
      expect(r.chat_path, `should reject ${bad}`).toBeUndefined();
    }
  });

  it("合法路径段 chat_path 正常带出（回归：自定义网关路径不误伤）", () => {
    const result = resolve_llm_config(
      null,
      { llm: { mode: "api", model: "m", api_base: "https://gw.example", api_key: "k", chat_path: "/custom/v1/chat" } },
      { default_llm: {} },
    );
    expect(result.chat_path).toBe("/custom/v1/chat");
  });
});

describe("resolve_llm_params", () => {
  it("session_params takes priority", () => {
    const result = resolve_llm_params("gpt-4o", { temperature: 0.5, top_p: 0.8 }, {}, {});
    expect(result.temperature).toBe(0.5);
    expect(result.top_p).toBe(0.8);
  });

  it("falls to project override", () => {
    const result = resolve_llm_params(
      "gpt-4o",
      null,
      { model_params_override: { "gpt-4o": { temperature: 0.7, top_p: 0.9 } } },
      {},
    );
    expect(result.temperature).toBe(0.7);
  });

  it("falls to settings model_params", () => {
    const result = resolve_llm_params(
      "gpt-4o",
      null,
      {},
      { model_params: { "gpt-4o": { temperature: 0.6, top_p: 0.85 } } },
    );
    expect(result.temperature).toBe(0.6);
  });

  it("falls to defaults", () => {
    const result = resolve_llm_params("unknown", null, {}, {});
    expect(result.temperature).toBe(1.0);
    expect(result.top_p).toBe(0.95);
  });
});

// ---------------------------------------------------------------------------
// create_provider —— P1-5a 真正支持 ollama
// ---------------------------------------------------------------------------

describe("create_provider", () => {
  it("mode=api 返回 OpenAICompatibleProvider", () => {
    const p = create_provider({
      mode: "api",
      model: "gpt-4o",
      api_base: "https://api.openai.com/v1",
      api_key: "sk-x",
    });
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it("mode=api 空 api_base 抛错（堵死相对 URL / 协议相对 chat_path 外泄链——盲审 R3 HIGH-2）", () => {
    expect(() => create_provider({ mode: "api", model: "m", api_base: "", api_key: "sk-x" })).toThrow(/api_base/);
    expect(() =>
      create_provider({ mode: "api", model: "m", api_base: "   ", api_key: "sk-x", chat_path: "//attacker/v1" }),
    ).toThrow(/api_base/);
  });

  it("mode=ollama 走 OpenAI 兼容协议（默认 base = localhost:11434/v1）", () => {
    const p = create_provider({
      mode: "ollama",
      model: "",
      api_base: "",
      api_key: "",
      ollama_model: "llama3",
    });
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it("mode=ollama 缺 ollama_model 抛错（引擎级护栏）", () => {
    expect(() => create_provider({ mode: "ollama", model: "", api_base: "", api_key: "" })).toThrow(/ollama_model/i);
  });

  it("mode=local 抛错（sidecar 退役后本版本不支持）", () => {
    expect(() => create_provider({ mode: "local", model: "", api_base: "", api_key: "" })).toThrow(
      /不支持.*local|local.*不支持|本地模型|not.*implemented/i,
    );
  });

  it("未知 mode 抛错", () => {
    expect(() => create_provider({ mode: "anthropic-native", model: "m", api_base: "", api_key: "" })).toThrow(/mode/i);
  });
});

describe("resolve_llm_config — context_window 同层同源（审计 H4）", () => {
  it("project 层胜出：取 project.llm 的手动 context_window", () => {
    const r = resolve_llm_config(
      null,
      { llm: { mode: "api", model: "m-proj", context_window: 64_000 } },
      { default_llm: { mode: "api", model: "m-set", context_window: 128_000 } },
    );
    expect(r.model).toBe("m-proj");
    expect(r.context_window).toBe(64_000);
  });

  it("settings 层胜出（主流配置：全局默认 + AU 无覆盖）：取 default_llm 的手动窗口", () => {
    const r = resolve_llm_config(
      null,
      { llm: { mode: "api", model: "" } },
      { default_llm: { mode: "api", model: "m-set", context_window: 131_072 } },
    );
    expect(r.model).toBe("m-set");
    expect(r.context_window).toBe(131_072);
  });

  it("session 显式带 context_window（字符串形态）：直接生效", () => {
    const r = resolve_llm_config(
      { mode: "api", model: "m-sess", context_window: "200000" },
      { llm: { mode: "api", model: "m-proj", context_window: 64_000 } },
      { default_llm: {} },
    );
    expect(r.context_window).toBe(200_000);
  });

  it("session 不带窗口但模型 + api_base 与 settings 配置一致：继承该层手动窗口", () => {
    const r = resolve_llm_config(
      { mode: "api", model: "m-set", api_base: "http://x" },
      { llm: { mode: "api", model: "" } },
      { default_llm: { mode: "api", model: "m-set", api_base: "http://x", context_window: 131_072 } },
    );
    expect(r.context_window).toBe(131_072);
  });

  it("api_base 归一化：尾斜杠 / host 大小写差异不阻断继承", () => {
    const r = resolve_llm_config(
      { mode: "api", model: "m-set", api_base: "https://API.Gateway.example/v1/" },
      { llm: { mode: "api", model: "" } },
      {
        default_llm: {
          mode: "api",
          model: "m-set",
          api_base: "https://api.gateway.example/v1",
          context_window: 131_072,
        },
      },
    );
    expect(r.context_window).toBe(131_072);
  });

  it("双方 api_base 都为空（如 Ollama 默认端点）：视为同一端点，正常继承", () => {
    const r = resolve_llm_config(
      { mode: "ollama", model: "llama3", api_base: "" },
      { llm: { mode: "api", model: "" } },
      { default_llm: { mode: "ollama", model: "", ollama_model: "llama3", api_base: "", context_window: 8_192 } },
    );
    expect(r.context_window).toBe(8_192);
  });

  it("session 模型与任何层都不一致：不继承（undefined 交给映射表推断）", () => {
    const r = resolve_llm_config(
      { mode: "api", model: "another-model" },
      { llm: { mode: "api", model: "m-proj", context_window: 64_000 } },
      { default_llm: { mode: "api", model: "m-set", context_window: 131_072 } },
    );
    expect(r.context_window).toBeUndefined();
  });

  it("context_window = 0 是「自动推断」哨兵：视同未指定", () => {
    const r = resolve_llm_config(
      null,
      { llm: { mode: "api", model: "m-proj", context_window: 0 } },
      { default_llm: {} },
    );
    expect(r.context_window).toBeUndefined();
  });
});

describe("resolve_llm_config — chat_path 同层同源（仿 H4 context_window）", () => {
  it("project 层胜出：取 project.llm 的 chat_path，不串 settings 层", () => {
    const r = resolve_llm_config(
      null,
      { llm: { mode: "api", model: "m-proj", chat_path: "/proj/chat" } },
      { default_llm: { mode: "api", model: "m-set", chat_path: "/set/chat" } },
    );
    expect(r.model).toBe("m-proj");
    expect(r.chat_path).toBe("/proj/chat");
  });

  it("settings 层胜出（全局默认 + AU 无覆盖）：取 default_llm 的 chat_path", () => {
    const r = resolve_llm_config(
      null,
      { llm: { mode: "api", model: "" } },
      { default_llm: { mode: "api", model: "m-set", chat_path: "/v1/messages" } },
    );
    expect(r.model).toBe("m-set");
    expect(r.chat_path).toBe("/v1/messages");
  });

  it("session 不带 chat_path 但模型 + api_base 与 settings 一致：继承该层 chat_path（同源语义）", () => {
    const r = resolve_llm_config(
      { mode: "api", model: "m-set", api_base: "http://x" },
      { llm: { mode: "api", model: "" } },
      { default_llm: { mode: "api", model: "m-set", api_base: "http://x", chat_path: "/gateway/completions" } },
    );
    expect(r.chat_path).toBe("/gateway/completions");
  });

  it("三层皆无 chat_path：字段缺省（交给 Provider 回退 /chat/completions）", () => {
    const r = resolve_llm_config(
      null,
      { llm: { mode: "api", model: "m-proj" } },
      { default_llm: { mode: "api", model: "m-set" } },
    );
    expect(r.chat_path).toBeUndefined();
  });
});

describe("resolve_llm_config — session 继承需 api_base 同源（审计 3-A 终审复现）", () => {
  // 终审跑码实证的渗漏场景：AU=官方 DeepSeek；全局=自建网关上的**同名模型**
  // （手动 ctx 1M + 非标 chat_path）。会话下拉切到该模型名时 payload 带的是
  // AU（生效层）的官方 api_base —— 修复前按模型名匹配会把网关的窗口/路径
  // 渗漏到官方端点上（404 / 预算错配）。
  const project = {
    llm: { mode: "api", model: "au-model", api_base: "https://api.deepseek.com", api_key: "sk-au" },
  };
  const settings = {
    default_llm: {
      mode: "api",
      model: "deepseek-chat",
      api_base: "https://gateway.example/openai/v1",
      api_key: "sk-gw",
      context_window: 1_000_000,
      chat_path: "/gateway/chat",
    },
  };

  it("会话切到全局同名模型但端点是 AU 的官方 base：ctx 不渗漏（undefined 交映射表推断）", () => {
    const r = resolve_llm_config(
      { mode: "api", model: "deepseek-chat", api_base: "https://api.deepseek.com" },
      project,
      settings,
    );
    expect(r.context_window).toBeUndefined();
  });

  it("同场景：chat_path 不渗漏（缺省回退 /chat/completions）", () => {
    const r = resolve_llm_config(
      { mode: "api", model: "deepseek-chat", api_base: "https://api.deepseek.com" },
      project,
      settings,
    );
    expect(r.chat_path).toBeUndefined();
  });

  it("对照：会话端点与全局网关一致时照常继承 ctx + chat_path", () => {
    const r = resolve_llm_config(
      { mode: "api", model: "deepseek-chat", api_base: "https://gateway.example/openai/v1/" },
      project,
      settings,
    );
    expect(r.context_window).toBe(1_000_000);
    expect(r.chat_path).toBe("/gateway/chat");
  });

  it("api_base 路径段大小写敏感：/V1 与 /v1 视为不同端点（只归一 host）", () => {
    const r = resolve_llm_config(
      { mode: "api", model: "deepseek-chat", api_base: "https://gateway.example/OPENAI/V1" },
      project,
      settings,
    );
    expect(r.context_window).toBeUndefined();
  });
});
