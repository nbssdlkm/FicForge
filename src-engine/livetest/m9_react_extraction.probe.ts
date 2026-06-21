// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
//
// M9 ReAct 提取真 LLM 探针（NOT a unit test — hits network, needs local key）。
// 跑法：npx vitest run --config vitest.live.config.ts livetest/m9_react_extraction.probe.ts
// 目的：mock 单测证明了循环接线对；这里证明真 LLM（deepseek-chat）会按协议调
//       propose_facts → search_existing_facts → annotate_fact → finalize_extraction，
//       真的产出跨章 caused_by + 自动 thread_ids。「测试绿 ≠ 真 works」那一层。
//
// LLM = deepseek-chat（~/.deepseek/config.toml）。无 embedding 需求（M9 走关键词本地过滤）。

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { OpenAICompatibleProvider } from "../llm/openai_compatible.js";
import { reactExtractFromChapter } from "../services/react_extraction_dispatch.js";
import { createFact } from "../domain/fact.js";
import { createThread } from "../domain/thread.js";
import { ThreadStatus } from "../domain/enums.js";
import { FileFactRepository } from "../repositories/implementations/file_fact.js";
import { FileThreadRepository } from "../repositories/implementations/file_thread.js";
import { MockAdapter } from "../repositories/__tests__/mock_adapter.js";
import { consoleSink } from "../services/agent_telemetry.js";

function deepseekKey(): string {
  const toml = readFileSync(join(homedir(), ".deepseek", "config.toml"), "utf8");
  const m = toml.match(/api_key\s*=\s*"([^"]+)"/);
  if (!m) throw new Error("no deepseek api_key");
  return m[1];
}

// 现行 deepseek 主流模型（2026-06）：v4-flash（快，loop 用）/ v4-pro（强）。
// 默认用 flash 跑探针（贴近真实用户出章场景）；改 M9_PROBE_MODEL 环境变量可切 v4-pro。
const PROBE_MODEL = process.env.M9_PROBE_MODEL || "deepseek-v4-flash";
const llm = new OpenAICompatibleProvider("https://api.deepseek.com", deepseekKey(), PROBE_MODEL);

// 第 5 章「面圣」——承接前文：沈砚出示残角，太傅反咬，皇帝问话。
const CHAPTER_5 = `面圣那日，金殿的砖比灯阁的夜还要冷。
沈砚还没开口，太傅已先一步出列，将一卷文书举过头顶："陛下，沈书令私藏宫档，夤夜涂抹名录，其心可诛。"
满殿哗然。那卷文书上，赫然是她这些日子比对的笔迹摹本——有人一直在她身后看着。
皇帝没有立刻发话。他只是看着阶下那个单薄的身影。
"沈砚，"皇帝终于开口，"你可有话说。"
她抬起头，从袖中取出那半页残角，迎着满殿的目光，一字一字道："臣有一物，请陛下亲验。"`;

// 预置：第 1、3 章已落库的事实（带真实 fact_id，供跨章 caused_by 引用）。
const SEEDED_FACTS = [
  createFact({
    id: "f_ch1_remnant",
    content_raw: "[第1章] 沈砚在灯阁旧名录夹缝发现父亲笔迹的半页残角",
    content_clean: "沈砚在灯阁旧名录的装订夹缝里发现一角带父亲笔迹的残页，藏入袖中",
    characters: ["沈砚"],
    chapter: 1,
  }),
  createFact({
    id: "f_ch3_forgery",
    content_raw: "[第3章] 沈砚比对副录确认父亲'通敌'罪名系事后篡改",
    content_clean: "沈砚比对副录，确认父亲的通敌罪名是被人事后篡改名录构陷的",
    characters: ["沈砚"],
    chapter: 3,
  }),
];

// 预置：一条进行中的剧情线（active），M9 应把第 5 章相关事实挂到这里。
const SEEDED_THREAD = createThread({
  id: "t_vindicate",
  title: "沈砚为父翻案",
  description: "沈砚追查父亲十年前的冤案",
  state: "已确认名录被篡改，金殿面圣出示残角",
  status: ThreadStatus.ACTIVE,
});

describe("M9 ReAct 提取真 LLM 探针", () => {
  it("第5章：deepseek 走工具循环，产出跨章 caused_by + 自动 thread_ids（肉眼验）", async () => {
    const adapter = new MockAdapter();
    const factRepo = new FileFactRepository(adapter);
    for (const f of SEEDED_FACTS) await factRepo.append("au", f);
    const threadRepo = new FileThreadRepository(adapter);
    await threadRepo.add("au", SEEDED_THREAD);

    const existingSummary = SEEDED_FACTS.map((f) => ({ content_clean: f.content_clean }));

    const res = await reactExtractFromChapter(
      CHAPTER_5,
      5,
      existingSummary,
      { characters: ["沈砚", "裴照", "太傅", "皇帝"] },
      null,
      llm,
      { language: "zh", factRepo, threadRepo, auPath: "au", _telemetry_override: consoleSink },
    );

    // 肉眼验：打印每条事实 + 它的 caused_by / thread_ids
    console.log("\n========= M9 真 LLM 提取结果 =========");
    console.log(`status=${res.status}  facts=${res.facts.length}`);
    res.facts.forEach((f, i) => {
      console.log(`\n[${i}] ${f.content_clean}`);
      console.log(`    角色: ${JSON.stringify(f.characters)}  类型: ${f.fact_type}/${f.narrative_weight}`);
      console.log(`    caused_by: ${JSON.stringify(f.caused_by ?? [])}`);
      console.log(`    thread_ids: ${JSON.stringify(f.thread_ids ?? [])}`);
      if (f.time_kind) console.log(`    time_kind: ${f.time_kind}  known_to: ${JSON.stringify(f.known_to)}`);
    });
    console.log("\n=====================================\n");

    // 硬断言（不依赖 LLM 具体输出，只验循环 works）：至少产出 1 条事实、干净收尾。
    expect(res.facts.length).toBeGreaterThan(0);
    expect(res.status).toBe("ok");
    // 防幻觉断言：所有 caused_by 必须是真实 seeded fact_id；所有 thread_ids 必须是真实 thread。
    const validFactIds = new Set(["f_ch1_remnant", "f_ch3_forgery"]);
    for (const f of res.facts) {
      for (const cb of f.caused_by ?? []) expect(validFactIds.has(cb)).toBe(true);
      for (const tid of f.thread_ids ?? []) expect(tid).toBe("t_vindicate");
    }
  }, 120_000);
});
