// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
//
// M9 ReAct 提取「质量广度测」真 LLM 探针（NOT a unit test — hits network, needs local key）。
// 跑法：npx vitest run --config vitest.live.config.ts livetest/m9_breadth.probe.ts
//
// 单题材探针（m9_react_extraction.probe.ts）证明了「循环 works + 单题材挂对」。
// 本探针扩到 4 个题材，每个埋好 ground truth（前序因 + 该归的剧情线），量化：
//   ① 过度提取（每章条数 vs 合理上限） ② caused_by 召回（埋的跨章因找到没）
//   ③ thread 归属（自动挂对线没） ④ 防幻觉（所有 id 都真实吗）
// 硬断言只卡「幻觉 + 循环坏掉」；质量指标打印出来由人读判（"测试绿 ≠ 真 works" 那层）。
//
// LLM = deepseek v4-flash（贴近用户出章）。M9_PROBE_MODEL=deepseek-v4-pro 可切强模型对比。
// M9 走关键词本地过滤，无 embedding 需求。

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterAll } from "vitest";

import { OpenAICompatibleProvider } from "../llm/openai_compatible.js";
import { reactExtractFromChapter } from "../services/react_extraction_dispatch.js";
import { createFact } from "../domain/fact.js";
import { createThread } from "../domain/thread.js";
import { ThreadStatus } from "../domain/enums.js";
import { FileFactRepository } from "../repositories/implementations/file_fact.js";
import { FileThreadRepository } from "../repositories/implementations/file_thread.js";
import { MockAdapter } from "../repositories/__tests__/mock_adapter.js";

function deepseekKey(): string {
  const toml = readFileSync(join(homedir(), ".deepseek", "config.toml"), "utf8");
  const m = toml.match(/api_key\s*=\s*"([^"]+)"/);
  if (!m) throw new Error("no deepseek api_key");
  return m[1];
}

const PROBE_MODEL = process.env.M9_PROBE_MODEL || "deepseek-v4-flash";
const llm = new OpenAICompatibleProvider("https://api.deepseek.com", deepseekKey(), PROBE_MODEL);

interface Scenario {
  id: string;
  genre: string;
  seededFacts: { id: string; content_clean: string; chapter: number }[];
  thread: { id: string; title: string; state: string };
  chapterNum: number;
  characters: string[];
  chapterText: string;
  // ground truth
  expectedCauses: string[];   // 至少有一条 fact 的 caused_by 应该命中这些（埋好的跨章因）
  expectedThreadId: string;
  reasonableMax: number;      // 这一章合理的事实条数上限（超了=过度提取信号）
  watch?: string;             // 这个题材重点观察什么（给读者）
}

const SCENARIOS: Scenario[] = [
  {
    id: "office", genre: "现代职场·数据造假悬疑", chapterNum: 3,
    characters: ["林夏", "周明"],
    seededFacts: [
      { id: "f_office_logs", chapter: 1, content_clean: "林夏在测试服务器日志里发现留存数据被一段脚本批量改写过" },
      { id: "f_office_cover", chapter: 2, content_clean: "周明在周会上坚称留存率达标，把异常甩锅给埋点 bug" },
    ],
    thread: { id: "t_office_fraud", title: "林夏揭露数据造假", state: "已发现日志被改、周明在会上掩盖" },
    chapterText: `复盘会的投影还停在那张漂亮的留存曲线上。
林夏没看 PPT，她把那段改写脚本的提交记录追到了底——commit 作者栏，是周明的内网账号。
她深吸一口气，当着所有人调出了那条提交，时间正好压在周会前一晚。
周明的脸白了一瞬，随即冷笑："谁知道是不是有人盗用我账号。"
"日志里改的是哪几张表，盗号的人不会比你更清楚。"林夏把两份记录并排推到他面前。`,
    expectedCauses: ["f_office_logs", "f_office_cover"],
    expectedThreadId: "t_office_fraud",
    reasonableMax: 4,
    watch: "因果该挂到「发现日志被改」「周明掩盖」，别把整段对话拆成一堆碎事实",
  },
  {
    id: "scifi", genre: "科幻·首次接触（设定密集）", chapterNum: 3,
    characters: ["陈舸", "司令"],
    seededFacts: [
      { id: "f_scifi_signal", chapter: 1, content_clean: "深空观测站接收到来自半人马座方向的规律性脉冲信号" },
      { id: "f_scifi_decode", chapter: 2, content_clean: "陈舸破译出脉冲是一组连续质数，确认信号来自智能文明" },
    ],
    thread: { id: "t_scifi_contact", title: "首次接触", state: "确认是智能文明信号，是否回复有分歧" },
    chapterText: `主控厅的环形屏上，质数序列还在一遍遍滚动。
陈舸主张立刻回复——既然确认是智能文明，沉默才是最大的风险。
司令把茶杯重重搁下："回复就是暴露坐标。我们连对方有没有恶意都不知道。"
争执没有结果。当夜，陈舸独自留在副控室，用那座废弃的备用天线，向那个方向发出了一段同样的质数应答。
信号离站的那一刻，他知道自己已经替整个文明做了决定。`,
    expectedCauses: ["f_scifi_decode", "f_scifi_signal"],
    expectedThreadId: "t_scifi_contact",
    reasonableMax: 4,
    watch: "过度提取高危：别把「备用天线」「环形屏」「茶杯」这种设定/道具当独立事实抽出来",
  },
  {
    id: "wuxia", genre: "武侠·江湖复仇", chapterNum: 3,
    characters: ["顾昀", "卫长老"],
    seededFacts: [
      { id: "f_wuxia_massacre", chapter: 1, content_clean: "十年前飞鸿镖局满门被灭，唯独少年顾昀从柴房逃生" },
      { id: "f_wuxia_token", chapter: 2, content_clean: "顾昀从一名追杀者尸身上夺得一枚刻着'卫'字的乌木腰牌" },
    ],
    thread: { id: "t_wuxia_revenge", title: "顾昀复仇", state: "凭'卫'字腰牌追查灭门仇人" },
    chapterText: `'卫'字腰牌的来历，顾昀查了整整三个月，线终于落在漕帮的卫长老身上。
那夜他翻进漕帮后院，伏在梁上听了半宿。
直到卫长老抬手熄灯，火光掠过他左颊那道旧疤——顾昀的呼吸停了。
那道疤，那只惯用左手的提刀姿势，正是十年前柴房外，那个一刀劈翻他父亲的黑衣刀客。
他攥紧了腰间的短刃，却没有动。今夜不是时候。`,
    expectedCauses: ["f_wuxia_token", "f_wuxia_massacre"],
    expectedThreadId: "t_wuxia_revenge",
    reasonableMax: 4,
    watch: "夜探该挂「腰牌线索」，认出刀客该挂「灭门」；两条跨章因都要在",
  },
  {
    id: "mystery", genre: "本格推理·密室（含红鲱鱼）", chapterNum: 4,
    characters: ["池砚", "管家", "女佣"],
    seededFacts: [
      { id: "f_myst_body", chapter: 1, content_clean: "别墅书房发现庄主尸体，门窗从内反锁，呈密室状态" },
      { id: "f_myst_alibi", chapter: 2, content_clean: "管家声称案发时一直在厨房备餐，女佣当场为他作证" },
      { id: "f_myst_key", chapter: 3, content_clean: "池砚在书房书架暗格里发现一把与房门匹配的备用钥匙" },
    ],
    thread: { id: "t_myst_case", title: "庄园密室案", state: "密室成因与管家不在场证明存疑" },
    chapterText: `池砚把众人请回书房，指尖点了点那道反锁的门闩。
"密室是伪造的。"他取出暗格里那把备用钥匙，"凶手作案后从外面用它锁门，再把钥匙放回暗格，制造出内锁的假象。"
他又转向管家："至于你的不在场——"
角落里的女佣忽然开口，声音发抖："对不起……那天午后他离开过厨房，约莫一刻钟。是他让我别说的。"
管家脸色骤变。池砚合上笔记本："一刻钟，足够上楼了。"`,
    expectedCauses: ["f_myst_key", "f_myst_alibi"],
    expectedThreadId: "t_myst_case",
    reasonableMax: 5,
    watch: "精度/红鲱鱼：密室伪造结论该挂「暗格钥匙」(f_myst_key)，别错挂到假的不在场证明 f_myst_alibi 上；管家嫌疑该挂女佣翻供",
  },
];

interface Metrics {
  id: string; genre: string; model: string;
  factCount: number; reasonableMax: number; overExtraction: boolean;
  causesExpected: number; causesFound: number;     // 召回
  threadFacts: number;                              // 挂到目标线的事实数
  hallucinatedCauses: number; hallucinatedThreads: number;
}
const collected: Metrics[] = [];

describe(`M9 质量广度测 (model=${PROBE_MODEL})`, () => {
  it.each(SCENARIOS)("[$genre] 提取 + 量化挂错率", async (sc) => {
    const adapter = new MockAdapter();
    const factRepo = new FileFactRepository(adapter);
    for (const f of sc.seededFacts) {
      await factRepo.append("au", createFact({
        id: f.id, content_raw: f.content_clean, content_clean: f.content_clean,
        characters: sc.characters, chapter: f.chapter,
      }));
    }
    const threadRepo = new FileThreadRepository(adapter);
    await threadRepo.add("au", createThread({
      id: sc.thread.id, title: sc.thread.title, description: sc.thread.title,
      state: sc.thread.state, status: ThreadStatus.ACTIVE,
    }));

    const existingSummary = sc.seededFacts.map((f) => ({ content_clean: f.content_clean }));
    const res = await reactExtractFromChapter(
      sc.chapterText, sc.chapterNum, existingSummary,
      { characters: sc.characters }, null, llm,
      { language: "zh", factRepo, threadRepo, auPath: "au" },
    );

    const seededIds = new Set(sc.seededFacts.map((f) => f.id));
    const allCauses = res.facts.flatMap((f) => f.caused_by ?? []);
    const allThreads = res.facts.flatMap((f) => f.thread_ids ?? []);
    const hallucinatedCauses = allCauses.filter((c) => !seededIds.has(c));
    const hallucinatedThreads = allThreads.filter((t) => t !== sc.thread.id);
    const causesFound = sc.expectedCauses.filter((id) => allCauses.includes(id));
    const threadFacts = res.facts.filter((f) => (f.thread_ids ?? []).includes(sc.expectedThreadId)).length;

    // ---- 打印供人读判（语义对错、红鲱鱼挂错 etc.）----
    console.log(`\n===== [${sc.genre}] status=${res.status} facts=${res.facts.length}/合理≤${sc.reasonableMax} =====`);
    console.log(`观察点：${sc.watch}`);
    res.facts.forEach((f, i) => {
      console.log(`  [${i}] ${f.content_clean}`);
      const cb = f.caused_by ?? [], tid = f.thread_ids ?? [];
      if (cb.length || tid.length) console.log(`        caused_by=${JSON.stringify(cb)} thread_ids=${JSON.stringify(tid)}`);
    });
    console.log(`  → 跨章因召回 ${causesFound.length}/${sc.expectedCauses.length} (${JSON.stringify(causesFound)})  挂线事实 ${threadFacts}  过度提取=${res.facts.length > sc.reasonableMax}`);
    if (hallucinatedCauses.length) console.log(`  ⚠ 幻觉 caused_by: ${JSON.stringify(hallucinatedCauses)}`);
    if (hallucinatedThreads.length) console.log(`  ⚠ 幻觉 thread_ids: ${JSON.stringify(hallucinatedThreads)}`);

    collected.push({
      id: sc.id, genre: sc.genre, model: PROBE_MODEL,
      factCount: res.facts.length, reasonableMax: sc.reasonableMax, overExtraction: res.facts.length > sc.reasonableMax,
      causesExpected: sc.expectedCauses.length, causesFound: causesFound.length,
      threadFacts, hallucinatedCauses: hallucinatedCauses.length, hallucinatedThreads: hallucinatedThreads.length,
    });

    // ---- 硬断言：只卡「循环坏 / 幻觉」，质量留给人读 ----
    expect(res.status).toBe("ok");
    expect(res.facts.length).toBeGreaterThan(0);
    expect(hallucinatedCauses, `幻觉 caused_by（防幻觉过滤漏了）: ${JSON.stringify(hallucinatedCauses)}`).toHaveLength(0);
    expect(hallucinatedThreads, `幻觉 thread_ids（防幻觉过滤漏了）: ${JSON.stringify(hallucinatedThreads)}`).toHaveLength(0);
  }, 180_000);

  afterAll(() => {
    if (collected.length === 0) return;
    console.log(`\n\n######## M9 广度测汇总 (model=${PROBE_MODEL}) ########`);
    console.log("题材".padEnd(22) + "条数/上限  过度?  跨章因召回  挂线  幻觉");
    for (const m of collected) {
      console.log(
        m.genre.padEnd(20) +
        `  ${m.factCount}/${m.reasonableMax}`.padEnd(9) +
        `  ${m.overExtraction ? "是" : "否"}`.padEnd(6) +
        `  ${m.causesFound}/${m.causesExpected}`.padEnd(10) +
        `  ${m.threadFacts}`.padEnd(5) +
        `  ${m.hallucinatedCauses + m.hallucinatedThreads}`,
      );
    }
    const over = collected.filter((m) => m.overExtraction).length;
    const fullRecall = collected.filter((m) => m.causesFound === m.causesExpected).length;
    const threadHit = collected.filter((m) => m.threadFacts > 0).length;
    console.log(`\n过度提取 ${over}/${collected.length} 题材 · 跨章因全召回 ${fullRecall}/${collected.length} · 挂到目标线 ${threadHit}/${collected.length} · 幻觉合计 ${collected.reduce((s, m) => s + m.hallucinatedCauses + m.hallucinatedThreads, 0)}`);
    console.log("##################################################\n");
  });
});
