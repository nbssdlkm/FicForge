# 开发者模式 + 生成调试面板 设计 spec

> 日期：2026-09-08 · 起草：pi 主会话 · 状态：**已实现待验收**（分支 `feat/dev-mode-debug`；实现经 codex 实现对抗审 2 major 修复 + minimax 实现快筛 clean）
> 需求来源：卡拉「客户端带调试功能，C（开发者模式+prompt/上下文透视）+ D（原生 devtools），主要自己调试用」
> **v2（2026-09-08）**：codex 对抗审 7 major 全核真全采纳 + minimax 快筛 9 条（采纳 8、驳回 1 带实证），修订点见 §3 内【v2】标注与 §5a 审阅响应表
> **v3（2026-09-08）**：codex 第二轮复核确认 v2 修复可落地 + minimax#2 驳回成立，再挖 2 条新 major（iterations 零基少报一轮 / chat 前置与普通抛错漏捕获），已采纳修订（【v3】标注）

---

## 1. 背景与目标

调 prompt / 生成效果时，目前拿不到「引擎到底塞了什么进 LLM」的实证——只能看结果反推。本需求给客户端加一套**自用调试能力**：

- **C**：开发者模式开关 + 生成调试面板。每次生成（写文 / 对话）的完整 prompt 全文、分层 token 预算、RAG 命中明细、agent 遥测可回看、可复制。
- **D**：三端原生 devtools 调试入口文档化（自用 debug 包路线）。

非目标：远程上报（D-0046 已推迟，不翻案）、生成前实时预览（留迭代）、面向普通用户的功能。

## 2. 复用检查（先查已有，不造轮子）

勘察结论：**所需数据 80% 已在引擎里流着**，本需求实质是「接住 + 存 + 展示」。

| 已有资产 | 位置 | 复用方式 |
|---|---|---|
| `assembleContext` 返回 `messages + budget_report + context_summary` | `src-engine/services/context_assembler.ts:237` | 捕获点直接读，不动组装逻辑 |
| `assembleChatContext` 返回 `systemContent/latestUserContent + budget_report + context_summary` | 同文件 `:459` | 对话路径同源捕获 |
| generation 流式已 yield `context_summary` 事件 | `services/generation.ts:265` | 不动事件流，捕获在引擎侧独立做 |
| `FileLogger`（JSONL 日轮转 + 脱敏）+ `DebugLogsSection`（查看/筛选/复制） | `src-engine/logger/`、`src-ui/src/ui/settings/DebugLogsSection.tsx` | 面板交互模式照抄（展开/刷新/复制）；脱敏函数 `redactString` 直接复用于 error 字段 |
| `agent_telemetry`（ReAct 退化路径事件落日志） | `services/agent_telemetry.ts` | 不改；面板展示层可选读日志（见 §5 开放点） |
| `react_extraction_enabled` 设置项全链（domain 默认 → dictToAppConfig → UI 开关） | `domain/settings.ts`、`repositories/implementations/file_settings.ts:243`、`GlobalSettingsModal` | `developer_mode` 字段照此链路接线 |
| `engine-client.ts` re-export 模式（`getLogger` 等） | `src-ui/src/api/engine-client.ts:251` | 调试 API 同法导出 |

## 3. 方案 C 详述

### C1 引擎侧 · 新增 `src-engine/debug/` 模块

**数据结构（`domain` 层新增类型，单一真相源）：**

```ts
interface GenerationDebugBundle {
  id: string;                 // 时间戳 + 自增序号
  ts: string;                 // ISO 时间戳
  path: "write" | "chat";
  au_id: string;              // 【v2 codex#7】作品/AU 标识——全局列表必须能区分来源，防跨作品误复制
  chapter_num: number;        // 【v2 codex#7】章节号
  model: string;              // 实际生效模型（resolveLlmConfig 结果，resolve 前失败则为空串）
  params: { max_tokens: number; temperature: number; top_p: number } | null; // resolve 前失败为 null
  /** 首轮发送的消息序列（对话=startMessages 含历史；写文=组装的 messages）。 */
  start_messages: Message[];
  /**
   * 【v2 codex#3】末轮实际发送的完整消息序列 = [...startMessages, ...internalHistory]
   * （对话 agent loop 每轮追加 tool call/result/guard hint；经 onIterStart 回调快照末轮）。
   * 写文路径单轮，final_messages === start_messages。assemble 前失败时两者均为空数组。
   */
  final_messages: Message[];
  iterations: number;         // agent loop 实际轮数（写文恒 1）。【v3 codex-R2#1】
                              // onIterStart 的 iter 是零基（agent_loop.ts:168 iter=0 起），
                              // 记录时 +1 归一为「轮数」语义，UI 直接展示不修正
  budget_report: BudgetReport | null;      // assemble 前失败为 null
  context_summary: ContextSummary | null;  // 含 RAG chunks 明细；同上
  result?: {                  // 成功时填
    input_tokens: number | null;
    output_tokens: number | null;
    duration_ms: number;
    draft_label?: string;
  };
  error?: {                   // 失败时填；message 过 redactString（复用 logger 脱敏，防 provider 回显密钥）
    code: string;
    message: string;
  };
}
```

**模块 API：**

```ts
setDebugCaptureEnabled(on: boolean): void   // 模块级开关；关 = capture 全 no-op；
                                            // 【v2 codex#6】置 false 时内部同步 clearDebugBundles()，
                                            // 兑现「关 = 零保留」
captureDebugBundle(bundle): void            // 环形缓冲，上限 10 条，满了丢最旧
listDebugBundles(): DebugBundleMeta[]       // 列表用轻量元数据（含 au_id/chapter_num/path/ts，
                                            // 不含 messages 全文）；返回拷贝不返内部引用
getDebugBundle(id): GenerationDebugBundle | null
clearDebugBundles(): void
```

- **只驻内存，不落盘**：prompt 里是私密文稿，落盘会留在用户数据目录；要带走用面板复制按钮。跨会话留痕需求由现有 logger 覆盖（telemetry 已在日志里）。
- **不可变语义【v2 minimax#1】**：bundle 在 capture 前组装完毕，capture 后不再被写；ring 缓冲只在 JS 事件循环内 push/shift（原子），list/get 返回拷贝。不加锁，但此语义写进模块注释 + 一条单测钉住。
- ring 上限 10 为模块常量（Neutral default，代码注释注明）；不进 settings.yaml——自用调试面，调参需求真出现再外部化。
- 开关语义与 `writing_mode` 时代不同：这是纯观测面，不改变任何生成行为。
- 引擎 `index.ts` 导出，`engine-client.ts` re-export（照 `getLogger` 模式）。

**捕获点（两处，各加 ~15 行）：**

1. **写文路径 `generation.ts`**：【v2 codex#5】bundle 骨架在 **try 入口**就建（此时只有 path/au_id/chapter_num），随后逐步填充——resolveLlmConfig 后填 model/params，assembleContext 后填 messages/budget/summary。`done` 分支填 `result` 后 capture；`catch` 分支用「当时有什么填什么」的骨架填 `error`（过 `redactString`）后 capture——resolveLlmConfig/provider 创建/RAG 检索/assembleContext 任一抛错都有 error bundle，只是字段随失败点前移而减少。abort（用户取消）不 capture。
2. **对话路径 `simple_chat_dispatch.ts`**：【v3 codex-R2#2】bundle 骨架在 **dispatch 入口**就建（与写文路径同纪律——resolveDispatchSession/provider 创建/文件加载/assemble 任一抛错都有 error bundle，字段随失败点前移而减少）。`assembleChatContext` 返回处（simple_chat_dispatch.ts:394 后）填 start_messages/budget/summary；经 agent loop `onIterStart(iter, internalHistory)` 回调在每次迭代开始时刷新末轮快照（`final_messages = [...startMessages, ...internalHistory]`、`iterations = iter + 1`）。终态 capture 分三路：
   - 业务 terminal 回调（正常完成）：填 result 后 capture；
   - **dispatch 事件翻译层**（simple_chat_dispatch.ts ~972 区域）：`declared_tools_but_empty_terminal` / `empty_response_terminal` / `max_iter_reached` 三类 harness 直产终态事件不经过业务回调，在翻译层看到即填 error 后 capture【v2 codex#2】；
   - 【v3 codex-R2#2】**翻译层 error 事件**（~976-984，resolveDispatchSession 抛错 / runAgentLoop 普通 provider/tool 抛错统一走到这里）：看到 error 事件同样填 error 后 capture——chat 失败零漏记。
3. **对话路径 RAG 明细修复【v2 codex#1】**：`assembleChatContext` 内部检索后丢弃了 `rag.chunks`（context_assembler.ts:536 只留 ragText），导致 chat 的 context_summary.rag_chunks 恒空。修复=在 assembler 内把 chunks 经 `toRagChunkDetail` 挂到 `summary.rag_chunks`（generation.ts:255 同款做法，同函数单一真相源）。**只动 summary 旁路统计，不动 prompt 内容**，写文路径逐字节不回归。
4. agent 逐轮迭代明细**不进 bundle**（第一批）——退化事件现有 telemetry 已落日志，够看。

### C2 设置层 · `AppConfig.developer_mode: boolean`（默认 false）

- `domain/settings.ts`：`createAppConfig` 加默认值 `false`；新增 `isDeveloperMode()` 判据函数（`=== true`，缺省即关——与 react_extraction 的 `!== false` 相反，因为调试面默认应对用户隐藏）。
- `file_settings.ts:dictToAppConfig`：加映射 `developer_mode: d.developer_mode === true`。
- 写侧走既有 `objToPlain` 逐字落盘，无需新代码。
- 【v2 minimax#2 驳回，实证】settings repository **interface 层无需改动**：`grep AppConfig src-engine/repositories/interfaces/` 零命中——接口操作整个 Settings 对象，AppConfig 字段链 = domain 类型 + dictToAppConfig 读侧 + objToPlain 写侧，无 interface 签名变化。
- 【v2 codex#4】**UI API 层必须同步接**：`src-ui/src/api/settings.ts` 的 `AppPreferencesInput`（:119，现仅 language/react_extraction_enabled）加 `developer_mode?: boolean`；`engine-settings.ts` 的 `saveAppPreferences`（:461）加透传、`getSettingsSummary`（:159-168）加返回。spec v1 漏列这两文件。
- **断链防护**（AGENTS.md 教训）：补 settings round-trip 测试（写 false→读 false、写 true→读 true、缺字段→false）。

### C3 UI · 设置弹窗 Debug 区块扩展

- `GlobalSettingsModal`：现有 Debug 区块（DebugLogsSection 所在处）顶部加「开发者模式」开关，接线照 `react_extraction_enabled` 同款（AppConfig 读写 + 保存流）。
- 开关变更时调 `setDebugCaptureEnabled`；**App 启动 settings 加载完成后也要调一次**（否则重启后开关状态与捕获状态漂移）。
- 新增 `GenerationDebugSection.tsx`（仅 `developer_mode` 开时渲染，位于 DebugLogsSection 下方；实现遵守 AGENTS.md Hook 设计规则——state 住组件内部、不暴露 raw setter【v2 minimax#8】）：
  - 列表：最近 10 次生成（时间 / **AU+章节** / 路径 / 模型 / input+output tokens / 成功或错误标）【v2 codex#7】
  - 展开详情三个子块：**Messages**（start_messages / final_messages 分组展示并标注语义——final=末轮实际发送完整序列，含 agent 迭代追加的 tool 消息【v2 codex#3/minimax#6】；逐条 role + 全文 mono 块 + 单条复制）、**预算分解**（P0–P5 各层 token + context_window + max_output_tokens 表）、**RAG 命中**（chunk 来源列表，复用 ContextSummaryBar 已有的 label 逻辑）
  - 「复制全部」按钮：整包 JSON 进剪贴板；「清空」按钮
  - 交互模式照抄 DebugLogsSection（展开加载 / 刷新 / 复制 toast）
- 【v2 minimax#9】启动顺序断言：`setDebugCaptureEnabled` 在 settings 加载完成后才调（App.tsx 既有 settings hydrate 流程之后）；UI 层在 settings 未加载完成时本就无法触发生成，竞态面不存在，但实现时加一行注释钉住此约定。
- i18n：新增 `settings.developerMode.*` / `settings.genDebug.*` 键，中英双语对称（守 1289 基线）。

### 影响面

- 开关关（默认）：`captureDebugBundle` no-op，正常用户**零行为变化、零内存增长**。
- 引擎：新增 1 目录 + 改 2 个捕获点文件 + settings 两文件 + index 导出。
- UI：新增 1 组件 + 改 GlobalSettingsModal / engine-client / i18n。
- 不触碰：context_assembler 组装逻辑、generation 事件流契约、agent_loop、telemetry、logger。

## 4. 方案 D 详述（D1 only）

勘察结论：
- **Tauri**：`src-ui/src-tauri/Cargo.toml` 未开 `devtools` feature → dev 构建（`npx tauri dev`）debug 模式自带 devtools，release 包没有。
- **Android**：debug APK 默认 webview debuggable → `chrome://inspect` 直连；release 关。
- **PWA**：浏览器 F12 零成本。

**D1**：新增 `docs/DEBUGGING.md`，一页纸写清三端调试入口（Tauri dev / debug 包、Android debug APK + chrome://inspect、PWA F12、日志文件位置 `.ficforge/logs/`、开发者模式用法）。

**D2（release 包带 devtools：Tauri feature + F12 快捷键 / Android MainActivity 开关）建议不做**——自用调试 dev/debug 包已够；release 带调试能力对最终用户是多余攻击面。**重开触发条件**：真收到只在 release 包复现、dev 包不复现的 bug 报告时再评估【v2 minimax#4】。待拍板确认。

## 5. 开放拍板点（卡拉裁决）

1. C 范围：**写文 + 对话双路径捕获**（建议）vs 只做写文？
2. `developer_mode` 放全局设置持久化（建议）vs 会话级临时开关？
3. D2 确认不做？
4. 分支：直接 main 还是开 feature 分支？（项目规则：在人工指定分支干活）
5. （次要的）面板要不要顺带展示 telemetry 退化事件（读现有日志文件，零引擎改动）？还是只看 DebugLogsSection 就够？

## 5a. 审阅响应表（v2，2026-09-08）

**codex 对抗审（gpt-5.6-sol high）**：verdict=major，7 条 major，pi 逐条对照源码核验**全部属实**，全部采纳：

| # | 发现 | 处置 |
|---|---|---|
| 1 | 对话路径 assembleChatContext 丢弃 rag.chunks，summary.rag_chunks 恒空（context_assembler.ts:536） | 采纳：assembler 内经 toRagChunkDetail 补挂，只动 summary 不动 prompt |
| 2 | 三类 harness 直产终态（declared_tools_but_empty/empty_response/max_iter）不经业务回调，error bundle 漏捕获（agent_loop.ts:268/288/388） | 采纳：改在 dispatch 事件翻译层捕获 |
| 3 | bundle.messages=startMessages ≠ 末轮实际请求（agent_loop.ts:177 每轮 [...startMessages, ...internalHistory]） | 采纳：拆 start_messages/final_messages + iterations，onIterStart 快照末轮 |
| 4 | developer_mode 漏接 UI API 层（settings.ts:119 AppPreferencesInput / engine-settings.ts:461 saveAppPreferences / :159 getSettingsSummary） | 采纳：补两文件进清单与接线 |
| 5 | assemble 前置步骤（resolveLlmConfig/RAG 等 generation.ts:196-238）抛错时无骨架可填 | 采纳：骨架提前到 try 入口，有什么填什么 |
| 6 | 关开关不清缓冲，「零保留」不成立 | 采纳：setDebugCaptureEnabled(false) 内部 clear |
| 7 | bundle 缺 au_id/chapter_num，全局列表跨作品混排且有误复制隐私面 | 采纳：补两字段进 bundle 与列表 UI |

**minimax 快筛（minimax-m3）**：verdict=minor，9 条（5 minor + 4 nit）：

| # | 发现 | 处置 |
|---|---|---|
| 1 | 环形缓冲并发语义未写 | 采纳：不可变语义 + 返回拷贝 + 单测钉住（不加锁，JS 事件循环内原子） |
| 2 | settings repository interface 层可能漏改 | **驳回（实证）**：`grep AppConfig repositories/interfaces/` 零命中，接口操作整个 Settings 对象，字段链无 interface 签名变化 |
| 3 | §6 漏列对话路径捕获点测试 | 采纳：已补 |
| 4 | D2 重开触发条件未留 | 采纳：已补（release-only bug 复现需求） |
| 5 | ring 大小 10 应外部化 | 部分驳回：保持模块常量 + 注释注明；自用调试面 YAGNI，真出现调参需求再进 settings |
| 6 | ReAct 路径 messages 边界需点清 | 采纳：已被 codex#3 修复覆盖（start/final 拆字段 + UI 标注） |
| 7 | :394 行号归属模糊 | 采纳：已写明文件名 |
| 8 | 新 UI 组件需守 Hook 规则 | 采纳：spec 已点明 |
| 9 | 启动 sync 竞态未明确 | 采纳：settings 加载完成后才调，UI 加载前本无法触发生成，注释钉住 |

原始输出落盘：`D:\AI-working\decisions\dispatch\outputs\adversarial-noreq-ficforge-devmode-20260908-053802.json`（codex）、`quickscreen-...-053802.json`（minimax 原始含思考流）+ `.clean.json`（抽取后 JSON）。

## 6. 测试计划

| 层 | 测试 |
|---|---|
| 引擎单测 | debug capture：ring 上限滚动 / disabled no-op / **置 false 清空缓冲【v2 codex#6】** / error 过 redactString / list 元数据不含 messages 全文且返回拷贝【v2 minimax#1】 |
| settings | round-trip：developer_mode 写读闭环 + 缺字段归一 false（dictToAppConfig 直测） |
| 捕获点·写文 | generation.ts：mock 全依赖，断言 done/error 两路径各 capture 一次且字段齐全；**assemble 前失败（mock resolveLlmConfig 抛错）也产 error bundle【v2 codex#5】**；abort 不 capture |
| 捕获点·对话【v2 minimax#3】 | simple_chat_dispatch：正常终态 capture 一次；**三类 harness 直产终态事件（declared_tools_but_empty / empty_response / max_iter）在翻译层各 capture 一次 error bundle【v2 codex#2】**；**翻译层 error 事件（resolveDispatchSession 抛错 / provider 抛错）也产 error bundle【v3 codex-R2#2】**；final_messages 含 internalHistory 追加；**iterations 为 1 基轮数【v3 codex-R2#1】** |
| 对话 RAG 明细 | assembleChatContext 内检索后 summary.rag_chunks 非空（chunk detail 齐全）【v2 codex#1】 |
| UI | GenerationDebugSection：列表渲染 / 展开 / 复制；GlobalSettingsModal 开关接线（照 dirty/state-sink 测试模式） |
| 基线 | 引擎 1579 + UI 642 全绿、双 tsc 0、双包 biome 0、i18n 对称检查 |

## 7. 涉及文件清单（预计白名单）

**新增**：
- `src-engine/debug/{index.ts,capture.ts}` + `src-engine/debug/__tests__/capture.test.ts`
- `src-engine/domain/debug_bundle.ts`（类型）+ 测试随 capture
- `src-ui/src/ui/settings/GenerationDebugSection.tsx` + `__tests__`
- `docs/DEBUGGING.md`

**修改**：
- `src-engine/index.ts`（导出）
- `src-engine/services/generation.ts`（捕获点 1）
- `src-engine/services/simple_chat_dispatch.ts`（捕获点 2 + 事件翻译层终态捕获）
- `src-engine/services/context_assembler.ts`（对话路径 summary.rag_chunks 补齐【v2 codex#1】）
- `src-engine/domain/settings.ts` + `src-engine/repositories/implementations/file_settings.ts`（developer_mode 字段链）
- `src-ui/src/api/settings.ts` + `src-ui/src/api/engine-settings.ts`（AppPreferencesInput / saveAppPreferences / getSettingsSummary【v2 codex#4】）
- `src-ui/src/api/engine-client.ts`（re-export）
- `src-ui/src/ui/settings/GlobalSettingsModal.tsx`（开关 + 面板挂载）
- `src-ui/src/i18n/{zh,en}.ts`（新键）
- `src-ui/src/App.tsx`（settings 加载后调 setDebugCaptureEnabled，如实际接线点在别处以代码为准）

## 8. 排除的做法及原因

| 做法 | 排除原因 |
|---|---|
| 远程上报（Sentry 等） | D-0046 已拍板推迟到多 agent 上线后 |
| 调试包落盘 | prompt 含私密文稿；跨会话留痕 logger 已覆盖 |
| 生成前实时 prompt 预览 | 第一批做生成后回放成本低；预览留迭代 |
| agent loop 逐轮迭代进 bundle | telemetry 已落日志；第一批不重复造 |
| D2 release 包调试能力 | 自用 dev 包够；release 多余攻击面 |
| 调试面板做成独立页面/路由 | 设置弹窗内区块已够自用；不动导航架构 |

## 9. 原则审计对照

- **复用检查**：§2 逐条列明，捕获点只读既有产物不改组装逻辑。
- **单一真相源**：DebugBundle 类型 domain 一处定义；redactString 复用 logger；开关判据走 `isDeveloperMode()` 一处。
- **可测试**：§6 每层有测试，settings 链补 round-trip 闭环。
- **不硬编码**：ring 上限 10 为模块常量（ Neutral default ），开关持久化在 settings.yaml。
- **既有行为保护**：开关关 = 零行为变化；generation 事件流契约不动；token badge（estimate 路径读 budget_report）不受影响。
- **治理**：本 spec 审阅（minimax + codex 讨论）→ 卡拉拍板 → 开发 → 审阅链 → 验收。
