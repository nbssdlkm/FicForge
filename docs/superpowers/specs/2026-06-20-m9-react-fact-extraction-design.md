# M9 ReAct 事实提取 — 工程设计 Spec

**文档路径（建议）**：`docs/superpowers/specs/2026-06-20-m9-react-fact-extraction-design.md`
**状态**：DRAFT — 待 CC 审核定稿
**日期**：2026-06-20
**关联决策**：D-0041（Memory 三层架构）、D-0042（ReAct 生成 + 选择性 ReAct 提取）

---

## 0. 前提假设与 Grounding 声明

本 spec 基于以下精确代码阅读结果（非推断）：

- `src-engine/services/facts_extraction.ts`（单章提取、批量提取、`rawToExtracted`、`splitTextForExtraction`）
- `src-engine/services/agent_loop.ts`、`simple_chat_dispatch.ts`、`tool_args_repair.ts`、`tool_stream_buffer.ts`、`agent_telemetry.ts`
- `src-ui/src/api/engine-facts.ts`、`src-ui/src/api/facts.ts`（`ExtractedFactCandidate` 类型）
- `src-ui/src/ui/writer/useWriterFactsExtraction.ts`、`DirtyModal.tsx`
- `src-engine/config/simple_features.ts`（`disableFactsExtraction` flag 已定义但未被任何生产路径消费）

凡涉及"当前实现"的描述，已由并行 reader 验证，非记忆推测。

---

## 1. 目标与动机

### 1.1 现状诊断：单次调用的四类结构性缺陷

当前 `extract_facts_from_chapter` 的核心问题不是 prompt 质量，而是**单次调用架构本身决定了它无法做到的事**：

| 缺陷编号 | 技术症状 | 对写手的实际影响 |
|---|---|---|
| L1 | 每个 chunk 一次 `generate()`，无推理/校验/精炼循环 | LLM 首次输出的遗漏或幻觉就是最终答案，无法自我纠正 |
| L2 | `caused_by` 只能引用当前批次输出的字符串，无法访问跨章 `fact_id` | 第 10 章的事件与第 3 章的原因永远无法被系统追踪；因果链断裂 |
| L3 | `thread_ids` 提取路径完全不存在（`ExtractedFact` 接口无此字段；`rawToExtracted` 不读取它） | M8-B 剧情线与事实的关联只能手工维护，M8-B 的核心价值无法自动兑现 |
| L4 | `catch {}` 吞掉所有 LLM 失败，chunk 静默贡献 0 个事实 | 章节长、模型超时时提取结果为空，写手无任何错误反馈 |

### 1.2 M9 的目标：ReAct 循环解决上述四类缺陷

**M9 不是"更好的 prompt"，而是把提取从单次调用改为有推理、有工具调用、有验证循环的 agent 流程。**

具体改进与用户结果的对应关系：

**改进 A：跨章 `caused_by` 精准引用**
- 技术手段：ReAct 循环中加入 `search_existing_facts` 工具，让 LLM 能检索已持久化的事实（含 `fact_id`），从候选列表中选取真实 ID 填入 `caused_by`
- 用户结果：当读者续写到"灵力枯竭"时，AI 能追溯"因为第 3 章修炼失败"，而不是凭空捏造或留空；事实图谱有实际的因果边，而不是孤立节点

**改进 B：`thread_ids` 自动检测，激活 M8-B 剧情线**
- 技术手段：ReAct 循环加入 `propose_thread_assignment` 工具；act step 读取现有 `Thread` 列表，为每个提取到的事实提议所属剧情线
- 用户结果：用户在 M8-B 建好剧情线后，后续章节的事实自动归入对应线，不需要一个个手工打标签；剧情线摘要注入续写上下文（M8-B 已实现）因此能获得实际填充的数据

**改进 C：验证循环防幻觉**
- 技术手段：observe step 验证提取到的事实是否在原文中有文本支撑（span 检索），角色名是否在 `cast_registry` 中存在，枚举字段是否一致
- 用户结果：提取结果的事实准确率提升，减少"从未出现的角色被提取为事实"之类的幻觉污染知识库

**改进 D：失败可观测**
- 技术手段：`TelemetrySink` + guard retry 替代 `catch {}`；失败事件写入 audit log，UI 层可感知并提示
- 用户结果：章节提取失败时写手能看到警告，而不是沉默地得到空结果

### 1.3 范围边界

M9 **仅**覆盖事实提取。章节摘要（M8-A Layer 1）、Thread 摘要注入（M8-B）保持现有实现不变。M9 产出的 `caused_by` 和 `thread_ids` 字段将喂入 M8-A/M8-B 的已有消费路径。

---

## 2. ReAct 循环设计

### 2.1 设计原则

- **最大化复用 `runAgentLoop`**：agentloop grounding 确认该 harness 已完全通用，无 simple-chat 耦合。M9 传入自己的 `AgentLoopConfig<ExtractionEvent>`，零改动 harness 本体。
- **所有工具调用自动执行**：提取是后台操作，无人在环；所有 tool_call 在 `onForceToolPath` 中立即 auto-execute，结果推入 `internalHistory`（镜像 `executeReadTool` 模式）。
- **步数预算优先于 token 预算**：extraction loop 是同步前台路径（confirm 章节后立即触发），用户在等待；步数 cap 是体验保障，token 上限是安全阀。

### 2.2 工具集定义（M9 新建）

**文件**：`src-engine/services/react_extraction_tools.ts`

```typescript
// M9 专属工具 — 类比 SIMPLE_TOOL_SCHEMAS，但用途完全不同
export const EXTRACTION_TOOL_SCHEMAS: ToolDefinition[] = [
  SEARCH_EXISTING_FACTS_TOOL,    // 查询已持久化事实，返回 { fact_id, content_clean, characters, chapter_num }[]
  PROPOSE_FACTS_TOOL,             // 提议一组新事实（结构化 JSON array）
  LINK_CAUSED_BY_TOOL,            // 为已提议的事实指定 caused_by fact_id（引用上面搜索结果）
  PROPOSE_THREAD_ASSIGNMENT_TOOL, // 为事实提议 thread_ids（需传入可用 thread 列表）
  VERIFY_FACT_TOOL,               // 验证某个提议事实在原文中的文本支撑
]
```

**每个工具的 Zod schema 草案**：

```typescript
// search_existing_facts
{
  query: z.string().describe("关键词或角色名，用于检索已有事实"),
  characters: z.array(z.string()).optional().describe("按角色过滤"),
  limit: z.number().int().min(1).max(20).default(10),
}

// propose_facts
{
  facts: z.array(z.object({
    content_clean: z.string().min(5),
    fact_type: z.enum(["CHARACTER", "RELATIONSHIP", "WORLD_STATE", "EVENT", "OBJECT", "LOCATION"]),
    narrative_weight: z.enum(["HIGH", "MEDIUM", "LOW"]),
    characters: z.array(z.string()),
    time_kind: z.enum(["ABSOLUTE", "RELATIVE", "FUZZY", "NONE"]).nullable(),
    story_time_tag: z.string().nullable().optional(),
    action_verb: z.string().nullable().optional(),
    known_to: z.union([z.literal("all"), z.literal("reader_only"), z.array(z.string())]).nullable().optional(),
    hidden_from: z.array(z.string()).optional(),
    suspense_type: z.enum(["IRONY", "MYSTERY", "TENSION", "NONE"]).nullable().optional(),
    _confidence: z.record(z.number().min(0).max(1)).optional(),
  }))
}

// link_caused_by
{
  fact_index: z.number().int().describe("propose_facts 输出数组的下标"),
  caused_by_fact_ids: z.array(z.string().regex(/^f_\d+_[0-9a-f]{4}$/)),
}

// propose_thread_assignment
{
  fact_index: z.number().int(),
  thread_ids: z.array(z.string()),
  confidence: z.number().min(0).max(1),
}

// verify_fact
{
  fact_index: z.number().int(),
  expected_span: z.string().describe("预期在原文中存在的关键短语"),
}
```

> **产品决策点 PD-1**（见第 5 节）：工具集粒度——是否拆分 `propose_facts` 和 `link_caused_by`，还是合并为单次 `propose_facts_with_links`？

### 2.3 循环结构

```
系统 prompt（提取指令 + 原文窗口 + 现有事实摘要 + 可用 Thread 列表）
        ↓
 Iter 1: REASON
   LLM 输出 plain text：原文中存在哪些事件/关系/状态，哪些角色出现，哪些可能需要跨章因果
        ↓
 Iter 2: ACT — propose_facts
   LLM 调用 propose_facts 工具，结构化输出一批候选事实
   auto-execute：validate schema → 存入 loop 内部 proposedFacts[] 暂存
        ↓
 Iter 3: ACT — search_existing_facts（可能多次，每次查不同关键词）
   LLM 用已提议事实的关键字检索既有事实库，获得 fact_id 列表
   auto-execute：调用 fact_repo.list_all() → 本地过滤（关键词 + 角色），返回候选
        ↓
 Iter 4: ACT — link_caused_by（可选，仅当搜索结果有相关事实时）
   LLM 选取 fact_id，为 proposedFacts[i] 填写 caused_by
        ↓
 Iter 5: ACT — propose_thread_assignment（可选，仅当 thread 列表非空时）
   LLM 为 proposedFacts[i] 提议 thread_ids
        ↓
 Iter 6: ACT — verify_fact（对 HIGH narrative_weight 事实强制；MEDIUM 按概率）
   LLM 提供 expected_span；auto-execute：在原文中做子串搜索，返回 found/not_found
   若 not_found：loop 继续，LLM 可修正 content_clean 或降低 confidence
        ↓
 OBSERVE → 终止条件满足 → 输出 proposedFacts[]（已含 caused_by + thread_ids）
```

**终止条件（任一满足即退出）**：
1. LLM 输出 plain text（`finishReason === "stop"`，无 tool call）→ `onTextPathTerminal`：用当前 `proposedFacts[]` 作为最终结果
2. 达到迭代 cap（产品决策点 PD-2）
3. `AbortSignal` 被触发（`checkAbort` 在每次迭代顶部检查）

**失败处理**：
- `propose_facts` schema 验证失败 → `repairAndValidateToolArgs` 修复（复用现有 6-step pipeline），修复失败则 retryHint 注入 `internalHistory`，loop continue
- `verify_fact` 返回 not_found 但 LLM 三次仍未修正 → 标记该事实 `_confidence.content_clean = 0.3`，保留但降级
- LLM generate 失败 → 不再 `catch {}`，由 `onPartialRescue` 捕获，用当前已有 `proposedFacts[]` 返回（部分结果好过静默空集）

### 2.4 复用清单（明确指定）

**直接复用，零改动**：

| 模块 | 复用理由 |
|---|---|
| `runAgentLoop<ExtractionEvent>` | 完全 callback 参数化，M9 传自己的 `AgentLoopConfig` |
| `LLMProvider.generateStream` + `GenerateParams` | 工具调用字段 `tools`/`tool_choice` 已存在 |
| `ToolCall`, `ToolDefinition`, `ToolChoice`, `Message`, `LLMChunk` 类型 | 纯线型类型，无业务耦合 |
| `repairAndValidateToolArgs` | 完全工具无关；M9 传自己的 Zod schema |
| `TelemetrySink` / `createTelemetry` / `consoleSink` | 传 `agentName: "react_extraction"` 即可 |
| `withAuLock` | 通用互斥锁，写入结果时使用 |
| `applyToolDelta` + `finalizeToolCalls`（harness 内部已调用） | M9 不直接调用，harness 代劳 |

**不得耦合，M9 必须独立实现**：

| 模块 | 原因 |
|---|---|
| `dispatch_simple_chat` | AU 文件加载、draft 保存、锁的语义均不适用 |
| `executeReadTool`（simple_chat_dispatch 内部） | 实现 `show_chapter`/`show_setting`，工具语义完全不同 |
| `SIMPLE_TOOL_SCHEMAS` / `SIMPLE_TOOL_PATH_FIELDS` | simple 模式的 10+ AU 编辑工具 |
| `SimpleChatEvent` | M9 定义自己的 `ExtractionEvent` union |
| `looksLikeWritingIntent` guard heuristic | 无写作意图判断场景 |
| guard retry hint 的中文文案 | 提取场景需要不同的 retry 指令 |

**M9 必须新建**：

- `src-engine/services/react_extraction_tools.ts`（Zod schemas + tool 定义）
- `src-engine/services/react_extraction_dispatch.ts`（`AgentLoopConfig<ExtractionEvent>` 实现：`onForceToolPath` auto-execute 全部工具、`onTextPathTerminal` 返回 `proposedFacts[]`、`onGuardRetry` empty-response hint）
- `src-engine/services/react_extraction_context.ts`（extraction 专用 system prompt 组装：原文窗口 + 现有事实摘要 + Thread 列表；**不复用** `assemble_context_simple`）
- `src-engine/services/react_extraction_search.ts`（`executeSearchExistingFacts`：调用 `fact_repo.list_all()` + 本地关键词/角色过滤）

### 2.5 Token 预算

| 项目 | 估算 | 依据 |
|---|---|---|
| 系统 prompt（提取指令 + Thread 列表） | ~800 tokens | 类比 `FACTS_ENRICH_SYSTEM_PROMPT` |
| 原文窗口（单章，max_chunk_tokens） | ~4000 tokens | 现有 `max_chunk_tokens` 默认值 |
| 现有事实摘要（前 20 条 `content_clean`） | ~600 tokens | 现有 `existing_facts[0..20]` 逻辑 |
| 每次 generate 输出 max_tokens | 2000 tokens | 复用现有设置 |
| 工具调用 overhead × N 轮 | ~1500 tokens/轮 | 工具 schema + `internalHistory` 累积 |
| 总预算（cap=6轮） | ~15k tokens | 在 32k 模型可用；DeepSeek 128k 充裕 |

> **产品决策点 PD-2**（见第 5 节）：迭代 cap 取多少？推荐 6（理由：reason=1 + propose=1 + search×2 + link=1 + verify=1，加 1 次修正余量）。

---

## 3. 数据 / Hop 改动

### 3.1 M9 新增/变更的字段

**从现有字段变"实质填充"**（字段结构已存在，但之前形同虚设）：

| 字段 | 所在类型 | M9 变化 |
|---|---|---|
| `caused_by: string[]` | `Fact` / `ExtractedFact` | 从 LLM 自由字符串 → ReAct 验证后的真实 `fact_id`（格式 `f_{ts}_{4hex}`） |
| `_confidence` | `Fact` / `ExtractedFact` | 从可选 passthrough → verify step 实质填充，`verify_fact` not_found 时 `content_clean` 降至 0.3 |

**M9 新增字段**（需穿透全 hop 链）：

| 字段 | 目标类型 | 状态 |
|---|---|---|
| `thread_ids: string[]` | `ExtractedFact` | **当前不存在**，M9 需新增 |
| `thread_roles: Record<string, string>` | `ExtractedFact` | **当前不存在**，可选，M9 Phase 1 先不填 |

### 3.2 完整 Hop 链（M8-A 教训严格执行）

**`caused_by`（已有字段，需保证不被中途丢弃）**：

```
Hop 0: rawToExtracted() — 已读取 raw.caused_by，存为 string[]
  ↓
Hop 0': [M9 新增] react_extraction_dispatch 的 link_caused_by 执行结果覆写 caused_by
         此时值为已验证的真实 fact_id，非 LLM 自由字符串
  ↓
Hop 1: ExtractedFact（engine 内存类型）— caused_by 字段已存在 ✓
  ↓
Hop 2: ExtractedFactCandidate（src-ui/src/api/facts.ts）
  *** DROP POINT *** — 当前类型定义无 caused_by 字段
  → 需修复：添加 caused_by?: string[] 到 ExtractedFactCandidate
  ↓
Hop 3: handleSaveExtracted（useWriterFactsExtraction.ts:169-177）
  *** DROP POINT *** — 当前手工枚举 6 个字段，caused_by 被丢弃
  → 需修复：将 addFact 调用改为 spread 所有 enrichment 字段
            （参考 add_fact() in facts_lifecycle.ts 的正确实现）
  ↓
Hop 3': DirtyModal.tsx handleResolve（line 117-124）
  *** DROP POINT *** — 同上，6 字段枚举，caused_by 丢弃
  → 需修复：同 handleSaveExtracted
  ↓
Hop 4: add_fact()（facts_lifecycle.ts）— 正确读取 caused_by，写入 Fact 对象 ✓
  ↓
Hop 5A: OpsRepository.append() — factToOps payload 包含 caused_by ✓
Hop 5B: FactRepository.append() — factToDict() 包含 caused_by ✓
  ↓
Hop 6A: ops rebuild — factFromPayload() 包含 caused_by ✓
Hop 6B: dictToFact() — 包含 caused_by ✓
```

**`thread_ids`（全新字段，需从零建立）**：

```
Hop 0: react_extraction_dispatch 的 propose_thread_assignment 执行结果
       → proposedFacts[i].thread_ids = [thread_id, ...]
  ↓
Hop 1: ExtractedFact（engine 内存类型）
  *** 需新增字段 *** — ExtractedFact interface 添加 thread_ids?: string[]
  ↓
Hop 2: ExtractedFactCandidate（src-ui/src/api/facts.ts）
  *** 需新增字段 *** — 添加 thread_ids?: string[]
  ↓
Hop 3: handleSaveExtracted（useWriterFactsExtraction.ts）
  *** 需修复 *** — spread 改造后自动包含（与 caused_by 同批修复）
  ↓
Hop 3': DirtyModal.tsx handleResolve
  *** 需修复 *** — 同上
  ↓
Hop 4: add_fact()（facts_lifecycle.ts）— 已有 thread_ids 读取逻辑 ✓
       （注：add_fact lines 244-247 已明确读取 thread_ids/thread_roles）
  ↓
Hop 5A: ops payload — 已包含 thread_ids ✓
Hop 5B: factToDict() — 已包含 thread_ids ✓
  ↓
Hop 6A: factFromPayload() — EDITABLE_FIELDS 已包含 thread_ids ✓
Hop 6B: dictToFact() — 已反序列化 thread_ids ✓
```

**Hop 改动汇总（CC 必须同步改动，否则字段在 Hop 1-3 静默丢失）**：

| 文件 | 改动 | 优先级 |
|---|---|---|
| `src-engine/services/facts_extraction.ts` — `ExtractedFact` interface | 新增 `thread_ids?: string[]` | P0（M9 必须） |
| `src-ui/src/api/facts.ts` — `ExtractedFactCandidate` | 新增 `caused_by?: string[]`、`thread_ids?: string[]` + 所有 M8-A enrichment 字段 | P0（M8-A 遗留 + M9） |
| `src-ui/src/ui/writer/useWriterFactsExtraction.ts:169-177` | `addFact` 调用改为 spread 全部 enrichment 字段 | P0（M8-A 遗留 + M9） |
| `src-ui/src/ui/writer/DirtyModal.tsx:117-124` | 同上 | P0（M8-A 遗留 + M9） |

> **CC 注意**：`handleSaveExtracted` 和 `DirtyModal.handleResolve` 的修复属于 **M8-A 已知债务（hops grounding 已识别）**，M9 是修复的最晚时机——再不改，M9 生产的 `caused_by` 和 `thread_ids` 将在 Hop 3 静默丢失。建议在 M9 实现前作为独立 commit 先修复这两个 drop point。

### 3.3 `FactInfo` 路径（list/display）

`FactInfo` = `export type { Fact as FactInfo }` from `engine-client.ts`，是完整 `Fact` domain 对象。所有 M8-A/M8-B 字段已包含。此路径无 drop point，无需改动。

---

## 4. 接入点与门控

### 4.1 Drop-in 替换目标

**主接入点**：`src-engine/services/facts_extraction.ts` 中的 `extract_facts_from_chapter`

M9 实现必须严格匹配以下签名（调用方 `engine-facts.ts:106` 不改动）：

```typescript
export async function extract_facts_from_chapter(
  chapter_text: string,
  chapter_num: number,
  existing_facts: { content_clean?: string }[],
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null,
  llm_provider: LLMProvider,
  llm_config: unknown,
  opts?: ExtractFactsOptions,  // { max_chunk_tokens?, language?, signal? }
): Promise<ExtractedFact[]>
```

返回类型 `ExtractedFact[]` 不变。M9 实现在内部执行 ReAct loop，最终返回相同类型。

**批量路径**：`extract_facts_batch` 签名同样保持不变；M9 可对单章结果做串行 ReAct 处理后合并。

> **产品决策点 PD-3**（见第 5 节）：M9 是 **替换** 现有单次调用，还是 **并行运行** 后取 ReAct 结果？

### 4.2 配置 flag

**新增 `EnableReActExtraction` flag**（`src-engine/config/simple_features.ts` 或独立 `AppConfig` 字段）：

```typescript
// AppConfig 中新增（engine 层）
react_extraction_enabled?: boolean  // 默认 false（M9 opt-in，见 PD-4）

// getSimpleFeatures 或 feature gate 派生逻辑
disableFactsExtraction: mode === 'simple'  // 已有，不变
reactExtractionEnabled: appConfig.react_extraction_enabled === true && mode === 'full'
```

**`disableFactsExtraction` 补线**（当前 dead flag）：

grounding 确认 `disableFactsExtraction` 定义于 `simple_features.ts:23` 但**无任何生产调用方消费**。M9 上线前必须同步补线：

```typescript
// engine-chapters.ts confirmChapter，在 onOpenFactsPrompt 调用前
const features = getSimpleFeatures(sett.app?.writing_mode);
if (features.disableFactsExtraction) {
  return result;  // simple 模式跳过提取
}
```

或在 `useWriterChapterActions.ts:99` UI 层补：

```typescript
if (!disableFactsExtraction && !skipFactsPrompt) {
  onOpenFactsPrompt();
}
```

> **产品决策点 PD-4**（见第 5 节）：`react_extraction_enabled` 默认开还是关？

### 4.3 触发路径与门控矩阵

| 触发路径 | 文件 | M9 影响 |
|---|---|---|
| Path A（post-confirm，WriterLayout） | `useWriterChapterActions.ts` → `useWriterFactsExtraction.ts` → `extractFacts` | `extract_facts_from_chapter` drop-in 替换，签名不变 |
| Path B（DirtyModal 重提取） | `DirtyModal.tsx:75` → `extractFacts` | 同上 |
| Path C（FactsPage 批量） | `useFactsExtraction.ts` → `submitFactsExtraction` → TaskRunner → `extract_facts_batch` | `extract_facts_batch` 内部替换 |
| simple 模式 | 任意路径 | `disableFactsExtraction=true` 直接跳过，M9 不执行 |
| full 模式 + `react_extraction_enabled=false` | 任意路径 | 走原有单次调用（降级保底） |
| full 模式 + `react_extraction_enabled=true` | 任意路径 | 走 M9 ReAct loop |

### 4.4 `fact_repo` 访问

`search_existing_facts` 工具在 auto-execute 时需调用 `fact_repo.list_all(auPath)`。

当前 `extract_facts_from_chapter` 签名**无 `fact_repo` 参数**——这是需要 CC 判断的 API 扩展点：

**方案 A**：将 `fact_repo` 加入 `ExtractFactsOptions`（可选字段，单次调用路径传 null 时退化到无搜索能力）
**方案 B**：在 `engine-facts.ts` 的 wrapper 中预先拉取事实列表，传入 `existing_facts` 参数（但 `existing_facts` 目前只传 `content_clean`，缺少 `fact_id`）
**方案 C（推荐）**：扩展 `ExtractFactsOptions` 新增 `fact_repo?: FactRepository`；调用方 `engine-facts.ts` 已有 `fact_repo` 实例，传入即可；不传时 `search_existing_facts` 工具返回空结果，loop 自然跳过 `link_caused_by`

> **CC 判断点**：方案 C 是 additive change，不破坏任何现有调用方（`fact_repo` 可选）。除非有反对理由，建议直接采用。

---

## 5. 待人类拍板的产品决策

### PD-1：工具集粒度

**背景**：`propose_facts` 和 `link_caused_by` 可以合并为一个工具（`propose_facts_with_links`，facts 数组每项带可选 `caused_by_fact_ids`），或保持拆分。

**拆分的好处**：LLM 可以先提议事实，再搜索，再决定因果关联；认知步骤清晰，修复失败时只需重跑一步。

**合并的好处**：少一次工具调用，节省约 1-2 轮迭代（token + 延迟）。

**CC 推荐**：**拆分**。因果关联正确性是 M9 的核心价值，需要专门的 search-then-link 循环保证；合并会让 LLM 在第一次 propose 时就猜 fact_id，回到当前单次调用的问题。

**对写手的影响**：拆分方案延迟略高（多 1-2 秒），但因果准确率显著更高；合并方案更快但 `caused_by` 仍可能不准。

---

### PD-2：ReAct 迭代 cap

**背景**：迭代 cap 直接影响 (a) 延迟 (b) token 消耗 (c) `caused_by` 和 `thread_ids` 的覆盖度。

**CC 推荐**：默认 **6 轮**（reason×1 + propose×1 + search×2 + link×1 + verify×1）。允许 `AppConfig` 配置覆盖（`react_extraction_max_iter: number`，默认 6）。

**对写手的影响**：
- cap=3：快（~3-5秒），但 `caused_by` 可能搜索不到就跳过
- cap=6：中等延迟（~8-12秒），因果链和剧情线检测有足够轮次
- cap=10：慢（~20秒），边际收益小

---

### PD-3：M9 替换 vs 并行运行

**背景**：M9 可以 (a) 直接替换 `extract_facts_from_chapter` 内部实现，或 (b) 在 `engine-facts.ts` wrapper 中并行跑两个实现，用 ReAct 结果覆盖单次调用结果（或取合集）。

**替换的好处**：代码简洁，单一真相源，M9 逻辑集中。

**并行的好处**：可 A/B 比较质量，单次调用作为降级保底（ReAct 失败时自动回退）。

**CC 推荐**：**先并行（fallback 模式）**，ReAct 成功则用 ReAct 结果；ReAct 失败（超时/LLM 错误）则用单次调用结果。稳定后（2-3 个版本后）再移除单次调用路径。这满足"小步可逆"原则。

**对写手的影响**：并行方案让用户无感知切换，ReAct 失败时不影响当前提取流程；替换方案如果 ReAct 出 bug 会完全中断提取。

---

### PD-4：`react_extraction_enabled` 默认值

**背景**：M9 功能是否上线就默认开启？

**CC 推荐**：**默认关闭（opt-in）**，在 GlobalSettingsModal 加一个"增强事实提取（Beta）"开关。理由：(a) ReAct loop 增加延迟，写手可能对"提取变慢"有负面感知；(b) `caused_by` 精准引用依赖 `fact_repo` 已有足够事实（新用户早期章节效果有限）；(c) opt-in 后可收集真实使用反馈决定何时默认开启。

**对写手的影响**：不开启则体验与现在完全相同；开启后提取延迟增加但因果链和剧情线自动填充。

---

### PD-5：自动检测到的 `thread_ids` 的处理方式

**背景**：ReAct loop 的 `propose_thread_assignment` 会为事实提议 `thread_ids`。这个提议是：
- **方案 A（静默写入）**：直接把 `thread_ids` 写入事实，不经用户确认
- **方案 B（提议展示）**：在提取审查 UI 的候选事实卡片上显示"建议归入：[剧情线名]"，用户可接受/拒绝
- **方案 C（后台写入 + 通知）**：写入后在 toast 或事实列表中显示"已自动归入 N 条剧情线"

**CC 推荐**：**方案 B（提议展示）**。理由：(a) 剧情线归属是创作决策，写手应该知情并可干预；(b) 镜像 M10 归档的非静默设计原则（D-0040 决策精神）；(c) 技术上只需在已有提取审查 UI 的候选卡片加一行"归入剧情线"展示，改动最小。

**对写手的影响**：
- 方案 A：最省事但写手丢失控制感，LLM 分错线时很难发现
- 方案 B：多一个确认步骤，但透明度最高
- 方案 C：最无感，但 LLM 分错线时修改需要额外操作

---

### PD-6：单章 vs 批量路径的 ReAct 策略差异

**背景**：Path A/B（单章，交互式）和 Path C（批量，后台 TaskRunner）对延迟容忍度不同。是否在批量路径也跑完整 ReAct loop？

**CC 推荐**：
- 单章路径（Path A/B）：完整 ReAct（cap=6）
- 批量路径（Path C）：精简 ReAct（cap=3，跳过 `verify_fact`），因为批量本来就是后台任务，延迟不是瓶颈，但 token 消耗乘以章节数后需要控制

**对写手的影响**：批量提取的 `caused_by` 准确率略低于单章（搜索轮次减少），但仍优于当前单次调用。

---

## 6. 测试计划（TDD）

### 6.1 原则

测试的真正价值是 **round-trip 闭环证明**：M9 提取到的 `caused_by` 和 `thread_ids` 必须能从 `facts.jsonl` 读回，且值与提取时一致。单元测试覆盖逻辑分支，round-trip 测试证明闭环。

### 6.2 单元测试

**文件**：`src-engine/services/__tests__/react_extraction_tools.test.ts`

```typescript
describe("EXTRACTION_TOOL_SCHEMAS Zod validation", () => {
  it("propose_facts rejects content_clean < 5 chars")
  it("propose_facts rejects invalid fact_type enum")
  it("link_caused_by rejects malformed fact_id format")
  it("propose_thread_assignment clamps confidence to [0,1]")
  it("verify_fact requires non-empty expected_span")
})

describe("repairAndValidateToolArgs with extraction schemas", () => {
  it("repairs propose_facts with markdown code fence wrapper")
  it("repairs link_caused_by with string instead of array")
  it("returns retryHint on unrepairable input")
})
```

**文件**：`src-engine/services/__tests__/react_extraction_search.test.ts`

```typescript
describe("executeSearchExistingFacts", () => {
  it("returns empty array when fact_repo returns empty")
  it("filters by character name case-insensitively")
  it("limits results to requested count")
  it("returns fact_id + content_clean + characters + chapter_num")
  it("does NOT return full Fact object (privacy: only search-relevant fields)")
})
```

**文件**：`src-engine/services/__tests__/react_extraction_dispatch.test.ts`

```typescript
describe("AgentLoopConfig onForceToolPath", () => {
  it("auto-executes propose_facts and stores in proposedFacts[]")
  it("auto-executes search_existing_facts without human gate")
  it("auto-executes link_caused_by and updates proposedFacts[i].caused_by")
  it("auto-executes propose_thread_assignment and updates proposedFacts[i].thread_ids")
  it("verify_fact not_found sets _confidence.content_clean = 0.3")
  it("verify_fact found leaves _confidence unchanged")
  it("unknown tool name returns error result without throwing")
})

describe("AgentLoopConfig termination", () => {
  it("returns proposedFacts[] on text-path terminal (no tool calls)")
  it("returns proposedFacts[] on max_iter reached (partial result)")
  it("returns proposedFacts[] on AbortSignal (onPartialRescue)")
  it("returns empty array (not throws) when propose_facts never called")
})
```

### 6.3 集成测试（ReAct loop with mock LLM）

**文件**：`src-engine/services/__tests__/react_extraction_loop.test.ts`

```typescript
describe("M9 ReAct extraction loop integration", () => {
  // Mock LLMProvider: 预录 generate 响应序列（reason text → propose_facts tool call
  // → search result → link_caused_by tool call → text terminal）
  
  it("完整 6-step loop 产出含 caused_by 的 ExtractedFact[]")
  it("search_existing_facts 返回空时跳过 link_caused_by，caused_by 保持 []")
  it("thread 列表为空时跳过 propose_thread_assignment")
  it("LLM generate 抛错时 onPartialRescue 返回已有 proposedFacts[]（非空集）")
  it("mock LLM 返回 malformed propose_facts JSON 时 repair 修复后继续")
  it("cap=2 时即使未完成 link_caused_by 也正常返回")
})
```

### 6.4 Round-trip 测试（最高优先级）

**文件**：`src-engine/services/__tests__/react_extraction_roundtrip.test.ts`

**核心 fixture**（确定性，不依赖真实 LLM）：

```typescript
// 场景：第 5 章提取，存在第 3 章的 caused_by 引用
const FIXTURE_CHAPTER_3_FACT: Fact = {
  fact_id: "f_1719000000000_ab12",
  content_clean: "林晚月在炼气期第三层修炼失败，灵力枯竭",
  chapter_num: 3,
  characters: ["林晚月"],
  // ...other required fields
}

const FIXTURE_CHAPTER_5_TEXT = `
林晚月终于明白，她此刻的虚弱源于三章前那次失败的炼气。
`

const MOCK_LLM_RESPONSES = [
  // Iter 1: reason (plain text)
  "分析原文：第5章出现灵力虚弱，可能与之前的炼气失败有因果关系",
  // Iter 2: propose_facts tool call
  { toolCall: "propose_facts", args: { facts: [{ content_clean: "林晚月灵力虚弱", ... }] } },
  // Iter 3: search_existing_facts tool call
  { toolCall: "search_existing_facts", args: { query: "灵力 炼气", characters: ["林晚月"] } },
  // Iter 4: link_caused_by
  { toolCall: "link_caused_by", args: { fact_index: 0, caused_by_fact_ids: ["f_1719000000000_ab12"] } },
  // Iter 5: text terminal
  "提取完成",
]

describe("cross-chapter caused_by round-trip", () => {
  it("extracts fact with valid caused_by fact_id referencing chapter 3", async () => {
    const facts = await reactExtractFromChapter(
      FIXTURE_CHAPTER_5_TEXT, 5,
      [FIXTURE_CHAPTER_3_FACT],
      { characters: ["林晚月"] },
      null, mockProvider, mockConfig,
      { fact_repo: mockFactRepo }
    )
    expect(facts[0].caused_by).toEqual(["f_1719000000000_ab12"])
  })

  it("persists caused_by through add_fact → factToDict → dictToFact", async () => {
    // 1. 调用 add_fact(auPath, 5, facts[0])
    // 2. 读取 facts.jsonl via FactRepository
    // 3. 断言读回的 fact.caused_by === ["f_1719000000000_ab12"]
    // 这是 round-trip 闭环证明
  })
  
  it("persists thread_ids through add_fact → factToDict → dictToFact", async () => {
    // fixture: propose_thread_assignment 设置 thread_ids = ["thread_001"]
    // 断言读回的 fact.thread_ids === ["thread_001"]
  })
})
```

**Hop drop point 回归测试**：

```typescript
describe("Hop drop point regression", () => {
  // 防止 handleSaveExtracted / DirtyModal.handleResolve 再次丢弃字段
  
  it("handleSaveExtracted forwards caused_by to addFact", () => {
    // mock addFact，断言调用参数包含 caused_by
  })
  
  it("handleSaveExtracted forwards thread_ids to addFact", () => {
    // 同上
  })
  
  it("DirtyModal handleResolve forwards caused_by to addFact", () => {})
  it("DirtyModal handleResolve forwards thread_ids to addFact", () => {})
})
```

### 6.5 测试执行验收

M9 上线前验收门槛：

- `vitest run` 全绿（含 M9 新增用例）
- `tsc --noEmit` 干净（engine + src-ui）
- round-trip 测试必须覆盖 `caused_by` + `thread_ids` 的完整 hop 链
- i18n lint（若 GlobalSettings 加了"增强事实提取"开关）：中英双语 key 均存在

---

## 7. 无硬编码审计

### 7.1 关键词扫描门（合规底线）

M9 diff 必须通过以下扫描（结果预期为 0）：

```bash
# 扫描 diff（排除 __fixtures__/ 和 *.test.*）
git diff main..HEAD -- 'src-engine/services/react_*' \
  | grep -cE '\d+(\.\d+)?折|必中|永久有效|100%|保证赚钱|百分百中奖|稳赚|提现|现金|最强|国家级'
# 期望输出：0
```

### 7.2 业务规则硬编码审计

M9 涉及的所有判断点审计：

| 判断点 | 实现位置 | 是否有硬编码风险 | 结论 |
|---|---|---|---|
| `fact_type` 枚举值 | `ExtractedFact` interface + Zod schema | 枚举值是领域类型，非业务规则 | 合规 |
| `narrative_weight` 枚举 | 同上 | 同上 | 合规 |
| `_confidence` 阈值（verify not_found → 0.3） | `react_extraction_dispatch.ts` | 0.3 是技术参数，可通过 config 覆盖 | 需加 `AppConfig.react_extraction_confidence_floor: number = 0.3` |
| `max_iter` 默认值 6 | `react_extraction_dispatch.ts` | 技术参数，通过 `AppConfig.react_extraction_max_iter` 配置 | 需配置化 |
| `search_existing_facts` 默认 limit 10 | Zod schema default | 技术参数，可在工具调用时由 LLM 覆盖 | 合规 |
| `HIGH narrative_weight` 必须 verify | dispatch logic | 技术质量策略，可配置 | 建议配置化 |
| 提取后 `existing_facts[0..20]` 截断 | 复用现有逻辑 | 现有行为，不新增 | 合规 |

**结论**：M9 无任何产品业务规则硬编码。所有阈值通过 `AppConfig` 可覆盖。

### 7.3 真实游戏/品牌名铁律

M9 的 system prompt（`react_extraction_context.ts`）和工具调用不引入任何真实游戏/品牌名。提取工具操作的是写手自己的章节文本，不注入任何外部产品词汇。

---

## 8. 风险 / 回滚 / 范围外

### 8.1 风险清单

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| R1：ReAct loop 延迟超出写手耐受（>15秒） | 中 | 高 | PD-4 opt-in + PD-2 cap 可调；单章路径加 loading 状态反馈 |
| R2：`search_existing_facts` 在早期章节无事实可搜，`caused_by` 空集 | 高（早期必然） | 低 | 符合预期，loop 自然跳过 `link_caused_by`；`caused_by=[]` 与当前行为一致 |
| R3：`propose_thread_assignment` 错误分配剧情线，污染 Thread 数据 | 中 | 中 | PD-5 选方案 B（提议展示），用户确认后才写入；`_confidence` 字段展示置信度 |
| R4：LLM 生成非法 `fact_id` 格式（`link_caused_by` args） | 中 | 低 | Zod schema 正则 `/^f_\d+_[0-9a-f]{4}$/` 拒绝；repair pipeline 返回 retryHint |
| R5：`fact_repo.list_all()` 在大型 AU（>1000 事实）性能问题 | 低（早期 AU 规模小） | 中 | `search_existing_facts` 本地过滤前先按 chapter_num 窗口截断（`chapter_num <= current - 1`）；大规模时换向量检索（M10 再议） |
| R6：ReAct loop 被 AbortSignal 中途取消，返回部分事实 | 低 | 低 | `onPartialRescue` 已处理；返回 `proposedFacts[]` 当前值（可能为空），降级到 0 事实行为与当前一致 |
| R7：Hop drop point 修复（`handleSaveExtracted`/`DirtyModal`）引入回归 | 低 | 高 | 先写 round-trip 回归测试固化当前行为，再改代码；CI 门控 |

### 8.2 回滚策略

M9 采用 PD-3 推荐的并行+降级模式：

```typescript
// engine-facts.ts wrapper 伪码
async function extractFacts(auPath, chapterNum) {
  const features = getSimpleFeatures(appConfig.writing_mode)
  const reactEnabled = appConfig.react_extraction_enabled && !features.disableFactsExtraction
  
  if (reactEnabled) {
    try {
      const reactFacts = await reactExtractFromChapter(...)
      if (reactFacts.length > 0) return { facts: reactFacts }
      // fallthrough to single-shot if ReAct returns empty
    } catch (e) {
      telemetry.emit("react_extraction_failed", { error: String(e) })
      // fallthrough
    }
  }
  
  return { facts: await extract_facts_from_chapter(...) }  // 原有路径
}
```

**回滚步骤**：将 `react_extraction_enabled` 设为 `false`（或删除 AppConfig 字段），原有单次调用路径立即生效，无需 revert 代码。

### 8.3 明确范围外（Out of Scope）

以下内容**不属于 M9**，不得在本 spec 实现中纳入：

1. **ReAct 推理过程的 UI 展示**（"思维链可视化"）：M9 只暴露最终 `ExtractedFact[]`，loop 内部迭代对用户不可见。如需展示，作为独立 UI 需求排期。

2. **LLM 重训练 / fine-tuning**：M9 完全基于 prompt engineering，不涉及模型训练。

3. **Thread 自动创建**：PD-5 决策范围内，`propose_thread_assignment` 只能引用**已存在**的 Thread（由 `thread_repo.list_all()` 获取）。M9 不自动创建新 Thread，这是用户权限域。

4. **`caused_by` 跨 AU 引用**：`search_existing_facts` 只搜索当前 AU 的事实，不跨 AU 建立因果链。

5. **实时 ReAct 进度流式显示**（每一步工具调用的 streaming UI）：extracting 时显示一个 spinner 即可，类似当前行为。

6. **向量检索替换本地过滤**（R5 缓解升级版）：当前 `search_existing_facts` 用关键词本地过滤，向量化检索是 M10 的话题。

7. **M9 与 M8-B Thread 摘要的集成测试**：M9 负责正确填写 `thread_ids`，M8-B 摘要注入逻辑已实现且测试独立，二者通过 `Fact.thread_ids` 字段解耦，无需 M9 侵入 M8-B 代码。

8. **`extract_facts_batch` 的 ReAct 化（Path C）**：M9 Phase 1 优先完成单章路径（Path A/B），批量路径（Path C/TaskRunner）留待 Phase 2 或独立排期，避免 scope 膨胀。

---

*Spec 版本 v0.1 — 待 CC 审核定稿后升 v1.0 并更新 CLAUDE.md 的「活跃工作」节*