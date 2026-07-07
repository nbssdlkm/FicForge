// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { DEFAULT_CONTEXT_WINDOW } from "../model_context_map.js";
import {
  contextWindowForModel,
  findRecommendedModel,
  getProvider,
  listProviders,
} from "../provider_manifest.js";

describe("provider_manifest — 完整性", () => {
  const providers = listProviders();

  it("非空且首批内置齐全（对中文写手排序）", () => {
    const ids = providers.map((p) => p.id);
    expect(ids).toEqual([
      "deepseek",
      "siliconflow",
      "moonshot",
      "zhipu",
      "dashscope",
      "ark",
      "minimax",
      "openrouter",
      "openai",
      "gemini",
      "anthropic",
      "ollama",
    ]);
  });

  it("供应商 id 无重复", () => {
    const ids = providers.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每条 baseUrl 非空 + displayName 中英双语非空", () => {
    for (const p of providers) {
      expect(p.baseUrl.trim().length).toBeGreaterThan(0);
      expect(p.displayName.zh.trim().length).toBeGreaterThan(0);
      expect(p.displayName.en.trim().length).toBeGreaterThan(0);
    }
  });

  it("推荐模型：ctx>0、id 非空、供应商内 id 无重复、type 合法", () => {
    for (const p of providers) {
      const modelIds = p.recommendedModels.map((m) => m.id);
      expect(new Set(modelIds).size).toBe(modelIds.length); // 供应商内 id 无重复
      for (const m of p.recommendedModels) {
        expect(m.id.trim().length).toBeGreaterThan(0);
        expect(m.displayName.trim().length).toBeGreaterThan(0);
        expect(m.contextWindow).toBeGreaterThan(0);
        expect(["chat", "embedding"]).toContain(m.type);
        if (m.maxOutputTokens !== undefined) {
          expect(m.maxOutputTokens).toBeGreaterThan(0);
        }
      }
    }
  });

  it("内置供应商（Ollama 除外）每家 2-4 个推荐模型", () => {
    for (const p of providers) {
      if (p.id === "ollama") continue;
      expect(p.recommendedModels.length).toBeGreaterThanOrEqual(2);
      expect(p.recommendedModels.length).toBeLessThanOrEqual(4);
    }
  });

  it("Ollama 推荐模型为空（运行时 ctx 需手填）", () => {
    const ollama = getProvider("ollama");
    expect(ollama?.recommendedModels).toEqual([]);
    expect(ollama?.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("SiliconFlow：id 带 org/ 前缀 + 含 BAAI/bge-m3 embedding，type 标注正确", () => {
    const sf = getProvider("siliconflow");
    expect(sf).toBeDefined();
    // org/ 前缀形态
    expect(sf!.recommendedModels.some((m) => m.id.includes("/"))).toBe(true);
    // embedding 条目存在且 type 正确
    const bge = sf!.recommendedModels.find((m) => m.id === "BAAI/bge-m3");
    expect(bge).toBeDefined();
    expect(bge!.type).toBe("embedding");
    // chat 条目不能被误标 embedding
    const chats = sf!.recommendedModels.filter((m) => m.id !== "BAAI/bge-m3");
    expect(chats.every((m) => m.type === "chat")).toBe(true);
  });

  it("embedding 类型只出现在合理位置（不给 chat 配 embedding 标签场景）", () => {
    // 全清单里 embedding 条目都不带 chat 专属场景标签（sanity）
    for (const p of providers) {
      for (const m of p.recommendedModels) {
        if (m.type === "embedding") {
          // embedding 不该带 creative/flagship 这类对话场景标签
          expect(m.tags ?? []).not.toContain("creative");
          expect(m.tags ?? []).not.toContain("flagship");
        }
      }
    }
  });
});

describe("provider_manifest — 查询函数", () => {
  it("getProvider 命中 / 未命中", () => {
    expect(getProvider("deepseek")?.id).toBe("deepseek");
    expect(getProvider("nonexistent")).toBeUndefined();
  });

  it("findRecommendedModel 命中 / provider 未命中 / model 未命中", () => {
    expect(findRecommendedModel("deepseek", "deepseek-v4-pro")?.contextWindow).toBe(1_000_000);
    expect(findRecommendedModel("nonexistent", "deepseek-v4-pro")).toBeUndefined();
    expect(findRecommendedModel("deepseek", "no-such-model")).toBeUndefined();
  });
});

describe("contextWindowForModel — 三层优先级判别", () => {
  it("第 1 层：manifest 推荐模型权威 ctx（给 providerId + 精确命中）", () => {
    // siliconflow 的 org/ 前缀 id，manifest 权威值 1M
    expect(contextWindowForModel("deepseek-ai/DeepSeek-V4-Pro", "siliconflow")).toBe(1_000_000);
    // bge-m3 embedding 的 ctx
    expect(contextWindowForModel("BAAI/bge-m3", "siliconflow")).toBe(8_192);
  });

  it("第 1 层优先于第 2 层：manifest 值即便与 MODEL_CONTEXT_MAP 不同也以 manifest 为准", () => {
    // gpt-5.4-mini：manifest = 400K；MODEL_CONTEXT_MAP fuzzy 也 = 400K（同源），
    // 用一个 manifest 里 ctx 与 map 无关的场景验证优先级：MiniMax-M2.7 manifest=204800
    expect(contextWindowForModel("MiniMax-M2.7", "minimax")).toBe(204_800);
  });

  it("第 2 层：无 providerId 时走 MODEL_CONTEXT_MAP fuzzy（strip org/ + 前缀）", () => {
    // 不传 providerId → 落 MODEL_CONTEXT_MAP，org/ 前缀被 strip 后命中
    expect(contextWindowForModel("moonshotai/Kimi-K2.6")).toBe(262_144);
    expect(contextWindowForModel("deepseek-v4-flash")).toBe(1_000_000);
  });

  it("第 2 层：providerId 给了但 model 不在该 provider 推荐里 → 回退 MODEL_CONTEXT_MAP", () => {
    // deepseek 供应商里没有 gpt-5.5，但 gpt-5.5 在 MODEL_CONTEXT_MAP → 走第 2 层
    expect(contextWindowForModel("gpt-5.5", "deepseek")).toBe(1_000_000);
  });

  it("第 3 层：完全未知 id 返回 undefined（不静默兜 DEFAULT）", () => {
    expect(contextWindowForModel("totally-unknown-model-xyz")).toBeUndefined();
    expect(contextWindowForModel("some-org/Totally-Unknown", "deepseek")).toBeUndefined();
    // 调用方拿到 undefined 后自己兜 DEFAULT（本 helper 不代劳）
    const cw = contextWindowForModel("totally-unknown-model-xyz") ?? DEFAULT_CONTEXT_WINDOW;
    expect(cw).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});
