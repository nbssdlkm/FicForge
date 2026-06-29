# 设计:对话式 × 记忆栈融合(全塞退役 + 单一主力版)

- 日期:2026-06-28
- 状态:DRAFT(待审)
- 关联决策:取代 D-0044 fork 隔离(简版有意禁用记忆能力)的临时契约;简版收敛主线的收尾
- 关联 spec:`2026-06-02-converge-simple-into-main-phase1-design.md`、`2026-06-13-converge-simple-phase2-ui-design.md`

---

## 1. 背景与问题

简版收敛(Phase 1+2)把独立的「简版」fork(对话式续写)收敛回主仓,经 `writing_mode: 'full' | 'simple'` 单运行时开关共存。但收敛只做到了**两条线并行共处**,没做**融合**。代码现状是一个「硬二选一」:

| | 对话式 | 记忆管理(facts / 剧情线 / 摘要 / RAG / M8 / M9 / M10) |
|--|--|--|
| 完整版(主力) | ❌ 无对话入口 | ✅ 全有 |
| 简版 | ✅ 有 | ❌ 全禁(走全塞) |

- **简版走「全塞」**:`assemble_context_simple`(`context_assembler.ts`)不做 P0–P5 预算切层,把全部 worldbuilding + characters + 全部已确认章节拼进 system,且**有意**禁掉 facts / 剧情线 / RAG / 摘要(`simple_features.ts` 四个 flag 全 true;`settings_tools.ts` 物理拉黑 `add_fact`/`modify_fact`)。
- **对话式是简版独占**:`AuWorkspaceLayout.tsx` 的 chat tab 仅在 `isSimple` 时渲染(`SimpleChatPanel`);完整版只有手动编辑器。
- M8/M9/M10 一整套记忆栈全建在完整版这条线上,**从没和对话式 UX 接通过**。

结果:要对话就没记忆,要记忆就没对话。用户(PM)确认的产品方向是 —— **主力版本身就应该结合对话式 + 各种记忆管理**,全塞模式退役。

## 2. 决策摘要(已与用户拍板)

- **版本格局 = 选项 1「单一主力版」**:删 `writing_mode` 开关。以后只有一个版本,一篇作品里**「对话」tab 和「写文/阅读」tab 并列、共用同一套记忆栈**,随时切。"并存" = 对话与手动这两种**编辑形式**在同一个带记忆的版本里并存,用户不再选模式。
- **定海神针**:对话和手动只是两种**输入方式**,背后是**同一套引擎 + 同一套记忆 + 同一条「生成 → 接受 → 记忆」流水线**。功能无差异,只是交互形式不同。
- **记忆管理 = 自动为主**:聊天出章、接受后走和手动版 confirm 完全一致的自动后处理(M9 事实提取 / M8-C 摘要 / RAG 索引 / M10-A 回顾)。**不**给对话 agent 新增 facts/剧情线编辑工具;人工微调仍走事实面板 / 剧情线面板。
- **全塞退役路径 = A(真融合)**:`dispatch_simple_chat` 直接改用分层上下文,删 `assemble_context_simple` + `simple_features` flag,一步到位,不留尾巴。

## 3. 目标 / 非目标

**目标**
1. 对话式续写吃到完整记忆栈:分层上下文(facts / 剧情线 / RAG / 上一章 / 核心设定)注入对话生成。
2. 对话出章接受后,走与手动版完全一致的 confirm 后处理流水线(事实/摘要/RAG/回顾)。
3. 删除全塞分支(`assemble_context_simple`)、`getSimpleFeatures` flag 体系、`writing_mode` 开关及其 UI 分叉。
4. 一篇作品同时提供对话 + 写文两个 tab,共用记忆。
5. 老简版作品平滑可用 + 提供「补全旧章记忆」工具。

**非目标(本次不做)**
- 对话式管记忆(对话里直接增删改 facts/threads)—— 自动为主,留作未来。
- 改 facts/剧情线/摘要/RAG 各自的内部算法 —— 只接线,不改内核。
- 多设备同步 / ops 行为变更。
- 移动端独立重设计(沿用现有响应式;tab 统一同步生效)。

## 4. 架构设计

### 4.1 引擎层

**(a) 对话上下文:全塞 → 分层(核心改动)**

退役 `assemble_context_simple`(全塞),新建**分层对话上下文组装** `assemble_chat_context`,**复用现有 layer-builder**(不重写记忆内核):

- 复用 `build_system_prompt`(或对话特化版)、`build_facts_layer`(P3)、`build_threads_layer`(M8-B)、`build_recent_chapter_layer`(P2)、`build_core_settings_layer`(P5)、RAG 检索(P4)。
- 产物切两块:
  - **system 内容** = 人设 + 钉死设定(P0)+ 分层记忆/参考(P2–P5 + facts + 剧情线 + RAG)。
  - **message 数组** = 多轮对话历史 + 最新一句(由 agent loop 驱动,不再有 P1 单发指令层 —— 对话的"指令"就是用户最新一句)。
- **token 预算(扩展 D-0039)**:对话历史是活的、不能丢最新轮,**先为对话历史预留**,再用剩余预算分配记忆层(优先级:facts > 剧情线 > 上一章 > RAG > 核心设定低保),不够时按既有降级顺序丢低优先层。预算公式单一真相源仍在 `context_assembler`,新增"chat history reserve"项。

- **R2 审计校正(实现约束,见 plan):**
  - 产物契约 = `{ systemContent, latestUserContent, budget_report }` —— **必须保留 `budget_report`**,否则对话顶栏 token badge(`estimate_simple_tokens` 改接后靠它算)断裂。
  - **组装只在 `runAgentLoop` 外发生一次**,`systemContent` 进 `startMessages[0]`;循环内不重组(否则每轮重算 RAG)。循环内 read-only fetch(show_chapter)结果进 `internalHistory`、绕过组装期预算,需按上限截断防中途爆 context。
  - **`dispatch_simple_chat` 参数签名要扩** `vector_repo/embedding_provider/facts/threads`(现缺),上游 API `engine-simple-dispatch.ts` 注入 —— 这是真实接线工作,非"只复用 builder"。
  - RAG 编排现为 `generation.ts` 内联块,先抽成共享函数再复用(单一真相源)。

**(b) 分发:`dispatch_simple_chat` 改接分层上下文**

- 上下文来源从 `assemble_context_simple` 换成 `assemble_chat_context`。
- agent loop / 工具集**保持不变**(看章 / 看设定 / 改角色世界观档 / `chat_reply`);**不**解除 `add_fact`/`modify_fact` 黑名单(自动为主,对话不直接写 facts)。
- `SIMPLE_AGENT_MAX_ITER` 复审是否够用(分层后 show_chapter/show_setting 部分冗余,迭代需求可能下降;暂留 5,spec 实现期实测)。

**(c) 接受草稿:接通完整版后处理 + M9(两条独立路径,审计校正)**

对话接受草稿当前调 `confirmChapter`(共用)。要让对话接受 = 手动接受,有**两条彼此独立**的接线,别混为一谈:

- **confirmChapter 内的后处理**(摘要 + RAG + 回顾):删 `disableChapterSummary` 门控(`engine-chapters.ts` 5 处)→ M8-C 章节摘要 + M10-A retrospective 自动跑(受 embedding/LLM 约束)。注:**confirm 路径的 RAG 索引本就无 gate、恒跑**;`disableRAG` 只管写文 tab 的生成期检索,与接受无关。
- **M9 事实提取(独立 UI 流程,不在 confirmChapter 里)**:手动版 M9 由用户触发——confirm 后点「提取结果预览」(`useWriterFactsExtraction.handleOpenExtractReview` → `extractFacts` → `reactExtractFromChapter`),开关是 `react_extraction_enabled`(**不是** `disableFactsExtraction`,后者是零消费者死代码)。对话流要接 M9,必须在 `SimpleChatPanel` 接受路径**复用** `useWriterFactsExtraction` + `ExtractReviewModal`,接受成功后弹预览、人审落库(目前简版接受后直接落库,不弹)。这归 UI 期(见 §8 P2),**不是删 flag 就能自动通**。

**(d) 删除全塞体系**

- 删 `assemble_context_simple`、`estimate_simple_tokens`(全塞专用 token 估算,若仅服务全塞)。
- 删 `src-engine/config/simple_features.ts` 的 `SimpleFeatures` interface + `getSimpleFeatures`(及全项目所有 `getSimpleFeatures(...)` 调用点)。
- `WRITING_MODES` / `WritingMode` / `isWritingMode` / `writing_mode` 字段:见 4.3 删除策略。

### 4.2 UI 层

- **`AuWorkspaceLayout.tsx` 去 `isSimple` 分叉**:每篇作品恒定渲染「对话」+「写文/阅读」两个 tab(桌面 tab 组 + 移动端段控),共用记忆。`SimpleChatPanel` 不再 mode-gated。
- **删 `useWritingMode.tsx`**(及 localStorage 镜像 `ficforge_writing_mode`)、`getAuLandingPage`(`simple/landing.ts`)的 mode 分叉、`GlobalSettingsModal` 的「写作模式」下拉。
- **默认落地页**:进作品默认落「对话」tab(对话是融合后主交互);有需要再切「写文」。(待 UI 实测微调,非阻塞。)
- `SimpleChatPanel` 接受草稿路径接上 `ExtractReviewModal`(见 4.1c)。

### 4.3 `writing_mode` 字段删除策略

`writing_mode` 存在 `settings.yaml`(`domain/settings.ts:128` 默认 `"full"`,`file_settings.ts:249` 兜底)。删除要防旧 settings 反序列化报错:

- domain / dict 映射:**保留容忍读取**(读到未知 `writing_mode` 字段忽略,不报错),但不再写、不再有消费者。参考 M7 删 `SyncConfig` 时"保留 `dictToSyncConfig` 保旧数据反序列化"的同款做法。
- round-trip 测试:旧 `settings.yaml`(含 `writing_mode: simple`)加载不崩、字段被安全丢弃。

### 4.4 老数据迁移

现存简版作品(`.well-known/simple-chat.yaml`、无 facts/threads/summaries):

- **打开即用**:统一版打开,对话历史 + 老章保留;老章无记忆(从没提取过),新章正常进记忆流水线。
- **「补全旧章记忆」工具**:复用并扩展现有「补全旧章摘要」(`BackfillSummaryModal` + `backfill_chapter_summaries`),扩成"扫无记忆的老章 → 逐章补 事实提取 + 摘要 + RAG"(进度条 + 可中断 + CAS-in-lock,沿用既有模式)。**用户主动点,不强制、不自动**。

## 5. 数据流(融合后)

```
对话 tab:用户发消息
  → dispatch_simple_chat
    → assemble_chat_context(分层:P0 + facts + 剧情线 + RAG + 上一章 + 核心设定;对话历史进 message 数组)
    → runAgentLoop(工具:看章/看设定/改设定档/chat_reply;流式出草稿 or 闲聊)
  → 草稿落 simple-chat.yaml + draft 文件
  → 用户接受
    → confirmChapter(与手动版同一函数)
      → 落正文 + state + ops(事务)
      → confirm 内后处理:RAG 索引(恒跑)→ M8-C 摘要 → M10-A 回顾(删 disableChapterSummary 后自动)
    → [独立 UI 步,非 confirm 内] M9 事实提取:弹 ExtractReviewModal 人审落库(复用 writer 的 useWriterFactsExtraction)

写文 tab:沿用现有完整版 generate_chapter / confirm 流程,零改动。

两个 tab 读写同一篇 AU 的同一套文件(chapters / facts.jsonl / threads.jsonl / .summaries / .vectors)。
```

## 6. 模块边界与单一真相源

- 记忆层组装:layer-builder(`build_*_layer`)是唯一真相源,全塞版与分层版**不再各维护一套**(全塞删除后只剩分层)。
- 后处理流水线:`confirmChapter` 后处理是唯一真相源,对话与手动共用,不再有 `disable*` 分叉。
- token 预算公式:仍集中在 `context_assembler`,新增 chat-history reserve 项,不散落。

## 7. 测试策略

- **引擎**:
  - `assemble_chat_context` 单测:分层注入(facts/threads/RAG/上一章/核心设定都进)、对话历史预留 + 记忆层降级顺序、空记忆逐字节回退。
  - 对话接受 → confirm 后处理:facts 提取被触发(对比删 flag 前后)、摘要/RAG 索引触发。
  - 删全塞回归:确认无 `getSimpleFeatures` 残留消费者;旧 `settings.yaml` round-trip 不崩。
- **UI**:
  - `AuWorkspaceLayout` 双 tab 恒渲染(桌面 + 移动),无 mode-gating。
  - `SimpleChatPanel` 接受 → 弹 `ExtractReviewModal`。
  - 删 `useWritingMode` / 写作模式下拉后无引用残留(tsc + grep)。
- **真机眼验(P3)**:对话出章 → 接受 → 看到事实提取候选 → 接受 → 剧情线/摘要落库;切到写文 tab 看同一篇文的记忆;补旧章记忆工具。
- 双端 tsc + i18n lint 全绿;`full` 行为不回归(写文 tab 路径逐字节不变)。

## 8. 分期

- **P1 引擎融合**:抽 RAG 编排为共享函数 + `assemble_chat_context`(分层接对话 + 历史预留)+ `dispatch_simple_chat` 改接 + 删 `disableChapterSummary` 门控(点亮 confirm 内 M8-C 摘要 + M10-A 回顾)+ 删全塞/flags + `estimate_simple_tokens` 改接 + 引擎测试。**P1 后对话接受有摘要/RAG/回顾,但还没事实提取**。
- **P2 UI 统一 + 接通 M9**:`AuWorkspaceLayout` 双 tab 去分叉 + 移动底栏 tab 集合重构 + 删 `useWritingMode`/`WritingModeProvider`/写作模式下拉/landing 分叉(含 Library 3 站点)+ **`SimpleChatPanel` 接受路径复用 `useWriterFactsExtraction` + `ExtractReviewModal`(M9 唯一落点)** + UI 测试。
- **P3 迁移 + 打磨**:「补全旧章记忆」工具 + `writing_mode` 字段容忍读取 + 真机眼验 + 刷 CLAUDE.md / 记忆。

## 9. 风险与开放点

- **对话历史 + 分层记忆的 token 竞争**:长对话 + 大记忆可能挤爆预算。缓解:chat-history reserve 优先 + 记忆层降级。需实测调比例。
- **对话 agent 工具与分层上下文冗余**:`show_chapter`/`show_setting` 在分层注入后部分冗余(核心设定已在 P5、上一章在 P2)。保留(看更早章节/全文仍有用),实现期观察是否调 prompt 引导。
- **M9 在对话流的触发时机**:本设计 = 接受草稿后触发(与手动一致)。多轮对话中途不提取(避免半成品入库)。
- **默认落地 tab**:对话 vs 写文,实测微调。
- **`SIMPLE_AGENT_MAX_ITER`**:分层后是否需调,实测定。

## 10. 影响文件清单(预估,实现期以代码为准)

引擎:`context_assembler.ts`(删全塞 + 新增 `assemble_chat_context`)、`simple_chat_dispatch.ts`(改接)、`config/simple_features.ts`(删 flag 体系,保留 `WRITING_MODES` 视删除策略)、`domain/settings.ts` / `file_settings.ts`(`writing_mode` 容忍读取)、`settings_tools.ts`(`get_tools_for_mode` 简化)、`estimate_simple_tokens.ts`(评估删除)。
UI:`AuWorkspaceLayout.tsx`、`hooks/useWritingMode.tsx`(删)、`simple/landing.ts`(删分叉)、`GlobalSettingsModal.tsx`(删下拉)、`SimpleChatPanel.tsx`(接 ExtractReviewModal)、补旧章记忆 modal(扩 `BackfillSummaryModal`)。
