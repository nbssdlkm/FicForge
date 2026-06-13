// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

// TD-005a: AU 级 embedding_lock 覆盖必须优先于全局 settings.embedding，
// 且半配置（只填 key 不填 base）要安全回退到全局，不指向空端点。

import { describe, expect, it } from "vitest";
import { createSettings, createProject } from "@ficforge/engine";
import { createEmbeddingProvider } from "../engine-state";

function settingsWithEmbedding(emb: { api_base: string; api_key: string; model: string }) {
  const s = createSettings();
  s.embedding = { ...s.embedding, api_base: emb.api_base, api_key: emb.api_key, model: emb.model };
  return s;
}

function projectWithLock(lock: Partial<{ api_base: string; api_key: string; model: string }>) {
  const p = createProject({ project_id: "p1", au_id: "au1" });
  p.embedding_lock = {
    ...p.embedding_lock,
    api_base: lock.api_base ?? "",
    api_key: lock.api_key ?? "",
    model: lock.model ?? "",
  };
  return p;
}

describe("createEmbeddingProvider — AU embedding_lock priority (TD-005a)", () => {
  const globalSett = settingsWithEmbedding({
    api_base: "https://global.example/v1",
    api_key: "global-key",
    model: "global-model",
  });

  it("uses the AU embedding_lock when api_key + api_base are both set", () => {
    const proj = projectWithLock({ api_base: "https://au.example/v1", api_key: "au-key", model: "au-model" });
    expect(createEmbeddingProvider(globalSett, proj)?.get_model_name()).toBe("au-model");
  });

  it("falls back to global settings.embedding when the lock is empty", () => {
    expect(createEmbeddingProvider(globalSett, projectWithLock({}))?.get_model_name()).toBe("global-model");
  });

  it("falls back to global when the lock has api_key but no api_base (partial-override guard)", () => {
    const proj = projectWithLock({ api_key: "au-key" });
    expect(createEmbeddingProvider(globalSett, proj)?.get_model_name()).toBe("global-model");
  });

  it("returns undefined when neither the lock nor global embedding is configured", () => {
    const emptySett = settingsWithEmbedding({ api_base: "", api_key: "", model: "" });
    expect(createEmbeddingProvider(emptySett, projectWithLock({}))).toBeUndefined();
  });

  it("still works with no project argument (global-only path unchanged)", () => {
    expect(createEmbeddingProvider(globalSett)?.get_model_name()).toBe("global-model");
  });
});
