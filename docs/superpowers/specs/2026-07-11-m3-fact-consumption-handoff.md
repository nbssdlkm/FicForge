# Handoff：M3 三个 fact 字段的消费端补全（POV 门控 + 时间线排序）

> 写给**新会话**的接力文档。读完这份就能上手，不需要上一轮对话的上下文。
> 来源：2026-07-11 第三轮盲审 M3（写而不读字段），用户已拍板**保留并实现**（不是删）。

---

## 一句话任务

三个 fact 字段（`hidden_from` / `story_time_order` / `story_time_tag`）AI 一直在正确提取并落盘，但**产品里没有任何地方读取它们干活**。本任务：把"读取 + 用"这一端接上，让承诺过的两个功能真正生效——**按视角藏信息（POV 门控）** 和 **按剧情内时间排序（时间线）**。

**关键前提：AI 提取端已经做完、正确工作，本任务不改提取，只补消费。**

---

## 背景（这是什么、用户拍了什么板）

- 用户是**非程序员 AI PM**，看产品级取舍，要**大白话、无术语、无 emoji、如实低调**。任何要他拍板的决策点必须带五段（背景/影响/后果/为何推荐/为何要你拍），大白话。
- 上一轮把这三字段作为审计 M3 摆给用户："建功能 vs 删规划脚手架"。**用户选了建功能**，原话"很显然这是设计上该实现的功能"。
- 但用户**还没回答实现细节的两个岔路**（见下"待拍板"）。**新会话第一步应先用大白话把这两个岔路问清楚，再动手。**

---

## 三个字段的原始设计意图（`git blame` 源头 commit `e44db40`，M8-A "Fact Enrichment Layer 2/3"，2026-06-20）

三字段是照记忆架构蓝图 D-0041 预埋的，当时被明确标为"低价值、先不注入 prompt、把消费功能推给 M9/后续"——结果后续从未落地。这不是"漏做"，是**设计时的主动降级**，所以三者价值不等，别一刀切：

| 字段 | 层 | 原始设计用途 | 价值判断 |
|------|-----|------------|---------|
| `hidden_from` (string[]) | Layer 3 信息不对称 | `known_to` 的反集，服务"戏剧反讽/按视角藏信息"。设计文档称其为"同人续写的核心张力机制""**跨竞品唯一性亮点**" | **高**——真该做，差异化卖点 |
| `story_time_order` (number) | Layer 2 叙事定位 | 叙事内时序整数（与真实 timeline 正交），驱动按剧情内时间对记忆排序。设计把"全局排序+冲突检测"推给"M9/后续" | 中——锦上添花，记忆换个顺序 |
| `story_time_tag` (string) | Layer 2 叙事定位 | 人类可读时间标签（如"Y1 冬末"）。设计文档自认**与已有 `story_time` 字段语义重叠**、"只给 UI 显示用"、不进 prompt | **低/存疑**——可能冗余，做前先确认要不要 |

**AI 当前的填写规则**（提取 prompt，`src-engine/prompts/zh.ts:221-227` / `en.ts:240-246`；ReAct zod schema `src-engine/services/react_extraction_tools.ts:74-82`）：
- `story_time_order`：从 1 开始的正整数，本章为基准，早于本章用更小正整数，不确定填 null
- `story_time_tag`：自由文本时间标签，不确定填 null
- `hidden_from`：明确不知情的角色名数组，正常叙事填 `[]`（只有悬念场景才非空）
- 三字段各带 per-field `_confidence`（high/medium/low）

**设计文档原件**：`docs/superpowers/specs/2026-06-20-m8a-fact-enrichment-design.md`（P3 注入策略在 `:317-326` 明列三字段为"低价值不注入"；开放问题 `:459` 把 story_time_order 全局排序推给"后续"）。D-0041 原件不在仓库（在用户 Obsidian / 归档）。

---

## 精确的消费缺口位置（要动的就这几处）

全部集中在 `src-engine/services/context_assembler.ts`（P0 高风险模块，有 golden test 护栏——改完必跑 golden）：

1. **POV 门控（hidden_from）缺口**
   - `build_facts_layer`（约 `:292` 起）的 eligible 过滤（约 `:299-305`）：现在只看 `status` + `focus_ids` + `isColdFact`，**没有 pov × hidden_from 过滤**。这里该加：当前 POV 角色若在某 fact 的 `hidden_from` 里，按选定策略处理该 fact。
   - `perspective_block`（约 `:82-87`）：现在只出第一人称文风指令（"把客观事实转成 {pov} 的主观感知"），**不联动事实过滤**。POV 角色来源 = 项目级 `WritingStyle.pov_character`（第一人称时；`Perspective` 枚举 `domain/enums.ts:57-61` 只有 THIRD_PERSON / FIRST_PERSON）。
   - **注意**：第三人称时没有单一 POV 角色，hidden_from 门控是否生效、怎么生效，是设计问题（见待拍板）。

2. **时间线排序（story_time_order）缺口**
   - `sort_by_weight_and_recency`（约 `:399-407`）：现在按 `narrative_weight` 再按 `chapter`（recency）排，**没用 story_time_order**。若要"按剧情内时间"排，这里是切入点——但要想清楚：是替换现有排序，还是新增一种"时间线视图"？现有排序服务的是"注入 context 的显著性"，未必等同"用户想看的时间线"。

3. **story_time_tag 的 UI 缺口**
   - `src-ui/src/api/facts.ts`（约 `:33` / `:76`）只透传 DTO，UI 无渲染该标签的组件。若决定做，是纯 UI 展示活。

**已核实无其它消费者**：三字段现存引用全是 round-trip（`file_fact.ts`）、ops 投影（`ops_projection.ts`）、livetest 探针、DTO 透传、zod 校验——零行为消费。

---

## 待用户拍板（新会话开头先用大白话问清楚，别自己替他定）

**① POV 门控怎么做——"藏"还是"提示"？**（这是效果差很远的岔路）
- **A（藏）**：主角不知道的事，直接不喂给 AI。绝不穿帮，但 AI 可能因"不知情"写出前后矛盾。
- **B（提示，推荐）**：仍把事喂给 AI，但标注"主角不知道这件事，请写出他的不知情/懵懂"。AI 能圆住剧情又不穿帮；偶尔可能透一点。系统第一人称视角现在已用类似 B 的思路，B 更顺更稳。

**② 这次范围——三样一起做，还是先只做 POV 门控？**
- 推荐：先做 hidden_from 的 POV 门控（真正价值点），时间线排序作第二步，story_time_tag 先放着。

**③（顺带）story_time_tag 到底要不要？** 设计文档自认它和 `story_time` 重叠、只给 UI 用。做之前确认它是不是冗余。

**④ 第三人称视角下 hidden_from 怎么处理？** 没有单一 POV 角色时门控是否生效——需产品定义。

---

## 实现节奏与硬约束（沿用本项目一贯纪律）

- **单一真相源**：POV 门控判据 / 时序排序判据若 UI 与 engine 都要用，抽公共函数共用，别两处手抄。
- **context_assembler 是 P0 高风险**：任何改动必跑 `context_assembler_golden` + `context_assembler.chat` + `context_assembler_semantic`（现 21 用例）。新功能要新增 golden/回归用例并**做变异验证**（改坏判据要有测试变红）。
- **审阅节奏**：每批实现 → 双包 tsc + 全测试绿 → 独立对抗审（opus 子 agent，找行为回归/边界）→ 整改 → 提交。用户偏好这个"修→审→整改→提交"循环。
- **提取端不动**：AI 已正确产出数据，本任务只接消费端。若发现提取规则需微调（如 story_time_order 冲突），先跟用户确认。
- **Git 约束**：只能 `git add` / `git commit`（当前分支 main）。**禁止自行 push / merge / 切分支 / 建 PR**。完成后输出结论 + `git diff --stat` 等人工确认。
- **写含中文的文件**：注意 UTF-8 no-BOM，别引双重编码乱码（用 `file` + `grep` 验证）。

---

## 仓库基线状态（新会话接手时的起点）

- **分支**：`main`（本地）。**D 批修复战役 9 个 commit 已在本地 main，尚未 push**（`5240bb5`→`0e01e5b`）——等用户发话 push，别自己动。
- **测试基线**：引擎 **1403 passed**（+3 skipped）、UI **561 passed**、双 `tsc --noEmit` 0 错、i18n 1273 键对称。工作区干净。
- **跑测试**：引擎 `cd src-engine && npx vitest run`；UI `cd src-ui && npx vitest run`；类型 `npx tsc --noEmit`（各自目录）；i18n `cd src-ui && npm run i18n:check`。
- **相关代码地图**：
  - fact 定义 + 枚举：`src-engine/domain/fact.ts`（字段 `:25-38`、`_confidence` `:60-70`）、`src-engine/domain/enums.ts`（`TimeKind` `:90-97`、`SuspenseType` `:101-106`、`Perspective` `:57-61`）
  - 提取 prompt：`src-engine/prompts/zh.ts` / `en.ts`（FACTS_ENRICH 段）；ReAct 工具 schema：`src-engine/services/react_extraction_tools.ts`
  - 组装（消费缺口所在）：`src-engine/services/context_assembler.ts`（`build_facts_layer` / `sort_by_weight_and_recency` / `perspective_block` / `build_fact_enrichment_suffix`）
  - 视角来源：项目级 `WritingStyle`（`domain/project.ts`），`pov_character` + `perspective`
  - UI 透传：`src-ui/src/api/facts.ts`
- **审计出处**：`docs/internal/audit/2026-07-11-blind-audit-round2.md`（M3 发现 `:285`、决策五段 `:370-377`、D 批收尾段在文件末尾）。进度真相源 `PROGRESS.md`（M3 待办在"需要人工"节）。

---

## 新会话的第一步

1. 用大白话把上面"待拍板"的 ①②（必要时 ③④）问用户，拿到方向。
2. 按方向出一个小实现计划（先 POV 门控），跟用户对一下再动手。
3. 进入"实现 → 双包绿 → 对抗审 → 整改 → 提交"循环，context_assembler 改动务必跑 golden + 变异验证。
