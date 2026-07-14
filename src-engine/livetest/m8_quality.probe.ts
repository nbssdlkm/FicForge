// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
//
// M8 真 LLM 输出质量探针（NOT a unit test — hits network, needs local keys）。
// 跑法：npx vitest run --config vitest.live.config.ts
// 目的：肉眼验 M8-C 摘要情感保真 / M8-A 富化字段合理性 / M10 回望后见之明。
// 单测覆盖不到「测试绿≠真 works」那一层。故意放 livetest/（不在 __tests__，正常 suite 不收）。
//
// LLM = ~/.deepseek/config.toml 的 base_url + flash_model（现为火山方舟 deepseek-v4-flash-260425）；
//       DEEPSEEK_PROBE_MODEL / 旧 M8_PROBE_MODEL 环境变量可覆盖模型。
// Embedding = 硅基流动 bge-m3（~/.siliconflow/api_key）。
// 注：历史基线在 deepseek-chat 上测（2026-07-24 官方停用），换模型后质量观感不可直接对旧记录比。

import { describe, it, expect } from "vitest";

import { RemoteEmbeddingProvider } from "../llm/embedding_provider.js";
import { makeDeepseekProbeProvider, siliconflowKey } from "./_deepseek.js";
import { generateStandardSummary, generateMicroSummary } from "../services/chapter_summary.js";
import { extractFactsFromChapter } from "../services/facts_extraction.js";
import { runRetrospective } from "../services/retrospective.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { ChapterSummaryRepository } from "../repositories/interfaces/chapter_summary.js";
import type { RagManager } from "../services/rag_manager.js";

// ---------------------------------------------------------------------------
// Keys / providers（网关 + 模型走 config.toml 单一真相源，见 _deepseek.ts）
// ---------------------------------------------------------------------------

const {
  provider: llm,
  model: PROBE_MODEL,
  baseUrl: PROBE_BASE,
} = makeDeepseekProbeProvider({
  legacyEnvVar: "M8_PROBE_MODEL",
});
const embed = new RemoteEmbeddingProvider("https://api.siliconflow.cn/v1", siliconflowKey(), "BAAI/bge-m3");
const llmConfig = { mode: "api" };
console.log(`[M8 probe] LLM = ${PROBE_MODEL} @ ${PROBE_BASE}`);

// ---------------------------------------------------------------------------
// 样例：原创、题材中立的宫廷悬疑短篇（无真实游戏/品牌名）。
// 设计成能触发全部 M8-A 字段 + 一个需要后见之明修订的开篇章。
// ---------------------------------------------------------------------------

const CHAPTERS: Record<number, string> = {
  1: `灯阁的烛火在后半夜最是昏沉。沈砚伏在长案前誊抄旧档，指尖被纸边割出一道细口也浑然不觉。
她翻到那卷褪色的名录时，本只想照例抄录，却在装订的夹缝里摸到一角硬纸——是被人匆匆撕去后残留的半页。
残角上只剩三个未尽的字，墨迹却让她心口一凉：那是父亲的笔锋，收锋时惯有的那一顿，她认得。
父亲死于十年前的那场清算，罪名是私通外邦。可这半页名录，分明不该有他的字。
沈砚听见廊下值夜的脚步声由远及近，她几乎没有思量，便将残角折进袖中，重新提笔，像什么都没发生。
烛花爆了一下。她对着空荡的阁子，谁也没有告诉。`,
  2: `裴照当值的这一夜，灯阁的门栓响了两回。
头一回是换岗，第二回，却是太傅独自来的。
按例，三品以上才可夜入灯阁查档，太傅自然够格。可他没带随从，袖口沾着未干的墨，神色比烛火还要飘忽。
"近来旧档可有人动过？"太傅问得轻描淡写，目光却在排架上逡巡，像在找一卷不肯认的东西。
裴照躬身答：今夜只沈书令在内誊抄。太傅"嗯"了一声，便径自往最里的那排名录架去了。
裴照退到阶下，没有多想——他只当是哪位老臣睡不着，来翻旧账。
他不知道，他随口通报的那个名字，正把一桩十年前的旧案，重新点着。`,
  3: `天未亮，沈砚已把残角与库中另一卷副录并排铺开。
两卷本该一字不差，可副录上父亲的名字下，"通敌"二字的墨色比四周新出小半成——是后填的。
她又比出三处涂改：日期被挪后了一旬，证人画押的指节纹路对不上，连判词的用印都偏了半分。
十年了，她第一次敢确信：父亲不是叛臣，是有人改了名录，把一个忠字改成了叛字。
窗纸泛白时，沈砚把残角贴身收好。她知道再抄一万卷旧档也换不回一个人，但她可以面圣。
哪怕只有半页纸，她也要让那半个字，在金殿上重新被人念出来。`,
  4: `她想起十年前的那个冬夜，也是这样的昏灯。
那时她还够不到父亲的书案，只能踮脚看他把一封信凑近烛火。
火舌舔上信纸，父亲的脸在明灭里忽老忽轻。他没回头，只低声对她说了一句话。
"阿砚，记着——灯灭之前，别信任何人。"
她那时不懂，只觉得父亲的手在抖。第二天，家门口就来了带刀的人。
多年后她才慢慢咂摸出那句话的分量：父亲烧的不是信，是某些人不愿留下的名字。
而他把唯一没烧尽的那一角，留给了灯阁，留给了总有一天会翻到它的她。`,
  5: `面圣那日，金殿的砖比灯阁的夜还要冷。
沈砚还没开口，太傅已先一步出列，将一卷文书举过头顶："陛下，沈书令私藏宫档，夤夜涂抹名录，其心可诛。"
满殿哗然。那卷文书上，赫然是她这些日子比对的笔迹摹本——有人一直在她身后看着。
皇帝没有立刻发话。他只是看着阶下那个单薄的身影，目光里有沈砚读不懂的东西。
"沈砚，"皇帝终于开口，"你可有话说。"
她抬起头，从袖中取出那半页残角，迎着满殿的目光，一字一字道："臣有一物，请陛下亲验。"
烛未燃，殿上无人知道，这半页纸将点着的，是谁的灯，又是谁的火。`,
};

const CAST = { characters: ["沈砚", "裴照", "太傅", "皇帝"] };

function line(label: string): void {
  console.log(`\n${"=".repeat(78)}\n${label}\n${"=".repeat(78)}`);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe("M8 real-LLM quality probe", () => {
  // 存每章生成的 standard/micro，供 retrospective 复用
  const store = new Map<
    number,
    { standard?: { text: string; source_chapter_hash: string }; micro?: { text: string } }
  >();

  it("M8-C standard + micro summaries (情感保真)", async () => {
    for (const num of [1, 2, 3, 4, 5]) {
      const text = CHAPTERS[num];
      const standard = await generateStandardSummary(text, num, llm, { language: "zh" });
      const micro = await generateMicroSummary(text, num, llm, { language: "zh" });
      line(`第 ${num} 章 摘要`);
      console.log(`[standard ${standard?.length ?? 0}字]\n${standard}`);
      console.log(`\n[micro ${micro?.length ?? 0}字]\n${micro}`);
      expect(standard).toBeTruthy();
      expect(micro).toBeTruthy();
      store.set(num, {
        standard: { text: standard!, source_chapter_hash: `hash-ch${num}` },
        micro: { text: micro! },
      });
    }
  }, 300_000);

  it("M8-A fact enrichment (富化字段合理性)", async () => {
    for (const num of [1, 3, 4]) {
      const facts = await extractFactsFromChapter({
        chapter_text: CHAPTERS[num],
        chapter_num: num,
        existing_facts: [],
        cast_registry: CAST,
        character_aliases: null,
        llm_provider: llm,
        llm_config: llmConfig,
        opts: { language: "zh" },
      });
      line(`第 ${num} 章 提取事实（${facts.length} 条）`);
      for (const f of facts) {
        console.log(
          JSON.stringify(
            {
              content_clean: f.content_clean,
              characters: f.characters,
              fact_type: f.fact_type,
              narrative_weight: f.narrative_weight,
              status: f.status,
              location: f.location,
              story_time_tag: f.story_time_tag,
              story_time_order: f.story_time_order,
              time_kind: f.time_kind,
              action_verb: f.action_verb,
              caused_by: f.caused_by,
              known_to: f.known_to,
              hidden_from: f.hidden_from,
              suspense_type: f.suspense_type,
              _confidence: f._confidence,
            },
            null,
            2,
          ),
        );
      }
      expect(facts.length).toBeGreaterThan(0);
    }
  }, 300_000);

  it("M10 retrospective (后见之明修订 第1章)", async () => {
    // 先确保 store 有第1章 standard + 第2/3/4章 micro（依赖上面 summary 测试已跑）。
    if (!store.get(1)?.standard) {
      // 独立兜底：单跑本测试时补生成
      for (const num of [1, 2, 3, 4]) {
        const standard = num === 1 ? await generateStandardSummary(CHAPTERS[num], num, llm, { language: "zh" }) : null;
        const micro = await generateMicroSummary(CHAPTERS[num], num, llm, { language: "zh" });
        store.set(num, {
          standard: standard ? { text: standard, source_chapter_hash: `hash-ch${num}` } : store.get(num)?.standard,
          micro: micro ? { text: micro } : undefined,
        });
      }
    }

    // generateRetrospective 步骤1 用 chapterRepo.get()（拿 content + content_hash 供 CAS），
    // 不是 getContentOnly —— stub 必须实现 get，否则 undefined 调用即抛 → 回望静默返回 null。
    const chapterRepo = {
      get: async (_au: string, n: number) => ({ content: CHAPTERS[n], content_hash: `hash-ch${n}` }),
      getContentOnly: async (_au: string, n: number) => CHAPTERS[n],
    } as unknown as ChapterRepository;

    let captured: { text: string; hash: string } | null = null;
    const summaryRepo = {
      get: async (_au: string, n: number) => store.get(n) ?? null,
      promoteToV2: async (_au: string, _n: number, text: string, hash: string) => {
        captured = { text, hash };
      },
    } as unknown as ChapterSummaryRepository;

    const ragManager = {
      indexChapterSummary: async () => {},
    } as unknown as RagManager;

    line("第 1 章 原 standard 摘要（回望前）");
    console.log(store.get(1)?.standard?.text);
    console.log("\n后续 micro（喂给回望的后见之明）:");
    for (const n of [2, 3, 4]) console.log(`  第${n}章: ${store.get(n)?.micro?.text}`);

    await runRetrospective({
      auPath: "test-au",
      targetChapterNum: 1,
      chapterRepo,
      summaryRepo,
      ragManager,
      embeddingProvider: embed,
      llmProvider: llm,
      currentChapter: 5,
      opts: { language: "zh" },
    });

    line("第 1 章 回望后 standard v2（后见之明修订版）");
    console.log((captured as { text: string; hash: string } | null)?.text ?? "(null — 回望未产出)");
    expect(captured).toBeTruthy();
  }, 300_000);

  it("embedding 端到端（bge-m3 1024 维 + 语义相似度合理性）", async () => {
    const s1 = store.get(1)?.standard?.text ?? CHAPTERS[1];
    const s3 = store.get(3)?.standard?.text ?? CHAPTERS[3];
    const queryRelated = "父亲被冤枉，名录被人篡改";
    const queryUnrelated = "今天的早餐吃了一碗面条";
    const vecs = await embed.embed([s1, s3, queryRelated, queryUnrelated]);
    line("Embedding 端到端");
    console.log(`dimension = ${vecs[0].length}（期望 1024）`);
    console.log(`sim(摘要1, 摘要3 同故事)      = ${cosine(vecs[0], vecs[1]).toFixed(4)}`);
    console.log(`sim(摘要3, "父亲被冤枉"相关)  = ${cosine(vecs[1], vecs[2]).toFixed(4)}`);
    console.log(`sim(摘要3, "早餐面条"无关)    = ${cosine(vecs[1], vecs[3]).toFixed(4)}`);
    expect(vecs[0].length).toBe(1024);
    // 相关查询应比无关查询更贴近摘要3
    expect(cosine(vecs[1], vecs[2])).toBeGreaterThan(cosine(vecs[1], vecs[3]));
  }, 120_000);
});
