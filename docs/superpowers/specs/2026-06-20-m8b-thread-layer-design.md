# M8-B Thread（剧情线）层设计

- 日期：2026-06-20
- 作者：CC（自主拍板，用户授权「待拍产品决策你自己拍，记进 spec，随时可推翻」）
- 依赖：M8-A（Fact 富化，已上线，`thread_ids`/`thread_roles` 已 schema 留位）；M8-C（Chapter Summary，已上线）。D-0041 §7 三层记忆的第三层。
- 状态：设计（待实现）

---

## 0. 修订记录

- v1（2026-06-20）：初稿。引擎层范围；手动建线（D-0041 §7 Q2「初期手动建 3-5 条线」）；剧情线摘要数字化注入续写上下文（真实消费者，非死步）。
- v2（2026-06-20，实现 + 双审修正）：3-lens workflow 对抗审 + 实现中读真代码发现并治本：
  1. **【治本，M8-A 同款 BLOCKER】hop 5 实为两步**：除 add_fact op payload 快照外，`add_fact` 服务的 `createFact` 调用本身也必须从 `fact_data` 转发 `thread_ids/thread_roles`（facts_lifecycle.ts:232 区）——否则 fact 对象拿不到值，快照与持久化全空。spec 初稿把这步压进 hop 5，实现时单独补上。**测试用服务级 add_fact（非手搓 op）跑通整条链**，正是 M8-A 测试手搓 op 反而抓不到自己 hop5 BLOCKER 的教训。
  2. **【避坑】§6.3 措辞修正**：generation.ts:251 已显式传 `params.settings.app.writing_mode`（非隐式默认）。**不得**改成硬编码 `"full"`（会让 simple 模式停走 assemble_context_simple）。正确做法：仅在其后追加 `params.threads ?? []`。
  3. **【避红测】REQUIRED_KEYS 计数有两处断言**：`prompts.test.ts:61` + `m8a_facts_enrichment.test.ts:470`，都需 66→67。
  4. `edit_fact` 服务经通用 `key in fact` 循环已天然支持 thread_ids（fact 总经 dictToFact 加载，属性恒存在）；EDITABLE_FIELDS 管 rebuild 侧。两侧均测。
  5. ThreadStatus 断言放 `enums.test.ts` 值稳定性（非 contract_enums——threads 不是 LLM 工具，无 schema 可对）。
  - 结果：引擎 931/931 + 双端 tsc 干净；src-ui 163/164（唯一失败 useContextTokenCount 系既有 async-timing flake，隔离跑 4/4 绿，与本支线无关）。
- v3（2026-06-20，实现审 codex + workflow 修正）：两路独立审（codex CLI + 3-lens workflow，均带 M8-A BLOCKER 怀疑度）**独立确认主链 hop 无漏、门控零回归、edit_fact 边界安全**（M8-A 那类坑未复发）。据审收口：
  1. **【接受 BLOCKER 但判定为「文档化的工程分层」非架构死步】codex：生产 UI 无入口调 thread API → 发版后 `build_threads_layer` 恒拿 []，M8-B 能力不落地**。CC 拍板：M8-B 是**引擎层增量**（与 M8-C 摘要、M10 archival sweep 同节奏——引擎闭环完成+测试，UI 是显式下一块）。引擎链路真实完整且测试覆盖；缺的是**用户入口（UI）**，不是数据链消费者。**但与 M8-C 不同**（摘要 confirm 自动触发、零用户操作即有可观测产出），M8-B 剧情线是**手动**的，没 UI 就没用户可达入口 → 发版无可观测价值，纯基础设施。**→ 决策：先合引擎+API 增量，「M8-B-UI（剧情线面板 + 挂线交互）」列为价值落地的下一块，向用户显式 flag 可改排期。**
  2. workflow MAJOR（确认）：门控测试漏断言 p2/p4_tokens → 已补全 P 层断言。
  3. codex MINOR：engine-generate 线程读失败 `catch(()=>[])` 静默 → 改 logCatch 记录（沿用本会话 bughunt 非静默吞错铁律）。
  4. codex MINOR：thread_roles 潜在漂移 → v1 无生产者实际不会发生，setFactThreads 注释标 M9 维护责任。
  5. build_threads_layer sort 加 `?? ""` 兜底防损坏行 undefined updated_at；simple 模式不注入 threads 加显式注释（spec D5）。
  - 延后（记 §十）：ExtractedFact(Candidate)/FactInfo 加 thread_ids（提取产出剧情线归属是 M9 的活，现加=死字段）。
  - 复验：引擎 931/931 + 双端 tsc 干净。

---

## 一、背景与问题

D-0041 设计三层记忆：**Fact**（原子事实 + 信息不对称）/ **ChapterSummary**（单章叙事压缩）/ **Thread**（跨章剧情线）。前两层已上线，Thread 是缺的第三层。

Fact 与 ChapterSummary 都答不出一个问题：「**这条贯穿 ch1-ch3-ch5 的『为父翻案』线，现在进行到哪了，还有什么没收**」。Fact 太碎（一条条原子事件），Summary 是按章切的（每章一段，不按剧情线归组）。长篇续写最常见的失忆就是 **AI 忘了某条长线**——开了个伏笔几十章不收，或把已收的线又翻出来。Thread 层就是补这个：把相关 Fact 归到一条**命名的、持久的、跨章的剧情线**下，带一句「当前进展」，在续写时注入，让模型守住长线连贯。

---

## 二、产品决策（CC 拍板，用户可推翻）

> 下列决策按「五段式」精神标注，便于用户复核时一眼看懂取舍。其中只有 **D2** 是真正的产品取舍（且只是落实 D-0041 §7 Q2 用户已定方向），其余是工程实现选择。

### D2【唯一真产品取舍】M8-B 只做「手动建线 + 手动写进展」，不接 LLM

- **背景**：剧情线可以让用户手动建，也可以让 AI 自动识别/自动写进展。
- **影响**：决定 M8-B 是纯确定性数据层，还是要接 LLM 提取。
- **后果**：
  - 手动：用户自己建 3-5 条线、自己写一句进展、把 Fact 挂到线上。简单、确定、可测、零 LLM 成本。AI 自动识别留给 M9（ReAct 提取）。
  - 自动：M8-B 就要接 LLM 去「猜哪些 Fact 属于哪条线」「自动写线的进展」——本质是 M9 的活，提前做会与 M9 撞车且引入 LLM 不确定性。
- **为何推荐手动**：D-0041 §7 Q2 用户已定「初期手动建 3-5 条线」；自动识别是 M9 的明确职责；先把数据层 + 注入消费者打通，M9 再往上叠自动化，零返工。
- **为何记这条**：它划定了 M8-B 的边界（不接 LLM），影响后面所有实现取舍。**用户若想 M8-B 就要 AI 自动建线，请推翻，我改走 M8-B/M9 合并方案。**

### D1【工程】剧情线成员关系的单一真相源 = `fact.thread_ids`

Thread 记录**不存** `fact_ids`；「哪些 Fact 属于这条线」由 `fact.thread_ids.includes(thread.id)` 派生。理由：双向存 = 两处维护同一关系 → 必漂移（CLAUDE.md「两张表意思相同就会漂」铁律）。`fact.thread_ids` 已在 M8-A schema 留位，正好做这个真相源。

### D3【工程】Thread 元数据走 threads.jsonl 直写（非 ops-backed）；成员关系随 Fact 走 ops

- ChapterSummary 也是直写（可再生）；Fact 是 ops-backed（要 undo/audit）。
- Thread 元数据（标题/进展/状态）是用户手写、不可再生、但**不绑定某一章**——所以不需要进 undo 级联。直写 + 文件锁足够。
- 成员关系 `fact.thread_ids` 是 Fact 的字段 → 天然随 facts 的 ops 投影走（这就是为何要把它过全 6-hop）。undo 某章 → 该章新增的 Fact 连同其 `thread_ids` 一起被 rebuild 移除，语义正确。
- **悬挂引用**：用户删一条线后，旧 Fact 上仍残留该 `thread_id` —— 完全惰性无害（注入只遍历 threads，不反查 fact→thread），不需要跨存储清理。

### D4【工程】消费者 = 活跃剧情线摘要注入，**按数据存在性门控**，空线 ⇒ 续写上下文逐字节不变

沿用 M8-C/M10-B/M8-A 的加法门控套路：`assemble_context` 新增可选 `threads: Thread[] = []` 参数。空数组（所有现存调用方 + golden 测试都不传）⇒ 注入层为空字符串 ⇒ 被 `filter(Boolean)` 滤掉 ⇒ 输出与今天逐字节一致。只有真有 active 线时才出现摘要段。golden 测试零改动。

### D5【范围】`thread_roles` 序列化留位但 v1 不被注入消费；simple 模式不注入剧情线

- `thread_roles`（Fact 在某条线里的角色，如 `turning_point`）过 6-hop 序列化（防未来格式漂移），但 v1 的注入只用 thread.title + thread.state，不读 thread_roles。留给 M9 做更丰富的弧建模。
- simple 模式（`assemble_context_simple`，全塞、fork 隔离 D-0044）v1 不注入剧情线，保持 fork 隔离；未来可加。

---

## 三、领域模型

新增 `src-engine/domain/thread.ts`：

```ts
import { ThreadStatus } from "./enums.js";   // 新枚举，见下

export interface Thread {
  id: string;            // t_{timestamp}_{4rand}（mirror Fact id 格式）
  title: string;         // 剧情线名（"沈砚为父翻案"）
  description: string;   // 这条线是什么（可空字符串）
  state: string;         // 当前进展一句话（注入用；"已确认名录被篡改，准备面圣"）
  status: ThreadStatus;  // active / resolved / dormant
  created_at: string;    // ISO 8601
  updated_at: string;    // ISO 8601
}

export function createThread(
  partial: Pick<Thread, "id" | "title"> & Partial<Thread>,
): Thread {
  return {
    description: "",
    state: "",
    status: ThreadStatus.ACTIVE,
    created_at: "",
    updated_at: "",
    ...partial,
  };
}
```

`src-engine/domain/enums.ts` 新增（单一声明，全项目 grep 只此一处）：

```ts
export enum ThreadStatus {
  ACTIVE = "active",      // 进行中
  RESOLVED = "resolved",  // 已收束
  DORMANT = "dormant",    // 暂时搁置
}
```

`contract_enums.test.ts` / `enums.test.ts` 补 ThreadStatus 断言（mirror 既有枚举测试）。

---

## 四、存储与仓库

### 接口 `src-engine/repositories/interfaces/thread.ts`

```ts
export interface ThreadRepository {
  list(auPath: string): Promise<Thread[]>;
  get(auPath: string, id: string): Promise<Thread | null>;
  add(auPath: string, thread: Thread): Promise<void>;
  update(auPath: string, thread: Thread): Promise<void>;  // 按 id 整条替换
  remove(auPath: string, id: string): Promise<void>;
}
```

### 实现 `src-engine/repositories/implementations/file_thread.ts`

逐字段镜像 `file_fact.ts`：`threadToDict` / `dictToThread`、`threads.jsonl` 路径（`joinPath(auPath, "threads.jsonl")` + `validateBasePath`）、`withWriteLock` 串行化、`read_jsonl`/`append_jsonl`/`rewrite_jsonl`。`dictToThread` 对 status 做枚举校验（非法值兜底 active，align M8-A `dictToFact` 的 time_kind/suspense_type 枚举校验模式）。

`engine-instance` / 仓库工厂注册 `threadRepo`（mirror summaryRepo 注册点，M8-C 已铺好该模式）。

---

## 五、Fact.thread_ids / thread_roles 贯穿全 6 个序列化 hop（治本，M8-A 同款铁律）

> 缺任一 hop 即静默丢字段。M8-A 的致命 BLOCKER 就是漏了 hop 5（add_fact 快照）。round-trip 测试**必须**覆盖 hop 3+4+5。

| # | hop | 文件:符号 | 改动 |
|---|-----|-----------|------|
| 1 | `interface Fact` + `createFact` | `domain/fact.ts` | 字段已留位（`thread_ids?: string[]` / `thread_roles?: Record<string,string>`），无需改 interface；createFact 不加默认（保持可选，与 caused_by 一致由下游填） |
| 2 | `factToDict` / `dictToFact` | `file_fact.ts:19` / `:58` | factToDict：`if (fact.thread_ids?.length) d.thread_ids = fact.thread_ids;` `if (fact.thread_roles && Object.keys(fact.thread_roles).length) d.thread_roles = fact.thread_roles;`。dictToFact：`thread_ids: Array.isArray(d.thread_ids)?d.thread_ids as string[]:[]`（mirror caused_by 默认 []）、`thread_roles: (typeof d.thread_roles==="object"&&d.thread_roles!==null)?d.thread_roles as Record<string,string>:undefined`（mirror _confidence 默认 undefined） |
| 3 | `factFromPayload`（ops add_fact payload→Fact） | `ops_projection.ts:223` | 加 thread_ids（数组兜底 []）、thread_roles（对象兜底 undefined），逐字镜像 caused_by/_confidence 处理 |
| 4 | `EDITABLE_FIELDS`（edit_fact op 回放白名单） | `ops_projection.ts:286` | 加 `"thread_ids"`、`"thread_roles"` —— 这同时让「给 Fact 挂线」复用既有 edit_fact 机制，**不新增 op 类型** |
| 5a | **`add_fact` 的 `createFact` 转发** | `services/facts_lifecycle.ts:232`（createFact 调用） | 从 `fact_data` 读 thread_ids/thread_roles 传进 createFact（**v2 补**：不加则 fact 对象为空，5b 快照与 hop2 持久化全空） |
| 5b | `add_fact` op 的 `payload.fact:{…}` 快照 | `services/facts_lifecycle.ts`（add_fact 内 fact 快照对象） | 快照对象补 thread_ids / thread_roles（不加则新字段永不进 op，hop 3 无从恢复） |
| 6 | 消费者 | `context_assembler.ts` | **不在 per-fact 行注入**（thread_ids 本身不进 fact 行）；消费走 §六 `build_threads_layer`。给 Fact 挂线 = `setFactThreads` API → edit_fact op（hop 4 已支持） |

> 注意：与 M8-A 不同，hop 6 对 thread 字段**不是** `build_facts_layer` 的 per-fact 后缀注入——`thread_ids` 是机器引用、无叙事价值、不该进 prompt 的 fact 行。它的价值在 §六的剧情线摘要段。

---

## 六、消费者：活跃剧情线摘要注入（核心，证明非死步）

### 6.1 纯函数 `build_threads_layer`（新增于 `context_assembler.ts`）

```ts
export function build_threads_layer(
  threads: Thread[],
  budget_tokens: number,
  llm_config: unknown,
  language = "zh",
): string {
  const active = threads
    .filter((t) => t.status === ThreadStatus.ACTIVE)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at)); // 最近推进的在前
  if (active.length === 0) return "";

  const lines: string[] = [];
  let used = 0;
  for (const t of active) {
    const stateText = t.state?.trim() || t.description?.trim() || "";
    const line = stateText ? `- 【${t.title}】${stateText}` : `- 【${t.title}】`;
    const tk = _count(line, llm_config).count;
    if (used + tk > budget_tokens) break;   // 预算截断，mirror build_facts_layer
    lines.push(line);
    used += tk;
  }
  if (lines.length === 0) return "";
  const P = getPrompts(language as "zh" | "en");
  return P.SECTION_PLOT_THREADS + "\n" + lines.join("\n");
}
```

新增 prompt key `SECTION_PLOT_THREADS`（zh：「## 当前剧情线（守住这些长线的连贯，别遗忘也别重复收束）」/ en 对应），zh+en 双语，`prompts/__tests__/prompts.test.ts` 的 `REQUIRED_KEYS.length` 同步 +1（M8-A 教训 BLOCKER-2）。

注入格式示例：
```
## 当前剧情线（守住这些长线的连贯，别遗忘也别重复收束）
- 【沈砚为父翻案】已确认名录被篡改，下一步面圣呈递残角
- 【太傅的图谋】太傅在暗中追查同一卷名录，尚未与沈砚正面冲突
```

### 6.2 接进 `assemble_context`（FULL 模式）

threads 完全镜像 `facts` 的流动方式（`facts` 由 UI 层 `e.repos.fact.list_all` 加载 → 传 `generate_chapter` → 传 `assemble_context`）：

- `assemble_context` 签名加**最后一个**可选参数 `threads: Thread[] = []`（放在 `writingMode` 之后；所有现存调用方 + golden 测试不传 ⇒ `[]`）。
- 收集位置：P3（事实表）之后、P2（最近章节）之前收集 `threadText = build_threads_layer(threads, max(0, budget - used - guarantee), llm, language)`，计入 `used` 与 `report`（新增 `report.thread_tokens`，`BudgetReport` + `createBudgetReport` 补字段）。
- 注入位置：`layers = [p1Text, p3Text, threadText, p2Text, p4Text, p5Text]`，reverse 后顺序为 `P5→P4→P2→thread→P3→P1`，剧情线摘要落在「最近章节」之后、「事实表 / 当前指令」之前——离指令近、注意力高。
- 空 `threads` ⇒ `threadText=""` ⇒ filter 滤掉 ⇒ 逐字节不变（FULL 模式 golden 测试零改动通过）。

### 6.3 生产接线（两环，镜像 facts）

1. **`src-engine/services/generation.ts`**：`GenerateChapterParams` 加 `threads?: Thread[]`（mirror `facts: Fact[]`，generation.ts:143）；`generate_chapter` 解构 `threads` 后，在 `assemble_context(...)` 调用（generation.ts:244）末尾把 `threads ?? []` 传进去（需把当前隐式默认的 `writingMode` 显式传 `"full"` 以到达 threads 位）。
2. **`src-ui/src/api/engine-generate.ts`**：mirror `const allFacts = await e.repos.fact.list_all(...)`，加 `const threads = await e.repos.thread.list(params.au_path).catch(() => []);`（best-effort 降级，list 抛错 → `[]`，不阻断续写），传入 `engineGenerateChapter({ ..., threads })`。

> M8-C 同款 best-effort 接线哲学：摘要/线加载失败一律降级、绝不阻断主写作流。

---

## 七、手动 CRUD API（薄封装，供未来 UI + 测试驱动）

新增 `src-ui/src/api/engine-threads.ts`（mirror `engine-facts.ts` 薄封装）：

- `listThreads(auPath)` / `addThread(auPath, {title, description?, state?})` / `updateThread(auPath, thread)` / `archiveThread(auPath, id)`（= update status=dormant/resolved）/ `removeThread(auPath, id)`
- `setFactThreads(auPath, factId, threadIds)`：走既有 **edit_fact** op 路径写 `fact.thread_ids`（hop 4 已纳入白名单），复用 facts 的 ops/undo/锁机制，**不新增 op 类型**。

> UI 组件（剧情线面板、挂线交互）**不在 M8-B 范围**——与 M8-C「摘要生成已上线、UI 未surface」同节奏。M8-B 交付完整引擎闭环：建线 → 挂 Fact → 注入续写。UI 后续单独排。

---

## 八、测试计划（TDD，先红后绿）

1. **domain**：`createThread` 默认值；ThreadStatus 枚举值（enums.test / contract_enums.test）。
2. **repo round-trip**：`file_thread` add/list/get/update/remove；threadToDict↔dictToThread 含非法 status 兜底。
3. **6-hop 序列化（关键，mirror M8-A T4）**：
   - file_fact jsonl：含 thread_ids/thread_roles 的 Fact → factToDict → dictToFact → 断言还原。
   - **ops rebuild（hop 3+4+5）**：构造带 thread_ids/thread_roles 的 add_fact + 用 edit_fact 改 thread_ids 两个 op → `rebuildFactsFromOps` → 断言最终 thread_ids/thread_roles 正确（这正是 M8-A 漏掉、codex 抓出的那条链）。
4. **build_threads_layer**：active 排序 + 格式；dormant/resolved 不注入；预算截断（窄预算丢尾部）；空/全非 active ⇒ `""`。
5. **assemble_context 门控**：不传 threads ⇒ 与现有 golden 输出**逐字节一致**（跑现有 golden 测试，零改动通过）；传 active 线 ⇒ user message 含剧情线段且位置正确（P2 后、P3 前）；`report.thread_tokens` 计入。
6. **engine-generate 接线**：list 抛错时降级传 []，续写不中断（mock threadRepo.list reject）。
7. **prompts**：REQUIRED_KEYS 计数 +1；zh/en 均有 SECTION_PLOT_THREADS。

---

## 九、治理 / 复用 / no-hardcoding 审计

- **复用**：createFact→createThread、file_fact→file_thread、edit_fact ops→挂线（不新增 op）、build_facts_layer 预算截断套路→build_threads_layer、summaryRepo 注册点→threadRepo。无重复实现。
- **单一真相源**：成员关系只存 `fact.thread_ids`（D1）；ThreadStatus 单一枚举声明；SECTION_PLOT_THREADS 单一 prompt key（zh/en 双语同源）。
- **no-hardcoding gate**：本支线零业务规则硬编码（ThreadStatus 是题材中立结构枚举）。diff 关键词扫描（`\d+(\.\d+)?折|必中|永久有效|100%|保证赚钱|百分百中奖|稳赚|提现|现金|最强|国家级`）预期 0 命中。
- **数据链对称**：写（addThread/setFactThreads）必有读（list→build_threads_layer 注入）；round-trip 测试证闭环。
- **门控零回归**：空 threads ⇒ 续写上下文逐字节不变（golden 测试守门）。

---

## 十、范围外（明确不做，留后续）

- AI 自动识别剧情线 / 自动写 thread.state（M9 ReAct）。
- 剧情线 UI 面板 + 挂线交互（UI 排期）。
- simple 模式注入剧情线（fork 隔离，未来可加）。
- thread_roles 的注入消费（v1 只序列化留位）。
- Thread 元数据进 undo 级联（直写设计，不需要，见 D3）。
- **`ExtractedFact` / `ExtractedFactCandidate` / `FactInfo` 加 thread_ids 字段**（M8-B 实现审 MINOR/NIT）：当前 LLM 提取**不产出** thread_ids（剧情线手动建/手动挂，非提取），故这些「提取候选」类型留 thread_ids 是死字段、无生产者。**留给 M9**——M9 若让提取产出剧情线归属，再在 ExtractedFact→rawToExtracted→addFact 候选链补字段。手动挂线路径（setFactThreads→edit_fact）不经这些类型，已通。
