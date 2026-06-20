# M8-A · Fact Enrichment 设计（Layer 2/3 字段扩展）

- Date: 2026-06-20
- Status: Approved-rev2（CC 全权拍板 + 治本修复，实现就绪 —— 见「修订 v2」节）
- Source: D-0041 Memory 架构重设计（§3 Fact 字段扩展 + §7 开放问题 Q4/Q5）
- Owner: Human PM + CC
- Dependencies: M8-C（Chapter Summary 层，已完成）；M8-B（Thread 层，未做）；M9/D-0042（ReAct 完整提取）

---

## 修订 v2（2026-06-20，CC 全权拍板 + 治本修复，**覆盖下方草案的冲突处**）

> 用户授权 CC 自行拍板产品决策 + 治本（不怕动文件，考虑上下游）。本节为权威口径，与下方草案冲突时以本节为准。

### 已拍板的产品决策

- **Q4 known_to 粒度** → **复用 `normalizeCharacters`，与 `characters` 字段同款**。类型 `"all" | "reader_only" | string[]`；数组分支：先 `.filter(x => typeof x === "string")` 元素类型守卫，再 `normalizeCharacters(arr, character_aliases)` 归一化（修复草案 MAJOR-3 数字元素崩溃 + MAJOR-4 归一化矛盾）。**不造 group 概念**——未识别字符串原样留存（无害），不丢弃、不报错。默认值 `"all"`（共识=无戏剧反讽）。
- **Q5 emotional_beat_prose** → **不加**。情感保真已由 M8-C Chapter Summary 层在章节级承担；fact 级再加=重复 + hallucination 风险 + 无下游消费者。下方 §九 FLAG Q5 作废。
- **confidence 追踪（草案 §3.3）裁出 M8-A** → 提取新字段即可；per-field confidence 的「低置信 UI 高亮」是 UI 层 review 功能，单独排期，不进本支线（避免 P3 注入门控复杂度爆炸，草案 topRisk #3）。

### 治本：Fact 新字段必须贯穿【全部 6 个序列化/反序列化 hop】（草案 BLOCKER-1 根因）

新增任一 Fact 字段，下列每一环都要处理，缺一即静默丢字段（CLAUDE.md「新字段被沉默丢弃」铁律）：

| # | hop | 文件:行 | 草案是否覆盖 |
|---|-----|---------|------|
| 1 | `interface Fact` + `createFact` 默认 | `domain/fact.ts` | ✓ |
| 2 | `factToDict` / `dictToFact`（jsonl 读写） | `file_fact.ts:19` / `:40` | ✓ |
| 3 | **`factFromPayload`（ops add_fact payload→Fact）** | `ops_projection.ts:221` | ✗ **补** |
| 4 | **`EDITABLE_FIELDS` 白名单（edit_fact op 回放）** | `ops_projection.ts:262` | ✗ **补**（加全部新字段名） |
| 5 | **`add_fact` op 的 `payload.fact:{…}` 快照** | `services/facts_lifecycle.ts`（add_fact 内 fact 快照对象） | ✗ **补**（不加则新字段永不进 op，hop 3 无从恢复） |
| 6 | `ExtractedFact` + `rawToExtracted` + `build_facts_layer` 注入 | `facts_extraction.ts` / `context_assembler.ts:168` | ✓ |

> round-trip 测试必须覆盖 hop 3+4+5：构造含新字段的 add_fact + edit_fact ops → `rebuildFactsFromOps` → 断言新字段还原（不只测 file_fact 的 jsonl round-trip）。

### 其余草案修正

- **TimeKind = 6 值**（normal/flashback/insert/dream/parallel/imagined），草案 §二「5 值」是笔误（MAJOR-1）。
- `rawToExtracted` 伪代码用真实联合类型 `"all" | "reader_only" | string[] | null`，删除未定义的 `base` 变量引用（MAJOR-2）。
- **BLOCKER-2**：新增 prompt key 后同步更新 `prompts/__tests__/prompts.test.ts` 的 `REQUIRED_KEYS.length` 断言（当前 61，按实际新增数 +N）。
- 实现顺序紧接本节；下方草案 §三–§十一 的字段定义/测试计划仍有效，仅以本节覆盖冲突项。

---

## 一、背景与问题

当前 Fact 层（`src-engine/domain/fact.ts`）只有基础字段：时间线、涉及角色、章节号、类型、权重、状态。D-0041 §3 识别三个盲区：

1. **叙事定位缺失**：不知道这件事发生在哪个场景、叙事时序是否是插叙/梦境，LLM 生成时无法推断场景衔接。
2. **信息不对称无结构**：戏剧反讽（dramatic irony）——"读者知道但角色不知道"——是同人续写的核心张力机制，当前完全丢失；known_to/hidden_from 是跨竞品的唯一性亮点（D-0041 §3）。
3. **因果链缺失**：无 `caused_by`，LLM 无法感知哪些事件有直接因果关系，续写时容易出逻辑断层。

**范围注意**：`thread_ids`/`thread_roles`（故事线追踪）依赖 Thread 层（M8-B，未做），本支线只做其余 9 个非线字段，两个线字段在 schema 留位但不提取不注入。

---

## 二、范围

### 在内（M8-A 本轮）

- `domain/fact.ts`：新增 9 个可选字段（Layer 2 + Layer 3 非线字段），`createFact` 默认全为 null/undefined
- `domain/enums.ts`：新增 `TimeKind` 枚举（5 值）、`SuspenseType` 枚举（4 值）
- `FactConfidence` 辅助类型（per-field `high|medium|low`，存同一 Fact 文件同名 `_confidence` 子结构）
- `repositories/implementations/file_fact.ts`：`factToDict` / `dictToFact` 双向序列化含新字段
- `services/facts_extraction.ts`：`ExtractedFact` 新增 9 个可选字段 + per-field confidence；`FACTS_SYSTEM_PROMPT` 升级 prompt 填新字段（best-effort，low 不拦提取）
- `prompts/keys.ts`：新增 `FACTS_ENRICH_SYSTEM_PROMPT`（zh + en，与 `FACTS_SYSTEM_PROMPT` 并存；本轮替换现有 FACTS_SYSTEM_PROMPT，详见§六）
- `services/context_assembler.ts`：`build_facts_layer`（P3，`context_assembler.ts:168`）条件注入新字段（仅注入 confidence >= medium 的字段，避免 low 噪音进入 prompt）
- 测试：TDD 顺序（先写测试）

### 不在内（推后）

- `thread_ids` / `thread_roles`：依赖 Thread 层（M8-B），schema 留位，不提取不注入
- **完整 ReAct 提取**：本支线用单次 LLM call best-effort 填新字段；多轮验证 / 追问是 M9/D-0042 的内容
- Q5 `emotional_beat_prose`（独立字段保留情感原文）：待人工拍板（见§九）
- UI 展示 low-confidence 高亮：在 UI 层，非引擎层，不在本支线
- `caused_by` edge type：D-0041 §7 Q1 已决策【不需要 edge type】，`caused_by` 是纯 `fact_id[]`

---

## 三、数据模型

### 3.1 新增枚举（`domain/enums.ts`）

```typescript
/** 叙事时间种类（M8-A）。 */
export enum TimeKind {
  NORMAL    = "normal",     // 正常叙事时序
  FLASHBACK = "flashback",  // 闪回
  INSERT    = "insert",     // 插叙（非闪回的非线性片段）
  DREAM     = "dream",      // 梦境/幻觉
  PARALLEL  = "parallel",   // 平行时间线
  IMAGINED  = "imagined",   // 想象/假设
}
export const TIME_KIND_VALUES = Object.values(TimeKind) as [TimeKind, ...TimeKind[]];

/** 悬念类型（M8-A）。 */
export enum SuspenseType {
  FORESHADOW     = "foreshadow",     // 铺垫/预示
  SECRET         = "secret",         // 秘密（读者已知角色不知）
  MISUNDERSTANDING = "misunderstanding", // 误解
  SETUP          = "setup",          // 铺设（待 payoff 的前置条件）
}
export const SUSPENSE_TYPE_VALUES = Object.values(SuspenseType) as [SuspenseType, ...SuspenseType[]];
```

### 3.2 Fact 接口扩展（`domain/fact.ts`）

在现有字段（`id` … `updated_at`）之后追加，全部可选（允许 null/undefined）：

```typescript
// ---------- Layer 2: 叙事定位（M8-A）----------
location?:         string | null;   // 场景地点（如"御书房"）
story_time_tag?:   string | null;   // 人类可读时间标签（如"Y1 冬末"）
story_time_order?: number | null;   // 机器排序整数（叙事内时序，与 timeline 正交）
time_kind?:        TimeKind | null; // 叙事时间种类
action_verb?:      string | null;   // 核心动作一词（如"决裂"，用于摘要与 UI）
caused_by?:        string[];        // 直接因果的 fact_id 列表（只填明确的）

// ---------- Layer 3: 信息不对称（M8-A，thread 字段留位不实现）----------
known_to?:      "all" | "reader_only" | string[]; // 谁知道这件事（dramatic irony 核心）
hidden_from?:   string[];        // 明确不知情的角色（可选，仅悬念场景）
suspense_type?: SuspenseType | null;              // 悬念类型
thread_ids?:    string[];        // 【留位，M8-B 实现】故事线 ID 列表
thread_roles?:  Record<string, string>; // 【留位，M8-B 实现】故事线角色

// ---------- 置信度旁路（M8-A）----------
_confidence?:   FactFieldConfidence; // per-field LLM 置信度，非叙事内容不注入 prompt
```

### 3.3 置信度辅助类型（`domain/fact.ts`）

```typescript
export type ConfidenceLevel = "high" | "medium" | "low";

/** LLM 对每个新字段的置信度。字段不存在 = 未生成（等同 null 字段未评估）。 */
export interface FactFieldConfidence {
  location?:         ConfidenceLevel;
  story_time_tag?:   ConfidenceLevel;
  story_time_order?: ConfidenceLevel;
  time_kind?:        ConfidenceLevel;
  action_verb?:      ConfidenceLevel;
  caused_by?:        ConfidenceLevel;
  known_to?:         ConfidenceLevel;
  hidden_from?:      ConfidenceLevel;
  suspense_type?:    ConfidenceLevel;
}
```

### 3.4 `createFact` 默认值

新字段全部 optional，`createFact` 无需改动——TS `Partial<Fact>` 已覆盖。  
**单一真相源验证**：`dictToFact`（`file_fact.ts:41`）是唯一从 JSONL 反序列化的路径，必须在此处理所有新字段（见§四）。

---

## 四、序列化（`repositories/implementations/file_fact.ts`）

### 4.1 `factToDict`（`file_fact.ts:19`）新增

```typescript
// Layer 2
if (fact.location      != null) d.location       = fact.location;
if (fact.story_time_tag  != null) d.story_time_tag  = fact.story_time_tag;
if (fact.story_time_order != null) d.story_time_order = fact.story_time_order;
if (fact.time_kind     != null) d.time_kind      = fact.time_kind;
if (fact.action_verb   != null) d.action_verb    = fact.action_verb;
if (fact.caused_by?.length)    d.caused_by      = fact.caused_by;
// Layer 3
if (fact.known_to      != null) d.known_to       = fact.known_to;
if (fact.hidden_from?.length)  d.hidden_from    = fact.hidden_from;
if (fact.suspense_type != null) d.suspense_type  = fact.suspense_type;
// thread 留位（M8-B）：不序列化，防止以后格式变更造成污染
// _confidence（旁路数据，持久化供 UI 高亮用）
if (fact._confidence)          d._confidence    = fact._confidence;
```

策略：只有非空值才写入 dict（keeps JSONL 精简；读取时 `?? null/[]` 兜底）。

### 4.2 `dictToFact`（`file_fact.ts:41`）新增

```typescript
location:          (d.location       as string  | undefined) ?? null,
story_time_tag:    (d.story_time_tag as string  | undefined) ?? null,
story_time_order:  (d.story_time_order as number | undefined) ?? null,
time_kind:         (d.time_kind      as TimeKind | undefined) ?? null,
action_verb:       (d.action_verb    as string  | undefined) ?? null,
caused_by:         Array.isArray(d.caused_by)  ? (d.caused_by as string[]) : [],
known_to:          (d.known_to as ("all" | "reader_only" | string[]) | undefined) ?? null,
hidden_from:       Array.isArray(d.hidden_from) ? (d.hidden_from as string[]) : [],
suspense_type:     (d.suspense_type  as SuspenseType | undefined) ?? null,
_confidence:       typeof d._confidence === "object" && d._confidence
                     ? (d._confidence as FactFieldConfidence) : undefined,
```

**注意**：`known_to` 可以是字符串 `"all"|"reader_only"` 或 `string[]`，反序列化时两种形态都要保留（不要 coerce）。  
**known_to group 支持**：见§九 FLAG Q4；在人工拍板前，`string[]` 已可存 group 名（如 `["主角团"]`），无需 schema 变更。

---

## 五、提取（`services/facts_extraction.ts`）

### 5.1 目标

**本轮是 best-effort 单次 LLM call**，不做多轮验证/追问（M9/D-0042 范围）。LLM 对每个新字段附一个 confidence level；low 字段仍存储，但 P3 注入过滤掉（见§七）。

### 5.2 `ExtractedFact` 扩展（`facts_extraction.ts:18`）

```typescript
export interface ExtractedFact {
  // 既有字段不变
  content_raw: string;
  content_clean: string;
  characters: string[];
  fact_type: string;
  narrative_weight: string;
  status: string;
  chapter: number;
  timeline: string;
  source: string;

  // M8-A 新增（全部可选；LLM 可不填）
  location?:          string | null;
  story_time_tag?:    string | null;
  story_time_order?:  number | null;
  time_kind?:         string | null;   // LLM 输出字符串，rawToExtracted 时校验枚举
  action_verb?:       string | null;
  caused_by?:         string[];        // fact_id 引用；本轮只存，不校验引用有效性
  known_to?:          "all" | "reader_only" | string[] | null;
  hidden_from?:       string[];
  suspense_type?:     string | null;   // 同 time_kind

  _confidence?:       FactFieldConfidence;
}
```

### 5.3 Prompt 升级策略

新增 `FACTS_ENRICH_SYSTEM_PROMPT`（zh + en，加入 `prompts/keys.ts`）替换现有 `FACTS_SYSTEM_PROMPT`（**保留 `FACTS_SYSTEM_PROMPT` 不删**，用于 batch 提取，后者不要求新字段——batch 面向遗产章节，已有的 fact 无 caused_by 引用目标，LLM 填出无效 ID 反而有害）。

- 单章提取（`extract_facts_from_chapter`）：改用 `FACTS_ENRICH_SYSTEM_PROMPT`
- 批量提取（`extract_facts_batch`）：继续用 `FACTS_BATCH_SYSTEM_PROMPT`（不变）

`FACTS_ENRICH_SYSTEM_PROMPT` prompt 指令要点：

```
1. 每个事实除原有字段外，输出以下新字段（best-effort，不确定时填 null）：
   - location: 场景地点（字符串或 null）
   - story_time_tag: 故事内时间标签（如"Y1 冬末"，字符串或 null）
   - story_time_order: 叙事时序整数（从 1 开始，本章为基准；早于本章的用更小正整数；null 表示不确定）
   - time_kind: 叙事种类，枚举 normal/flashback/insert/dream/parallel/imagined，null 表示不确定
   - action_verb: 核心动作一词（中文单字或双字动词，如"决裂""撒谎"，null 表示难以概括）
   - caused_by: 此事实的直接前因的 fact_id 列表（仅当本次输出中存在明确前因时填写，否则 []）
   - known_to: "all"（所有角色知晓）/"reader_only"（只有读者知晓）/字符串数组（知情角色 id/名）
   - hidden_from: 明确不知情的角色名列表（正常叙事填 []）
   - suspense_type: null / foreshadow / secret / misunderstanding / setup
2. 每个新字段附 confidence，格式 "_confidence": { "location": "high", "known_to": "low", ... }
3. 已有字段的要求不变：保留情感中立、关注可验证事实。
4. caused_by 只引用本次同一 JSON 输出中的其他 fact content_clean 的缩写，或留空——绝不猜测跨章 fact_id。
```

**注**：`caused_by` 跨章引用在 best-effort 阶段不可靠（LLM 不知道已有 fact 的 id），本轮限制为同次输出内互引或留空。M9 的 ReAct 提取才能做跨章 `fact_id` 的准确填充。

### 5.4 `rawToExtracted` 扩展（`facts_extraction.ts:184`）

```typescript
// 枚举校验（防止 LLM 乱填）
const TIME_KIND_SET = new Set(Object.values(TimeKind));
const SUSPENSE_SET  = new Set(Object.values(SuspenseType));

function rawToExtracted(raw, chapter_num, character_aliases): ExtractedFact | null {
  // 既有逻辑不变 ...

  // M8-A 新字段
  const timeKindRaw = raw.time_kind as string | undefined;
  const suspenseRaw = raw.suspense_type as string | undefined;

  const enriched: Partial<ExtractedFact> = {
    location:         (raw.location   as string  | undefined) ?? null,
    story_time_tag:   (raw.story_time_tag as string | undefined) ?? null,
    story_time_order: typeof raw.story_time_order === "number" ? raw.story_time_order : null,
    time_kind:        (timeKindRaw && TIME_KIND_SET.has(timeKindRaw as TimeKind))
                        ? timeKindRaw : null,
    action_verb:      (raw.action_verb as string | undefined) ?? null,
    caused_by:        Array.isArray(raw.caused_by) ? (raw.caused_by as string[]) : [],
    known_to:         raw.known_to != null ? (raw.known_to as typeof base.known_to) : null,
    hidden_from:      Array.isArray(raw.hidden_from) ? (raw.hidden_from as string[]) : [],
    suspense_type:    (suspenseRaw && SUSPENSE_SET.has(suspenseRaw as SuspenseType))
                        ? suspenseRaw : null,
    _confidence:      typeof raw._confidence === "object" && raw._confidence
                        ? (raw._confidence as FactFieldConfidence) : undefined,
  };

  return { ...base, ...enriched };
}
```

---

## 六、集成点（file:line）

| 关注点 | 文件:行（现状） | 改动 |
|--------|----------------|------|
| Fact 类型扩展 | `domain/fact.ts:8` `Fact` interface | 追加 9 新字段 + `_confidence` |
| 枚举新增 | `domain/enums.ts` 末尾 | 新增 `TimeKind` / `SuspenseType` 枚举 |
| createFact 默认 | `domain/fact.ts:26` | 无需改动（新字段全 optional） |
| 序列化 | `file_fact.ts:19` `factToDict` | 新字段条件写入 |
| 反序列化 | `file_fact.ts:41` `dictToFact` | 新字段读取 + 枚举校验 |
| ExtractedFact | `facts_extraction.ts:18` | 新增 9 可选字段 + `_confidence` |
| 单章提取 prompt | `facts_extraction.ts:248` `messages[0].content` | 改用 `P.FACTS_ENRICH_SYSTEM_PROMPT` |
| rawToExtracted | `facts_extraction.ts:184` | 枚举校验 + 字段提取 |
| P3 注入过滤 | `context_assembler.ts:168` `build_facts_layer` | 条件注入新字段（confidence >= medium） |
| Prompt 合约 | `prompts/keys.ts:6` `REQUIRED_KEYS` | 追加 `FACTS_ENRICH_SYSTEM_PROMPT` |
| zh/en prompt | `prompts/zh.ts` / `prompts/en.ts` | 实现 `FACTS_ENRICH_SYSTEM_PROMPT` |

---

## 七、P3 注入策略（`context_assembler.ts:168`）

`build_facts_layer` 对新字段的注入规则：

1. **注入门控**：`_confidence.fieldName` 必须为 `"high"` 或 `"medium"` 才注入该字段；`"low"` 或 absent → 跳过（避免噪音）。
2. **选择性注入**：不是把所有新字段都追加到每条事实，而是按价值优先级选择性追加：
   - **高价值**（近乎必注入）：`known_to`（dramatic irony 核心）、`time_kind`（非 normal 时）、`action_verb`
   - **中价值**（有内容时注入）：`location`、`suspense_type`
   - **低价值**（通常不注入 prompt，保留在 JSONL 供 UI 用）：`story_time_tag`（已有 `story_time` 字段语义重叠）、`story_time_order`（机器序整数，LLM 无需原始数字）、`caused_by`（`fact_id[]` 不直接可读，M9 前意义有限）、`hidden_from`（`known_to` 的反集，注入一个即可）
3. **格式**：每条 fact 行追加括号内补充，如：`- [active] 皇帝暗中赐毒 (known_to: reader_only; time_kind: normal; action_verb: 赐毒)`

**实现位置**：`build_facts_layer` 内，在拼接 `f.content_clean` 之后，追加 `buildFactEnrichmentSuffix(f)` 辅助函数（同文件，纯函数，独立可测）。

---

## 八、错误处理 / 降级

| 场景 | 处理 |
|------|------|
| LLM 不输出新字段 | `rawToExtracted` 返回 null 默认值；既有字段照常提取 |
| LLM 输出非法枚举值（`time_kind: "fantasy"`） | 枚举集合校验 → 降级为 null；warn log |
| `caused_by` 引用当次不存在的 ID | 本轮不校验（存下来供 M9 验证），只做 `Array.isArray` 守卫 |
| `known_to` 是非预期类型（数字） | `rawToExtracted` 守卫：`typeof === "string" || Array.isArray` 通过，否则 null |
| P3 注入时 `_confidence` 缺失 | 所有新字段跳过注入（等同 all low）；facts 正常显示，只是没有增强字段 |
| 序列化/反序列化 `_confidence` 中有未知字段 | 保留（`as FactFieldConfidence`）；将来加字段零迁移 |
| `dictToFact` 读到旧 fact（无新字段） | `?? null / []` 兜底；前向兼容，零迁移 |

---

## 九、待人工拍板清单（禁止自行决定）

> 以下问题来自 D-0041 §7（Q4/Q5）或本支线设计时浮现。每条给 2-3 个选项 + 为何需要人拍板。

---

### FLAG Q4：`known_to` 粒度——是否支持 group 名？

**背景**：D-0041 §3 Layer 3 定义 `known_to: "all" | "reader_only" | character_id[]`。实际提取中，LLM 容易输出"主角团""反派阵营"这类 group 名，而不是逐个角色的 character_id（因为 LLM 不知道有哪些 character_id）。

**影响**：如果严格用 `character_id[]`，提取质量会极低（LLM 必须枚举每个角色的 id，而它不知道 id）；如果允许 group 名，则 known_to 的语义变成了"角色名/组名集合"，需要处理"group 名和 character_id 混用"的模糊情况。

**选项**：
1. **允许任意字符串（角色名 or 组名均可）**：`known_to` 的 `string[]` 元素不做格式限制，存什么 LLM 填什么；P3 注入时直接用原文；UI 高亮时不做 ID 解析。最简单，但"主角团"这类 group 没有进一步可查询的结构。
2. **仅限 cast_registry 中的 character 名**：提取后做 `normalizeCharacters`（同 `characters` 字段逻辑），不在 registry 中的 → 丢弃。提取质量更可控，但"读者知道但角色不知道"这种场景下 group 概念丢失。
3. **允许 group 关键字白名单**：在 prompt 里约束 LLM 只输出 `"all" | "reader_only" | <角色名>` 三种，禁止输出 group；不符合的字段降级为 `"reader_only"` 兜底。最保守，戏剧反讽的 group 语义需要人工补充。

**为何需要人**：这是产品取舍，不是技术问题——关系到 known_to 在 UI 里如何渲染（是直接显示字符串？还是解析成角色图标？）、以及 M9 ReAct 提取如何设计。

---

### FLAG Q5：中文复杂情绪——是否需要 `emotional_beat_prose` 字段？

**背景**：D-0041 §7 Q5 指出，中文同人创作中存在"暧昧/欲拒还迎/言不由衷"等难以结构化 tag 的情绪状态。当前 `action_verb`（核心动作一词）无法捕获这种复杂情绪的纹理；`time_kind: dream` 等枚举也不足以描述。

**选项**：
1. **不加 `emotional_beat_prose`（维持当前设计）**：复杂情绪靠 `content_clean` 全量描述来保留；`action_verb` 补充最核心的一词；情感保真交给 Chapter Summary 层（M8-C 已做，情感保真靠 prompt）。实现最简单，无新字段。
2. **加 `emotional_beat_prose: string | null`**：LLM 在提取时可选保留一段原始情感片段（20-50 字）；置信度正常附 confidence；P3 不注入（避免重复）；存 JSONL 供 UI 展示和 M9 利用。额外代价：JSONL 增大，提取 prompt 更复杂（要求 LLM 从正文引用原话有 hallucination 风险）。
3. **用 `content_raw` 字段承载**：`content_raw` 本来就是"带章节编号的原始版本"，把情感原文片段放进去。但这会污染 `content_raw` 的语义（现有 `content_raw` 是固定格式），不推荐。

**为何需要人**：这是叙事理念选择——是追求"情感原文片段"的精确性（选项2，有 hallucination 风险），还是接受"action_verb + content_clean 已经够用"（选项1），涉及用户体验判断，只有 PM 能决定产品边界。

---

## 十、测试计划（TDD 顺序）

每块先写测试、后写实现，引擎 `vitest run` 必须全绿，不破坏 full 模式既有行为。

### T1：枚举完整性

`domain/enums.ts` 新增枚举的值集合测试：
- `TimeKind` 有 6 个值（normal/flashback/insert/dream/parallel/imagined）
- `SuspenseType` 有 4 个值（foreshadow/secret/misunderstanding/setup）

### T2：`createFact` 新字段默认值

调用 `createFact({ id, content_raw, content_clean })` → 新字段全部 undefined/absent（不报错），序列化时新字段不出现在 dict（保持 JSONL 兼容）。

### T3：`factToDict` / `dictToFact` round-trip

- 含全部 9 新字段（各类型各一个非 null 值） + `_confidence` 的 Fact → `factToDict` → `dictToFact` → 结果与原 Fact 逐字段一致
- `known_to: "reader_only"` round-trip（字符串形式）
- `known_to: ["Alice", "Bob"]` round-trip（数组形式）
- `caused_by: ["f_123_abcd"]` round-trip
- 旧格式（无新字段）的 dict → `dictToFact` → 新字段全为 null/[] → 无异常（前向兼容）

### T4：`rawToExtracted` 枚举校验

- `time_kind: "flashback"` → 正确映射
- `time_kind: "FLASHBACK"` 或 `"fantasy"` → null（大小写 + 非法值）
- `suspense_type: "secret"` → 正确映射；`"bomb"` → null
- `story_time_order: "1"`（字符串） → null（类型守卫）
- `story_time_order: 3`（数字） → 3
- `known_to: 42`（非法类型） → null
- `caused_by: "f_123"` （字符串，非数组） → `[]`

### T5：`extract_facts_from_chapter` 含新字段

mock LLM 返回含新字段的 JSON，含 `_confidence`：
- 结果中新字段正确解析
- `_confidence` 正确传递
- `time_kind: "fantasy"`（非法）→ 该字段为 null，其余字段不受影响
- LLM 返回不含新字段 → 既有字段正常提取，新字段全 null，不抛错

### T6：`build_facts_layer` 条件注入

- fact 含 `known_to: "reader_only"`, `_confidence.known_to: "high"` → 输出行含 `known_to: reader_only`
- fact 含 `known_to: "all"`, `_confidence.known_to: "low"` → 不注入该字段
- fact 不含 `_confidence` → 所有新字段均不注入
- `time_kind: "normal"` → 不注入（normal 是默认，无信息量）
- `time_kind: "flashback"`, `_confidence.time_kind: "medium"` → 注入
- `action_verb: "决裂"`, confidence high → 注入
- `buildFactEnrichmentSuffix` 纯函数独立测试（零 I/O）

### T7：prompt keys 覆盖 lint

`FACTS_ENRICH_SYSTEM_PROMPT` 在 zh + en 两个 prompt 模块均有实现，且内容非空（复用既有 i18n 覆盖 lint 机制）。

### T8：golden/budget 预期 delta

`build_facts_layer` 在有新字段注入时，P3 token 数会略增 → 属"预期内非零回归"，更新 `context_assembler_golden.test.ts` 基线（同 M8-C 先例），非破坏。

---

## 十一、与其它支线的撞车点

| 支线 | 撞车点 | 处置 |
|------|--------|------|
| **M8-C Chapter Summary** | 已完成；`chapter_summary.ts` / `rag_manager.ts` 不与本支线重叠 | 无冲突 |
| **M8-B Thread 层** | `thread_ids` / `thread_roles` 字段 schema 在本支线留位，不提取不注入 | M8-B 实现时直接填已预留的 schema 槽，零迁移 |
| **M9 ReAct 提取** | M9 会改 `facts_extraction.ts` 实现多轮提取；本支线的 `ExtractedFact` 扩展和 prompt key 是 M9 的基础 | M9 可在本支线 `ExtractedFact` 之上扩展，不破坏当前接口 |
| **bughunt 别名归一化** | `normalizeCharacters`（`facts_lifecycle.ts:42`）已做 case-insensitive 统一导出；`known_to: string[]` 中的角色名应在 `rawToExtracted` 后通过同函数归一化 | 在 `rawToExtracted` 末尾对 `known_to` 数组元素调用 `normalizeCharacters` |
| **context_assembler golden test** | `context_assembler_golden.test.ts` 的 P3 token 基线会因注入新字段而略变 | 新字段注入是加法，更新基线即可（同 M8-C 先例） |
| **facts_extraction batch** | `FACTS_BATCH_SYSTEM_PROMPT` 不动（不要求新字段）；只有单章提取改用 `FACTS_ENRICH_SYSTEM_PROMPT` | 明确分开，无冲突 |

---

## 十二、推后的开放问题（非本支线决定）

- D-0041 §7 Q4 `known_to` group 粒度 → **见§九 FLAG Q4**（待拍板）
- D-0041 §7 Q5 `emotional_beat_prose` → **见§九 FLAG Q5**（待拍板）
- `caused_by` 跨章 fact_id 准确填充 → M9/D-0042 ReAct 提取
- `known_to` 在 UI 渲染为"角色图标"还是纯文字 → UI 支线，非引擎层
- `story_time_order` 的全局排序与冲突检测（两个 fact 同时 order=3 时如何处理）→ M9/后续

---

## 附：权威来源

D-0041 全文不在主仓（原件 `D:\fanfic-system\docs\internal\decisions\D-0041-memory-architecture-redesign.md`，Tailscale 主机本地）。本 spec §三–§七 的字段定义忠实复刻 D-0041 §3 Layer 2/3，仅按范围裁剪（线字段留位不实现；Q4/Q5 不自行决定）。

---

## 可行性复核

> 审核日期：2026-06-20。对照 `src-engine/` 实际代码逐条核查集成点、行号、函数签名、类型假设。
> **不复核产品决策**（§九 FLAG Q4/Q5 已标记待人拍板）；只找工程可行性硬伤。

### BLOCKER

#### BLOCKER-1：`ops_projection.ts` 是被遗漏的第二条 Fact 反序列化路径

**文件**：`src-engine/ops/ops_projection.ts:221`（`factFromPayload`）和 `:262`（`EDITABLE_FIELDS`）

`factFromPayload` 是 audit log rebuild 时重建 `Fact` 对象的路径，与 `file_fact.ts:dictToFact` 是并行的第二条反序列化路径。spec §四 只覆盖了 `dictToFact`，完全未提 `factFromPayload`。

影响分两层：

1. **新字段静默丢失（read path）**：`factFromPayload` 调用 `createFact({...})` 时只传现有字段，所有新字段因 `createFact` 的 `...partial` 展开而取 undefined 默认值——不会 crash，但从 ops.jsonl rebuild 的 Fact 对象新字段全为 absent，与从 `facts.jsonl` 读取的 Fact 行为不一致。只要 audit log rebuild 路径被触发，新字段就会被丢弃。

2. **`edit_fact` ops replay 无法处理新字段（write path）**：`EDITABLE_FIELDS`（`ops_projection.ts:262`）硬编码了 `edit_fact` 可重放的字段白名单（11 个字段）。新 Layer 2/3 字段不在其中，所以即使未来 `edit_fact` 支持编辑新字段，ops 重放时也会忽略这些变更。现阶段 M8-A 不做 edit UI，但 schema 里已有字段而 ops 重放无法还原，是隐性数据一致性债。

**必须修复**：至少在 `factFromPayload` 里透传 `_confidence` 和新字段（同 `dictToFact` 处理逻辑），以保证两条路径行为一致。`EDITABLE_FIELDS` 是否扩展可推后，但需在 spec 里明确声明"本支线不扩展 `EDITABLE_FIELDS`，ops rebuild 不还原新字段编辑"作为已知局限。

---

#### BLOCKER-2：Prompt key 数量快照测试会失败，导致 T7 无法通过

**文件**：`src-engine/prompts/__tests__/prompts.test.ts:60`

```typescript
it("total key count is 61", () => {
  expect(REQUIRED_KEYS.length).toBe(61);
});
```

spec §六 集成点表要求在 `REQUIRED_KEYS`（`prompts/keys.ts:6`）中追加 `FACTS_ENRICH_SYSTEM_PROMPT`，会使总数变为 62，该快照测试直接 fail。

**这不是"更新基线即可"**：该测试是显式防止意外增减 key 的守卫，必须在同一 commit 内更新为 `toBe(62)`。实现者若只改 `keys.ts` 不改测试，TDD T7 无法全绿。

spec 应在 T7 测试计划里明确指出需要同步更新此快照值（目前 T7 只提"复用既有 i18n 覆盖 lint 机制"，未提该快照）。

---

### MAJOR

#### MAJOR-1：`TimeKind` 枚举值数量内部矛盾（§二 vs §3.1 vs T1）

**位置**：spec §二「在内」第二点写"新增 `TimeKind` 枚举（**5 值**）"；§3.1 enum 定义列出 6 个值（normal / flashback / insert / dream / parallel / imagined）；T1 测试计划写"TimeKind 有 **6 个值**"。

§二 的"5 值"与其余两处矛盾，属于笔误。实现者若以 §二 为准少加一个值，T1 测试将 fail。需勘误——哪个值不在范围内，或直接把 §二 改为"6 值"。

---

#### MAJOR-2：§5.4 `rawToExtracted` 伪代码引用未定义变量 `base`

**位置**：spec §5.4 代码片段第 25 行：

```typescript
known_to: raw.known_to != null ? (raw.known_to as typeof base.known_to) : null,
```

`base` 在该代码片段中从未声明。实际文件 `facts_extraction.ts:184` 的 `rawToExtracted` 函数签名和函数体中也没有 `base` 变量。实现者按此伪代码编写 TypeScript 会得到编译错误 `Cannot find name 'base'`。

应将类型标注改为显式联合类型 `"all" | "reader_only" | string[] | null` 或另行声明类型别名，不依赖不存在的 `base` 变量。

---

#### MAJOR-3：`known_to` 数组元素类型守卫不完整

**位置**：spec §5.4 `rawToExtracted` 伪代码；§八 错误处理表。

spec §八 的错误处理表列出 `known_to` 的守卫条件为 `typeof === "string" || Array.isArray` 通过，但 `Array.isArray` 成立并不保证元素是字符串——LLM 可能返回 `known_to: [1, 2]`（数字数组），此时 `Array.isArray` 返回 true，但元素被当作 `string[]` 使用会在后续 `normalizeCharacters` 调用或 P3 注入中产生意外行为（数字 `.toLowerCase()` 不存在）。

建议在 `rawToExtracted` 内对 array 分支增加 `(raw.known_to as unknown[]).filter(x => typeof x === "string") as string[]` 的元素类型过滤。

---

#### MAJOR-4：§十一 撞车点与 §5.4 伪代码对 `known_to` 归一化的处理互相矛盾

**位置**：spec §十一 撞车点表最后一行 vs §5.4 `rawToExtracted` 伪代码。

§十一 明确说"在 `rawToExtracted` 末尾对 `known_to` 数组元素调用 `normalizeCharacters`"。但 §5.4 的伪代码末尾只写 `return { ...base, ...enriched }`，未包含对 `known_to` 数组的 `normalizeCharacters` 调用。

实现者若按 §5.4 伪代码逐字实现，`known_to` 的角色名不会被归一化，与 `characters` 字段的处理不一致，且与 §十一 的明确指令相悖。需在伪代码里补上该调用，或在 §十一 里撤回该指令并说明不归一化的理由。

---

### 行号精度说明（非问题，供参考）

所有 spec 标注的 file:line 引用经核查均属实或差 1 行（`dictToFact` 实际从 line 40 开始而非 41；`messages[0].content` 的 system prompt 在 line 249 而非 248），误差在可接受范围内，不影响实现定位。

`normalizeCharacters` 实际在 `facts_lifecycle.ts:42`（spec 标注与实际一致）。

### 可行性总结

范围合理、独立可实现，无循环依赖。核心集成点（`fact.ts` / `enums.ts` / `file_fact.ts` / `facts_extraction.ts` / `context_assembler.ts` / `prompts/`）均属实。两个 BLOCKER 不修复会导致测试无法全绿（BLOCKER-2）或 audit log rebuild 行为静默不一致（BLOCKER-1）。四个 MAJOR 有两个会产生编译错误或运行时错误（MAJOR-2 `base` 引用 / MAJOR-3 数组类型），必须在实现前在 spec 层面澄清。
