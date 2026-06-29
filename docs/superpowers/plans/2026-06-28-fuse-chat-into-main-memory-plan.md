# 实现计划:对话式 × 记忆栈融合(已过两轮独立审计)

- 日期:2026-06-28(R2 修订 2026-06-29)
- spec:`docs/superpowers/specs/2026-06-28-fuse-chat-into-main-memory-design.md`
- 方式:TDD(先测后码),每期一个验证闸全绿才进下一期。`full`/写文路径逐字节不回归是硬约束。
- git:在 `main` 上分步 commit(等用户说"提交"才执行;不 push/不 merge)。
- **审计轮次**:R1 修 M9 归因 + disable* 区分 + 漏项;**R2 修分期编译耦合(B6)+ dispatch 参数链(B2)+ 组装时机(B1)+ 循环内预算(B3)+ 产物契约保留 budget_report(B7)+ 路径标注**。

---

## ⚠️ 实现前必读:审计校正的关键事实

1. **M9 事实提取不在 `confirmChapter` 里**,是用户触发的独立流程(`useWriterFactsExtraction.handleOpenExtractReview` → `extractFacts`(`src-ui/src/api/engine-facts.ts:130`)→ `reactExtractFromChapter`),开关 `react_extraction_enabled`。`disableFactsExtraction` 是零消费者死代码。**M9 接线全在 P2。**
2. **后处理 gate 都在 `src-ui/src/api/engine-chapters.ts`(API 层,不是 `src-engine/`)**:RAG 索引无 gate、恒跑(`:127-142`);`disableChapterSummary` gate M8-C 摘要(`:147`)+ M10-A 回顾(`:207`)+ backfill(`:345/358`)。`disableRAG` 只 gate 写文**生成期**检索(`src-engine/services/generation.ts:221`)。
3. **`assemble_context` 产物是单 user message**(`context_assembler.ts:726-733`);对话要 `[system, ...history, user]`。
4. **RAG 编排是 `generation.ts:221-244` 内联块**,非 builder。
5. **`dispatch_simple_chat` 当前参数签名缺 `vector_repo/embedding_provider/facts/threads`**(`simple_chat_dispatch.ts:116-143`,对比 `GenerateChapterParams` `generation.ts:135-165`)。
6. **`assemble_context_simple` 只在 `runAgentLoop` 外组装一次**(`simple_chat_dispatch.ts:418`→进 `startMessages`,`:679`);循环内 `internalHistory` 每轮增长(`agent_loop.ts:171`),read-only fetch 结果追加,**不受组装期预算管控**。
7. **`estimate_simple_tokens` 是活依赖**(token badge,`estimate_simple_tokens.ts:87`→`engine-tokens.ts:18`→`useContextTokenCount.ts:75`→`SimpleChatPanel.tsx:501`),读 `result.budget_report.total_input_tokens`——新产物契约**必须保留 budget_report**。
8. **`getSimpleFeatures` 的 UI 消费者 `landing.ts:14,19`** 与 `useWritingMode`/Library 3 站点强耦合——**物理删除 `getSimpleFeatures` 必须和 landing/Library/useWritingMode 同期(P2),否则 P1 tsc 红**(B6)。

---

## 分期总览(R2 重划)

- **P1 = 引擎 + API 接线层**(`src-engine/` + `src-ui/src/api/`):让对话**能**吃分层记忆 + confirm 内摘要/回顾点亮。**不碰 React UI、不物理删 `getSimpleFeatures`/`writing_mode`**(只删它们在引擎/API 层的 gate 使用)。P1 末对话接受有 摘要/RAG/回顾,**无事实提取**。
- **P2 = React UI 统一 + 模式系统物理删除 + M9 接线**:双 tab、移动底栏、删 `useWritingMode`/`WritingModeProvider`/landing/Library 站点/写作模式下拉、**此时才物理删 `getSimpleFeatures`/simple_features**(landing 不再用)、接 M9。
- **P3 = 迁移 + 打磨**:补旧章记忆工具、`writing_mode` 字段容忍读取、真机眼验、刷文档/记忆。

> 关键:`getSimpleFeatures` 的**物理删除**在 P2(与 landing 同期),P1 只删它在引擎/API 的 gate 调用。P1 **不**承诺"grep getSimpleFeatures 归零"——那是 P2 的闸。

---

## Phase 1 — 引擎 + API 接线(对话吃分层记忆 + 点亮摘要/回顾)

### 1.0 抽 RAG 编排为共享函数
**测试**:`retrieveRagForContext(...)` 对给定 query/budget 返回 rag_text,与 generation 现状逐字节一致。
**实现**:把 `generation.ts:221-244`(build_active_chars + build_rag_query + retrieve_rag + budget)抽成可复用函数,`generation.ts` 改调它(行为不变),供对话路径复用。**同时删 `generation.ts:221` 的 `disableRAG` gate**(融合后无简版,写文生成期 RAG 恒开)。

### 1.1 扩 `dispatch_simple_chat` 参数链 [R2 新增,B2]
**测试**:dispatch 参数类型含 `vector_repo?/embedding_provider?/facts/threads`;上游 API 入口注入这些 repo。
**实现**:
- `SimpleChatDispatchParams`(`simple_chat_dispatch.ts:116-143`)新增 `vector_repo?`、`embedding_provider?`、`facts: Fact[]`、`threads: Thread[]`。
- **上游注入**:`src-ui/src/api/engine-simple-dispatch.ts`(对话 API 入口)按 `generate_chapter` 同款,从 engine 实例取 `vector_repo/embedding_provider` + `facts = repos.fact.list_all`、`threads = repos.thread.list` 注入。

### 1.2 新增 `assemble_chat_context`(分层 + 一次性组装 + 保留 budget)[R2 强化 B1/B7]
**测试** `context_assembler.chat.test.ts`:
- 注入:facts/剧情线/上一章/核心设定/RAG(经 1.0)都进 `systemContent`。
- 产物契约:返回 `{ systemContent: string, latestUserContent: string, budget_report }`(**保留 budget_report**,供 estimate token badge,B7)。
- 历史预留:超长记忆 + 多轮历史时最新轮不丢,记忆层按 facts>剧情线>上一章>RAG>核心设定低保降级,预留带上限。
- 空记忆回退:= 人设 + 核心设定,不崩。
**实现**:
- `assemble_chat_context(...)` 复用 builder + 1.0 RAG 函数;产物切 `systemContent` + `latestUserContent`(不复用 `assemble_context` 726-733 尾段)。
- token 预算:D-0039 公式基础上新增输入侧 `chatHistoryReserve`(上限 + 最新轮硬保)。

### 1.3 `dispatch_simple_chat` 改接 + 明确组装时机 [R2 强化 B1]
**测试**:上下文走 `assemble_chat_context`(facts/threads 进 prompt);`chat_reply` 闲聊不受影响;**断言组装只在循环外发生一次**(可用 spy 计数 assemble 调用 = 1)。
**实现**:
- `assemble_chat_context` **在 `runAgentLoop` 调用之前组装一次**,`systemContent` 进 `startMessages[0]`,`latestUserContent` 进最新 user message;**循环内不重组**(避免每轮重算 RAG)。
- **[B3 循环内预算]**:read-only fetch(show_chapter/show_setting)结果 push 进 `internalHistory` 前**按上限截断**(防多轮大章节 fetch 中途爆 context);组装期预算为预期 fetch 留余量。标为实测观察点。

### 1.4 点亮 confirm 内后处理(摘要 + 回顾)
**测试**:删 `disableChapterSummary` gate 后,对话接受走 `confirmChapter` → M8-C 摘要 + M10-A 回顾触发(embedding/LLM 就位时);删前跳过。
**实现**:删 `src-ui/src/api/engine-chapters.ts` 的 `disableChapterSummary` 5 处 gate(`:147/207/345/358` + import `:18`)→ 摘要/回顾/backfill 恒可用。**保留** `getSimpleFeatures` 函数本体(P2 才物理删)。

### 1.5 删全塞 + estimate 改接(保留 getSimpleFeatures)[R2 修正 B7]
- 删 `assemble_context_simple` + `context_assembler.ts:557` 委托分支(不删编译错)。
- **`estimate_simple_tokens` 改接** `assemble_chat_context`,读其保留的 `budget_report`(token badge 不断,B7)。
- **不删** `getSimpleFeatures`/simple_features 定义(`landing.ts` 仍引用,P2 同期删)。`generation.ts`/`context_assembler.ts`/`engine-chapters.ts` 对它的**使用**已在 1.0/1.3/1.4 清掉。

### Phase 1 验证闸
引擎 + API 测试全绿(RAG 抽函数 + dispatch 扩参 + chat-context 一次性组装 + 摘要点亮 + 删全塞回归 + token badge 仍工作);双端 tsc 干净(`getSimpleFeatures` 仍存活、仅 landing 一个消费者,**不要求 grep 归零**);**写文 golden 逐字节不回归**。⚠️ 此时对话接受**无事实提取**(P2 接)。

---

## Phase 2 — React UI 统一 + 模式系统物理删除 + M9

### 2.1 `AuWorkspaceLayout` 双 tab + 移动底栏 [R2 修正路径/措辞]
**测试**:每篇作品恒渲染「对话」+「写文/阅读」(桌面 tab + 移动段控),无 mode-gating。
**实现**:
- `AuWorkspaceLayout.tsx` 删 `useWritingMode` 快照 + `isSimple` 分叉,tab 恒含 chat + writer;默认落地 = 对话(实测可调)。
- 移动端(`src-ui/src/ui/mobile/MobileLayout.tsx` + `BottomNavBar.tsx`):删 `isSimple` props 链,**采用现有 `SIMPLE_TAB_IDS` 集合(已含 chat+writer,5 列)作为唯一底栏集合**,去掉 FULL/SIMPLE 二选一分支(非"重设计")。

### 2.2 删模式系统(物理删 getSimpleFeatures 在此)[R2 B6 核心]
- 删 `hooks/useWritingMode.tsx` + `App.tsx:17` `WritingModeProvider` + localStorage 镜像。
- 删 `simple/landing.ts` 的 `getAuLandingPage` mode 分叉 → 固定落地 tab;改 3 站点 `Library.tsx`(28/38/76)、`LibraryFandomSections.tsx`(11/80/249)、`useLibraryMutations.ts`(7/35/95)。
- **此时物理删 `getSimpleFeatures` + `config/simple_features.ts` flag 体系 + 死 flag `disableFactsExtraction`**(landing 已不用)→ **现在** grep `getSimpleFeatures` 归零。
- 删 `GlobalSettingsModal.tsx` 写作模式下拉 + i18n;engine/UI 停写 `writing_mode`(`engine-settings.ts:203-204,218`、`api/settings.ts:83`)。
- grep 确认 `useWritingMode`/`getAuLandingPage`/`isSimple`/`getSimpleFeatures` 无残留。

### 2.3 对话接受接通 M9(唯一落点)
**测试**:`SimpleChatPanel` 接受 → `await confirmChapter` 完成后 → `handleOpenExtractReview(target.chapterNum)` → 弹 `ExtractReviewModal` → 人审落库。
**实现**:`SimpleChatPanel.handleAcceptDraft`(329-364)`await confirmChapter` 后,复用 `useWriterFactsExtraction(auPath)` + `ExtractReviewModal`(`WriterModals.tsx:167` 纯 props)+ `useExtractedSelection`。传 `target.chapterNum`(非 chapterCount)。前置 `react_extraction_enabled` + embedding/LLM 就位,否则给反馈不空跑。

### Phase 2 验证闸
UI 测试全绿;双端 tsc + i18n lint;**grep `getSimpleFeatures`/`useWritingMode`/`isSimple` 全归零**;dev server 桌面+移动实测:双 tab + 移动底栏 + 对话接受弹提取预览并落库。

---

## Phase 3 — 迁移 + 打磨

### 3.1 「补全旧章记忆」工具
**测试**:扫无记忆老章 → 逐章补 事实提取 + 摘要 + RAG;章边界可中断;CAS-in-lock(沿用 backfill 摘要同款)。
**实现**:扩 `chapter_summary` backfill → `backfill_chapter_memory`;扩 `BackfillSummaryModal` → 「补全旧章记忆」(扫缺 → 数量+花费 → 进度条 + unmount-abort)。AU 设置「高级操作」入口。

### 3.2 `writing_mode` 字段容忍读取
- domain/dict 映射读到旧 `writing_mode` 安全忽略;round-trip 测试旧 `settings.yaml` 加载不崩、字段丢弃无损其它。评估删 `WRITING_MODES`/`WritingMode` 类型。

### 3.3 真机眼验 + 文档
- 真机:对话出章 → 接受 → 事实提取候选 → 接受 → 剧情线/摘要落库;切写文 tab 看同篇记忆;补旧章记忆工具。
- 刷 CLAUDE.md「活跃工作」+ 迁移表;刷记忆 `project_simple_converge`/`next_session_ficforge`。

### Phase 3 验证闸
引擎+UI 全绿;双端 tsc + i18n lint;真机旅程通过;文档/记忆刷新。

---

## 跨期约束 / 风险
- 边界:P1 = 引擎 + API 层(触 `src-ui/src/api/`,**不触 React UI、不物理删模式系统**);P2 = React UI + 模式物理删 + M9;P3 = 迁移。**对话「完整记忆」要 P1+P2 都完才齐**(P1 给摘要/RAG/回顾,P2 给事实提取)。
- 任何一期不破坏写文路径(`generate_chapter`/confirm 逐字节回归)。
- 风险:① 循环内 internalHistory 增长爆 context(B3,1.3 截断 + 实测);② `looksLikeWritingIntent` 启发式(`simple_chat_dispatch.ts:171-180`)在有记忆的新上下文下语义可能漂移,P2/P3 真机复审;③ 长对话 + 大记忆的预算竞争(实测调比例)。
- 每期产出跑独立对抗审(Agent 子 agent 继承主循环 opus;codex CLI 不可靠见记忆)。
- 不自行 push/merge/切分支。

## 影响文件清单(R2 补全)
引擎:`context_assembler.ts`(删全塞 + 委托分支 + 新增 `assemble_chat_context` + 预算)、`simple_chat_dispatch.ts`(扩参 + 改接 + 组装时机 + fetch 截断)、`generation.ts`(抽 RAG 函数 + 删 disableRAG gate)、`estimate_simple_tokens.ts`(改接)、`config/simple_features.ts`(P2 删)、`settings_tools.ts`(get_tools_for_mode 简化)。
API:`engine-simple-dispatch.ts`(**注入 vector_repo/embedding_provider/facts/threads,B2**)、`engine-chapters.ts`(删 disableChapterSummary gate)、`engine-settings.ts`/`api/settings.ts`(P2 停写 writing_mode)。
React UI:`AuWorkspaceLayout.tsx`、`mobile/MobileLayout.tsx`、`mobile/BottomNavBar.tsx`、`hooks/useWritingMode.tsx`(删)、`App.tsx`(删 Provider)、`simple/landing.ts`(删分叉)、`Library.tsx`/`LibraryFandomSections.tsx`/`useLibraryMutations.ts`(3 站点)、`GlobalSettingsModal.tsx`(删下拉)、`SimpleChatPanel.tsx`(接 M9)、`BackfillSummaryModal.tsx`(扩补记忆)。
