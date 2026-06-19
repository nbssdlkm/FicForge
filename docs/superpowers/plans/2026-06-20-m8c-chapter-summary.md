# M8-C Chapter Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每章生成一条 `standard` 叙事摘要，嵌入向量库新 `summaries` collection，在 P4 RAG 检索注入，给 LLM 连贯的整章记忆。

**Architecture:** A2（RAG 嵌入）。摘要在 confirm 落盘后 best-effort 生成（1 次 LLM call），存 `chapters/main/ch{NNNN}.summary.jsonl`，嵌入为 `collection:"summaries"` 的 1 个向量，复用现有 `JsonVectorEngine` + `retrieve_rag`。门控复用 `getSimpleFeatures(mode).disableChapterSummary`。

**Tech Stack:** TypeScript（src-engine）、vitest、openai-node（LLMProvider/EmbeddingProvider）、PlatformAdapter 文件 I/O、gpt-tokenizer。

## Global Constraints

- 引擎测试 `cd src-engine && npx vitest run` 必须全绿；不破坏 full 模式既有行为（golden/budget/confirm/undo）。
- `full` 模式默认 `disableChapterSummary=false`；`simple` 模式 `=true`（`config/simple_features.ts` 单一真相源，禁止平行开关）。
- 决策①：只生成 `standard` 一档；`micro`/`detailed` 键预留不生成不读。
- 决策②：摘要生成/嵌入失败只经 `logCatch` 记录，绝不回滚或阻断章节确认。
- 决策③：检索时排除 `metadata.chapter === current_chapter` 的摘要。
- 决策④：门控读 `getSimpleFeatures(settings.app.writing_mode).disableChapterSummary`。
- 章节号格式 `ch{NNNN}`（4 位零填充，如 `ch0007`）。
- prompt key 新增必须同时进 `keys.ts` 的 `REQUIRED_KEYS` + `zh.ts` + `en.ts`（i18n 覆盖 lint 会校验）。
- 提交只 stage 明确文件，禁止 `git add -A`/`-A`；提交信息末尾带 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

### Task 1: ChapterSummary domain 类型

**Files:**
- Create: `src-engine/domain/chapter_summary.ts`
- Test: `src-engine/domain/__tests__/chapter_summary.test.ts`

**Interfaces:**
- Produces: `interface ChapterSummary { standard: SummaryTier | null }`；`interface SummaryTier { version: number; text: string; generated_at: string; source_chapter_hash: string }`；`createChapterSummary(partial): ChapterSummary`。

- [ ] **Step 1: Write the failing test**

```ts
// src-engine/domain/__tests__/chapter_summary.test.ts
import { describe, it, expect } from "vitest";
import { createChapterSummary } from "../chapter_summary.js";

describe("createChapterSummary", () => {
  it("builds a standard tier with provided fields", () => {
    const s = createChapterSummary({
      standard: { version: 1, text: "摘要", generated_at: "2026-06-20T00:00:00Z", source_chapter_hash: "abc" },
    });
    expect(s.standard?.text).toBe("摘要");
    expect(s.standard?.version).toBe(1);
  });

  it("defaults standard to null when absent", () => {
    expect(createChapterSummary({}).standard).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-engine && npx vitest run domain/__tests__/chapter_summary.test.ts`
Expected: FAIL（`createChapterSummary` 未定义 / 模块不存在）

- [ ] **Step 3: Write minimal implementation**

```ts
// src-engine/domain/chapter_summary.ts
// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 单档摘要。M8-C 只生成 standard；micro/detailed 留位（D-0041 §5），本轮不生成不读。 */
export interface SummaryTier {
  version: number;
  text: string;
  generated_at: string;       // ISO 8601
  source_chapter_hash: string; // 章节 content_hash，用于陈旧检测
}

/** 单章摘要文件（chapters/main/ch{NNNN}.summary.jsonl）的内存表示。 */
export interface ChapterSummary {
  standard: SummaryTier | null;
  // micro / detailed 键预留（M8-C 不生成）
}

export function createChapterSummary(partial: Partial<ChapterSummary>): ChapterSummary {
  return { standard: partial.standard ?? null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-engine && npx vitest run domain/__tests__/chapter_summary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-engine/domain/chapter_summary.ts src-engine/domain/__tests__/chapter_summary.test.ts
git commit -m "feat(m8c): ChapterSummary domain 类型

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: RAG_COLLECTIONS 加入 "summaries"

**Files:**
- Modify: `src-engine/domain/context_summary.ts:7`
- Test: `src-engine/domain/__tests__/rag_collections.test.ts`

**Interfaces:**
- Produces: `RAG_COLLECTIONS` 含 `"summaries"`；`RagCollection` 联合类型自动派生新值。

- [ ] **Step 1: Write the failing test**

```ts
// src-engine/domain/__tests__/rag_collections.test.ts
import { describe, it, expect } from "vitest";
import { RAG_COLLECTIONS } from "../context_summary.js";

describe("RAG_COLLECTIONS", () => {
  it("includes the summaries collection", () => {
    expect(RAG_COLLECTIONS).toContain("summaries");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-engine && npx vitest run domain/__tests__/rag_collections.test.ts`
Expected: FAIL（`summaries` 不在数组中）

- [ ] **Step 3: Write minimal implementation**

`src-engine/domain/context_summary.ts:7` 原为：
```ts
export const RAG_COLLECTIONS = ["chapters", "characters", "worldbuilding"] as const;
```
改为：
```ts
export const RAG_COLLECTIONS = ["chapters", "characters", "worldbuilding", "summaries"] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-engine && npx vitest run domain/__tests__/rag_collections.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-engine/domain/context_summary.ts src-engine/domain/__tests__/rag_collections.test.ts
git commit -m "feat(m8c): RAG_COLLECTIONS 加入 summaries

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: ChapterSummaryRepository 接口 + file 实现

**Files:**
- Create: `src-engine/repositories/interfaces/chapter_summary.ts`
- Create: `src-engine/repositories/implementations/file_chapter_summary.ts`
- Test: `src-engine/repositories/implementations/__tests__/file_chapter_summary.test.ts`

**Interfaces:**
- Consumes: `PlatformAdapter`（`exists/readFile/writeFile/mkdir/deleteFile`）、`ChapterSummary`（Task 1）。
- Produces: `interface ChapterSummaryRepository { get(auPath, chapterNum): Promise<ChapterSummary | null>; save(auPath, chapterNum, summary): Promise<void>; remove(auPath, chapterNum): Promise<void> }`；`class FileChapterSummaryRepository`；helper `summaryPath(auPath, chapterNum): string`。

- [ ] **Step 1: Write the failing test**

```ts
// src-engine/repositories/implementations/__tests__/file_chapter_summary.test.ts
import { describe, it, expect } from "vitest";
import { FileChapterSummaryRepository } from "../file_chapter_summary.js";
import { createChapterSummary } from "../../../domain/chapter_summary.js";

// 内存 adapter（仅实现本测试用到的方法）
function memAdapter() {
  const fs = new Map<string, string>();
  return {
    files: fs,
    async exists(p: string) { return fs.has(p); },
    async readFile(p: string) { const v = fs.get(p); if (v === undefined) throw new Error("ENOENT"); return v; },
    async writeFile(p: string, c: string) { fs.set(p, c); },
    async mkdir(_p: string) {},
    async deleteFile(p: string) { fs.delete(p); },
  } as any;
}

describe("FileChapterSummaryRepository", () => {
  it("round-trips a standard summary", async () => {
    const repo = new FileChapterSummaryRepository(memAdapter());
    const s = createChapterSummary({
      standard: { version: 1, text: "第七章摘要", generated_at: "2026-06-20T00:00:00Z", source_chapter_hash: "h7" },
    });
    await repo.save("/au", 7, s);
    const got = await repo.get("/au", 7);
    expect(got?.standard?.text).toBe("第七章摘要");
    expect(got?.standard?.source_chapter_hash).toBe("h7");
  });

  it("returns null when no summary file exists", async () => {
    const repo = new FileChapterSummaryRepository(memAdapter());
    expect(await repo.get("/au", 99)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-engine && npx vitest run repositories/implementations/__tests__/file_chapter_summary.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

```ts
// src-engine/repositories/interfaces/chapter_summary.ts
// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
import type { ChapterSummary } from "../../domain/chapter_summary.js";

export interface ChapterSummaryRepository {
  get(auPath: string, chapterNum: number): Promise<ChapterSummary | null>;
  save(auPath: string, chapterNum: number, summary: ChapterSummary): Promise<void>;
  remove(auPath: string, chapterNum: number): Promise<void>;
}
```

```ts
// src-engine/repositories/implementations/file_chapter_summary.ts
// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
import type { PlatformAdapter } from "../../platform/adapter.js";
import type { ChapterSummary } from "../../domain/chapter_summary.js";
import { createChapterSummary } from "../../domain/chapter_summary.js";
import type { ChapterSummaryRepository } from "../interfaces/chapter_summary.js";
import { joinPath } from "./file_utils.js";

/** ch{NNNN}.summary.jsonl 路径。NNNN 为 4 位零填充章节号。 */
export function summaryPath(auPath: string, chapterNum: number): string {
  const padded = String(chapterNum).padStart(4, "0");
  return joinPath(auPath, "chapters", "main", `ch${padded}.summary.jsonl`);
}

export class FileChapterSummaryRepository implements ChapterSummaryRepository {
  constructor(private adapter: PlatformAdapter) {}

  async get(auPath: string, chapterNum: number): Promise<ChapterSummary | null> {
    const path = summaryPath(auPath, chapterNum);
    if (!(await this.adapter.exists(path))) return null;
    try {
      const raw = JSON.parse(await this.adapter.readFile(path)) as Partial<ChapterSummary>;
      return createChapterSummary(raw);
    } catch {
      return null; // 损坏文件按"无摘要"处理（决策②降级精神）
    }
  }

  async save(auPath: string, chapterNum: number, summary: ChapterSummary): Promise<void> {
    const path = summaryPath(auPath, chapterNum);
    const dir = path.substring(0, path.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    await this.adapter.writeFile(path, JSON.stringify(summary, null, 2));
  }

  async remove(auPath: string, chapterNum: number): Promise<void> {
    const path = summaryPath(auPath, chapterNum);
    if (await this.adapter.exists(path)) await this.adapter.deleteFile(path);
  }
}
```

> 注：`.summary.jsonl` 扩展名沿用 D-0041 命名，内容是单个 JSON 对象（每章一条摘要，非多行），不影响功能。`joinPath` 已存在于 `file_utils.ts`。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-engine && npx vitest run repositories/implementations/__tests__/file_chapter_summary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-engine/repositories/interfaces/chapter_summary.ts src-engine/repositories/implementations/file_chapter_summary.ts src-engine/repositories/implementations/__tests__/file_chapter_summary.test.ts
git commit -m "feat(m8c): ChapterSummaryRepository 接口 + file 实现

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Prompt keys（摘要生成 + RAG 标签）

**Files:**
- Modify: `src-engine/prompts/keys.ts`（`REQUIRED_KEYS` 加 3 个 key）
- Modify: `src-engine/prompts/zh.ts`、`src-engine/prompts/en.ts`
- Test: `src-engine/prompts/__tests__/summary_keys.test.ts`

**Interfaces:**
- Produces: prompt key `SUMMARY_STANDARD_SYSTEM`、`SUMMARY_STANDARD_USER`（含 `{chapter_num}`/`{chapter_text}` 占位）、`RAG_LABEL_SUMMARIES`。

- [ ] **Step 1: Write the failing test**

```ts
// src-engine/prompts/__tests__/summary_keys.test.ts
import { describe, it, expect } from "vitest";
import { getPrompts } from "../index.js";

describe("summary prompt keys", () => {
  for (const lang of ["zh", "en"] as const) {
    it(`${lang} defines summary keys`, () => {
      const P = getPrompts(lang);
      expect(P.SUMMARY_STANDARD_SYSTEM.length).toBeGreaterThan(0);
      expect(P.SUMMARY_STANDARD_USER).toContain("{chapter_text}");
      expect(P.RAG_LABEL_SUMMARIES.length).toBeGreaterThan(0);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-engine && npx vitest run prompts/__tests__/summary_keys.test.ts`
Expected: FAIL（key 未定义；TS 也会报 PromptKey 不含这些）

- [ ] **Step 3: Write minimal implementation**

`keys.ts` 的 `REQUIRED_KEYS` 数组里，紧接 `"RAG_LABEL_CHAPTERS",` 之后加：
```ts
  "RAG_LABEL_SUMMARIES",
```
并在 `FACTS_SYSTEM_PROMPT` 所在分组附近（任意位置，数组成员即可）加：
```ts
  // === chapter_summary（M8-C） ===
  "SUMMARY_STANDARD_SYSTEM",
  "SUMMARY_STANDARD_USER",           // f-string with {chapter_num} {chapter_text}
```

`zh.ts`（紧邻 `RAG_LABEL_CHAPTERS: "历史章节片段",` 之后加标签，并在文件内合适位置加两个生成 prompt）：
```ts
  RAG_LABEL_SUMMARIES: "往期章节摘要",
  SUMMARY_STANDARD_SYSTEM:
    "你是一名小说编辑，为单个章节写一段 180-250 字的中文叙事摘要。要求：" +
    "①保留关键情节推进与转折；②保留情绪节拍与人物张力（不要像事实清单那样过滤情感）；" +
    "③第三人称、过去时、连贯成段，不要分点；④只输出摘要正文，不要前言或标题。",
  SUMMARY_STANDARD_USER:
    "为第 {chapter_num} 章写 180-250 字叙事摘要：\n\n{chapter_text}",
```

`en.ts`（对称）：
```ts
  RAG_LABEL_SUMMARIES: "Past Chapter Summaries",
  SUMMARY_STANDARD_SYSTEM:
    "You are a novel editor writing a 180-250 word narrative summary of a single chapter. " +
    "Requirements: (1) keep key plot progression and turns; (2) preserve emotional beats and " +
    "character tension (do NOT filter out emotion the way a fact list would); (3) third person, " +
    "past tense, one coherent paragraph, no bullet points; (4) output only the summary prose, no preamble or title.",
  SUMMARY_STANDARD_USER:
    "Write a 180-250 word narrative summary of chapter {chapter_num}:\n\n{chapter_text}",
```

> ⚠️ UTF-8 no-BOM 写入；写后 `grep -c "锛" src-engine/prompts/zh.ts` 应为 0（无乱码）。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-engine && npx vitest run prompts/__tests__/summary_keys.test.ts` 和既有 i18n 覆盖测试
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-engine/prompts/keys.ts src-engine/prompts/zh.ts src-engine/prompts/en.ts src-engine/prompts/__tests__/summary_keys.test.ts
git commit -m "feat(m8c): 摘要生成 + RAG_LABEL_SUMMARIES prompt keys（zh/en）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 摘要生成服务（纯 LLM）

**Files:**
- Create: `src-engine/services/chapter_summary.ts`
- Test: `src-engine/services/__tests__/chapter_summary.test.ts`

**Interfaces:**
- Consumes: `LLMProvider`（`../llm/provider.js`，`generate({messages,max_tokens,temperature,top_p,signal}) => {content}`）、`getPrompts`。
- Produces: `generate_standard_summary(chapter_text, chapter_num, llm_provider, opts?): Promise<string | null>`（返回摘要正文；空输入或失败返回 null）。`opts?: { language?: string; signal?: AbortSignal }`。

- [ ] **Step 1: Write the failing test**

```ts
// src-engine/services/__tests__/chapter_summary.test.ts
import { describe, it, expect, vi } from "vitest";
import { generate_standard_summary } from "../chapter_summary.js";

function fakeProvider(reply: string) {
  return { generate: vi.fn(async () => ({ content: reply })) } as any;
}

describe("generate_standard_summary", () => {
  it("returns trimmed LLM text", async () => {
    const p = fakeProvider("  第七章，主角与师父决裂。  ");
    const out = await generate_standard_summary("第七章正文……", 7, p);
    expect(out).toBe("第七章，主角与师父决裂。");
    expect(p.generate).toHaveBeenCalledOnce();
  });

  it("returns null on empty chapter without calling LLM", async () => {
    const p = fakeProvider("x");
    expect(await generate_standard_summary("   ", 7, p)).toBeNull();
    expect(p.generate).not.toHaveBeenCalled();
  });

  it("returns null when LLM throws (degrade, no throw)", async () => {
    const p = { generate: vi.fn(async () => { throw new Error("network"); }) } as any;
    expect(await generate_standard_summary("正文", 7, p)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-engine && npx vitest run services/__tests__/chapter_summary.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

```ts
// src-engine/services/chapter_summary.ts
// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Chapter Summary 生成（M8-C，D-0041 §5）。
 * 只生成 standard 档；情感保真靠 prompt 指令（对比 facts_extraction 滤情感）。
 * 失败一律返回 null 降级，绝不抛出（决策②）。
 */
import { getPrompts } from "../prompts/index.js";
import type { LLMProvider } from "../llm/provider.js";

export interface GenerateSummaryOptions {
  language?: string;
  signal?: AbortSignal;
}

export async function generate_standard_summary(
  chapter_text: string,
  chapter_num: number,
  llm_provider: LLMProvider,
  opts?: GenerateSummaryOptions,
): Promise<string | null> {
  if (!chapter_text.trim()) return null;
  const language = opts?.language ?? "zh";
  const P = getPrompts(language as "zh" | "en");

  const messages = [
    { role: "system" as const, content: P.SUMMARY_STANDARD_SYSTEM },
    {
      role: "user" as const,
      content: P.SUMMARY_STANDARD_USER
        .replace("{chapter_num}", String(chapter_num))
        .replace("{chapter_text}", chapter_text),
    },
  ];

  try {
    const response = await llm_provider.generate({
      messages,
      max_tokens: 600,
      temperature: 0.4,
      top_p: 0.95,
      signal: opts?.signal,
    });
    const text = (response.content ?? "").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null; // 决策②：降级，不抛
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-engine && npx vitest run services/__tests__/chapter_summary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-engine/services/chapter_summary.ts src-engine/services/__tests__/chapter_summary.test.ts
git commit -m "feat(m8c): generate_standard_summary 生成服务（失败降级）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: RagManager.indexChapterSummary + rebuildForAu 纳入

**Files:**
- Modify: `src-engine/services/rag_manager.ts`
- Test: `src-engine/services/__tests__/rag_manager_summary.test.ts`

**Interfaces:**
- Consumes: `EmbeddingProvider.embed(texts): Promise<number[][]>`、`JsonVectorEngine.index_chunks(VectorChunk[])`、`ChapterSummaryRepository.get`（注入）。
- Produces: `RagManager.indexChapterSummary(auPath, chapterNum, summaryText, embeddingProvider): Promise<void>`（embed + index + persist，id `sum{N}`，`collection:"summaries"`，metadata `{au_id, chapter, kind:"standard"}`）。`rebuildForAu` 新增可选参 `summaryRepo?: ChapterSummaryRepository`，若该章有摘要则一并 index。

- [ ] **Step 1: Write the failing test**

```ts
// src-engine/services/__tests__/rag_manager_summary.test.ts
import { describe, it, expect, vi } from "vitest";
import { RagManager } from "../rag_manager.js";
import { JsonVectorEngine } from "../../vector/engine.js";

function memAdapter() {
  const fs = new Map<string, string>();
  return {
    async exists(p: string) { return fs.has(p); },
    async readFile(p: string) { const v = fs.get(p); if (v === undefined) throw new Error("ENOENT"); return v; },
    async writeFile(p: string, c: string) { fs.set(p, c); },
    async mkdir(_p: string) {},
    async deleteFile(p: string) { fs.delete(p); },
    async listDir() { return []; },
  } as any;
}

describe("RagManager.indexChapterSummary", () => {
  it("indexes the summary text into the summaries collection", async () => {
    const engine = new JsonVectorEngine(memAdapter());
    const mgr = new RagManager(engine);
    const emb = { embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])) } as any;

    await mgr.indexChapterSummary("/au", 7, "第七章摘要", emb);

    const results = await engine.search("/au", [0.1, 0.2, 0.3], { collection: "summaries", top_k: 5, char_filter: null });
    expect(results.length).toBe(1);
    expect(results[0].content).toBe("第七章摘要");
    expect(results[0].metadata.chapter).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-engine && npx vitest run services/__tests__/rag_manager_summary.test.ts`
Expected: FAIL（`indexChapterSummary` 不存在）

- [ ] **Step 3: Write minimal implementation**

在 `rag_manager.ts` 的 `RagManager` 类中加方法（imports 顶部加 `import type { ChapterSummaryRepository } from "../repositories/interfaces/chapter_summary.js";`）：

```ts
  /**
   * 索引单章 standard 摘要为 summaries collection 的 1 个向量。
   * id `sum{N}`，index_chunks 按 id 去重 → 重新生成自动覆盖。
   */
  async indexChapterSummary(
    auPath: string,
    chapterNum: number,
    summaryText: string,
    embeddingProvider: EmbeddingProvider,
  ): Promise<void> {
    if (!summaryText.trim()) return;
    await this.ensureLoaded(auPath);
    const [embedding] = await embeddingProvider.embed([summaryText]);
    await this.vectorEngine.index_chunks([{
      id: `sum${chapterNum}`,
      collection: "summaries",
      content: summaryText,
      embedding,
      metadata: { au_id: auPath, chapter: chapterNum, kind: "standard" },
    }]);
    await this.vectorEngine.persist(vectorsDir(auPath));
  }
```

并在 `rebuildForAu` 签名加可选 `summaryRepo?: ChapterSummaryRepository`，在逐章循环里、`indexChapterInMemory` 之后追加：

```ts
        if (summaryRepo) {
          const sum = await summaryRepo.get(auPath, ch.chapter_num);
          const text = sum?.standard?.text;
          if (text) {
            const [embedding] = await embeddingProvider.embed([text]);
            await this.vectorEngine.index_chunks([{
              id: `sum${ch.chapter_num}`,
              collection: "summaries",
              content: text,
              embedding,
              metadata: { au_id: auPath, chapter: ch.chapter_num, kind: "standard" },
            }]);
          }
        }
```

（`vectorsDir` 与 `EmbeddingProvider` 已在文件内可用。）

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-engine && npx vitest run services/__tests__/rag_manager_summary.test.ts`
Expected: PASS。另跑既有 `rag_manager` 相关测试确认未回归。

- [ ] **Step 5: Commit**

```bash
git add src-engine/services/rag_manager.ts src-engine/services/__tests__/rag_manager_summary.test.ts
git commit -m "feat(m8c): RagManager.indexChapterSummary + rebuild 纳入摘要

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: retrieve_rag 检索 summaries（衰减 + 排除当前章 + 格式化）

**Files:**
- Modify: `src-engine/services/rag_retrieval.ts`
- Test: `src-engine/services/__tests__/rag_retrieval_summary.test.ts`

**Interfaces:**
- Consumes: `VectorRepository.search`、`RAG_LABEL_SUMMARIES`（Task 4）、`RAG_COLLECTIONS` 含 summaries（Task 2）。
- Produces: `retrieve_rag` 额外检索 `summaries`（`SUMMARIES_TOP_K=4`，时间衰减），过滤 `metadata.chapter === current_chapter`，`formatRagChunks` 新增 summaries 分组，超预算优先级链加入 summaries。

- [ ] **Step 1: Write the failing test**

```ts
// src-engine/services/__tests__/rag_retrieval_summary.test.ts
import { describe, it, expect } from "vitest";
import { retrieve_rag } from "../rag_retrieval.js";

// 假 vector repo：summaries 返回两条（ch5, ch6=当前章应被排除）
function fakeVectorRepo() {
  return {
    async search(_au: string, _q: number[], opts: any) {
      if (opts.collection === "summaries") {
        return [
          { content: "第五章摘要", chapter_num: 5, score: 0.9, metadata: { chapter: 5 } },
          { content: "第六章摘要", chapter_num: 6, score: 0.95, metadata: { chapter: 6 } },
        ];
      }
      return [];
    },
  } as any;
}
const emb = { embed: async (t: string[]) => t.map(() => [0.1, 0.2]) } as any;

describe("retrieve_rag summaries", () => {
  it("retrieves summaries, excludes the current chapter, labels them", async () => {
    const [text] = await retrieve_rag(
      fakeVectorRepo(), emb, "/au", "query", 5000, null, { mode: "api" },
      0.05, /* current_chapter */ 6, "zh",
    );
    expect(text).toContain("往期章节摘要");
    expect(text).toContain("第五章摘要");
    expect(text).not.toContain("第六章摘要"); // 当前章被排除（决策③）
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-engine && npx vitest run services/__tests__/rag_retrieval_summary.test.ts`
Expected: FAIL（summaries 未检索/未排除/未格式化）

- [ ] **Step 3: Write minimal implementation**

在 `retrieve_rag` 内、`chapters` 检索块之后加 summaries 检索（带衰减 + 排除当前章）：

```ts
  // summaries collection（带时间衰减；排除当前章——其全文已在 P2）
  const SUMMARIES_TOP_K = 4;
  const sumChunks = await searchCollection(
    vector_repo, au_id, queryEmbedding, "summaries" as any, SUMMARIES_TOP_K, char_filter,
  );
  for (const c of sumChunks) {
    const chNum = (c.metadata?.chapter as number) ?? c.chapter_num ?? 0;
    if (chNum === current_chapter) continue; // 决策③
    const decay = Math.exp(-rag_decay_coefficient * Math.max(0, current_chapter - chNum));
    allChunks.push({ ...c, score: c.score * decay, _collection: "summaries" });
  }
```

> 注：`searchCollection` 的 `collection` 形参类型当前是 `"chapters" | "characters" | "worldbuilding"`，把它放宽为 `string`（或加 `"summaries"`），保持 `vector_repo.search` 调用不变。

`formatRagChunks` 的 `labelMap` 加：
```ts
    summaries: P.RAG_LABEL_SUMMARIES,
```
并把分组输出顺序数组 `["characters", "worldbuilding", "chapters"]` 改为 `["characters", "worldbuilding", "summaries", "chapters"]`。

超预算优先级链 `const priority = ["characters", "chapters", "worldbuilding"];` 改为 `["characters", "summaries", "chapters", "worldbuilding"];`。

`toRagChunkDetail` 中，`chapter_num` 仅 chapters 有意义那段，扩展为 `chapters`/`summaries` 都带 chapter_num：
```ts
  if ((c._collection === "chapters" || c._collection === "summaries") && c.chapter_num > 0) {
    detail.chapter_num = c.chapter_num;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-engine && npx vitest run services/__tests__/rag_retrieval_summary.test.ts`
Expected: PASS。另跑既有 `rag_retrieval` 测试确认未回归。

- [ ] **Step 5: Commit**

```bash
git add src-engine/services/rag_retrieval.ts src-engine/services/__tests__/rag_retrieval_summary.test.ts
git commit -m "feat(m8c): retrieve_rag 检索 summaries + 排除当前章 + 标签

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: 引擎编排器（生成→存→索引，门控+best-effort）

**Files:**
- Modify: `src-engine/services/chapter_summary.ts`（加编排函数）
- Modify: `src-engine/services/index.ts`（导出新 service/类型/repo）
- Test: `src-engine/services/__tests__/chapter_summary_orchestrate.test.ts`

**Interfaces:**
- Consumes: `generate_standard_summary`（Task 5）、`ChapterSummaryRepository.save`（Task 3）、`RagManager.indexChapterSummary`（Task 6）、`compute_content_hash`（`repositories/implementations/file_utils.js`）。
- Produces: `generate_and_index_summary(deps): Promise<boolean>`，`deps = { auPath, chapterNum, chapterText, contentHash, llmProvider, embeddingProvider, summaryRepo, ragManager, language?, signal? }`。返回是否成功生成；任何失败经 `logCatch("summary", ...)` 后返回 false（决策②）。

- [ ] **Step 1: Write the failing test**

```ts
// src-engine/services/__tests__/chapter_summary_orchestrate.test.ts
import { describe, it, expect, vi } from "vitest";
import { generate_and_index_summary } from "../chapter_summary.js";

describe("generate_and_index_summary", () => {
  it("generates, saves, and indexes; returns true", async () => {
    const summaryRepo = { save: vi.fn(async () => {}), get: vi.fn(), remove: vi.fn() } as any;
    const ragManager = { indexChapterSummary: vi.fn(async () => {}) } as any;
    const ok = await generate_and_index_summary({
      auPath: "/au", chapterNum: 7, chapterText: "第七章正文", contentHash: "h7",
      llmProvider: { generate: vi.fn(async () => ({ content: "第七章摘要" })) } as any,
      embeddingProvider: { embed: vi.fn(async (t: string[]) => t.map(() => [0.1])) } as any,
      summaryRepo, ragManager,
    });
    expect(ok).toBe(true);
    expect(summaryRepo.save).toHaveBeenCalledOnce();
    expect(ragManager.indexChapterSummary).toHaveBeenCalledWith("/au", 7, "第七章摘要", expect.anything());
  });

  it("returns false and does not throw when generation yields null", async () => {
    const summaryRepo = { save: vi.fn(), get: vi.fn(), remove: vi.fn() } as any;
    const ragManager = { indexChapterSummary: vi.fn() } as any;
    const ok = await generate_and_index_summary({
      auPath: "/au", chapterNum: 7, chapterText: "   ", contentHash: "h7",
      llmProvider: { generate: vi.fn() } as any,
      embeddingProvider: { embed: vi.fn() } as any,
      summaryRepo, ragManager,
    });
    expect(ok).toBe(false);
    expect(summaryRepo.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-engine && npx vitest run services/__tests__/chapter_summary_orchestrate.test.ts`
Expected: FAIL（`generate_and_index_summary` 不存在）

- [ ] **Step 3: Write minimal implementation**

在 `services/chapter_summary.ts` 追加（imports 顶部加 `import { logCatch } from "../logger/index.js";`、`import { createChapterSummary } from "../domain/chapter_summary.js";`、`import { now_utc } from "../repositories/implementations/file_utils.js";`、相关类型 import）：

```ts
import type { EmbeddingProvider } from "../llm/embedding_provider.js";
import type { ChapterSummaryRepository } from "../repositories/interfaces/chapter_summary.js";
import type { RagManager } from "./rag_manager.js";

export interface SummaryOrchestrateDeps {
  auPath: string;
  chapterNum: number;
  chapterText: string;
  contentHash: string;
  llmProvider: LLMProvider;
  embeddingProvider: EmbeddingProvider;
  summaryRepo: ChapterSummaryRepository;
  ragManager: RagManager;
  language?: string;
  signal?: AbortSignal;
}

/** 生成→存→索引；全程 best-effort，失败 log 后返回 false，绝不抛（决策②）。 */
export async function generate_and_index_summary(deps: SummaryOrchestrateDeps): Promise<boolean> {
  try {
    const text = await generate_standard_summary(
      deps.chapterText, deps.chapterNum, deps.llmProvider,
      { language: deps.language, signal: deps.signal },
    );
    if (!text) return false;
    const summary = createChapterSummary({
      standard: { version: 1, text, generated_at: now_utc(), source_chapter_hash: deps.contentHash },
    });
    await deps.summaryRepo.save(deps.auPath, deps.chapterNum, summary);
    await deps.ragManager.indexChapterSummary(deps.auPath, deps.chapterNum, text, deps.embeddingProvider);
    return true;
  } catch (err) {
    logCatch("summary", `Failed to generate/index summary for chapter ${deps.chapterNum}`, err);
    return false;
  }
}
```

`services/index.ts` 加导出：
```ts
export { generate_standard_summary, generate_and_index_summary } from "./chapter_summary.js";
export type { ChapterSummary, SummaryTier } from "../domain/chapter_summary.js";
export { FileChapterSummaryRepository } from "../repositories/implementations/file_chapter_summary.js";
export type { ChapterSummaryRepository } from "../repositories/interfaces/chapter_summary.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-engine && npx vitest run services/__tests__/chapter_summary_orchestrate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-engine/services/chapter_summary.ts src-engine/services/index.ts src-engine/services/__tests__/chapter_summary_orchestrate.test.ts
git commit -m "feat(m8c): 摘要编排器 generate_and_index_summary + 引擎导出

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: 接线 confirm + edit 接缝（UI api）+ engine-instance 注册

**Files:**
- Modify: `src-ui/src/api/engine-instance.ts`（注册 `chapterSummary` repo）
- Modify: `src-ui/src/api/engine-chapters.ts`（confirm 后 + updateChapterContent 后调编排器）
- Test: 手动 + tsc（UI 层无单测框架覆盖此 seam；逻辑已在 Task 8 测）

**Interfaces:**
- Consumes: Task 8 的 `generate_and_index_summary`、`getSimpleFeatures`、`createEmbeddingProvider`、`create_provider`、`resolve_llm_config`、`compute_content_hash`。

- [ ] **Step 1: 在 engine-instance.ts 注册 summary repo**

在 `EngineInstance` 类型与构造里，仿 `trash`/`repos` 加：
```ts
// import
import { FileChapterSummaryRepository } from "@ficforge/engine";
// 类型字段
chapterSummary: ChapterSummaryRepository;
// 构造
chapterSummary: new FileChapterSummaryRepository(adapter),
```
（`ChapterSummaryRepository` 类型从 `@ficforge/engine` import。）

- [ ] **Step 2: 在 confirmChapter 的 RAG 索引块内追加摘要生成**

`engine-chapters.ts` 现有 `try { const embProvider = createEmbeddingProvider(sett, proj); if (embProvider) { ... indexChapter ... } }` 块内，`indexChapter` 之后、状态升级之前追加：
```ts
        if (!getSimpleFeatures(sett.app.writing_mode).disableChapterSummary) {
          const llmCfg = resolve_llm_config(sett, proj);
          const canGen = llmCfg.mode === "ollama" || (llmCfg.mode === "api" && !!llmCfg.api_key);
          if (canGen) {
            await generate_and_index_summary({
              auPath, chapterNum, chapterText: chContent,
              contentHash: result.content_hash,
              llmProvider: create_provider(llmCfg),
              embeddingProvider: embProvider,
              summaryRepo: e.chapterSummary,
              ragManager: e.ragManager,
              language: sett.app?.language || "zh",
            });
          }
        }
```
（`getSimpleFeatures`、`generate_and_index_summary` 从 `@ficforge/engine` import；`result.content_hash` 来自 confirm 返回，已有。整块仍在原 try/catch 内 → 决策②满足。）

- [ ] **Step 3: 在 updateChapterContent（编辑）后重生成摘要**

定位 `engine-chapters.ts` 的 `updateChapterContent` / 调 `edit_chapter_content` 的 wrapper，在编辑落盘成功后，仿 Step 2 加一段同样的门控+编排调用（用编辑后的新内容与新 content_hash）。若该 wrapper 当前不返回 content_hash，用 `compute_content_hash(newContent)` 现算。包在独立 try/catch + `logCatch("summary", ...)`。

- [ ] **Step 4: 编译 + 既有测试**

Run: `cd src-engine && npx tsc --noEmit` 与 `cd ../src-ui && npx tsc --noEmit`
Run: `cd ../src-engine && npx vitest run`
Expected: tsc 双端干净；引擎测试全绿。

- [ ] **Step 5: Commit**

```bash
git add src-ui/src/api/engine-instance.ts src-ui/src/api/engine-chapters.ts
git commit -m "feat(m8c): 接线 confirm/edit 接缝生成摘要 + 注册 summary repo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: 全量回归 + golden 预期 delta

**Files:**
- Modify（按需）: `src-engine/services/__tests__/*golden*` / budget 基线（若新 RAG 标签进入断言）
- Test: 全套

- [ ] **Step 1: 跑全套引擎测试**

Run: `cd src-engine && npx vitest run`
Expected: 全绿。若某 golden/budget 断言因新增 `summaries` 分组或 prompt key 数量变化而失败 → 属预期内非零回归。

- [ ] **Step 2: 核对失败属预期**

逐个失败断言确认：差异仅来自 (a) prompt key 总数 +3，(b) full 模式 RAG 文本可能多 `往期章节摘要` 分组（仅当测试 fixture 含 summaries 向量时；多数 golden 不含 → 不应变）。确认无意外行为漂移。

- [ ] **Step 3: 更新基线**

仅对确认属预期的断言更新期望值（如 prompt key count）。不放宽任何行为断言。

- [ ] **Step 4: 全绿 + tsc**

Run: `cd src-engine && npx vitest run && npx tsc --noEmit`
Run: `cd ../src-ui && npx vitest run && npx tsc --noEmit`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add -u src-engine/services/__tests__
git commit -m "test(m8c): 更新 golden/budget 基线（prompt keys +3 等预期 delta）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 实现后验证（verification-before-completion）

- [ ] `cd src-engine && npx vitest run` 全绿（贴输出）
- [ ] `cd src-engine && npx tsc --noEmit` 干净；`cd src-ui && npx tsc --noEmit` 干净
- [ ] `grep -rn "disableChapterSummary" src-engine` 确认 flag 有真实消费者（engine-chapters）
- [ ] simple 模式不生成摘要、full 模式生成（代码走查 + 测试）
- [ ] 每个 commit 已发后台 codex 审，findings 已 triage

## Codex 复审修正（2026-06-20，计划阶段 codex 审，已折叠进下列任务）

codex plan review 出 2 BLOCKER + 5 MAJOR，逐条对代码验证均属实，修正如下（T1–T4 不受影响，已合）：

- **[BLOCKER1 → T6]** `repositories/interfaces/vector.ts`：`VectorChunk.collection` 与 `SearchOptions.collection` 是字面量联合 `"chapters"|"characters"|"worldbuilding"`，且 `metadata` 要求 `chunk_index`+`branch_id`。→ T6 先改 vector.ts：collection 用 `RagCollection`（domain 单一真相源），`metadata.chunk_index`/`branch_id` 改可选，加 `kind?: string`。
- **[BLOCKER2 → T9]** `resolve_llm_config` 真实签名是 `(session_llm, project, settings)`，既有 seam 用 `resolve_llm_config(null, proj, sett)`。→ T9 用 `resolve_llm_config(null, proj, sett)`，不是 `(sett, proj)`。
- **[MAJOR3 → T9]** `engine-state.ts:68` 的 `rebuildForAu(auPath, e.repos.chapter, embProvider, proj.cast_registry)` 没传 summaryRepo → 全量重建漏摘要。→ T9 更新该调用传 `e.chapterSummary`。
- **[MAJOR4 → T7]** `retrieve_rag` 收 `state.current_chapter`（待写章）；P2 注入 `current-1`（最近已确认章）。排除 `chapter === current_chapter` 排错对象。→ T7 改为排除 `chapter >= current_chapter - 1`（真正在 P2 的那章）。
- **[MAJOR5 → T9]** 摘要生成若塞进 confirm 现有 RAG try（promote READY 那段），摘要失败会阻止 READY、留 STALE，违反决策②。→ T9 把摘要生成放**独立 try/catch**，在 READY 升级**之后/之外**，自带 `logCatch("summary",...)`。
- **[MAJOR6 → 去范围]** spec §8 的"检索/重建时 hash 不符 warn"需要 retrieve_rag 拿章节内容/repo，当前无此依赖，欠定义。→ **本轮删除该 warn**（留 M10）。编辑后的新鲜度靠全量重建解决。
- **[MAJOR7 → T9]** 编辑 (`chapter_edit.ts:61`) 标 `index_status=STALE` 且不增量重索引 chunk。只对摘要做 per-edit 重生成会造成"新摘要 + 陈旧 chunk"混态且不一致。→ **T9 删除 per-edit 摘要重生成**；编辑后摘要随全量重建（Recalc）一起刷新，与 chunk 行为一致。

## Codex 审阅协议（每块完成后，非阻塞）

每个 Task commit 后，后台发：
```bash
codex exec "Review the latest commit's diff for correctness, missed edge cases, and whether it matches the M8-C spec at docs/superpowers/specs/2026-06-20-m8c-chapter-summary-design.md. Be terse. Do NOT read files under .claude/ or agents/." -s read-only -c 'model_reasoning_effort="medium"' < /dev/null > /tmp/codex_m8c_taskN.txt 2>&1
```
（run_in_background；约 5-7 min 返回。继续下一 Task，不等。返回后 triage findings：真 bug 当场修，风格建议记录。）
