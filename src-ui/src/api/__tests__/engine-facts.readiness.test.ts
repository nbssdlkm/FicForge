// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * getFactsExtractionReadiness — 事实提取就位判断（审计④）。
 *
 * 与 resolveFactsProvider 同源（resolve_llm_config 优先级 session>project>default_llm）。
 * 关键回归：AU 级独立配 LLM、全局 default_llm 空时，readiness 必须为真——否则对话自动
 * 提取 gate 会误判为不可用而静默跳过（与写文路径不一致）。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as engineModule from "@ficforge/engine";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";
import { getFactsExtractionReadiness } from "../engine-facts";
import { createAu, createFandom } from "../engine-fandom";
import { getEngine, initEngine } from "../engine-instance";

let adapter: MockAdapter;
let auPath: string;

beforeEach(async () => {
  vi.restoreAllMocks();
  adapter = new MockAdapter();
  initEngine(adapter, "/data");
  const fandom = await createFandom("Naruto");
  const au = await createAu(fandom.name, "Canon", fandom.path);
  auPath = au.path;
});

describe("getFactsExtractionReadiness（审计④：与 resolveFactsProvider 同源）", () => {
  it("全局 default_llm 空 + AU 级 project.llm 配了可用 key → readiness=true", async () => {
    const proj = await getEngine().repos.project.get(auPath);
    proj.llm.mode = engineModule.LLMMode.API;
    proj.llm.model = "gpt-test";
    proj.llm.api_base = "https://llm.example.com/v1";
    proj.llm.api_key = "proj-secret";
    await getEngine().repos.project.save(proj);

    const r = await getFactsExtractionReadiness(auPath);
    expect(r.has_usable_connection).toBe(true);
  });

  it("全局与 project 都无 key → readiness=false", async () => {
    const r = await getFactsExtractionReadiness(auPath);
    expect(r.has_usable_connection).toBe(false);
  });

  it("仅全局 default_llm 配了 key（无 project 覆盖）→ readiness=true", async () => {
    const s = await getEngine().repos.settings.get();
    s.default_llm.mode = engineModule.LLMMode.API;
    s.default_llm.model = "gpt-global";
    s.default_llm.api_base = "https://g.example.com/v1";
    s.default_llm.api_key = "global-secret";
    await getEngine().repos.settings.save(s);

    const r = await getFactsExtractionReadiness(auPath);
    expect(r.has_usable_connection).toBe(true);
  });
});
