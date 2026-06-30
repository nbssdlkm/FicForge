# FicForge · 粮坊 — Claude Code 项目指南

## 项目概况

FicForge 是面向同人写手的 AI 辅助续写工具。**架构迁移（Python 后端 → TypeScript 统一核心引擎，M0–M5）已完成**，引擎同时支撑桌面端（Tauri）和移动端（Capacitor/PWA）。

**当前主线**：「对话式 × 记忆栈融合」—— 把简版 fork 的聊天式续写（agent-harness / 工具调用）收敛进主仓后，进一步删 `writing_mode` 模式开关、做成**单一主力版**：一篇作品里「对话」+「写文/阅读」双 tab 并列、共用同一套记忆栈（facts / 剧情线 / 摘要 / RAG），背后同一条「生成→接受→记忆」流水线。Phase 1（引擎+API）+ Phase 2（UI 统一 + 模式系统物理删 + 对话接受接 M9 提取）已完成并合 main；Phase 3（迁移+打磨）进行中。详见下方「活跃工作」。
> **历史**：更早的「简版收敛」（两模式经 `writing_mode: 'full' | 'simple'` 运行时开关共存）已被本主线取代 —— `writing_mode` 开关与字段均已物理退役，不再维护两套模式。

## 架构（PRD v4, D-0034）

```
TypeScript 核心引擎 (src-engine/)
  ├── domain/          数据类型、枚举、工具定义（来自 core/domain/*.py）
  ├── prompts/         58 个中英文模板（来自 core/prompts/*.py）
  ├── services/        全部业务逻辑（来自 core/services/*.py）
  ├── repositories/    抽象接口（9 个 TypeScript interface）
  ├── llm/             LLM 调用（openai-node SDK）
  ├── tokenizer/       Token 计数（gpt-tokenizer）
  ├── vector/          内存向量检索（JSON 分片 + cosine similarity）
  └── ops/             ops.jsonl 审计日志投影（确定性排序 / state·facts 重建 / lamport 时钟）—— 原 sync/ops_merge.ts 迁此（**多设备同步引擎已退役删除 M7 — D-0040**）

Platform Adapter
  ├── TauriAdapter     桌面端文件 I/O
  ├── CapacitorAdapter 移动端文件 I/O
  └── WebAdapter       PWA（OPFS/WebDAV）

壳层
  ├── Tauri 壳（embedding 走云端 API；Python sidecar 已退役 — M7，见下方）
  └── Capacitor 壳 (Android) / PWA (iOS/Web)
```

> **简版收敛新增（Phase 1，2026-06）**：`config/simple_features.ts`（`getSimpleFeatures(mode)` 由 `writing_mode` 派生 4 个 flag，取代编译期 `SIMPLE_FEATURES` const）；`services/` 下 `agent_loop` / `agent_telemetry` / `tool_args_repair` / `tool_stream_buffer` / `simple_chat_dispatch` / `estimate_simple_tokens`；`domain/simple_chat.ts` + `simple_tools_zod.ts`；`repositories/.../file_simple_chat.ts`。`full` 模式逐字节零回归。

## 迁移阶段（当前进度）

| Phase | 内容 | 状态 |
|-------|------|------|
| M0 | Domain 模型、Prompt 模板、Token 计数、PlatformAdapter 接口 | **已完成** |
| M1 | Repository 接口+实现、向量存储（JSON 分片）、ChromaDB 迁移脚本 | **已完成** |
| M2 | Facts Lifecycle、Context Assembler、RAG、LLM Provider、Generation | **已完成** |
| M3 | Confirm/Undo Chapter、Dirty Resolve、Import/Export | **已完成** |
| M4 | Settings Chat、Trash、Recalc、前端 API 切换、SSE 消除、Sidecar 精简 | **已完成**（E.6 sidecar 已退役删除 — M7，2026-06） |
| M5 | 移动端 Capacitor/PWA、响应式 UI | **已完成**（ops 合并 + 数据同步**已废弃**，见 D-0040） |
| M6 | Agent 架构 | **重开规划**，D-0032 作废，见 D-0043；触发条件满足后启动（预计 2026 Q3/Q4） |
| M7 | 架构简化（同步退役 + ops 降级 audit log） | **已完成 + 已合本地 main**（`9e44491`，origin 未 push）：同步 UI 隐藏（`c4b0f42`）+ engine 同步引擎删除、`ops_merge.ts` 外科式迁 `src-engine/ops/`（剥离多设备合并/冲突检测、保留 rebuild/lamport 投影核心）、死 UI/API/locale/文档清理 |
| M8 | Memory 三层架构（Fact / Chapter Summary / Thread） | **已完成**（合入 main，2026-06） |
| M9 | ReAct 基础设施（生成 + 选择性提取） | **已完成**（合入 main，2026-06） |
| M10 | Retrospective rewrite + Archive 冷热分层 | **已完成**（M10-A + M10-B 合入 main，2026-06） |

> **注**：M6–M10 源自 PRD v5（架构简化 + Memory 重设计）。**PRD v5 及 D-00xx 决策记录 / devlog 已不在仓库内**（`docs/internal/` 仅余 `plans/`）—— 如需查阅在 Obsidian `D:\MY LIFE\FicForge\` 或归档处。M8–M10 已完成；**当前实际推进的主线是「对话式 × 记忆栈融合」（单一主力版）**，Phase 1+2 已合 main、Phase 3 进行中，见下方「活跃工作」。

## 活跃工作（当前分支）

**当前分支：`main`** —— `origin/main @ be83996`，融合主线 Phase 1+2 全 pushed。本会话有未提交的 Phase 3 清理块（见下，待用户拍板 commit）。

### 主线：对话式 × 记忆栈融合（单一主力版）

**目标**（用户拍板）：删 `writing_mode` 模式开关，做成单一主力版 —— 一篇作品里「对话」tab +「写文/阅读」tab 并列、共用同一套记忆栈（facts / 剧情线 / 摘要 / RAG）。对话与手动只是两种输入，背后同一条「生成→接受→记忆」流水线；记忆=自动为主（接受后自动提取）。
- spec：`docs/superpowers/specs/2026-06-28-fuse-chat-into-main-memory-design.md`；plan：`docs/superpowers/plans/2026-06-28-fuse-chat-into-main-memory-plan.md`（两轮独立审）。
- **Phase 1（引擎 + API）全完**：对话路径走 `assemble_chat_context`（分层记忆进 systemContent）、`computeInputBudget` 单一真相源、confirm 内摘要/回顾不再受 mode gate。
- **Phase 2（UI 统一 + 模式系统物理删 + M9 接线）全完 + pushed**：恒并列双 tab（桌面 + 移动 5-tab 底栏）、物理删 `useWritingMode`/`getSimpleFeatures`/landing 分叉；对话接受自动触发 M9 提取（双 gate：`react_extraction_enabled !== false` + `default_llm.has_usable_connection`）弹 `ExtractReviewModal` + header「提取剧情笔记中…」指示。最后一块 P2.3 = commit `be83996`。
- **Phase 3（迁移 + 打磨）进行中**：
  - ✅ **清理块（未提交）**：`writing_mode` 字段退役（`domain/settings` + `file_settings` + `config/simple_features`（仅留 `SIMPLE_AGENT_MAX_ITER`）+ `index` re-export；round-trip 测试改「容忍读取 + 不再持久化」）+ `summaryDisabled` 死字段 + `backfill.disabledMode` 死 i18n 清理；`get_tools_for_mode` 评估=**不动**（它是 settings-chat scope au/fandom/simple，非 writing_mode）。引擎 1020 + UI 206 + 双 tsc + i18n 1176 全绿 + 独立对抗审 opus 判 safe。
  - ✅ **真机眼验（preview，无 key）**：清理块 + 3.1 modal 均零 console 报错；建/开 AU 落地对话 tab；双 tab 切换；token badge；高级操作「补全旧章记忆」按钮（已取代「补全旧章摘要」）开 modal 走 needConfig 路径全活。LLM 实跑流程靠绿测试兜底（填 key 受安全规则禁）。
  - ✅ **3.1「补全旧章记忆」（未提交）**：用户拍板做（有真实用户）。逐章统一 pass（新引擎服务 `backfill_chapter_memory`：loop/章边界中断/CAS-in-lock/半成功）补 摘要（缺则补）+ 笔记（用户勾选章，自动落库，默认勾零笔记章）+ 向量（处理到的章正文+摘要）。API `scanChapterMemory`/`backfillChapterMemory`；新 `BackfillMemoryModal`（四阶段 + 笔记章选择器 + unmount-abort）**取代**旧「补全旧章摘要」；**旧 summary-only 全栈物理删**（engine `backfill_chapter_summaries` + API `backfillChapterSummaries`/`countChaptersMissingSummary`，`find_chapters_missing_summary` 保留复用）。spec：`docs/superpowers/specs/2026-06-30-backfill-chapter-memory-design.md`。引擎 1024 + UI 214 + 双 tsc + i18n 1186 全绿 + **三轮独立对抗审 opus**（正确性 / 数据完整性 / 删除安全），采纳 HIGH 重复提取警告 + MEDIUM 半成功标 STALE + NIT 强制 t.chapterNum 归属 + LOW 空态提示。

### 背景：记忆栈（M8 / M9 / M10，均已完成并合入 main）

- M8-A Fact 富化 / M8-B Thread 剧情线 / M8-C Chapter Summary（standard，需配 embedding）；M9 ReAct 提取（复用 `runAgentLoop`，跨章 `caused_by` + 自动挂 `thread_ids`，`REACT_MAX_FACTS_PER_CHAPTER=8` 软上限）；M10-A retrospective + M10-B 冷热分层（`archived` fact 字段 + 高级操作「整理旧剧情笔记」`ArchiveCandidatesModal`）。真机全旅程 2026-06-22 验过（记忆栈四层 Facts/Thread/Summary/RAG 全跑通，配硅基 bge-m3）。spec：`docs/superpowers/specs/2026-06-20-m9-react-fact-extraction-design.md` / `2026-06-20-m8b-thread-layer-design.md`。

> **技术债现状（2026-06-30 核对 `docs/TECH-DEBT.md`）：TD-001…TD-016 全部 ✅ 已修复 / 已消解，无 open 技术债。** 别再把任何 TD-0xx 当待办列在这里 —— 引用前必查 TECH-DEBT.md 的「状态」行。

- **3.1「导入原始文件夹」联动**：补全旧章记忆已建好；其杀手场景（导入只含正文的原始文件夹后一键建记忆）待「导入原始文件夹」流程成常用入口后再验。
- **真机全 LLM 旅程**（唯一未跑的验证）：配真 key 端到端跑 对话出章→接受→提取候选→落库→切写文 tab 看同篇记忆→补记忆工具实跑。一直因填 key 受安全规则禁、用户没精力手填而跳过，靠绿测试兜底。
- **代码质量硬化**（正交支线，非 TECH-DEBT）：`docs/internal/plans/system-optimization-{roadmap,execution-plan}-2026-04-19.md`（Settings/Project 契约收窄、真 SecretStore、写入串行化）。基线部分已过时，按需取用、需先重新核对现状。
- **M6 Agent 架构**（PRD v5 / D-0043）：触发条件未满足，不排期。

---

**以下为已合并 main 的历史背景（简版收敛 Phase 1/2 + bughunt 收尾等，均已合入 main）：**

### 2026-04-20/21 完成的工作

**Writer 状态下沉重构（5 phase + 6 cleanup）**：
- WriterLayout useState 22 → 1，行数 619 → 293，setter 外泄 ~61 → 0
- 删除 `useWriterResetOnAuChange.ts`；引入 `loadDataRef` shim 破死循环；5 个 bridge ref → 0（反转控制流）
- UI 测试 0 → 13 文件 / 93 用例（`@testing-library/react` + jsdom 首次接入）
- Codex 简报 + 4 铁律 + 第 5 条规则（hook 不暴露 raw setter）已写入本文件

**Phase 7 tech debt**（全部关闭；计划文档 `phase-7-tech-debt-plan.md` 已不在仓库内）：
- ✅ T7-1 PartialCommitError（structured 错误码替代误导文案，commit `ab34816`）
- ✅ T7-2 路径白名单（`? # % :` 替换 `_`，分新建 sanitize / 已有 validate 双路径，commit `2c46c4b`）
- ✅ T7-3 端到端 AbortSignal（4 层贯通；切 AU 中途取消生成，commit `2355eb9`）
- ✅ T7-4 Import pipeline rollback（settings 落盘后 tx.commit 失败时清理；**未扩展 WriteTransaction** —— settings 不是 ops-backed 数据，不入事务，commit `6733abd`）
- ✅ T7-5 429 retry 可中断（`waitWithAbort` + `attachAbort` helper；addEventListener/removeEventListener 成对；commit `58963b3`）
- ✅ T7-6 confirm 后增量索引 + RAG STALE 降级（commit `e6686f8`）
- ✅ T7-7 RAG chapters top_k 3 → 8（commit `46d4d62`）
- ✅ T7-8 rebuildForAu 中途失败 unload 恢复 + 单测补全（修复 commit `be7c1fc`，regression test with mutation verification commit `a82c38e`；真机已验）

**上下文预算重平衡**（decision D-0039）：
- 旧公式 `budget = ctx × 60% − system` 在 128k 模型上浪费 48k tokens（`maxTokens` 被 `chapter × 2 = 3000` 绑死，40% 输出预留从不用满）
- 新公式：`budget = max(ctx − max(maxTokens, 10k) − system − 500, ctx × 60% − system)`，旧公式作下限兜底保证小模型不退步
- 128k 模型 input budget +52%，200k +58%，64k +38%；8k/4k 不变
- 新增 `OUTPUT_RESERVE_CEIL=15k` 硬顶防超长章节耗预算，触发时 `console.warn`
- commit `6ef7bd2`（决策 D-0039；记录文件已不在仓库内）

### 待决策 / 观察（未排期）

- **简版 vs 主模式的产品定位**：简版最终是主力 UX、轻量入口、还是并存？影响 Phase 2 之后的 UI 取舍（需 PM 拍板）
- **M6–M10**（Agent / 架构简化 / Memory 三层 / ReAct / Retrospective）：源自 PRD v5（out-of-repo），当前**不排期**，让位于简版收敛主线；概览见上方迁移阶段表
- ✅ **M4-E.6 Sidecar 精简（已决策退役 2026-06）**：sidecar 已删除，embedding 走云端 API（详见下方 Python 后端章节）
- **T7-7 观察**：RAG top_k=8 若不够，调 `rag_decay_coefficient` 0.05 → 0.03
- **Eval Harness** 支线独立节奏：工程产出进 `src-engine/eval/`，学习笔记在 Obsidian `D:\MY LIFE\FicForge\Eval Harness\`

### Codex 累计教训（写入新会话提示）

- 写入含中文字符串的文件时多次引入 UTF-8 双重编码乱码（5 处已修），简报必须强约束"file 命令验证 UTF-8 no-BOM + grep 验证无乱码"
- 诊断报告必须附 logcat / grep 实证（曾在 T7-3 之前错认为 secure-storage hang，实际是 React useEffect 死循环）
- 拆分代码默认走 setter 注入式 reshape；必须明确"hook 不收 setter / state 与 reset 同文件 / 跨 hook 只传 value"
- **T7-7 prompt 里 hardcoded 了 gpt-4o + contextWindow=128000 来测 CEIL 分支，但仓库里 `get_model_max_output("gpt-4o") === 4096`——Codex 正确识别并最小化 mock 了 `get_model_max_output`，没改业务代码**。好的 Codex 简报要留这种"实现细节可偏差但验证目标不偏"的弹性

## 关键决策

- **D-0034** 架构迁移为 TypeScript 统一核心引擎
- **D-0035** 向量存储从 ChromaDB 迁移为 JSON 分片 + 内存检索
- **D-0036** ~~数据同步基于 ops 日志合并~~ → **部分被 D-0040 取代**。ops 不再是 source of truth，降级为 audit log
- **D-0037** 移动端 Capacitor (Android) + PWA (iOS/Web)
- **D-0038** 桌面端和移动端各自独立管理 Embedding 模型
- **D-0039** 上下文预算重平衡（128k 模型 input budget +52%）
- **D-0040** 取消本地化同步 + ops 降级为 audit log（取代 D-0036 的核心契约）
- **D-0041** Memory 三层架构重设计（Fact / Chapter Summary / Thread）
- **D-0042** ReAct 生成 + 选择性 ReAct 提取
- **D-0043** M6 Agent 架构重新规划（取代 D-0032；等触发条件满足后启动）
- **简版收敛**（2026-06，无独立 D 编号）：简版 fork → 主仓 `writing_mode` flag 共存，取代「维护两套代码库」；spec 见 `docs/superpowers/specs/2026-06-02-converge-simple-into-main-phase1-design.md`
- **注**：D-0034…D-0043 的决策**记录文件**已不在仓库内（`docs/internal/decisions/` 已清空）；以上为决策事实摘要，原始记录见 Obsidian / 归档
- 新创建的 fandom / AU / lore 路径段统一收紧到白名单：字母、数字、Unicode 字母、空格、`-`、`_`、`.`；诸如 `? # % : * " < > / \` 的保留字符一律替换为 `_`。

## 技术栈

| 层 | 技术 |
|----|------|
| 核心引擎 | TypeScript（src-engine/，独立于 UI） |
| 前端 | React + Vite（src-ui/） |
| 桌面壳 | Tauri 2 |
| 移动壳 | Capacitor (Android) / PWA (iOS) |
| LLM 调用 | openai-node SDK（OpenAI 兼容接口） |
| Token 计数 | gpt-tokenizer |
| 向量检索 | JSON 分片 + 内存 cosine similarity |
| YAML 读写 | js-yaml |
| Frontmatter | gray-matter |
| Docx 导入 | mammoth.js |
| Embedding | 云端 API（OpenAI / Voyage / 智谱 / 硅基流动等，OpenAI 兼容） |

## Python 后端（src-python/，已退役 M7）

**已退役（2026-06，M4-E.6）**：`src-python/` 整目录删除。原 Tauri 桌面端捆绑的 Python embedding sidecar（bge-small-zh）从未接入 `createEmbeddingProvider`（`/embed` 端点无消费者、`config_resolver` 直接 block `local` 模式），属断线死重。退役收益：砍 40-80MB 桌面包体、简化 Tauri 构建、消除 v0.1.3 PyInstaller fastembed 打包阻塞。

**现状**：embedding 三端统一走云端 API（OpenAI / Voyage / 智谱 / 硅基流动等）。`capabilities.ts` 把 `local` embedding/generation 标 `platform_unsupported`（UI 不渲染）；本地模型加载请用 Ollama（OpenAI 兼容，三端可用）。若将来要"桌面离线完全可用"，重开独立 feature 分支（缓存/内置向量），不复活 sidecar。

## 内部参考文档

> **2026-06 现状**：原 `docs/internal/{prd,decisions,devlog,audit,milestone,governance,prompts}` 子目录**已不在仓库内**，只剩 `plans/`。PRD（v2/v4/v5）、D-00xx 决策记录、devlog 如仍需查阅，在 Obsidian `D:\MY LIFE\FicForge\` 或已归档。**别再引用这些已失效路径。**

**仓库内现存文档：**
- `docs/`（顶层，已 git 跟踪）— `API-REFERENCE.md`、`BUILD.md`、`DESIGN-SYSTEM.md`、`SYNC-GUIDE(_zh).md`、`TECH-DEBT.md`（**TD-001…TD-015 现行技术债清单，含简版收敛相关 TD-014/015**）、`D-0033-i18n-known-limitations.md`
- `docs/internal/plans/` — `system-optimization-{roadmap,execution-plan}-2026-04-19.md`（代码质量硬化计划，正交支线）
- `docs/superpowers/specs/` — `2026-06-02-converge-simple-into-main-phase1-design.md`（简版收敛 Phase 1 设计 spec；**新 spec 的归处**）

**学习笔记**（非工程产出）放 Obsidian `D:\MY LIFE\FicForge\`，不进仓库。

## 高风险模块（迁移时重点关注）

1. **undo_chapter**（10 步级联回滚）→ 现已有 golden test + mutation verification（commit `a82c38e`）
2. **context_assembler**（P0-P5 六层预算竞争）→ 固定输入/输出 golden test 已完备
3. ~~**ops.jsonl 多设备同步**~~ → **D-0040 已退役**，ops 仅作 audit log

---

## Claude Code 行为约束

### 禁止自行操作
- **禁止** 自行执行 git push
- **禁止** 自行执行 git merge
- **禁止** 自行切换到 main 分支
- **禁止** 自行创建 PR 并合并

### 必须等待人工确认
- 完成任务后，输出结论和 git diff --stat，等待人工确认
- 人工说"提交"或"合并"后才可执行 git 操作
- 如果人工没有明确指示，就停在当前状态等待

### 允许的 git 操作
- git add（暂存改动）
- git commit（在当前分支提交）
- git status / git diff / git log（查看状态）

### 分支规则
- 在人工指定的分支上工作，不自行创建或切换分支

---

## 工作原则

### 质量优先于省力

**不找"最省力方法"**。写代码 / 修 bug 时：

- **功能实现完整**：不为省时间跳过功能边界 —— 迁移、错误处理、边界条件、回滚、并发防护，都算功能的一部分。
- **少代码冗余**：同一字面量 / 同一判据逻辑不允许两处手工维护；**建立单一真相源**，其他地方 import 使用。
- **健壮性**：错误路径要处理（rollback / 降级 / warn）；并发路径要有锁或快照保护；状态变更要考虑"半成功"场景。
- **可维护性**：模块职责单一；命名反映语义；注释写"为什么"不是"怎么做"；新增字段要 trace 到完整数据链的每一环。
- **可拓展性**：接口留扩展点。例子：新增字体只改 manifest.ts 数据，不改 downloader / registry / service 代码。

### 单一真相源（示例）

```
默认值：engine 的 createXxxConfig() 一处定义，UI 层 import 使用
判据函数：UI / engine 共用同一个公共函数（如 scriptSlotOf）
枚举/清单：FONT_MANIFEST 一处声明，全项目 grep 只能找到这一个定义
```

### Hook 设计规则（2026-04 Writer 状态下沉重构确立）

**真实案例**：Codex 2026-04-19 拆 WriterLayout 时把 state 留在顶层、靠传 setter 让 hook 操作（`useWriterResetOnAuChange` 收 28 个 setter、`useWriterBootstrap` 收 26 参数）。结构上是"reshape 不是 refactor"：文件拆了，耦合没降；加新 state 要改 5-6 个文件；Android 上暴露 useEffect 死循环。后续用 4 个 Phase 把 22 个 useState 从 WriterLayout 下沉到各自 hook 内部（对应 devlog 已不在仓库内）。

**从此以后，Hook 必须遵守**：

1. **Hook 不接收 setter 作为参数**。如果 hook 需要修改某个 state，那个 state 就必须住在它内部。
   - 例外：textarea / 下拉这种受控组件**的用户事件 setter** 允许暴露（命名必须是动词，如 `selectDraft` 而不是 `setActiveDraftIndex`；`setInstructionText` 因 textarea 双向绑定是硬需求允许保留）
   - 例外：跨 hook bridge 的语义化注入方法允许（如 `setFocusFromState(focus)` 给 bootstrap 加载后同步初始 focus —— 它是"用引擎状态同步"的语义，不是裸 setState）
2. **State 和它的 reset 逻辑住在同一文件**。每个持有 state 的 hook 自己用 `useEffect(() => { reset }, [auPath])`（或对应的 key）处理上下文切换。**禁止**写"reset 集中 hook"那种模式 —— 它的参数列表会无限膨胀。
3. **跨 hook 共享只传 value 不传 setter**。要修改其它 hook 的 state，调用它暴露的语义化 method（命名用动词：`appendStream` / `markGeneratedWith` / `clearDraftState`）。
4. **依赖数组爆炸时用 ref shim**：如果一个 useEffect 的 useCallback dep 数组 > 10 个，大概率其中某个 ref 引用不稳会导致 dep 变化 → 死循环。用 `const fnRef = useRef(fn); fnRef.current = fn;` + `useEffect(() => { void fnRef.current(); }, [keyDep])` 破局。Phase 状态下沉后 dep 自然收敛，可移除 shim。
5. **Hook 不对外暴露 raw setter**。返回值里出现 `setX: (value) => void` 一律视为待清理（除非它服务于下面例外）。允许的例外：
   - **受控组件的双向绑定**（`<textarea value={x} onChange={setX}>`、`<input>` 的 `setChapterTitle` / `setInstructionText`）—— 必须在返回对象里注释"受控绑定"
   - **用户事件 setter 用动词命名**（`selectDraft` 而不是 `setActiveDraftIndex`；`dismissDirtyBanner` 而不是 `setDirtyBannerDismissed`）
   违反示例：`useWriterChromeState` 曾一并导出 11 个 raw setter（`setMobileToolsOpen / setExportOpen / ...`）—— 2026-04-20 Phase 6.3 清理后只保留 2 个有语义理由的。

**验收工具**（CI 可接入）：
```bash
# hook type 里不应有裸 setter 参数（允许 ≤ 5 个已知例外）
grep -E "set[A-Z]\w*:" src/ui/**/useXxx*.ts | wc -l
# 顶层组件应该大部分是 JSX 编排，useState 不应成堆
grep -c "useState" src/ui/SomePage.tsx   # < 5 是健康
```

---

## 查 Bug 的方法论

### 端到端 trace 数据流（强制）

**教训**：单文件 self-review 多轮也发现不了结构性 bug。

真实案例（2026-04 字体系统 Phase 7 才发现）：`dictToAppConfig` 完全漏接 `app.fonts` 字段 → Phase 4 以来**字体偏好从未跨会话持久化**（靠 localStorage 兜底掩盖了）。5+ 轮单文件自检都没发现，直到顺着"UI write → yaml.dump → yaml.load → dict-to-domain → UI read"完整走了一遍才看见。

### 查 bug 的流程

1. **画完整数据链**：用户操作 → state → localStorage → engine settings → yaml.dump → WebDAV sync → yaml.load → dict-to-domain → 回到 UI。**每一环都必须有对应代码**。
2. **每个环节验证有测试** —— 没测试的环节就是风险点。
3. **特别检查写入路径和读取路径的对称性**：有写必有读，有 save 必有 load（round-trip test 证明闭环）。
4. **新增字段 / 新增 config 时**：主动 grep 到 dict-to-domain 映射函数、序列化函数、所有 copy/clone 点，确认新字段都被处理。**不要只依赖 TypeScript 静态类型 —— 它不检查 yaml 字典到 domain 对象的转换**。

### 容易忽视的 bug 模式

- **stale closure**：React setter 依赖其他 state 时，用 ref 缓存最新值 / 函数式 setState，不依赖闭包值。
- **嵌套对象浅合并**：`{ ...current, nested: newNested }` 会整体替换 `nested`，不是深合并。要么传完整对象，要么写递归深合并。
- **Silent fallback**：`??` / `||` / `catch () => {}` 的回退路径会掩盖 bug。写代码时问自己"fallback 实际何时触发？触发时表现正确吗？"
- **死代码里的 typo**：fallback 永不触发的话，里面的 typo 会潜伏 —— 谁知道哪天条件变了就炸。
- **双处手工同步的字面量**：同一常量出现在两个文件里 = 冗余 + 随时间漂移的 bug 源。
- **新字段被沉默丢弃**：加 `interface FooConfig` 新字段 → `createFooConfig` 有了默认 → 但 `dictToFooConfig`（YAML / JSON 的映射函数）没处理 → 持久化断链。

### 审查节奏

- **只看自己新写的代码 → 容易漏结构性 bug**
- 要主动 trace 到**原有代码**里看是否有新字段 / 新类型未被处理
- "它能 build + 测试绿" ≠ "它 works"。**跑 dev server / preview 亲眼看一遍**，尤其是跨会话 / 跨设备的持久化路径。
- **测试的真正价值是 round-trip 闭环证明**，不是单元逻辑覆盖。

---

## 架构迁移（M0–M5，已完成）

> 迁移已收尾，本节留作历史背景。架构图、关键决策见上文。

迁移期参考文档（PRD v4 / 迁移审计 / PRD v2 / DECISIONS-updated）**均已不在仓库内**，如需见 Obsidian / 归档。

迁移期沿用的原则（现为背景知识）：

1. **Python 源码曾是最权威的规格说明书**（`src-python/` **已于 M7 整目录删除** —— 迁移后只剩 embedding sidecar，已随 M4-E.6 退役）。**`src-engine/` TS 引擎是唯一现行实现 + 真相源**；新功能直接在 TS 引擎写
2. Repository 接口签名直接对应 TypeScript interface
3. 不改动现有 Python 代码（除补测试）
4. 新 spec / 设计文档写到 `docs/superpowers/specs/`（devlog 旧目录已废）

### src-engine/ 目录补充

上文架构图列出了核心子目录。以下是架构图未体现的补充细节：

- `repositories/interfaces/` — TypeScript interface（从 Python ABC 翻译）
- `repositories/implementations/` — 文件 I/O 实现
- `platform/` — PlatformAdapter 接口 + 平台适配（Tauri / Capacitor / Web）
- `index.ts` — 统一导出入口

前端导入方式：`import { ... } from "@ficforge/engine"`（Vite alias 已配置）。

### 文件所有权

| 范围 | 负责人 |
|------|--------|
| `src-engine/` 全部 | CC |
| 前端 API 层切换（client.ts 等） | CC |
| 移动端 UI 适配 | Codex（后续任务） |
| 现有 Python 代码 | 冻结，不改动 |
