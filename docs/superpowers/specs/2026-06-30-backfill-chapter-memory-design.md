# 设计：补全旧章记忆工具（plan 3.1）

- 日期：2026-06-30
- 主线：对话式 × 记忆栈融合 Phase 3.1
- 状态：设计已与用户拍板（待写实现计划）

## 目标

给「缺记忆的旧章」一个统一入口，逐章把**能从正文重建的记忆层**补齐：章节摘要、剧情笔记（连带剧情线挂接）、向量索引。典型场景：用户晚配 embedding、或导入只有正文的旧章（如「导入原始文件夹」），手里有一批正文齐全但记忆为空的章。

> **现状**：三件能力已各自存在但分散 —— 笔记走「剧情笔记」页批量提取（`submitFactsExtraction` 自动落库）、摘要走 AU 高级操作「补全旧章摘要」（`backfillChapterSummaries`）、向量走「重建索引」（`rebuildForAu` 整库）。本工具把前两者 + 处理到的章的向量合成一个逐章 pass，不再让用户分三处点。

## 已拍板决策

1. **笔记自动落库**（不逐章弹预览审）。批量场景逐章 review 不可行；与现有批量提取一致；事后可在「剧情笔记」页手动删错。
2. **笔记提取章范围由用户勾选**（默认勾「零笔记」的章）。提取每章都调 LLM 花钱，用户掌控范围。
3. **架构 A：逐章统一 pass**（新引擎服务 `backfill_chapter_memory`），复用现成原语，不重写逻辑。
4. **新「补全旧章记忆」取代旧「补全旧章摘要」按钮** —— 摘要是它的子集（不勾任何章提笔记时退化为「补摘要 + 索引这些章」）。避免高级操作里两个重叠按钮。

## 补什么 / 不补什么

| 补 | 对哪些章 | 怎么补 |
|----|---------|--------|
| 章节摘要（standard） | 所有缺摘要的已定稿章（自动判定） | `generate_standard_summary`，全自动 |
| 剧情笔记 | **用户勾选的章**（默认零笔记章） | M9 react/plain 提取，自动落库 |
| 剧情线挂接 | 同笔记（提取时顺带） | M9 提取自动挂 `thread_ids` / 跨章 `caused_by`，非独立步 |
| 向量索引 | 上面被处理到的章 | 该章正文 + 摘要进向量库 |

**不在范围内**（避免误解）：
- **整库向量重建** —— 本工具只索引它处理到的章；「已有记忆但向量不全」仍交给现有独立的「重建索引」按钮，两者不重叠。
- **state（当前章号 / 出场角色历史）** —— 「重新整理」(recalc) 的职责，不动。
- **设定文件（角色 / 世界观）** —— 用户手写、非从正文提取，不碰。

## 架构

### 引擎：`backfill_chapter_memory` 服务

新文件 `src-engine/services/backfill_memory.ts`（避免把跨摘要/笔记/索引的编排塞进已较大的 `chapter_summary.ts`；它 import 复用 `chapter_summary` 与笔记提取原语）。镜像现有 `backfill_chapter_summaries`（`src-engine/services/chapter_summary.ts`）的结构：loop + 回调注入 + 章边界中断 + 进度。loop 与中断/CAS 编排逻辑在引擎（可单测），副作用（persist 摘要 / save 笔记 / index 向量）走回调由 API 层在 **AU 锁内** 执行。

每章（in-scope）依次：
1. 缺摘要 → `generate_standard_summary`（慢 LLM，**锁外**生成）
2. 该章在勾选集 → 提取笔记（复用 M9 提取，带 `caused_by` + `thread_ids`，**锁外**）
3. **锁内 CAS 落盘回调**：重查该章 `content_hash` 未变才写 —— 摘要 persist + 索引、笔记 `add_fact`（带 `extractedEnrichment`）、章正文 `indexChapter`；hash 变了 / 章被删 → **跳过该章**，不写陈旧数据
4. 章边界查 `signal` → 可中断（已补的保留，当前章跑完不强杀，下一章不起）
5. 每章独立 try/catch，单章失败不拖垮整批（半成功处理）

`BackfillMemoryResult`：`{ total, summariesGenerated, factsChapters, factsAdded, indexed, skipped, failed, aborted }`。

### 检测口径（scan）

- 缺摘要：`find_chapters_missing_summary`（现成单一真相源）
- 零笔记章：`fact.list_all` 按 `chapter` 分组，0 条的章 → 默认勾选（启发式：零笔记 ≈ 没提过）
- in-scope = 缺摘要章 ∪ 勾选提笔记章；这些章顺带索引正文 + 摘要
- 前置：embedding + LLM 配置；未配 → needConfig 提示、不能跑（沿用 `BackfillSummaryModal` 现有判定）

### API 层

- `scanChapterMemory(auPath)` → `{ chaptersMissingSummary: number[], chaptersZeroFacts: number[], totalConfirmed, embeddingConfigured, llmConfigured }`
- `backfillChapterMemory(auPath, { factsChapters: number[] }, onProgress?, signal?)` → `BackfillMemoryResult`
  - 提供锁内 CAS 回调给引擎服务；笔记 react/plain 由 `react_extraction_enabled` 决定（同 `extractFacts`）

### UI

- `BackfillSummaryModal` 改造为 `BackfillMemoryModal`：复用四阶段（scanning / confirm / running / done）+ unmount-abort（`AbortController`）。`confirm` 阶段加**笔记章选择器**（每章一行：章号 + 当前笔记数 + 勾选框；默认勾零笔记章；全选/全不选；显示「X 章补摘要 + Y 章提笔记」花费提示）。
- `AuSettingsAdvancedSection`：「补全旧章摘要」按钮 → 「补全旧章记忆」（文案 + handler 换）。

## CAS-in-lock + 中断 + 半成功

沿用 `backfill_chapter_summaries` 已验证的语义（codex 审过的 P1 CAS + P2 unmount-abort）：慢 LLM 锁外、落盘锁内 + `content_hash` CAS 防陈旧向量；章边界中断；单章失败隔离。笔记落盘也纳入同一 CAS —— 章节中途被 edit/undo 则不把基于旧正文提的笔记挂上去。

## 测试

- **引擎**：`backfill_chapter_memory` 单测 —— 仅摘要 / 仅笔记 / 两者；CAS hash 变 → skipped；章边界 signal 中断 → aborted + 已补保留；单章抛错 → failed 不中断整批。
- **API**：`scanChapterMemory` 检测口径；`backfillChapterMemory` 端到端（mock provider + repos），验笔记自动落库 + 摘要 persist + 索引调用。
- **UI**：`BackfillMemoryModal` 四阶段 + 笔记章选择器（默认勾零笔记章、勾选改变花费提示）+ unmount-abort + needConfig 路径。
- 写文路径（generate_chapter / confirm）逐字节不回归。

## i18n

新增 `backfillMemory.*`（或扩 `backfill.*`）双语 key：标题、扫描、笔记章选择器、花费提示、各阶段、汇总。`AuSettingsAdvancedSection` 按钮 + 描述文案。`i18n:check` 双语同步。

## 取舍 / 风险

- **笔记自动落库可能混入噪音**（用户认可，事后 FactsPage 可删）。
- **零笔记 ≈ 没提过是启发式**：真没料的安静章每次跑都会再试一次（成本可控，因用户选章范围）。
- **向量边界**：本工具只索引处理到的章；全篇向量完整性仍靠「重建索引」。文案需让用户明白二者分工，避免误以为本工具会整库重嵌。
- **批量 LLM 成本**：勾很多章提笔记 → 大量 LLM 调用；花费提示 + 用户选章双重缓解。

## 影响文件清单

- 引擎：`src-engine/services/chapter_summary.ts`（或新 `backfill_memory.ts`）新增 `backfill_chapter_memory` + 类型；`services/index.ts` 导出。
- API：`src-ui/src/api/engine-chapters.ts` 新增 `scanChapterMemory` / `backfillChapterMemory`（与 `backfillChapterSummaries` 同处，复用其 providers/repos/CAS 接线；笔记提取复用 `engine-facts` 的 provider 解析）；`engine-client.ts` 导出。
- UI：`src-ui/src/ui/settings/BackfillSummaryModal.tsx` → `BackfillMemoryModal.tsx`（改造）；`AuSettingsAdvancedSection.tsx`（按钮）；`AuSettingsLayout.tsx`（modal 接线）。
- i18n：`src-ui/src/locales/{zh,en}.json`。
