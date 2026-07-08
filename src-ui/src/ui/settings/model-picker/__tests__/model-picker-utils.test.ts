// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect } from "vitest";
import { listProviders } from "@ficforge/engine";
import type { ModelCatalog } from "../../../../api/settings";
import {
  buildPickerProviders,
  ctxInfoForModel,
  formatCtx,
  isLikelyEmbeddingId,
  matchProviderByBaseUrl,
  modelGroupKey,
  modelOptionsForProvider,
  resolveSessionLayer,
} from "../model-picker-utils";

const catalog: ModelCatalog = {
  custom_providers: [
    {
      id: "custom-relay-1",
      displayName: "我的中转站",
      baseUrl: "https://relay.example.com/v1",
      has_api_key: true,
      models: [
        { id: "relay/awesome-chat", displayName: "Awesome Chat", contextWindow: 200_000, type: "chat" },
        { id: "relay/awesome-embed", displayName: "Awesome Embed", type: "embedding" },
      ],
    },
  ],
  enabled_models: {
    deepseek: [
      // 与推荐重名 → 去重时推荐优先
      { id: "deepseek-v4-flash", displayName: "重名条目", type: "chat" },
      // 手填 ctx → manual
      { id: "deepseek-pulled", displayName: "deepseek-pulled", contextWindow: 65_536, type: "chat" },
      // 无 ctx 但 map fuzzy 可推 → estimated
      { id: "deepseek-chat", displayName: "deepseek-chat", type: "chat" },
      // 无 ctx 且 map 推不出 → unknown
      { id: "totally-unknown-xyz", displayName: "totally-unknown-xyz", type: "chat" },
    ],
  },
};

describe("buildPickerProviders", () => {
  it("内置清单顺序 = listProviders 顺序（单一真相源），自定义供应商追加尾部", () => {
    const providers = buildPickerProviders(catalog, "zh");
    const builtinIds = listProviders().map((p) => p.id);
    expect(providers.slice(0, builtinIds.length).map((p) => p.id)).toEqual(builtinIds);
    expect(providers.at(-1)).toMatchObject({ id: "custom-relay-1", isCustom: true, label: "我的中转站" });
  });

  it("catalog 未加载（null）时仍给出内置清单", () => {
    const providers = buildPickerProviders(null, "en");
    expect(providers.length).toBe(listProviders().length);
    expect(providers[0].label).toBe(listProviders()[0].displayName.en);
  });

  it("enabled_models 按 providerId 挂到对应供应商", () => {
    const providers = buildPickerProviders(catalog, "zh");
    const deepseek = providers.find((p) => p.id === "deepseek")!;
    expect(deepseek.enabledModels.map((m) => m.id)).toContain("deepseek-pulled");
  });
});

describe("matchProviderByBaseUrl", () => {
  const providers = buildPickerProviders(catalog, "zh");

  it("精确 / 尾斜杠 / 大小写差异均可命中", () => {
    expect(matchProviderByBaseUrl(providers, "https://api.deepseek.com")?.id).toBe("deepseek");
    expect(matchProviderByBaseUrl(providers, "https://api.deepseek.com/")?.id).toBe("deepseek");
    expect(matchProviderByBaseUrl(providers, "HTTPS://API.DEEPSEEK.COM")?.id).toBe("deepseek");
    expect(matchProviderByBaseUrl(providers, "https://relay.example.com/v1/")?.id).toBe("custom-relay-1");
  });

  it("未知 base / 空串 → undefined（不静默猜测）", () => {
    expect(matchProviderByBaseUrl(providers, "https://unknown.example.com")).toBeUndefined();
    expect(matchProviderByBaseUrl(providers, "")).toBeUndefined();
  });
});

describe("modelOptionsForProvider — 合并 + 过滤 + ctx 分层", () => {
  const providers = buildPickerProviders(catalog, "zh");
  const deepseek = providers.find((p) => p.id === "deepseek")!;
  const siliconflow = providers.find((p) => p.id === "siliconflow")!;
  const relay = providers.find((p) => p.id === "custom-relay-1")!;

  it("推荐模型 ctx = authoritative（manifest 权威值）", () => {
    const options = modelOptionsForProvider(deepseek, "chat");
    const flash = options.find((o) => o.id === "deepseek-v4-flash")!;
    expect(flash.origin).toBe("recommended");
    expect(flash.ctx).toEqual({ source: "authoritative", value: 1_000_000 });
  });

  it("与推荐重名的已启用条目被去重（推荐优先，不出现两条）", () => {
    const options = modelOptionsForProvider(deepseek, "chat");
    expect(options.filter((o) => o.id === "deepseek-v4-flash")).toHaveLength(1);
  });

  it("已启用模型：手填 ctx=manual、fuzzy 可推=estimated、推不出=unknown", () => {
    const options = modelOptionsForProvider(deepseek, "chat");
    expect(options.find((o) => o.id === "deepseek-pulled")!.ctx).toEqual({ source: "manual", value: 65_536 });
    const estimated = options.find((o) => o.id === "deepseek-chat")!.ctx;
    expect(estimated.source).toBe("estimated");
    expect(estimated.value).toBeGreaterThan(0);
    expect(options.find((o) => o.id === "totally-unknown-xyz")!.ctx).toEqual({ source: "unknown" });
  });

  it("embedding 槽位只显示 embedding 类型（实施项 5 过滤参数）", () => {
    const chatOptions = modelOptionsForProvider(siliconflow, "chat");
    const embOptions = modelOptionsForProvider(siliconflow, "embedding");
    expect(embOptions.map((o) => o.id)).toEqual(["BAAI/bge-m3"]);
    expect(chatOptions.some((o) => o.id === "BAAI/bge-m3")).toBe(false);
    // 自定义供应商同样过滤
    expect(modelOptionsForProvider(relay, "embedding").map((o) => o.id)).toEqual(["relay/awesome-embed"]);
  });
});

describe("ctxInfoForModel — 手填模型的三层判定", () => {
  const providers = buildPickerProviders(catalog, "zh");
  const options = modelOptionsForProvider(providers.find((p) => p.id === "deepseek")!, "chat");

  it("选项内命中 → 沿用选项 ctx；选项外 fuzzy → estimated；完全未知 → unknown", () => {
    expect(ctxInfoForModel(options, "deepseek-v4-flash")).toEqual({ source: "authoritative", value: 1_000_000 });
    expect(ctxInfoForModel(options, "kimi-k2.6").source).toBe("estimated");
    expect(ctxInfoForModel(options, "made-up-model-9000")).toEqual({ source: "unknown" });
    expect(ctxInfoForModel(options, "")).toEqual({ source: "unknown" });
  });
});

describe("formatCtx", () => {
  it("十进制口径缩写", () => {
    expect(formatCtx(1_000_000)).toBe("1M");
    expect(formatCtx(10_000_000)).toBe("10M");
    expect(formatCtx(262_144)).toBe("262K");
    expect(formatCtx(200_000)).toBe("200K");
    expect(formatCtx(8_192)).toBe("8K");
    expect(formatCtx(500)).toBe("500");
  });
});

describe("isLikelyEmbeddingId / modelGroupKey", () => {
  it("embedding 形态 id 识别", () => {
    expect(isLikelyEmbeddingId("text-embedding-3-small")).toBe(true);
    expect(isLikelyEmbeddingId("BAAI/bge-m3")).toBe(true);
    expect(isLikelyEmbeddingId("gte-large-zh")).toBe(true);
    expect(isLikelyEmbeddingId("deepseek-v4-pro")).toBe(false);
    expect(isLikelyEmbeddingId("glm-5.2")).toBe(false);
  });

  it("系列分组（embedding 优先归组）", () => {
    expect(modelGroupKey("deepseek-ai/DeepSeek-V4-Pro")).toBe("deepseek");
    expect(modelGroupKey("claude-sonnet-5")).toBe("claude");
    expect(modelGroupKey("BAAI/bge-m3")).toBe("embedding");
    expect(modelGroupKey("qwen3.7-max")).toBe("qwen");
    expect(modelGroupKey("weird-model-x")).toBe("other");
  });
});

describe("resolveSessionLayer — 生效层级三态", () => {
  it("会话改过 → session；AU 覆盖 → au；否则 global", () => {
    expect(resolveSessionLayer({ sessionModel: "a", configuredModel: "b", hasAuOverride: false })).toBe("session");
    expect(resolveSessionLayer({ sessionModel: "a", configuredModel: "b", hasAuOverride: true })).toBe("session");
    expect(resolveSessionLayer({ sessionModel: "a", configuredModel: "a", hasAuOverride: true })).toBe("au");
    expect(resolveSessionLayer({ sessionModel: "a", configuredModel: "a", hasAuOverride: false })).toBe("global");
    expect(resolveSessionLayer({ sessionModel: "", configuredModel: "a", hasAuOverride: false })).toBe("global");
  });
});
