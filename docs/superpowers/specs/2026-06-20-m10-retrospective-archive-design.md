# M10 · Retrospective Rewrite + 冷热分层设计

- Date: 2026-06-20
- Status: Draft（待人工拍板决策清单后方可进入 Codex 计划阶段）
- Source: D-0041 Memory 架构重设计（§5 Retrospective §6 冷热分层）
- Owner: Human PM + CC
- 前置依赖: M8-C（standard 摘要已落盘 + summaries RAG collection 已存在）

---

## 一、背景与问题

M8-C 确立了"每章生成 standard 摘要"的基础管道。但叙事记忆有两个残余盲区：

1. **摘要时间性偏差**：standard 摘要在该章 confirm 后立即生成，那时后续章节尚未展开，摘要里写的因果判断可能在 5 章后变得过时（伏笔被展开、角色动机被揭示）。Retrospective rewrite 用"后见之明"修订早期章节摘要，让 RAG 召回的记忆更忠实于整体叙事走向。

2. **注入策略单一**：M8-C 把所有 active fact 一律注入 P3（Facts 层），随章数增长 P3 爆炸、有用信号被无关条目稀释。冷热分层按"距当前章节的距离 + narrative_weight"把 fact 分为热/温/冷三档，不同档位走不同注入路径，让有限预算始终花在最有价值的信息上。

**依赖关系**：本支线踩在 M8-C 的摘要体系上。M8-C 只做了 `standard` 档，**`micro` 档是本支线新增**，供 Retrospective 注入提供"后见之明"上下文。

---

## 二、范围

### 在内（M10 本轮）

**A. micro 摘要生成**
- 每章在 standard 生成的同时（confirm 接缝）额外生成一条 `micro` 摘要（30-50 字，叙事节点级）
- `micro` 键写入既有 `chapters/main/ch{NNNN}.summary.jsonl`（M8-C 已预留键位）
- 不索引到向量库（micro 仅供 Retrospective 编排器读取，不独立进 RAG）

**B. Retrospective Rewrite（standard v2 生成）**
- 触发条件（待拍板，见 §十一 Q1）：以"每 5 章"为默认设计基准
- 以第 N 章为目标，注入 ch N+1~N+5 的 `micro` 摘要作"后见之明"，重生成 N 章的 `standard` 摘要
- 存为 `version: 2`，保留 `version: 1` 为 `standard_v1` 备份键；RAG 注入始终用最新版（当前 `version` 最高的那条）
- 更新向量库：覆盖 `sum{N}` embedding（id 相同 → `index_chunks` 去重覆盖）

**C. 冷热分层（Fact archival）**
- `Fact` 加 `archived: boolean`（默认 `false`）字段
- 固化（archival）触发条件（待拍板，见 §十一 Q2）：以"距当前章节 ≥ 10 章 + narrative_weight=low"为设计基准
- `facts_lifecycle.ts` 加 `archive_fact` / `unarchive_fact` 函数
- 三档注入策略变更（改 `context_assembler.ts:build_facts_layer`）：
  - **热**（最近 3 章产生的 fact）：全字段注入 P3，维持现状
  - **温**（4-10 章内）：注入 P3，format 标注"[archived_candidate]"标签（不影响 LLM 用法，仅审计用）
  - **冷**（archived=true）：**不进 P3**；其所在章的 `standard` 摘要仍进 P4（RAG），即 fact 内容经由摘要间接可达
- `context_assembler.ts` 的 P3 层改读 `fact.archived` 过滤冷 fact

### 不在内（推后或正交）

- micro 档写入向量库 / 进 RAG 检索（无明确消费者，先不做）
- `detailed` 档（M8-C 已预留键位，有独立消费者时再做）
- ReAct 提取 Layer 2/3 Fact 字段 → M9 / D-0042
- TD-014（undo_chapter 的 resolves 反向级联）→ 由 M8 Memory 重设计批次处理
- M6 Agent 架构 → 独立排期

---

## 三、已确认决策（本支线无法先行拍板的一律进 §十一）

| # | 决策 | 理由 |
|---|------|------|
| ① | micro 不索引向量库 | 无独立 RAG 消费者；仅供 Retrospective 编排器读；避免 embedding 调用增加 confirm 耗时 |
| ② | Retrospective 失败不回滚、不阻断主写作流程 | 沿用 M8-C 决策②（summary 层故障隔离原则） |
| ③ | standard v2 覆盖向量 id `sum{N}`（去重覆盖而非新增） | 检索精准性：同章节摘要在 RAG 中永远只有 1 个 slot |
| ④ | v1 保留为 `standard_v1` 备份键 | 回滚 + 调试；对 RAG 无影响（不用该键检索） |
| ⑤ | 冷 fact 仍可经摘要间接进 P4 | 摘要已包含该 fact 的叙事上下文，不完全丢失信息 |
| ⑥ | archive/unarchive 操作由系统触发，不新增 UI 入口（本轮） | 先观察自动化效果；UI 手动固化等产品验证后再加 |

---

## 四、数据模型

### 4.1 SummaryTier（扩展 M8-C domain/chapter_summary.ts）

```typescript
// 现有（M8-C）
export interface SummaryTier {
  version: number;
  text: string;
  generated_at: string;
  source_chapter_hash: string;
}

// M10 新增：micro 档（同文件，增加 micro 键）
export interface ChapterSummary {
  standard: SummaryTier | null;
  standard_v1?: SummaryTier;   // Retrospective 前的原始版本备份（M10 新增）
  micro: SummaryTier | null;   // 30-50 字叙事节点（M10 新增）
  // detailed 键仍预留，不生成
}
```

存储路径不变：`chapters/main/ch{NNNN}.summary.jsonl`（单个 JSON 对象，扩键零迁移）。

### 4.2 Fact（扩展 domain/fact.ts）

```typescript
export interface Fact {
  // ... 现有字段（不动）
  archived: boolean;    // M10 新增；默认 false；冷 fact 标志
  archived_at?: string; // ISO 8601；仅 archived=true 时写入
}
```

`createFact` 默认值增加 `archived: false`（`archived_at` 不写，undefined）。

---

## 五、micro 摘要生成

### 5.1 Prompt

新增 prompt key `SUMMARY_MICRO_SYSTEM` / `SUMMARY_MICRO_USER`（zh + en，4 个 key）：
- 目标：30-50 字，"叙事节点"风格，捕捉本章最关键的 1-2 个情节/情绪转折
- 对比 standard：standard 追求 180-250 字完整叙事；micro 是"章节名片"，供 Retrospective 的 LLM 快速扫描多章节
- 实现：`generate_micro_summary(chapterText, chapterNum, llmProvider, opts)` 函数（仿 `generate_standard_summary`，新文件或加到 `chapter_summary.ts`）

### 5.2 触发接缝

与 standard 生成共用同一接缝（`src-ui/src/api/engine-chapters.ts` confirmChapter，当前行 ~137-174），在 `persist_chapter_summary` 调用之后顺序追加 micro 生成 + 写入（same file, same lock）：

```
// 现有（M8-C）
summaryText = await generate_standard_summary(...)
if (summaryText) await persist_chapter_summary(...)

// M10 新增（同锁内，same CAS check）
microText = await generate_micro_summary(...)
if (microText) await summaryRepo.update_micro(auPath, chapterNum, microText, contentHash)
```

失败处理：micro 失败 → logCatch + 吞掉，standard 及主流程不受影响。

### 5.3 Repository 扩展

`ChapterSummaryRepository` 新增：
```typescript
update_micro(auPath: string, chapterNum: number, text: string, hash: string): Promise<void>
```
实现读取现有 `.summary.jsonl`（若无则 `createChapterSummary`），合并写入 `micro` 键，覆盖存储。保证幂等（并发写同章 micro 后者覆盖前者，可接受）。

### 5.4 陈旧处理

章节编辑时（`updateChapterContent`）删除摘要文件（M8-C 已实现），micro 随文件一并删除。Retrospective 生成 v2 时不重新生成 micro（micro 基于原章节内容，不随后见之明变化）。

---

## 六、Retrospective Rewrite

### 6.1 编排逻辑

```
function shouldRunRetrospective(confirmedChapterNum: number, triggerInterval: number): boolean
// triggerInterval: D-0041 §7 Q1 开放，见待拍板清单
```

触发时（以 5 为例）：在章节 N 确认后，若 N % 5 === 0，对章节 N-5 运行 retrospective（N ≥ 6）。

### 6.2 生成步骤

新文件 `src-engine/services/retrospective.ts`：

```typescript
export interface RetrospectiveOptions {
  language?: string;
  signal?: AbortSignal;
}

/**
 * 为目标章节生成"后见之明"standard v2 摘要。
 * 注入：目标章节全文 + 其 standard v1 摘要（若有）+ 后续 micro 摘要列表。
 */
export async function run_retrospective(
  auPath: string,
  targetChapterNum: number,
  chapterRepo: ChapterRepository,
  summaryRepo: ChapterSummaryRepository,
  ragManager: RagManager,
  embeddingProvider: EmbeddingProvider,
  llmProvider: LLMProvider,
  currentChapter: number,     // 当前待写章，用于验证 micro 章节存在性
  opts?: RetrospectiveOptions,
): Promise<void>
```

实现步骤：
1. 读 `targetChapterNum` 章节全文（chapterRepo）
2. 读 `targetChapterNum` standard v1 摘要（若无跳过，首次无 v1 等于 M8-C 生成的就是 v1）
3. 收集 `targetChapterNum + 1` 至 `min(targetChapterNum + 5, currentChapter - 1)` 的 micro 摘要（summaryRepo.get 逐章读，missing 则跳过该章，不中断）
4. 若后续 micro 为空 → 无后见之明可用 → 跳过，不浪费 LLM 调用
5. 调 LLM 生成 v2（新 prompt key `SUMMARY_RETROSPECTIVE_SYSTEM` / `SUMMARY_RETROSPECTIVE_USER`，zh + en，4 个 key）
6. 写 v2：`summaryRepo.promote_to_v2(auPath, targetChapterNum, v2Text, contentHash)`（将旧 standard 备份为 standard_v1，写入新 standard version:2）
7. 覆盖向量索引：`ragManager.indexChapterSummary(auPath, targetChapterNum, v2Text, embeddingProvider)` → id `sum{N}` 被覆盖

### 6.3 错误处理

所有步骤失败均 logCatch + 吞掉，不影响 confirmChapter 主流程。`promote_to_v2` 实现里：先写 standard_v1 备份 → 再写 standard v2（按序），即使 v2 写失败，v1 备份已落盘（下次 Retrospective 重试会读到 v1 重新覆盖）。

### 6.4 Repository 扩展

```typescript
// ChapterSummaryRepository 新增
promote_to_v2(auPath: string, chapterNum: number, v2Text: string, hash: string): Promise<void>
```

实现：读取现有 summary → 将 `standard` 暂存为 `standard_v1` → 写入新 `standard { version: 2, text: v2Text, ... }` → 覆盖存储。

### 6.5 触发接缝

`engine-chapters.ts:confirmChapter` 的摘要生成块（当前行 ~137 起）之后追加：

```typescript
// M10 Retrospective（独立 best-effort 边界）
try {
  if (!getSimpleFeatures(sett.app.writing_mode).disableChapterSummary) {
    const targetNum = chapterNum - 5;  // 或由 triggerInterval 决定
    if (targetNum >= 1 && shouldRunRetrospective(chapterNum, RETROSPECTIVE_INTERVAL)) {
      await run_retrospective(
        auPath, targetNum, chapter, e.repos.chapterSummary,
        e.ragManager, embProvider, create_provider(llmCfg), chapterNum,
        { language: sett.app?.language || "zh" },
      );
    }
  }
} catch (err) {
  logCatch("retrospective", `Retrospective failed after ch${chapterNum}`, err);
}
```

`RETROSPECTIVE_INTERVAL` 常量在 `src-engine/services/retrospective.ts` 定义（当前值待拍板，见 §十一 Q1）。

---

## 七、冷热分层（Fact Archival）

### 7.1 archive_fact / unarchive_fact

新增到 `src-engine/services/facts_lifecycle.ts`：

```typescript
export async function archive_fact(
  au_id: string,
  fact_id: string,
  fact_repo: FactRepository,
  ops_repo: OpsRepository,
): Promise<void>

export async function unarchive_fact(
  au_id: string,
  fact_id: string,
  fact_repo: FactRepository,
  ops_repo: OpsRepository,
): Promise<void>
```

写 ops 条目（`op_type: "archive_fact"` / `"unarchive_fact"`），更新 `fact.archived` + `fact.archived_at`，通过 WriteTransaction 提交（ops → fact 顺序）。

### 7.2 自动固化触发

新增到 `src-engine/services/facts_lifecycle.ts`：

```typescript
/**
 * 扫描所有 active facts，对满足固化条件的 fact 批量打 archived=true。
 * 由 engine-chapters.ts:confirmChapter 在章节落盘后调用（best-effort）。
 * 固化条件（设计基准，待拍板见 §十一 Q2）：
 *   fact.chapter <= currentChapter - COLD_THRESHOLD_CHAPTERS  // 距当前章节距离
 *   && fact.narrative_weight === NarrativeWeight.LOW
 *   && !fact.archived
 * @returns 被固化的 fact_id 列表
 */
export async function run_archival_sweep(
  au_id: string,
  current_chapter: number,
  fact_repo: FactRepository,
  ops_repo: OpsRepository,
  cold_threshold_chapters = COLD_THRESHOLD_CHAPTERS,
): Promise<string[]>
```

`COLD_THRESHOLD_CHAPTERS = 10`（常量，待拍板见 §十一 Q2）。

### 7.3 context_assembler P3 注入策略改动

**改动位置**：`src-engine/services/context_assembler.ts:build_facts_layer`（当前行约 168-247）

改动面：
- `eligible` facts 过滤：已 `archived` 的 fact 从 P3 剔除（`f.archived !== true` 条件加入）
- 温 fact（距当前章节 4-10 章内）：format 加可选标签，不影响 LLM 语义（具体格式待拍板，见 §十一 Q3）
- `ContextSummary` 追加字段（见 §四的 context_summary.ts 变更）：`facts_archived_count: number`

**与 M8-A 撞车点**（详见 §九）：M8-A 如果也改 context_assembler 的 P2/P3 注入策略，两支线需串行协调。本支线对 `build_facts_layer` 的改动是**增量式过滤**（加条件 + 改 format），不重写函数签名；M8-A 应预期这个 diff 存在。

### 7.4 RAG 可达性保证

被固化的 fact 所在章节，其 standard 摘要（M8-C 生成）仍保留在 `summaries` RAG collection（不删），故 fact 内容仍可经由摘要 RAG 召回间接影响生成——虽无法直接作为事实注入，但不完全消失。这是冷 fact 的设计语义。

### 7.5 undo_chapter 联动

undo 删除该章节时（`undo_chapter.ts`）：若被删章节产生的 fact 处于 archived 状态，随其他 fact 一并删除（不需要 unarchive 再删，直接删）。相关 op 写 `delete_facts` 不加 unarchive 中间态。

---

## 八、集成点（file:line，基于当前已读代码）

| 关注点 | 落点（当前 file:line） | 改动类型 |
|--------|----------------------|---------|
| micro 生成函数 | `src-engine/services/chapter_summary.ts`（新函数，仿 `generate_standard_summary:23`） | 新增函数 |
| micro prompt keys | `src-engine/prompts/index.ts`（加 `SUMMARY_MICRO_*` 4 key） | 新增 prompt |
| retrospective 函数 | `src-engine/services/retrospective.ts`（新文件） | 新文件 |
| retrospective prompt keys | `src-engine/prompts/index.ts`（加 `SUMMARY_RETROSPECTIVE_*` 4 key） | 新增 prompt |
| v2 backup | `src-engine/repositories/interfaces/chapter_summary.ts:7`（新增 `promote_to_v2` 签名） | 接口扩展 |
| v2 实现 | `src-engine/repositories/implementations/file_chapter_summary.ts` | 新方法 |
| micro 写入 | `src-engine/repositories/interfaces/chapter_summary.ts`（新增 `update_micro` 签名） | 接口扩展 |
| ChapterSummary 类型 | `src-engine/domain/chapter_summary.ts:20`（加 `standard_v1?` + `micro` 键） | 类型扩展 |
| Fact 类型 | `src-engine/domain/fact.ts:8`（加 `archived: boolean` + `archived_at?` 字段） | 类型扩展 |
| createFact 默认值 | `src-engine/domain/fact.ts:26`（加 `archived: false`） | 默认值更新 |
| archive ops 类型 | `src-engine/domain/enums.ts:97`（`OpType` 加 `ARCHIVE_FACT`/`UNARCHIVE_FACT`） | 枚举扩展 |
| archive_fact 函数 | `src-engine/services/facts_lifecycle.ts:178`（末尾追加） | 新增函数 |
| run_archival_sweep | `src-engine/services/facts_lifecycle.ts`（追加） | 新增函数 |
| P3 过滤 | `src-engine/services/context_assembler.ts:175`（`build_facts_layer` 的 `eligible` 过滤条件） | 过滤条件扩展 |
| context_summary 字段 | `src-engine/domain/context_summary.ts:23`（新增 `facts_archived_count`） | 类型扩展 |
| confirm 接缝 micro | `src-ui/src/api/engine-chapters.ts:~163`（persist_chapter_summary 之后） | 追加调用 |
| confirm 接缝 retrospective | `src-ui/src/api/engine-chapters.ts:~175`（摘要块之后） | 追加调用 |
| confirm 接缝 archival sweep | `src-ui/src/api/engine-chapters.ts:~180`（retrospective 之后） | 追加调用 |
| i18n 验证 lint | `src-ui/src/locales/{zh,en}.json` + 覆盖 lint | 新增 key |

---

## 九、与其他支线的撞车点

### 9.1 M8-A（Fact Layer 2/3 + ReAct 提取）

**撞车面**：M8-A 的 Fact 字段扩展（Layer 2/3）会改 `src-engine/domain/fact.ts` 的 `Fact` interface，本支线也改同一文件（加 `archived` 字段）。需协调合并顺序。

**本支线对 context_assembler 的改动面**：仅 `build_facts_layer` 内部增加 `f.archived !== true` 过滤条件 + 温区 format 标签（不改函数签名、不改 P2/P4/P5 层）。M8-A 若也改 P3（Facts Layer）的注入逻辑，需串行合并；若 M8-A 只改 P2（章节层），无撞车。

**建议**：M8-A 先合，本支线后合（M8-A 是 Fact 字段的扩展，本支线在其之上加 filter）；或两支线同时提 spec，合 Codex 计划时在任务级拆分边界，避免同时改 `fact.ts` 和 `context_assembler.ts`。

### 9.2 M8-C（已完成）

本支线依赖 M8-C 已实现的：
- `chapters/main/ch{NNNN}.summary.jsonl` schema（本支线仅扩键，零迁移）
- `summaries` RAG collection（本支线 v2 覆盖同 id，复用现有 `indexChapterSummary`）
- `ChapterSummaryRepository` 接口（本支线扩展 `update_micro` + `promote_to_v2`，不破坏现有签名）
- `persist_chapter_summary` 函数（本支线在其后追加 micro，不修改该函数）

### 9.3 M9（ReAct 生成 + 选择性提取）

无直接撞车。M9 改生成路径，本支线改摘要 + fact 注入路径。若 M9 改 `context_assembler` 的 P4 层（RAG 召回注入方式），需确认与本支线 P3 改动不叠加副作用。

---

## 十、错误处理 / 降级

| 场景 | 处理 |
|------|------|
| micro 生成 LLM 失败 | logCatch + 吞掉；该章无 micro，Retrospective 遇到时跳过该章 |
| micro embedding（如将来需要） | 不适用（本轮 micro 不索引向量库） |
| Retrospective：后续 micro 全缺 | 跳过 Retrospective，不调 LLM，不浪费 |
| Retrospective LLM 失败 | logCatch + 吞掉；v1 保留，无 v2，RAG 继续用 v1 |
| `promote_to_v2` v1 写成功但 v2 失败 | v1 已备份，下次 Retrospective 重试；RAG 继续用 v1（无损） |
| `run_archival_sweep` 失败 | logCatch + 吞掉；facts 继续走 active 路径注入，仅多占 P3 预算 |
| P3 `archived` 过滤读不到 fact.archived（旧 fact 无此字段） | `f.archived !== true` 兜底返回 `undefined !== true → true → 保留注入`；旧 fact 不受影响 |
| undo_chapter 后 summary 文件已删（M8-C 已实现）| micro/standard_v1 随文件一并删除，无孤儿 |

---

## 十一、待人工拍板清单

---

### Q1：Retrospective 触发时机

**背景**：D-0041 §7 Q3 明确将此作为开放产品决策。正文生成后 LLM 再调一次（Retrospective）是成本和效益的权衡。

**选项**：

| 选项 | 描述 | 成本 | 适用场景 |
|------|------|------|---------|
| A（设计基准）| 每写完第 5 章自动触发，对 N-5 章执行 | 每 5 章多 1 次 LLM 调用，成本可预测 | 写作节奏稳定、希望系统自动维护记忆质量 |
| B | 用户手动点按钮触发（UI 确认流程） | LLM 成本由用户决定，极低 | 用户想控制每次 Retrospective 时机 |
| C | 先上线 A，A/B 后观察是否产生明显质量提升 | 初期同 A；验证后若无价值关闭 | 数据驱动决策，避免提前排期死 |

**为何需要人拍**：涉及成本（LLM 调用频率）和产品体验（是否弹确认 UI）两个产品判断，且 D-0041 §7 明确未定。

---

### Q2：冷 fact 固化阈值与触发条件

**背景**：阈值决定了有多少 fact 会退出 P3、多少预算被释放。阈值太低 = P3 过稀 = LLM 记不住；太高 = 无效果。

**选项**：

| 选项 | 固化条件 | 影响 |
|------|---------|------|
| A（设计基准）| `距当前章 ≥ 10` + `narrative_weight=low` | 只固化最远且最不重要的；保守 |
| B | `距当前章 ≥ 10`（不限 weight）| 固化更积极；P3 更干净；但可能漏 low 以上的历史背景 |
| C | `距当前章 ≥ 15` + `narrative_weight=low` | 非常保守；适合长篇 100+ 章 |
| D | 用户可配置阈值（设置项） | 灵活但增加 UI 复杂度 |

**为何需要人拍**：直接影响写作体验（P3 信息量），属产品调参；阈值错了会让 LLM 输出质量下降。

---

### Q3：温 fact 的 P3 标注格式

**背景**：温 fact（4-10 章内，非 archived）是否在 P3 输出里加额外标记，供 LLM 感知"这是稍老的事实"。

**选项**：

| 选项 | 格式示例 | 影响 |
|------|---------|------|
| A | 不加标注，与热 fact 完全相同 | 最简单；温 fact 对 LLM 无权重区别 |
| B（设计基准）| `- [active|older] 事实内容` 加 `older` 标签 | LLM 可感知时间梯度；但增加 token 消耗 |
| C | 温/热分为不同 block（独立 header） | 最清晰；但改 context_assembler 格式化逻辑更大 |

**为何需要人拍**：影响 LLM 提示工程效果，属 prompt 调参决策；需要真实测试验证哪种格式对 LLM 表现更好。

---

### Q4：固化触发的 UI 确认流程

**背景**：D-0041 §7 Q3 提到"固化触发的 UI 确认流程也需产品确认"。自动固化对用户是否透明？

**选项**：

| 选项 | 方式 | 体验 |
|------|------|------|
| A | 完全静默（本支线默认设计）| 用户看不到；固化失败也静默降级 |
| B | confirm 后 Toast 提示"已归档 N 条旧 fact" | 轻量透明；不打断写作流 |
| C | 固化前弹确认 Modal | 用户可干预；但打断写作节奏 |

**为何需要人拍**：产品 UX 决策；涉及 UI 实现量（A=零；B=1 Toast；C=Modal）。

---

## 十二、测试计划（TDD）

每块先写测试后实现。`vitest run` 必须全绿，不破坏既有 full 模式行为。

**micro 生成（2 个测试文件）**
1. `services/__tests__/chapter_summary_micro.test.ts`：mock LLM → micro text 写入 `.summary.jsonl`；失败不抛；简版 `disableChapterSummary` 门控；micro 不影响 standard（并存）
2. `repositories/implementations/__tests__/file_chapter_summary_v2.test.ts`：`update_micro` round-trip；`promote_to_v2` 备份 v1 + 写 v2；旧字段（无 micro/standard_v1）读回 null 兜底

**Retrospective（2 个测试文件）**
3. `services/__tests__/retrospective.test.ts`：后续 micro 空 → 跳过 LLM；micro 存在 → 生成 v2 + 覆盖 sum{N} embedding；v2 生成失败 → v1 不变；targetChapterNum < 1 → 跳过
4. `services/__tests__/retrospective_orchestrate.test.ts`：`shouldRunRetrospective` 边界（5/10/15/非倍数）；confirm 第 10 章 → target=5 的 Retrospective 被调

**冷热分层（3 个测试文件）**
5. `services/__tests__/facts_lifecycle_archive.test.ts`：`archive_fact` → `archived=true` + ops 条目；`unarchive_fact` → `archived=false`；旧 fact（无 archived 字段）archive → 正确写入
6. `services/__tests__/run_archival_sweep.test.ts`：满足阈值条件的 low fact → 被固化；high/medium weight → 不固化；已归档 → 不重复归档；空 facts → 无副作用
7. `services/__tests__/context_assembler_archival.test.ts`：`archived=true` 的 fact 不进 P3；`archived=false` 正常进 P3；旧 fact（无 archived 字段，undefined）被视为 active 进 P3（回归）；`build_facts_layer` golden 测试更新预期 delta

**prompt keys lint（1 个测试文件）**
8. `src-ui/src/__tests__/i18n_coverage.test.ts`（既有覆盖 lint 复用）：`SUMMARY_MICRO_*` + `SUMMARY_RETROSPECTIVE_*` zh/en 齐备（共 8 key）

**undo 联动 / 边界（纳入既有测试文件）**
9. `services/__tests__/undo_chapter_golden.test.ts`：undo 后 archived fact 随章节删除 → fact 列表不含 archived 遗留

**估算总任务数（TDD 粒度）**：8 个新测试文件 / 追加块，对应约 30-35 个 test case。

---

## 十三、推后开放问题

- D-0041 §7 Q1 Retrospective 正确时机（本 spec §十一 Q1，待拍板）
- micro 档何时进向量库 / 进 RAG（当前：不做，等有消费者）
- `detailed` 档消费者 UI（M8-C/M10 均不做，等功能落地再补）
- TD-014（undo_chapter resolves 反向级联）→ 随 M8 Memory 批次
- TD-015（导入导出 schema 扩展）→ M8 或事件驱动

---

## 附：权威来源

D-0041 全文（`D:\fanfic-system\docs\internal\decisions\D-0041-memory-architecture-redesign.md`，不在主仓 git 跟踪内）。本 spec §五-§七 的 micro/retrospective/archival 设计忠实复刻 D-0041 §5-§6，并按"只设计有消费者的部分"原则裁剪（micro 不入向量库、detailed 不生成）。§十一 Q1-Q4 均来自 D-0041 §7 开放问题，未经本 spec 自行定死。

---

## 可行性复核

> 复核基准：2026-06-20，审查人：Claude Code subagent。对照代码：`src-engine/` + `src-ui/src/api/engine-chapters.ts`。
> 仅记录工程可行性硬伤；产品决策（§十一 Q1–Q4）不重复。

### BLOCKER（阻断实现的硬错）

**B1：`OpType` 枚举未含 `set_chapter_title`——先例警示 `archive_fact`/`unarchive_fact` 必须同步扩枚举**

`src-engine/domain/enums.ts:90–102` 列出的 `OpType` 枚举值为 11 个，**不含** `set_chapter_title`。
然而 `engine-chapters.ts:104` 实际以字符串字面量 `"set_chapter_title"` 写入 ops，而不是 `OpType.SET_CHAPTER_TITLE`，所以 ops_projection 的 switch case（`ops_projection.ts:158`）能匹配，但 TypeScript 类型校验会报错（`op_type: "set_chapter_title"` 不在 `OpType` 联合类型内），且 `enums.test.ts:90-100` 也不覆盖此 key。
本 spec §七.1 要求 `archive_fact` / `unarchive_fact` 写 ops 条目，并标注"写 ops 条目（`op_type: "archive_fact"` / `"unarchive_fact"`）"——但 `createOpsEntry` 的 `op_type` 字段类型为 `OpType | string`（需要确认），而 `ops_projection.ts` 的重建 switch 不认识 `archive_fact`/`unarchive_fact` case，**archive 状态在 ops 重建路径下不可恢复**。
修正方向：要么在 `OpType` 枚举新增两个值并在 `ops_projection.ts` 补 case 处理（重建时恢复 `archived` 字段），要么明确决定 archive ops 仅作审计记录、不参与 rebuild（需在 spec 里显式声明，并在测试里覆盖 rebuild 后 fact 状态）。

**B2：`ChapterSummaryRepository` 接口扩展后 `FileChapterSummaryRepository` 与所有消费测试必须同步**

`src-engine/repositories/interfaces/chapter_summary.ts:7–11` 接口当前只有 `get` / `save` / `remove` 三个方法。
spec §五.3 要求新增 `update_micro`，§六.4 要求新增 `promote_to_v2`——这两个方法签名扩展到 interface 后，`FileChapterSummaryRepository`（`src-engine/repositories/implementations/file_chapter_summary.ts`）必须同步实现。
但更关键的：`engine-instance.ts:49` 中 `repos.chapterSummary` 的类型为 `FileChapterSummaryRepository`（具体类，非接口），`engine-chapters.ts:160` 调用 `e.repos.chapterSummary`——spec §六.5 的 `run_retrospective` 签名中传入 `e.repos.chapterSummary` 作为 `ChapterSummaryRepository` 类型参数，要求接口上有 `promote_to_v2`，但 `engine-instance.ts` 当前注册的具体类实现也必须有该方法，否则 tsc 在 engine-instance 侧也会报错。这是已知的接口扩展连带，**spec 没有提到需要更新 `engine-instance.ts` 的 `EngineInstance` 类型**，属遗漏集成点。

### MAJOR（须在实现阶段解决的重要问题）

**M1：`createChapterSummary` 工厂函数须同步扩展，否则 `update_micro` 和 `promote_to_v2` 读回旧文件时丢 micro/standard_v1**

`src-engine/domain/chapter_summary.ts:25–27`：
```typescript
export function createChapterSummary(partial: Partial<ChapterSummary>): ChapterSummary {
  return { standard: partial.standard ?? null };
}
```
当前仅返回 `standard` 字段。M10 扩展 `ChapterSummary` 加 `micro` + `standard_v1?` 后，`createChapterSummary` 仍只写 `{ standard }` — `FileChapterSummaryRepository.get()` 用 `createChapterSummary(raw)` 解析磁盘 JSON（`file_chapter_summary.ts:29`），会丢弃磁盘上已有的 `micro`/`standard_v1` 字段。
修正：`createChapterSummary` 须新增 `micro: partial.micro ?? null` + `standard_v1: partial.standard_v1 ?? undefined`，并确保 round-trip test 覆盖（spec §十二 测试 2 已要求，但必须保证工厂函数更新先于测试）。

**M2：confirm 接缝中 micro 生成和 Retrospective 触发均在 `withAuLock` 之外，与 CAS 校验模式不一致**

`engine-chapters.ts:151–169`：standard 摘要"生成在锁外（慢 LLM），落盘+索引在锁内"——spec §五.2 描述的 micro 生成位置是"`persist_chapter_summary` 调用之后顺序追加 micro 生成 + 写入（same file, same lock）"，但实际 `persist_chapter_summary` 在 `withAuLock` 的 callback 内（`engine-chapters.ts:151`），`withAuLock` 是一次性持锁 block。在同一 lock 内串行追加第二次慢 LLM 调用（micro 生成）会显著延长锁持有时间，违反"生成在锁外"的设计原则。
spec 伪代码（§五.2）把 `generate_micro_summary(...)` 和 `summaryRepo.update_micro(...)` 都放在"same CAS check"锁内——正确做法应与 standard 一致：micro LLM 调用在锁外完成，仅 `update_micro` 写入在锁内并补做 content_hash CAS check。spec 需明确这个双锁模式，否则 Codex 实现时会选择最简路径（全塞进锁内）导致死锁风险。

**M3：`run_retrospective` 签名传入 `ragManager: RagManager` 但 `RagManager` 未从 `@ficforge/engine` barrel 导出**

`src-engine/index.ts` 不导出 `RagManager` 类本身（只导出 `JsonVectorEngine`、`RagManager` 实际由 `engine-instance.ts` 直接 `import { RagManager } from "@ficforge/engine"` 得到）。
查 `engine-instance.ts:26`：`import { ..., RagManager, ... } from "@ficforge/engine"` — 实际上 `RagManager` **是通过 `services/index.ts` barrel 间接导出的**（`src-engine/index.ts:95: export * from "./services/index.js"`）。需确认 `services/index.ts` 是否导出 `RagManager`；若 `retrospective.ts` 放在 `services/` 下，它 import `RagManager` 会产生循环依赖（`services/` → `rag_manager.ts` → `services/` 内其他模块）的风险。建议复核 `services/index.ts` 的当前导出列表，并在 Codex 计划阶段明确 import 路径。

**M4：`Fact.chapter` 字段在 `run_archival_sweep` 里用于距离计算，但 `chapter` 含义是"产生于第几章"——已废弃/解决的 fact 不更新此字段，须排除**

`src-engine/domain/fact.ts:15`：`chapter: number` = 产生于第几章（创建时写入，不随 status 更新变化）。
`run_archival_sweep` 固化条件：`fact.chapter <= currentChapter - COLD_THRESHOLD_CHAPTERS`——但 `eligible` 集合未经 `archived` 和 status 双重过滤，按 `facts_lifecycle.ts` 现有逻辑，`add_fact` 时 status 默认 ACTIVE，`edit_fact` 可改 status 为 DEPRECATED/RESOLVED。spec §七.2 固化条件写的是"所有 active facts"扫描，但如果 `deprecated` 或 `resolved` 的 fact 同样满足 `chapter` 距离和 `narrative_weight=low` 条件，sweep 会把它们也打成 `archived=true`——此时 P3 filter `f.archived !== true` 会过滤它们，而它们本应已被 `status` 过滤（eligible 条件 `f.status === ACTIVE || UNRESOLVED`）排除在 P3 之外。
实际上因为 `build_facts_layer:175–179` 的 `eligible` filter 已按 status 过滤，archived 在 DEPRECATED/RESOLVED 上叠加是无害冗余，但 `run_archival_sweep` 若未限定 status 范围，会把 deprecated/resolved fact 的 `archived` 也写成 true，造成不必要的写操作和 ops 条目膨胀。需在 spec 里明确 sweep 只针对 `status ∈ {active, unresolved}` 的 fact。

**M5：`ops_projection.ts` 的 `rebuildFactsFromOps` 不识别 `archive_fact`/`unarchive_fact`——rebuild 后 archived 状态丢失**

（B1 的延伸后果详述）`src-engine/ops/ops_projection.ts` 的 `rebuildFactsFromOps` 函数通过 switch case 重建 fact 状态。当前 case 列表：`add_fact` / `edit_fact` / `update_fact_status` / `delete_fact`。若 `archive_fact` 写入 ops 但 rebuild 不处理，在任何需要从 ops 重建 facts 的场景（如 ops 投影测试、潜在的 state repair 工具）下，archived 字段都会还原为 `false`，与磁盘 fact 文件不一致。这是 ops 作为 audit log 的语义完整性问题。

**M6：`getSimpleFeatures(sett.app.writing_mode)` 在 confirm 接缝中空值安全性**

`engine-chapters.ts:138`：`getSimpleFeatures(sett.app.writing_mode)` 调用，但 `sett.app` 有可能是 `undefined`（`settings.get()` 返回的 app 字段非必须）。当前 standard 摘要生成路径已这样写，所以这是**已存在的 pre-existing issue**，本 spec 追加 micro 和 retrospective 时只需复用相同 guard pattern（`sett.app?.writing_mode`），不引入新风险。记录此处供 Codex 注意。

### 集成点行号核实

以下集成点行号经代码实测，与 spec §八 声明有偏差：

| spec §八 声明 | 实测 |
|--------------|------|
| `context_assembler.ts:build_facts_layer`（当前行约 168-247）| 实测 L168–247，**与声明一致** |
| `context_assembler.ts:175`（`eligible` 过滤条件）| 实测 L175–179，**与声明一致** |
| `facts_lifecycle.ts:178`（末尾追加） | 实测 `add_fact` 开始于 L178，末尾函数 `set_chapter_focus` 结束于 L448，追加位置在文件末尾是正确描述，**可行** |
| `domain/chapter_summary.ts:20`（加 `standard_v1?` + `micro` 键） | 实测 L20 为 `ChapterSummary` interface 定义行，**与声明一致** |
| `domain/fact.ts:8`（加 `archived: boolean`）、`fact.ts:26`（`createFact` 默认值） | 实测 L8 为 `Fact` interface 开始行，L26 为 `createFact` 函数定义行，**与声明一致** |
| `domain/enums.ts:97`（`OpType` 加 `ARCHIVE_FACT`/`UNARCHIVE_FACT`）| 实测 L97 正是 `RESOLVE_DIRTY_CHAPTER`，`OpType` enum 末尾 L102，追加位置正确，**可行**；但 spec 没提需同步更新 `domain/__tests__/enums.test.ts` 的枚举值测试 |
| `domain/context_summary.ts:23`（新增 `facts_archived_count`）| 实测 L23 为 `ContextSummary` interface 内 `facts_injected` 字段，追加 `facts_archived_count` 可行，**但 `createContextSummary` 工厂函数（L50-64）也须同步加默认值 `facts_archived_count: 0`，spec 未提及** |
| `engine-chapters.ts:~163`（micro）/ `~175`（retrospective）/ `~180`（archival sweep）| 实测 `persist_chapter_summary` 调用在 L160–168，摘要块结束于 L175（catch），追加位置对，**但 micro 生成应在 withAuLock 外（见 MAJOR M2）** |
| `repositories/interfaces/chapter_summary.ts:7`（新增 `promote_to_v2` 签名）| 实测 L7 为 `get` 方法签名，接口只有 get/save/remove 三个方法，扩展可行，但**须同时更新 `engine-instance.ts` 中 `repos.chapterSummary` 类型（见 BLOCKER B2）** |

### 范围可独立性评估

**可以独立成一个实现计划**，但有一个强前提：M8-C 的 `ChapterSummaryRepository` / `FileChapterSummaryRepository` / `createChapterSummary` / `persist_chapter_summary` / `RagManager.indexChapterSummary` 全部已落地（实测均已存在），前置依赖满足。

三个子模块（micro / retrospective / cold-tier archival）可以进一步拆分为独立 Codex 任务，建议顺序：
1. domain 扩展（`Fact.archived` + `ChapterSummary.micro/standard_v1` + `OpType` 枚举 + `ContextSummary.facts_archived_count`）
2. repository 扩展（`update_micro` + `promote_to_v2` + `createChapterSummary` 工厂更新）
3. services 新文件（`chapter_summary_micro.ts` 或在 `chapter_summary.ts` 追加 / `retrospective.ts` / `facts_lifecycle.ts` 追加 `archive_fact`/`unarchive_fact`/`run_archival_sweep`）
4. context_assembler P3 filter 改动
5. confirm 接缝接线（`engine-chapters.ts`）
6. 测试补全 + prompt keys + i18n

### 总结

- **BLOCKER 数量**：2（B1 枚举+rebuild 缺口；B2 engine-instance 集成点遗漏）
- **MAJOR 数量**：6（M1 工厂函数；M2 锁模式；M3 barrel 导出确认；M4 sweep status 范围；M5 rebuild 状态丢失；M6 空值安全预注意）
- **行号误差**：集成点行号总体准确（均在 ±5 行内），无根本性错误
- **结论**：设计方向可行，核心依赖均已落地，但 B1/B2 须在 Codex 计划阶段修正后方可开工
