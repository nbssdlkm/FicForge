# FicForge 第二轮全量代码审阅报告

> **修复状态（2026-07-07 全量修复第一波，8 个 commit，均已在本地 main）**
> - `4e68664` fix(memory)：H10 + C-1 ✅
> - `73b0c3e` fix(parse)：H6 / M27 / B-1 / B-2 / B-3（对抗审补充项）✅
> - `6826c8e` fix(platform)：H5 / H8 ✅
> - `e476a75` fix(rag)：H9 / M1 ✅
> - `3350e1b` fix(data)：H7 / M2 / M29 / M3（TD-017 登记）✅
> - `c7f16fe` fix(budget)：H4（badge 三层同源含 UI 端）✅
> - `1fd11be` fix(chat)：H1 / H2 / H3 + 对抗审 A1-A8 ✅
> - `d38837f` fix(mobile)：M20 ✅
> - **第二波（2026-07-07，续）**：`fb30c26` feat(models) MODEL_CONTEXT_MAP 刷新 + org/ 前缀匹配修复 + PROVIDER_MANIFEST ✅；`1be7fe2` fix(pipeline) M15-18/M24-26/M28/M30 + LOW 系 + 对抗审 F1/F2/F6 ✅；`a430bf2` fix(mobile) M9-M14/M21 + 对抗审 F3/F4 ✅。
> - **对抗审第二轮发现处置**：F1（跨路径互斥）/F2（settings-chat 同族）/F3（通知双向）/F4（生成中重载）/F6（分支口径）已修；**F5（trash 恢复死锁态，MEDIUM-PLAUSIBLE：非原子恢复崩溃或用户编辑半恢复文件后 restore/permanent_delete 双拒，数据不丢但 UI 无解）、F7（M18 只剔紧随配对）、F8（停止后立即重发撞 409 文案困惑）、F9（legacy 非白名单文件名 modify 丢 frontmatter 守护）— 记录未修**，F5 建议随 trash 后续迭代补显式选择 UI。
> - **剩余未做**：模型选择器 UI 阶段（引擎侧接口已就绪）；审计中标注「仅真机可证」项（M12 safe-area / M21 离线 / M11 帧率 / iOS IDB 连接回收 L12）；LOW 观察项 L7/L8/L10/L11/L14-L18/L21/L23-L25。
> - 每笔修复均经独立对抗审或判别性回归测试（回退旧码即挂）钉死；两轮对抗审共抓 20 条整改（A1-8 / B1-3 / C1 / F1-4 / F6），全部落地。

- **日期**：2026-07-07
- **基线**：main @ `2657163`（与 origin/main 同步，工作区干净）
- **范围**：src-engine/ + src-ui/ 全量（约 5.65 万行非测试 TS），重点移动端
- **方法**：8 个并行审阅 agent（移动平台层 / 移动 UI / 记忆栈 / 生成管线 / 持久化闭环 / UI 状态与 API / 融合主线设计符合性 / 记忆栈设计符合性）。所有**单一来源的高危论断**由主会话亲手核实（真实库复现、全仓 grep、逐行读门控代码）；多 agent 独立撞上同一问题的互为印证。
- **与第一轮的关系**：第一轮（2026-07-03，9 发现 → 8 修 + push，⑦判可接受权衡）的全部修法经住本轮独立复核，**无一翻案**。本轮发现均为新问题。

---

## 总评分：7 / 10

> 一句话：**结构优秀、边界脆弱**。核心架构、设计落地、测试纪律是产品级水准；但「进程/组件随时死掉」「文件写到一半崩溃」「数据只增不删」这三类边界没有被系统性尊重，而移动端恰恰把这三类边界变成高频事件。修完 P0+P1 预计可到 8~8.5。

| 维度 | 分数 | 依据 |
|---|---|---|
| 架构与可维护性 | 8.5 | 单一 TS 引擎 + 三端壳分层清晰；单一真相源纪律执行到位（computeInputBudget / isColdFact 等）；hook 铁律 1/3/4 全绿 |
| 设计落地符合性 | 8.5 | 融合主线 ~95%、记忆栈 ~85%；但 M8-A 富化默认失效属「做了 95% 丢了最后 5%」的典型 |
| 引擎核心正确性 | 8 | 两轮审计 + golden test 打底；预算真相源断裂与 gray-matter 解析洞是两个实质扣分项 |
| 数据持久化安全 | 5.5 | 假原子写、吞正文、trash 树回滚、三端语义漂移零契约测试——对「用户数据是唯一资产」的写作工具这是最短的板 |
| 移动端健壮性 | 6 | 「卸载即丢失」问题族（提取/生成/保存三条链）+ PWA 无 SW + 平台层文件 I/O 测试零覆盖 |
| 测试体系 | 7.5 | 引擎 1000+ 用例、round-trip/golden/mutation 意识好；缺口集中在平台 adapter 契约与几个恰好出问题的地方 |

---

## 一、设计目的达成度

### 1.1 融合主线（对话 × 记忆栈，单一主力版）：约 95%

| # | 设计承诺 | 状态 | 关键证据 |
|---|---|---|---|
| 1 | 双 tab 恒并列无模式开关（桌面） | 达成 | `AuWorkspaceLayout.tsx:249-257,407-414` |
| 2 | 移动 5-tab 底栏含对话 | 达成 | `BottomNavBar.tsx:25`、`MobileLayout.tsx:142-152` + 测试 |
| 3 | 对话/手动同一条「生成→接受→记忆」流水线 | 达成 | 两路径同调 `confirmChapter`（`engine-chapters.ts:70`），confirm 内摘要/回顾/RAG 无 mode gate |
| 4 | 对话走 assemble_chat_context 分层记忆 | 达成 | `context_assembler.ts:878-1042`；组装一次/循环外（`simple_chat_dispatch.ts:472-482`） |
| 5 | API 层注入 facts/threads/vector/embedding | 达成 | `engine-simple-dispatch.ts:71-96`（含审计③补的 ensureLoaded） |
| 6 | computeInputBudget 单一真相源 | 达成 | `context_assembler.ts:554-564`，写文/对话共用 |
| 7 | token badge 改接不断 | 达成 | `estimate_simple_tokens.ts:96-119` |
| 8 | 接受自动触发 M9 + 双 gate + ExtractReviewModal | 达成 | `SimpleChatPanel.tsx:133-136,390-393` + 7 个 gate 组合测试 |
| 9 | 对话不开放 add_fact/modify_fact | 达成 | `settings_tools.ts:167-172,328` 黑名单物理过滤 |
| 10 | writing_mode 等物理删干净 | 达成 | 源码 grep 归零；容忍读取 `file_settings.ts:246-250` |
| 11 | 新建/打开默认落地对话 tab | 达成 | `useLibraryMutations.ts:93`、`LibraryFandomSections.tsx:244-248` |
| 12 | 老作品平滑 + 补全旧章记忆工具 | 达成 | backfill 全栈 + 旧 summary-only 物理删 |

**断链仅一处**：对话接受后章节列表不刷新（见 H1）。次要：桌面双 tab 恒渲染缺 UI 测试（plan 2.1 只在移动端落地）；`chat-to-llm.ts:15` 过期注释；`src-engine/dist/` 陈旧编译产物（不在构建路径，建议删）。

### 1.2 记忆栈（M8/M9/M10 + backfill）：约 85%

数据面（提取→落库→序列化→生命周期→UI 干预）质量高；**分化点在「进 prompt 的最后一公里」**：

| 层 | 进 prompt 现状 |
|---|---|
| 摘要（P4 RAG summaries collection） | 真实生效（TOP_K=4、时间衰减、排除 P2 章） |
| 剧情线（threads 层） | 生效但只注入 title+state，state 零自动维护（见 M6） |
| 冷分层排除 | 彻底（审计⑥全链） |
| **M8-A 富化字段** | **默认路径下永不生效**（见 H10） |
| **caused_by 因果边** | **零生成端消费者**（见 M5） |

**backfill（2026-06-30 spec）**：逐章统一 pass / 锁外 LLM + 锁内 CAS / 半成功标 STALE / abort 区分 / UI 四阶段——全部达成。唯「导入→一键建记忆」衔接未做（已知待办，见 M8）。

---

## 二、发现清单

标注说明：〔源〕= 发现它的审阅维度；「双源/三源」= 多 agent 独立发现互证；「已核实」= 主会话亲手验证（复现/grep/读码）。

### HIGH（10 条）

**H1 · 对话接受后章节列表全线不刷新**〔移动 UI + 融合符合性，双源〕CONFIRMED
`SimpleChatPanel.tsx:362-404` 接受成功后仅调内部 `refreshChapterContext()`，无 `onChaptersChanged` 类 prop；`AuWorkspaceLayout.tsx:52-55,100-110` 的 `chapters` 只在 auPath 变化或写文侧 confirm/undo 时刷新；`App.tsx:229` `key={currentAuPath}` 使组件跨 tab 不重挂。
场景：对话接受第 1 章 → 移动「章节」tab 仍显示空态；桌面侧栏滞留旧列表。打在融合版主卖点上。**修复 = 一行 props 接线。**

**H2 · 接受后自动提取，切 tab 即静默丢结果且不可取消**〔移动 UI + UI 状态 + 融合符合性，三源〕CONFIRMED
`useWriterFactsExtraction.ts:51-78` 调 `extractFacts` 不传 signal（`engine-facts.ts:148` 明确支持）；提取状态/候选住在 `SimpleChatPanel` 内，`SimpleChatPanel.tsx:392` fire-and-forget。
场景：接受草稿 → header「提取剧情笔记中…」→ 切 tab 卸载面板 → LLM 跑完但 setState 落在已卸载组件 → modal 永不出现、笔记零落库、token 白烧、无提示。移动端 5-tab 底栏使此为高频路径。

**H3 · 接受落库状态可丢 → 同章可二次接受**〔UI 状态；防抖部分与移动 UI 互证〕CONFIRMED
`SimpleChatPanel.tsx:371-392`：`await confirmChapter`（内含标题+摘要+回顾多个串行 LLM，数秒~数十秒）之后才 `markDraftAccepted`；期间卸载则标记丢失。且 `useSimpleChat.ts:162-173` 防抖保存 cleanup 只 `clearTimeout`、无 unmount flush（对比 `useWriterDraftController.ts:315` 有 flush）。load 时 stale 清理只处理 `streaming` 不处理 stale `pending`（`SimpleChatPanel.tsx:157-167`）。
场景：章节已定稿但草稿永远显示可点「接受」→ 再点 = 覆写同章 + 重复提取 + revision 漂移。工具卡 `handleConfirmTool` 同机制。

**H4 · 预算真相源断裂：assembler 只看 project.llm，无视实际生效模型**〔生成管线〕CONFIRMED·已核实
`context_assembler.ts:523`（`project.llm?.model ?? ""`）、`:586/:895`（`get_context_window(project)`）、`rag_retrieval.ts:404`；而实际请求模型走 `resolve_llm_config(session_llm, project, settings)`（`generation.ts:204`、`simple_chat_dispatch.ts:459`）。
场景：最主流配置「全局 default_llm、AU 无覆盖」→ 窗口按 `DEFAULT_CONTEXT_WINDOW=32_000`、输出上限按 `get_model_max_output("")=4096` → 64k 模型约 60% 输入预算被静默扔掉，D-0039 对全局默认用户完全失效；badge 同源失真。反向：真实窗口 < 32k 且不在映射表 → 组装超窗 → API 400。
修法方向：resolve 后把 effective llm 视图传进 assembler，两条解析链归一。

**H5 · 全平台假原子写；.tmp 无恢复且会被覆盖固化**〔平台层 + 持久化，双源〕CONFIRMED·已核实
`file_utils.ts:96-105`：写 `.tmp` 后对正式路径仍是截断重写，成功即删 `.tmp`；`adapter.ts` 接口无 rename。全仓无任何代码读 `.tmp` 恢复；`append_jsonl`（`:115-120`）读全文重写——崩溃截断后下一次 append 用截断内容重建 `.tmp`，损失固化。`settings.yaml`/`state.yaml`/章节 `.md`（`file_chapter.ts:109`、`file_settings.ts:108`）连 `.tmp` 都没有。**threads.jsonl 无 ops 背书（`file_thread.ts` 直写），截断即永损**；facts 可经 rebuildFactsFromOps 找回。
场景：Android 后台杀进程/断电击中写入中途。修法：adapter 加 rename（三端原生都有；Web=IDB get+put+delete），或启动时 `.tmp` 检测恢复；给 thread 增删补 ops。

**H6 · 以 `---` 开头的无 frontmatter 章节被吞正文**〔持久化〕CONFIRMED·已实测复现
`file_chapter.ts:47-53,85,151-154`。实测：`matter('---\n\n夜色如墨…\n\n---\n\n第二场…')` → data 变成**字符串**（第一幕整段）、content 只剩后半。两条后果路径：`get()` 对字符串 primitive 赋 `chapter_id` 抛 TypeError → 该章不可读且 `list_main` 整 AU 崩；`get_content_only()` 静默返回残缺正文 → 喂给 backfill 摘要/RAG/导出，损坏固化扩散。
触发面：场景分割线 `---` 在同人正文常见；「导入原始文件夹」杀手场景是最大入口。修法：`matter` 结果 data 非 plain object 时整文按纯正文回退。**建议在导入入口上线前必修。**

**H7 · trash 整树删除回滚双失败可销毁唯一副本**〔持久化〕PLAUSIBLE（低概率/高后果）
`trash_service.ts:99-125,504-525`：树路径顺序「copy 全部→删全部源→appendManifest」，catch 里 `restoreCopiedTree`（copy-back 失败被 `catch {}` 吞）后**无条件** `deleteCopiedTree`。若 append/删源失败叠加某文件 copy-back 失败 → 源已删、副本也删。审计①修的单文件路径（`_moveToTrash:205-235`）顺序是安全的，树路径不对称。修法：镜像单文件顺序，或只删「源已验证存在」的副本。

**H8 · Keystore 瞬时故障被吞 → 用户保存设置即删真 key**〔平台层〕CONFIRMED（链路）
`capacitor_adapter.ts:277-287` `secureGet` catch 一切返 null（backend 故障与「没存过」不可区分）；`:248-254` capabilities 静态谎报 `os_keyring/persistent`（对比 WebAdapter `web_adapter.ts:399-410` 按运行时诚实上报）。
场景：Android Keystore 抖动（Samsung 已知/解锁窗口/备份恢复）→ UI 显示 key 为空 → 用户随手保存 → `secure_fields.ts:84-91` 空值语义删掉 secure storage 旧值 → 真丢。修法：插件 throw 时抛专用错误，UI 显示「读取失败」而非空字段。

**H9 · 向量层只增不删：undo/编辑/删 AU 均不清理**〔记忆栈 + 持久化，双源〕CONFIRMED·已核实
`vector/engine.ts:143-153` `delete_by_chapter`/`delete_by_source` **生产代码零调用**（已 grep 核实，唯一同名调用是 draft repo）。`undo_chapter.ts:129` 只置 STALE；`generation.ts:218` STALE 时仍尝试召回。
场景簇：a) undo 第 N 章（=明确拒绝）→ 重写 → 被拒正文 chunk 以 decay=1 最高权重进生成输入；`sumN` 摘要向量同残留。b) 重确认后新章 chunk 数变少 → 旧尾部 chunk 永久残留。c) `engine-fandom.ts:183-206` deleteAu 不触 ragManager → 同名重建 AU 直接继承已删作品内存向量，且首次 indexChapter 的 persist 将其**落盘固化**进新 AU。修法：undo/edit 接 `delete_by_chapter` + 摘要向量同删；deleteAu 时 unload。

**H10 · M8-A 富化字段默认（ReAct）路径永不进 prompt**〔记忆栈符合性〕CONFIRMED·已核实
注入门控 `buildFactEnrichmentSuffix`（`context_assembler.ts:186-188`）：`if (!fact._confidence) return ""` + per-field ≥ medium。而 ReAct `proposeFactItemSchema`（`react_extraction_tools.ts`）**不含 `_confidence`**（zod 剥离未知键）、system prompt 不要求它；dispatch 仅在因果未 grounded 时写 `_confidence.caused_by="low"`（`react_extraction_dispatch.ts:242`）。`react_extraction_enabled` 默认开（`domain/settings.ts:126`）。
结果：known_to / time_kind / action_verb / location / suspense_type 全部落库但一律被静默丢弃——M8-A 核心卖点（dramatic irony 的 known_to 注入）默认配置下实际贡献为零；只有关掉增强提取走单次调用路径（prompt 要求 confidence）才生效。修法很小：dispatch 对 propose 出现的富化字段合成默认 medium，或门控「ReAct 来源视为 medium」。

### MEDIUM（约 27 条）

**融合/记忆栈产品缺口**

- **M5 · caused_by 因果边零生成端消费者**〔记忆栈符合性〕：提取/防幻觉过滤/落库全通（`react_extraction_dispatch.ts:235-284`），但全仓仅 ExtractReviewModal 计数 Tag 消费；P3 按 M8-A 设计列为不注入（`context_assembler.ts:184`），M9 后无人把 fact_id 边转成 prompt 可读信息或 UI 因果视图。「续写追溯跨章因果」承诺未兑现，纯写入资产。
- **M6 · Thread.state 零自动维护**〔记忆栈符合性〕：注入只有 title+state（D1 设计），state 全靠 ThreadsLayout 手写；M9 自动挂线不碰 state、无「N 章未推进请更新」提示。20 章不更新 → 注入的是 20 章前旧进展，可能反向误导生成。
- **M7 · 归档候选识别永不自动触发**〔记忆栈符合性〕：Q4 拍板「系统识别→UI 提示→用户确认」只做了后半（`ArchiveCandidatesModal`）；`run_archival_sweep` 有意不接线（`facts_lifecycle.ts:657-663`）且 confirm 后无任何 toast。P3 膨胀问题对不主动探索的用户实际未解决。
- **M8 · 导入→backfill 衔接缺失**〔记忆栈符合性；已知待办〕：`LibraryImportPanel.tsx` 无完成后指向 backfill 的提示/跳转；杀手场景需用户自行导航到 AU 设置高级操作。

**记忆栈一致性**

- **M1 · index_status 单 bit 双向失真**〔记忆栈 + 持久化，双源〕：a) `engine-chapters.ts:131-140` confirm 增量索引成功即无条件 READY——掩盖「编辑历史章旧 chunk 未重索引」（`chapter_edit.ts:61` 置的 STALE）与 backfill 半成功 STALE；b) `backfillChapterMemory`（`:406-476`）成功路径**无 READY 写点**——杀手场景跑完仍显示「索引过期」，误导用户再跑全量重建 = 重复 embedding 花费。
- **M2 · backfill 补摘要整档覆盖抹掉 micro**〔记忆栈 + 持久化，双源〕：`chapter_summary.ts:115-121` `persist_chapter_summary` 用 `createChapterSummary({standard})` 全量重写，不像 `update_micro` 合并 `...existing`。confirm 时 standard 失败/micro 成功产生 micro-only 文件 → backfill 判缺摘要 → 补 standard 抹 micro；micro 无补生成路径（`:125-126`）→ retrospective 输入永久缺章。
- **M3 · RagManager/vectorEngine 跨 AU 并发竞态 + 技术债脱管**〔记忆栈 + 持久化，双源〕：`rag_manager.ts:147-183` `ensureLoaded` 后慢 embed 期间另一 AU load 换掉 `this.chunks`，随后 `persist(AU1)` 把 AU2 内存写进 AU1 index.json → AU1 索引报废。AU 锁按 AU 分把、跨 AU 不互斥；backfill 长跑放大窗口。**`rag_manager.ts:66-69` 注释称「见 TD 标记」但 TECH-DEBT.md 无对应条目**——与 CLAUDE.md「无 open 技术债」冲突，需记回。

**生成管线**

- **M15 · 未知工具名绕过校验直达 terminal**〔生成管线〕：`simple_chat_dispatch.ts:649` `hasInvalidArgs` 只查 `isMutating && !valid`，未知工具（isMutating=false）的 repair `retryHint` 被丢弃原样 emit；Branch 1（`:598-603`）restCalls 完全不跑 repair。LLM 幻觉工具名 → UI 弹无名待确认卡，「注 hint 让 LLM 改正」循环不可达。
- **M16 · 流中途断网被误分类 INTERNAL_ERROR/DISPATCH_FAILURE**〔生成管线〕：`openai_compatible.ts:247-254` 只把 AbortError 转 network_error，`reader.read()` 断网抛 TypeError 裸抛 → 上游归 INTERNAL_ERROR（无重试按钮）。首包前断网反而正确报 network_error，行为不一致。partial draft 有救，仅分类错。
- **M17 · dispatch 无并发防护，草稿标签竞争静默覆盖**〔生成管线〕PLAUSIBLE：`simple_chat_dispatch.ts:486-487` label 在 loop 前一次分配，无 `generation.ts:64-68` 同款 `_generating` 409 防重入；`withAuLock` 只包 save。双 tab 并列后：对话生成中切写文 tab 再点生成 → 双方拿同 label → 后完成者覆盖先完成者。
- **M18 · orphan tool 消息可把会话钉死**〔生成管线〕PLAUSIBLE：`chat-to-llm.ts:164-201` 半配对场景（tool_calls 要 a+b、只有 a 的 result 落盘）downgrade assistant 后已入列的 `role:"tool"` a 成孤儿 → 之后每次发送该会话都被 API 400 拒。修法：downgrade 时同步删除已配对 tool 消息。

**移动端 UI/UX**

- **M9 · 切底栏 tab 静默杀写文生成**〔移动 UI + UI 状态，双源〕：`MobileLayout.tsx:144-152` 条件渲染即卸载；`useWriterGeneration.ts:102-105` cleanup abort，abort 分支直接 return 无 toast 无部分落地。对话路径同样无 partial 恢复（写文 error 分支有 `partial_draft_label`，对话没有对应物）。桌面看章节用常驻侧栏无此代价——同一策略在移动 IA 下高频误伤。建议：生成中切 tab 加确认拦截，或不卸载只隐藏。
- **M10 · embedding stale 提醒 modal 只在桌面分支**〔移动 UI〕：`AuWorkspaceLayout.tsx:189` mobile early-return 在 stale Modal（`:420-428`）之前。移动端 RAG 静默降级，唯一线索藏在故事设置 status Tag。
- **M11 · 写文 tab 流式渲染保留简版已修掉的卡顿模式**〔移动 UI〕：`useWriterDraftController.ts:116-118` 每 chunk 一次 setState 无 rAF 缓冲 + `ChapterContentArea.tsx:153` react-markdown 全量重 parse 累积全文；对照 `useSimpleChat.ts:122-126` 注释（同款模式=V1 真机卡顿根因，聊天路径已改 rAF 批量 flush）。低端 Android 流式 3000 字 = 每 token 全文重解析。
- **M12 · iOS safe-area 几何冲突**〔移动 UI〕PLAUSIBLE（仅真机可证）：`MobileLayout.tsx:106` header `safe-area-top` + 固定 `h-11`（border-box 下内容高度被压 0）；内容区 `pb-24`（96px）< BottomNavBar 实高（iOS ≈108px）→ 输入框底部被遮 ~12px；`MobileSettingsView.tsx:50` FAB 同理。
- **M13 · 「清空对话」依赖 window.confirm，融合后前提失效**〔移动 UI〕PLAUSIBLE：`SimpleChatPanel.tsx:600-601` 注释「简版仅 Capacitor/Web」，融合后恒挂 Tauri 桌面；wry 对 confirm 支持不完整，桌面点击可能无反应。
- **M14 · 移动端 AI 设定助手不透传会话 LLM**〔移动 UI〕：`MobileSettingsView.tsx:77-87` 缺 `sessionLlm/disabled/onBusyChange`（桌面 `WriterLayout.tsx:290-301` 有传）。用户选的会话模型对移动设定助手不生效。

**UI 状态/API**

- **M24 · undo 无 in-flight 状态可双发**〔UI 状态〕：`useWriterChapterActions.ts:139-163` 无 isUndoing；`writerDisplayState.ts:90` writeActionsDisabled 不含 undo；UndoConfirmModal 无 loading。撤销中再确认一次 → 并发第二次 10 步级联回滚，多撤一章。
- **M25 · 交互式提取落库半成功重试产生重复 fact**〔UI 状态〕：`useWriterFactsExtraction.ts:90-122` 逐条 addFact 中途抛错 → modal 保持、候选原封不动 → 重试把已入库前半再存一遍。backfill 路径有重复警示，交互路径无等价防护。（注：与第一轮⑦判过的 backfill 场景不同源，这是交互 modal 路径。）
- **M26 · 对话错误绕过 friendly 映射 + 硬编码中文**〔UI 状态〕：`SimpleChatPanel.tsx:311-327` 直接拼 `[code] message` 不走 `getFriendlyErrorMessage`（写文路径走）；`engine-generate.ts:47-53`、`engine-simple-dispatch.ts:56-66` UNSUPPORTED_MODE 硬编码中文且 error_messages 无对应 key。

**持久化/平台**

- **M27 · gray-matter 缓存污染：相同文本章节共享 chapter_id**〔持久化〕CONFIRMED·实测：gray-matter v4 按原文缓存且浅拷贝共享 `.data`，`file_chapter.ts:58-80` get() 的内存补齐污染缓存 → 两个字节相同的无 frontmatter 章节共享 chapter_id/confirmed_at，save 后持久化（ops target_id 串扰）。另 matter.cache 无上限（内存）。修法：`matter(text, {})` 绕缓存或 `meta = {...parsed.data}`。
- **M28 · lore 文件名写读双路径不对称**〔持久化〕：写走 `sanitizePathSegment`（`engine-lore.ts:47-49`），undo/modify/delete 用 `normalizeMarkdownFilename` 原名走 `validateExistingPathSegment`（`:58-74`）。LLM 起的含全角标点文件名（`：？！【】` 非 `\p{L}`）→ 磁盘名 ≠ 记录名 → 撤销抛「源不存在」、回滚失败孤儿角色文件、modify 读不到旧文件。修法：以 saveLore 实际返回名回填 undoMeta。
- **M29 · 导入 overwrite：trash 失败被吞后直接覆盖旧章**〔持久化〕PLAUSIBLE：`import_pipeline.ts:545-558` `move_to_trash` 抛错被吞 → `tx.saveChapter` 覆盖 → 旧章永失且不在回收站。应降级 backup_chapter 或中止上报。
- **M30 · 目录 restore 半途失败无回滚，恢复永久卡死**〔持久化〕：`trash_service.ts:430-454` 逐文件 copy 中途失败 → 半成品 + manifest 仍在 → 重试撞冲突预检永败；用户用 permanent_delete 自救会把未恢复的 k+1..n 一并删掉。
- **M19 · Web 多标签页并发写丢更新**〔平台层〕：`file_utils.ts:41-59` 写锁是模块级 Map 仅单页面生效；无 `navigator.locks`/BroadcastChannel。PWA 开两个标签页 → append_jsonl 读改写交叉 → 后写者覆盖前写者。
- **M20 · Google Fonts render-blocking 外链打进 APK/PWA**〔平台层〕：`index.html:30-37`；大陆网络黑洞式丢包时首帧可卡 10s+，每次冷启动重试；Inter 无中文字形收益近零。修法：本地化或 `media="print" onload`。
- **M21 · PWA 无 service worker，iOS 离线=白屏**〔平台层〕：public/ 无 sw、全仓无注册、vite 无 PWA 插件。D-0037 把 PWA 定为 iOS 唯一方案：数据在 IndexedDB 里但壳打不开。vite-plugin-pwa 预缓存 shell 即可。
- **M22 · FontStorage 相对路径直通 raw adapter**〔平台层〕PLAUSIBLE：`fonts/storage.ts:20-27` `FONTS_DIR="fonts"` 未拼 dataDir（`engine-fonts.ts:32-33`），违反「Tauri 用绝对路径」契约 → 桌面按 CWD 解析，Finder 启动时 CWD=/ 写失败或落错位置，换启动方式「已下载字体消失」。manifest 有 3 个 live downloadable 字体，非死代码。
- **M23 · writeFile 自动建目录契约三端漂移**〔平台层〕：`adapter.ts:40` 文档承诺自动建目录；Tauri 不实现（父目录缺失即抛）；Capacitor mkdir `catch {}` 吞掉一切错误（磁盘满延迟暴露）。「移动端测过、桌面炸」的漂移温床。

### LOW（约 25 条，摘要）

- L1 chat.yaml 防抖保存无 unmount flush（并入 H3 修复）〔移动 UI/UI 状态〕
- L2 `MobileManageView.tsx:26-27` 丢弃父级回调死接线（给导入联动埋断钩）〔移动 UI〕
- L3 `MobileChapterList.tsx:102-156` button 内嵌 input/role=button 非法嵌套（iOS 手势互扰、读屏）〔移动 UI〕
- L4 全局 isStreaming 灌历史草稿卡 → 流式期历史长卡强制展开、滚动跳变（`SimpleChatHistory.tsx:188-195`、`WritingDraftCard.tsx:86,119`）〔移动 UI〕
- L5 流式路径零 429/5xx 重试，T7-5 只护航非流式（`openai_compatible.ts:168-172` vs `:298-385`）〔生成管线〕
- L6 generateStream 错误路径泄漏 abort listener（`:147-172` 两条 throw 不 removeEventListener）〔生成管线〕
- L7 P2 层 500 字下限可突破层预算，小窗口模型极端时超窗（`context_assembler.ts:406-420`）〔生成管线〕PLAUSIBLE
- L8 token badge 不计 assistant.tool_calls args 与 framing，系统性低估（`estimate_simple_tokens.ts:113`）〔生成管线〕
- L9 partial_draft_label 可指向 rescue save 失败的不存在草稿（`simple_chat_dispatch.ts:715-729,806-819`）〔生成管线〕
- L10 deviation hint 指涉模型看不到的上一条回复（偏离文本不入 history，`agent_loop.ts:245-257`）〔生成管线〕
- L11 listDir/exists/deleteFile 三端语义漂移矩阵，无契约测试钉住（`web_adapter.ts:280-316,253-256`）〔平台层〕
- L12 WebAdapter IDB 连接零容错：tx.onabort 不 reject 可挂死；iOS Safari 强关连接后永不重连=全部保存失败到手动刷新（`web_adapter.ts:39-55,217`）〔平台层〕
- L13 生产构建 logcat 打印含作品名的 secure key 名（`capacitor_adapter.ts:210-245` console.info，建议 debug gate）〔平台层〕
- L14 deviceId KV 回填救不了目标场景（kv 同以 localStorage 为后端；读到已存 ID 也不采用），受限环境 device_id 每次重开，仅影响审计可读性（`App.tsx:110-118`）〔平台层〕
- L15 Android 工程仅 app/build.gradle 入库：AndroidManifest（allowBackup/dataExtractionRules 关系作品明文外泄面）、variables.gradle 等不可审计、构建不可复现，建议至少入库 Manifest（`git ls-files src-ui/android` = 1 文件）〔平台层〕
- L16 REACT_MAX_FACTS_PER_CHAPTER=8 截断在 backfill 自动落库路径 silent（结果计数不含被 cap 数，`react_extraction_dispatch.ts:221-222`）〔记忆栈〕
- L17 retrospective v2 落盘成功/向量覆盖失败零补救信号（`retrospective.ts:177-183`，sum{N} 长期停 v1 无人促发 rebuild）〔记忆栈〕
- L18 vector persist 不清理已移除 chunk 磁盘文件（`vector/engine.ts:166-208`，纯磁盘垃圾膨胀）〔记忆栈〕
- L19 saveSimpleChat 失败 `catch(()=>{})` 静默吞（`useSimpleChat.ts:168-170`，已知 TODO，磁盘满时整段对话不落盘无提示）〔UI 状态〕
- L20 useSimpleDispatch auPath cleanup 不复位 isStreaming（当前被 App key 重挂掩盖，契约与实现漂移的定时炸弹，`useSimpleDispatch.ts:89-98,170-176`）〔UI 状态〕
- L21 useKV 初始异步加载可回滚用户刚写入的值；key 变更不重置（当前 key 均常量，潜伏，`useKV.ts:20-31`）〔UI 状态〕PLAUSIBLE
- L22 toast 计时器随队列变化整体重置，连续报错时滞留超时（`useFeedback.tsx:95-105`）〔UI 状态〕
- L23 backup_chapter 版本号 = 文件数+1，外部清理 v1 后可覆盖既有 v2（应 max+1，`file_chapter.ts:168-177`）〔持久化〕PLAUSIBLE
- L24 executeImport 无条件覆盖 last_scene_ending：低章号补导时续写衔接锚点错位（`import_pipeline.ts:606,619`、`ops_projection.ts:142-144`）〔持久化〕
- L25 杂项：单次调用路径 caused_by 是缩写字符串落库为垃圾数据且被 modal 误计 Tag（仅关增强提取时）；micro 生成被 embedding 配置连带门控（其实只需 LLM，`engine-chapters.ts:152`）；`chapter_summary.ts:126`「micro 无消费者」注释过期；`chat-to-llm.ts:15` 过期注释；`src-engine/dist/` 陈旧产物；hook 铁律规则 5 raw setter 超标（`useWriterFactsExtraction` 6 个 + facts/library 系 20+，多数受控绑定可豁免，`setBatchMode/setDeleteTarget` 等应动词化）；桌面双 tab 恒渲染缺 UI 测试

---

## 三、正面确认

- 第一轮审计①-⑨修法全部经住独立复核（⑤ CAS 三处覆盖、⑥ archived 全链、⑧ 钉章含 backfill、⑨ abort 无落盘泄漏），无一翻案
- i18n 中英 key 集合 1186 = 1186 零差异（含复数形态），t() 引用扫描无缺 key
- Hook 铁律 1/3/4 全绿：无 hook 收 setter、跨 hook 全走动词方法、loadDataRef shim 按文档保留
- facts/threads/摘要写读对称性 + ops 可重建性闭环（M8-A 9 字段 6 hop 贯通、thread_ids 单一真相源）
- backfill 编排（loop/章边界中断/CAS-in-lock/半成功/abort 三查）测试扎实（14 用例）
- 融合双 gate fail-closed、对话工具黑名单物理过滤、grounding 防幻觉子串校验等防御性设计到位

## 四、测试覆盖缺口汇总

1. **平台 adapter 文件 I/O 零覆盖**（现有 4 个测试文件只测 secret storage）：中文 round-trip、二进制 base64、三端语义契约（自动建目录/listDir/deleteFile）、路径归一化、配额/中断传播——建议一套跑在三个 adapter 上的共享契约测试
2. chapter 解析边界：正文以/含 `---`、无 frontmatter 文件的 round-trip；相同文本双章 chapter_id 独立性
3. trash 树路径回滚双失败、目录 restore 半途失败
4. 崩溃截断 JSONL 恢复（threads 无 ops 背书）
5. vector persist→reload 在 undo/edit 后的旧 chunk 清理断言；READY/STALE 状态迁移矩阵
6. 桌面双 tab 恒渲染 UI 测试（plan 2.1 承诺）

## 五、修复优先级建议

**P0（打在主卖点 + 数据入口安全）**
H1 章节列表接线（一行）→ H2 提取可取消+状态提升 → H3 接受状态落库时序/unmount flush → H4 预算真相源归一 → H6 gray-matter 解析回退（导入入口前必修）

**P1（数据安全 + 记忆栈实效）**
H5 原子写（adapter 加 rename）+ threads ops 背书 → H9 向量清理接线（undo/edit/deleteAu）→ M1 index_status 双向修 → H10 M8-A 置信度门控（让富化真正生效，改动极小收益大）→ H8 Keystore 错误区分 → H7 trash 树顺序对齐 → M2 摘要合并写 → M3 记回 TECH-DEBT → M29 导入覆盖兜底

**P2（体验与健壮性）**
M21 PWA service worker → M20 字体本地化 → M9 切 tab 生成拦截 → M11 流式 rAF 缓冲 → M24/M25/M26 → M5/M6/M7（因果消费/线状态提醒/归档提示，属产品迭代项可单独排期）→ 其余 MEDIUM/LOW 按顺带原则清

---

*方法论备注：8 agent 并行 find + 单源高危主会话亲手核实（gray-matter 真库复现 / delete_by_chapter 全仓 grep / _confidence 门控与 zod schema 逐行 / get_context_window 与 resolve_llm_config 双链比对 / atomicWrite 读码）。双源互证条目未重复验证。修复时建议沿用第一轮循环：修 → 独立对抗审 → 判别性回归测试（回退旧码即挂）→ 提交。*
