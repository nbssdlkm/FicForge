# 2026-07-11 九维盲审报告（第二轮）

## 方法论（与第一轮 2026-07-09 同口径）

- **技能**：`~/.claude/skills/code-audit/`（同第一轮），原版 6 维 + 用户增补 3 维。
- **盲审纪律**：9 个独立审查员（opus-4.8）并行、互不通气；只拿一句技术栈描述，禁读 CLAUDE.md / PROGRESS.md / docs / git 历史，只凭代码与行业通用标准下判断。**打分完成之前主模型未读第一轮报告**（防锚定），打分封板后才开盲对照。
- **范围**：src-engine/（排除 dist/node_modules/fonts）+ src-ui/src + 壳层配置（tauri.conf.json / capabilities / capacitor.config / vite.config），排除 android 产物。依赖维度用 general-purpose 在双包各跑 npm audit / npm outdated。
- **每维上限 15 条发现**，必须带严重度 + file:line + 具体失败场景。
- **口径差异披露（影响可比性）**：两轮指令同为「每维上限 15 条」，但第一轮报告自述盲审员实际被要求「填满 15 条」，本轮明示「宁缺毋滥」。两轮发现密度 86 → 39 条，既反映治理成效，也含审阅深度方差；**分数适合看趋势，不宜当绝对值**。另：盲审存在采样方差（同一族问题两轮可能点名不同实例），逐维对比时已按「族」归因。

## 评分公式（与第一轮完全一致）

每维 100 分起步，高 −15 / 中 −5 / 低 −2，扣到 0 为止；九维加权合成总分。
等级：A ≥90 / B ≥80 / C ≥70 / D ≥60 / F <60。跨维度重复的发现先去重再计分。

## 总分卡

**总分 84.1 / 100 —— 等级 B**（发现合计 39 条：1 高 / 19 中 / 19 低；跨维度去重复核后无同缺陷重复计分，仅标注 3 处同根机制，见发现全录内注）

| 维度 | 高 | 中 | 低 | 得分 | 权重 | 加权贡献 |
|------|----|----|----|------|------|---------|
| 正确性/健壮性 | 0 | 1 | 2 | **91** | 18% | 16.4 |
| 安全（密钥与环境） | 0 | 1 | 2 | **91** | 15% | 13.7 |
| 功能实现程度 | 1 | 1 | 1 | **78** | 14% | 10.9 |
| 测试质量 | 0 | 1 | 3 | **89** | 13% | 11.6 |
| 架构可维护性 | 0 | 4 | 2 | **76** | 10% | 7.6 |
| 代码重复 | 0 | 5 | 1 | **73** | 10% | 7.3 |
| 规范一致性 | 0 | 4 | 3 | **74** | 8% | 5.9 |
| 依赖健康 | 0 | 1 | 4 | **87** | 7% | 6.1 |
| 日志卫生 | 0 | 1 | 1 | **93** | 5% | 4.7 |

### 怎么读这个分

- **55/F → 84.1/B（+29.1），盲审对盲审的独立复测证实了 7/9–7/10 治理批次的有效性**。第一轮 13 条高危本轮只剩 1 条，且那 1 条本身是第一轮安全修复（Tauri fs 收权）的连带回归风险、修复会话当时已自标「待真机冒烟」。
- **上轮的重灾区全部大幅回升**：依赖 0→87、重复 11→73、规范 31→74、测试 41→89、日志 47→93。回升是真实工程投入（依赖漏洞双包清零、9 处文件名副本收敛单源、UI 测试 404→540、warnAlways 日志纪律），不是打分口径漂移——上轮发现在本轮的复现率接近零。
- **本轮扣分大头换了性质**：从「家务债存量」变成三类——①修复不彻底的残边（fandom get 契约漏网、redact 机制三面、TD-017 后同 AU 残余竞态、CSP connect-src 过宽）；②修复连带（fs 收权 vs 导出/遗留路径）；③上轮漏报的新发现（重复维 5 条中危全是新的）。
- 修复后自评 88.5 vs 本轮盲审 84.1：**自评偏乐观 4.4 分**，详见逐维对比末节。

---

## 发现全录

### 高危（1 条）

#### 功能实现程度（1）
- **桌面导出写入用户所选外部路径，被 Tauri fs 权限（仅 $APPDATA）拒绝，核心导出功能失效** — src-ui/src/ui/writer/ExportModal.tsx:30
  桌面端导出 save() 弹出保存对话框让用户任选路径（:20），随后用 @tauri-apps/plugin-fs 的 writeFile 写该路径（:30）。但 capabilities/default.json 的 fs:allow-write-file 仅授权 $APPDATA 与 $APPDATA/**。用户把稿件导出到桌面/文档等常规位置时，plugin-fs 写入被 scope 拒绝 → 落入 catch 返回 'error'（:32-35）→ 报错 toast，导出失败。对写作应用而言，把成稿导出到外部目录正是导出功能的主用途。
  *开盲对照注：成立与否取决于 tauri-plugin-dialog 是否自动把用户选中路径注入 fs scope——第一轮修复会话收权时已把此列为「环境边界，待 Windows 桌面构建冒烟」。本轮盲审从代码面独立把它顶为全场唯一 HIGH，等于把那条真机待办的优先级客观化：真机验证 OK 则此条撤销，不 OK 则为真 HIGH。*

### 中危（19 条）

#### 正确性/健壮性（1）
- **RagManager 对同一 AU 的并发向量写无引擎级互斥，persist 的孤儿分片 GC 会删掉并发写入的有效分片，导致 RAG/摘要向量静默丢失** — src-engine/services/rag_manager.ts:158
  withEngine 只做 pin（防 LRU 驱逐），不串行化对同一引擎的并发访问；indexChapter/removeChapter 被显式放在 withAuLock 之外调用（engine-chapters.ts:148/301/374/380、engine-state.ts:72 的 rebuildForAu）。同一 AU 上两个 RAG 写操作重叠（如 rebuildForAu 长跑期间又 confirm/编辑某章触发 indexChapter）时，二者共享同一 per-AU 引擎实例、并发改 this.chunks 并各自 persist；engine.ts persist 写完 index.json 后执行孤儿分片 GC（engine.ts:241-265），把不在本次 writtenRel 里的分片删除——操作 A 的 GC 删掉操作 B 刚写且仍被 B 的 index.json 引用的分片；load 时只 logCatch 跳过 → 该向量永久缺失于召回，全程无报错。
  *开盲对照注：TD-017 根治（per-AU 引擎 `16fdc5b`）消除的是跨 AU 竞态；本条是同 AU 并发写的残余竞态，属修复后的下一层缺口。*

#### 安全（1）
- **CSP connect-src 放行任意 http: 且 api_base 无 scheme 校验，明文 HTTP 端点会以明文传输 Bearer API key** — src-ui/src-tauri/tauri.conf.json:30
  用户把 LLM api_base 填成非 localhost 的明文地址（如社区中转 http://relay.example.com/v1）时，config_resolver.ts create_provider（:286）不校验 scheme，OpenAICompatibleProvider.headers()（openai_compatible.ts:329）照发 `Authorization: Bearer <apiKey>`，而桌面 CSP 的 connect-src 用通配 `http:` 放行任意主机（内置供应商仅 Ollama 用 http://localhost，其余全 https，通配 http: 对远端属过宽）。API 密钥在明文链路上可被同网段/中间人窃听，无任何拦截或告警。

#### 功能实现程度（1）
- **旧数据兼容分支把 dataDir 设为相对 './fandoms'，落在 $APPDATA 写权限范围外，迁移用户全盘无法保存** — src-ui/src/App.tsx:74
  启动时检测到旧数据（./fandoms/settings.yaml 存在且 $APPDATA 下无 settings.yaml）会把 dataDir 设为 './fandoms'，随后引擎、日志、章节、设定、facts 全部以该路径为根写盘；但 fs:allow-write-file 仅授权 $APPDATA/**，兼容迁移模式下所有写操作被 scope 拒绝。AppConfig.data_dir 默认值恰为 './fandoms'（domain/settings.ts:154），存在真实旧用户。触发面窄但触发即等于兼容模式整体不可写。*（与上条 HIGH 同根：fs 收权 × 存量路径假设。）*

#### 测试质量（1）
- **性能基准用硬编码墙钟阈值当正确性断言，在默认测试套件里会非确定性 flaky** — src-engine/vector/__tests__/benchmark.test.ts:68
  :68/88/108 断言真实余弦检索耗时 <50ms（5000×384 向量）、<20ms（1000×384）、<50ms（带 char_filter）；该文件匹配 vitest include，随每次 `vitest` 跑。慢/高负载/冷 JIT/ARM 的 runner 上 ~190 万次乘加+sqrt+排序可轻易超阈 → 断言失败、整套测试变红，但无任何代码回归；embedding 还用未播种 Math.random()。性能基准伪装成 pass/fail 单测。

#### 架构可维护性（4）
- **dispatch_simple_chat 是 471 行的上帝函数（439-910），把并发闸/provider 解析/工具循环/事件翻译揉在单个 async generator 里** — src-engine/services/simple_chat_dispatch.ts:439
  新增事件类型或改工具循环接线须在 470 行、大量共享闭包（doneTextReceived / draftId / thinkingCleared 等）的函数体里改动；:818 的大 switch 事件翻译与循环 setup 强耦合，任何改动都要通读全函数，无法对子职责做单元测试。
- **工具名契约在引擎 schema 与 UI 执行器两处各自硬编码字符串字面量，无共享常量，单一真相源破坏** — src-ui/src/ui/shared/settings-chat/execute-settings-tool.ts:338（对 src-engine/domain/settings_tools.ts:81）
  引擎用 name:"add_fact" 声明工具、UI 用 if (toolName === "add_fact") 分派执行，两处独立字面量。改名只改引擎 schema 时 UI 的 if 链永远匹配不到 → LLM 工具调用静默落空、TypeScript 无编译错误。该模式覆盖约 15 个工具。
- **SimpleChatPanel 838 行上帝组件：13 个本地 useState + 编排 5 个 hook + 手工 12 字段 reset effect** — src-ui/src/ui/simple/SimpleChatPanel.tsx:66
  组件持有 13 个 useState（78-93）并在 auPath 切换时用手写 12 行 reset 块（102-115）逐个清空；新增面板状态若忘补 reset 块，AU 切换后旧状态残留 → 跨作品串状态。startDispatchForUserInput（:210）是塞满闭包的巨型回调，五个 hook 的编排全压在本组件内。
- **自定义 hook 普遍对外暴露裸 setState（11+ 个 hook），状态不变量与其 reset/校验逻辑跟消费者分离** — src-ui/src/ui/writer/useWriterFactsExtraction.ts:230
  useWriterFactsExtraction 返回 7 个裸 setter（230-242），useFactEditor 7 个（:106）、useFactsFilter 6 个、useSimpleChat 5 个。消费者可从任意处直接 setX 改 hook 私有状态，绕过不变量维护；重构 hook 内部状态结构会同时打断所有消费者。

#### 代码重复（5）
- **「提取候选→事实入库」字段映射在 4 处手写并已实际漂移** — src-ui/src/ui/writer/DirtyModal.tsx:118（和 useWriterFactsExtraction.ts:134、useFactsExtraction.ts:181、api/engine-chapters.ts:520）
  同一段 candidate→fact payload 映射在 4 处各写一份且已漂移：DirtyModal 写 content_raw: c.content_raw（缺 `|| c.content_clean` 兜底）且 timeline: c.timeline||''，其余三处有兜底且条件展开 timeline。→ 候选 content_raw 为空时，脏章确认路径存入空 content_raw，其他入口存 content_clean，同一功能不同入口落库数据不一致；注释里反复出现「caused_by 此前在此丢」正是该复制块历史漂移的证据。应抽 buildFactDataFromCandidate(c)。
- **isAbortError 判据 5 处各写一份且语义不一致** — src-engine/services/agent_loop.ts:126（和 llm/openai_compatible.ts:15、backfill_memory.ts:18、generation.ts:307 内联、simple_chat_dispatch.ts:877 内联）
  agent_loop / openai_compatible / generation / simple_chat 要求 `instanceof DOMException || instanceof Error` 才认取消，backfill_memory 纯鸭子类型判 `.name === 'AbortError'`。→ 取消对象是普通对象（或跨 realm 使 instanceof 失效）时，backfill 判「干净取消」而生成/agent 路径判「真失败」走 partial-rescue，同一取消在不同模块分类为成功 vs 失败。应抽 utils 单一 isAbortError。
- **「生成→草稿持久化」块在 generation 与 simple_chat_dispatch 复制粘贴** — src-engine/services/simple_chat_dispatch.ts:604（和 generation.ts:271-294）
  createGeneratedWith(9 字段) + createDraft + `withAuLock(...draft_repo.save)` 逐字段重复。GeneratedWith 增字段或加锁策略变更须两处手工同步，漏改则对话路径与写文路径的草稿元数据/并发保护不一致。应抽 persistGeneratedDraft()。
- **每模型 contextWindow / maxOutputTokens 在两个文件各维护一份** — src-engine/domain/provider_manifest.ts:96（和 model_context_map.ts:20/108）
  MODEL_CONTEXT_MAP/MODEL_MAX_OUTPUT 已列各模型 ctx/out，provider_manifest 的 recommendedModels 又为同一批 ~12 个模型重复硬编码，注释自认「与 MODEL_CONTEXT_MAP 同源同值」。→ 官方口径变化只改一处即静默漂移；同一模型经 findRecommendedModel 命中取 manifest 值、fuzzy 未命中取 map 值，预算计算随命中路径而变。
- **两个「接受提取候选入库」hook 整体近重复** — src-ui/src/ui/facts/useFactsExtraction.ts:178（和 writer/useWriterFactsExtraction.ts:122-151）
  接受流程整段近乎逐行相同：filterSelected → savedCandidatesRef 过滤 pending → map 成 BatchFactInput → addFactsBatch → writtenIndices 逐条登记；仅章号归属一行不同。半成功登记、批量单锁 CAS、writtenIndices 错位修复等易错逻辑各维护一份，修 bug 须手工同步。应抽 useAcceptExtractedFacts(attributionFn)。*（与上面「4 处映射」条范围部分重叠但修点不同：一为 payload 映射单源，一为整段流程合流；计分各算。）*

#### 规范一致性（4）
- **仓储 get() 的「未找到」契约不统一：fandom 抛异常，而 project/chapter/fact/thread/draft 均返回 null** — src-engine/repositories/implementations/file_fandom.ts:29
  file_project 注释明确写「fs 错误照抛，get 契约，盲审 2026-07-09 全仓储统一」，唯独 fandom.get() 对不存在路径直接 throw（接口签名 interfaces/fandom.ts:10 也返回非空）。按统一 null 契约编写的调用方用 get() 探测存在性时会未捕获崩溃。*（开盲对照注：第一轮高危「get 契约分裂」的修复漏网成员。）*
- **引擎导出函数命名 snake_case 与 camelCase 系统性混用（约 49:53），7 个 service 文件同文件内混用** — src-engine/services/context_assembler.ts:239
  同一「build」动词既有 build_system_prompt(:107)、build_facts_layer(:292) 又有 buildFactEnrichmentSuffix(:239)；facts_extraction.ts 有 buildCharacterInfoBlock(:52) 与 extract_facts_from_chapter(:281)。无法按单一命名约定 grep/自动补全。*（存量长期债，上轮已报、拍板渐进还。）*
- **同一概念「章号」在同一文件内既写 chapter_num 又写 chapterNum，且与其它仓储接口的参数命名相左** — src-engine/services/chapter_summary.ts:99
  生成类函数用 chapter_num（:25-92），索引/保存 deps 用 chapterNum（:99-142）；ChapterSummaryRepo 接口全用 chapterNum，兄弟接口 ChapterRepo/DraftRepo/OpsRepo 同参数用 chapter_num。跨仓储调用易传错，静态类型不报。
- **tasks/ 是全引擎唯一使用 kebab-case 文件名 + class 风格的目录，偏离 snake_case 自由函数的层内约定** — src-engine/tasks/task-runner.ts:51
  引擎 139 个非测试源文件里唯一 kebab-case 全集中在 tasks/（task-runner.ts、task-store.ts、impl/facts-extraction-task.ts），且用 export class 风格而其余 services 几乎全是自由函数。新增任务实现时规范无单一真相源。

#### 依赖健康（1）
- **引擎运行时动态 import 的平台依赖全部误列为 devDependencies（成规模的声明错误）** — src-engine/package.json:29
  platform/tauri_adapter.ts:29 与 capacitor_adapter.ts:312 在运行时 await import("@tauri-apps/plugin-fs") / import("@aparajita/capacitor-secure-storage")，@tauri-apps/api、plugin-dialog、@capacitor/filesystem 亦运行时动态 import；但这 5 个包全部声明在 devDependencies（:26-35）。引擎以 --omit=dev 安装或被独立消费时，平台适配器运行时 module-not-found；当前仅因 private:true + src-ui 源码消费 + src-ui 自带同名依赖而被掩盖。

#### 日志卫生（1）
- **LLM 错误路径把提供商原始响应体片段经 err.message 写入可导出的诊断日志，且脱敏拦不住** — src-engine/llm/openai_compatible.ts:111
  generate() 失败时 getLogger().error("llm", "generate failed", { error: err.message })；未归类 HTTP 错误的 err.message 由 handleError 构造（:542-543）并嵌入 extractErrorDetail(bodyText)——提供商响应体前 200 字符（:460/462）。FileLogger 的 redactCtx 只按 ctx key 名脱敏（logger.ts:55/59/264），不扫字符串值，ctx.error 里的响应体原样落进 .ficforge/logs/*.jsonl——正是「导出日志」打包给用户分享的对象。自定义网关若在 4xx 错误体里回显所提交的 API key，密钥即明文入日志随导出外泄。settings_chat.ts:146 同模式。*（同根注：与安全维 tauri_adapter:156、本维 logger.ts:269 共享「redactCtx 只按字段名匹配」机制根因，但三条缺陷位置与修点不同，分开计分。）*

### 低危（19 条）

#### 正确性/健壮性（2）
- **标准章节切分把『第X章』『Chapter N』『第X节』三种标题正则合并同一匹配集，同时含章/节的文档被过度切分** — src-engine/services/chapter_splitter.ts:45
  trySplitByStandardHeaders(101-107) 把三个 pattern 全部匹配合并按位置排序当章边界（非「先章后节」降级）。导入「第X章」作章、「第X节」作场景小节的小说（5 章各 3 节）→ 切成约 20 个「章」，正文碎片化、章节号错位。
- **dirty resolve 先提交章节/state 再应用 fact 变更，fact 变更抛错时形成半成功且无法经同路径重试** — src-engine/services/dirty_resolve.ts:124
  tx.commit(:121) 成功后章节已置 clean 并移出 dirty；步骤6 applyFactChanges(:124) IO 错误抛出 → UI 提示失败，但重试在前置校验 `!chapters_dirty.includes()` 直接抛「章节不在 dirty 列表中」——用户看到失败提示，章节却已标记解决，勾选的 fact 变更丢失、只能另走 Facts 面板手工补。

#### 安全（2）
- **日志脱敏被 error 字段绕过：keyring 故障时把内嵌作品/AU 名的未脱敏 secure key 写进可复制的日志** — src-engine/platform/tauri_adapter.ts:156
  Rust 端 secure_store.rs:24 把原始 key 拼进错误串；tauri_adapter.ts:154-157 用 key_redacted 脱敏了 key 字段，却把错误串原样放进 ctx.error；redactCtx 按字段名匹配、`error` 不命中 → 含用户作品/AU 标题的完整 key 名进入日志，经 DebugLogsSection「复制日志」流向剪贴板/support。泄漏的是 key 名（作品标题）非密钥值。*（同根注：redactCtx 机制缺口，见日志维中危。）*
- **Capacitor secureDebug 日志把含作品/AU 名的原始 secure key 明文打进 console/logcat（受调试开关门控）** — src-engine/platform/capacitor_adapter.ts:233
  置 `__FICFORGE_SECURE_DEBUG__ = true` 后每次 secureGet/Set/Remove 以 console.info 打印 `key=apiKey:<作品名>`（233/250/261/272/279）。生产 Android 构建进 logcat。默认关闭且只泄 key 名，但与失败路径已强制 redactSecureKey 的口径不一致。

#### 功能实现程度（1）
- **SIMPLE_MUTATING_TOOLS 声明 core_character 工具为可确认修改类，但 UI 执行器无对应实现、确认即报 unsupported** — src-engine/services/simple_chat_dispatch.ts:97
  SIMPLE_MUTATING_TOOLS（90-99）把 create/modify_core_character_file 列为已知可确认工具且有 zod schema（不被幻觉守卫拦截、会出可确认 ToolCallCard），但 get_tools_for_mode('simple')（settings_tools.ts:328）不下发这 2 个工具、useSimpleToolExecutor 也未实现（fall-through 抛 unsupportedTool，:304）。LLM 幻觉出该工具时用户点「确认」→ 报「不支持的工具」。

#### 测试质量（3）
- **AU 锁的并行性用墙钟 elapsed 判定，阈值过紧易 flaky** — src-engine/services/__tests__/au_lock.test.ts:97
  :97 用 `elapsed<35ms` 区分并行/串行（仅 15ms 余量）、:52 用 `<50ms`，均真实 setTimeout。CI timer coalescing 下锁行为完全正确也会 spurious fail。应改事件时序/计数断言。
- **ops 快照/归档模块 checkAndSnapshot 的 watermark 增量逻辑零测试覆盖** — src-engine/services/snapshot.ts:87
  50 章触发边界(:48)、幂等跳过(:52)、watermark 增量 slice(:87)、快照损坏回退(:81-83) 全无测试。当前未 barrel 导出（M6 接入后启用）暂休眠；一旦接线，off-by-one 即静默重复/漏归档 ops 而无测试能捕获。
- **WriteTransaction 的 facts/drafts 失败分支与其核心写序保证未被断言** — src-engine/services/write_transaction.ts:229
  测试只在 chapters/state 注入写失败，facts(:210)/drafts(:229) 分支从未注入；且无测试断言 ops→chapters→facts→drafts→state 的实际落盘顺序。写序被未来改动打乱时现有测试无法发现。

#### 架构可维护性（2）
- **引擎公共出口用 export * 无边界导出整个 services 层（99 个符号）** — src-engine/index.ts:95
  对 services/domain/tasks/ops 全部 export *，每个内部服务函数都是公共 API，UI 可 import 任意深层服务；无法界定稳定对外契约，重构内部 helper 即意外破坏性变更。
- **用整数版本计数器（externalChaptersVersion / milestoneRefreshKey）作跨组件临时事件总线，隐式耦合** — src-ui/src/ui/workspace/AuWorkspaceLayout.tsx:59
  WriterLayout 常驻挂载后靠递增 externalChaptersVersion（59-63）通知重载；任何新的改章入口必须记得调 refreshChaptersExternal 而非裸 refreshChapters，否则常驻面板显示过期章节列表。约束仅存在于注释，类型系统不强制。

#### 代码重复（1）
- **yaml.dump 序列化选项字面量散落 7+ 个仓储文件** — src-engine/repositories/implementations/file_state.ts:44
  `{ sortKeys: false, lineWidth: -1 }` 在 file_state:44/60、file_project:91/155、file_fandom:50、file_settings:132/159、file_simple_chat:114/139、trash_service:863 各自手写。统一调整 YAML 输出须逐文件改十余处。应抽 dumpYaml(obj)。

#### 规范一致性（3）
- **api/ 层命名混杂：settingsChat.ts 是唯一 camelCase 复合词裸模块** — src-ui/src/api/settingsChat.ts:1
  其余裸模块全单词小写（chapters/facts/settings/trash/fandoms），引擎侧全 kebab；另有 fandoms.ts(复数) 与 engine-fandom.ts(单数) 不一致。新增 API 模块无可依据的单一约定。
- **UI 用 any 绕过引擎已导出的 BudgetReport 类型，至少 5 处（含 useState<any>）** — src-ui/src/ui/writer/useWriterDraftController.ts:86
  引擎已导出 BudgetReport 且 generation.ts 产出强类型，UI 侧 useWriterDraftController.ts:86/186、writerDisplayState.ts:34、WriterSidePanelContent.tsx:32、useWriterGeneration.ts:57/146 一律 any。字段改名 UI 得不到编译期报错。
- **UI catch 子句风格四分：catch(err)/catch(e)/catch(e: unknown)/catch(e: any) 并存** — src-ui/src/ui/library/useFandomLoreEditor.ts:97
  catch(err) 36 处（主导）、catch(e) 11、catch(e: unknown) 6、catch(e: any) 8；useFandomLoreEditor 同文件 4 个错误分支全用 catch(e: any)，在错误处理场景把 any 重新引回。

#### 依赖健康（4）
- **src-ui 传递依赖 esbuild 0.27.4 命中 GHSA-g7r4-m6w7-qqqr（dev server 任意文件读取，low）** — esbuild@0.27.4 (0.27.4 -> 0.28.1)
  经 vite/vitest 传递，仅影响开发环境（Windows + 不可信网络），CVSS 2.5，fixAvailable。*（上轮已知残留，被父包 semver 锁住。）*
- **src-ui 对 4 个 @tauri-apps/* 包使用过松的裸 ^2 范围，且与引擎的精确 pin 不一致** — src-ui/package.json:24
  @tauri-apps/api、plugin-http、plugin-opener、cli 声明为裸 ^2（引擎同名包 pin ^2.10.1）。lockfile 缺失/过期时 ^2 可静默拉入行为变化的新 minor 并造成双包漂移。
- **生产依赖 js-yaml 落后 1 个 major、lucide-react 落后 17 个 minor** — js-yaml@4.3.0 (4.3.0 -> 5.2.1)
  js-yaml 停在 4.3.0（安全补丁版，有意规避 v5 大版本迁移风险）、lucide-react 1.7.0 -> 1.24.0。长期停留累积升级债。
- **同一 monorepo 内 vitest 跨包大版本分裂（引擎 3.x vs UI 4.x）** — src-engine/package.json:35
  引擎 vitest ^3.2.7、UI ^4.1.4，两个不同大版本的测试运行器，config/API 差异、工具链双份维护。

#### 日志卫生（1）
- **日志 ctx 脱敏函数不递归进数组，数组内的敏感字段绕过掩码** — src-engine/logger/logger.ts:269
  redactCtx 仅对非数组对象递归（:269），数组值原样保留（:272）。当某 ctx 字段值是含 authorization/api_key 的对象数组时完全绕过脱敏。当前无生产调用命中此形态，属脱敏控件自身的防御性缺口。*（同根注：redactCtx 机制缺口第三面。）*

---

## 与第一轮逐维对比（打分封板后开盲）

### 分数对照

| 维度 | R1 盲审(07-09) | R1 修后自评 | R2 盲审(07-11) | 盲审Δ | 自评偏差 |
|------|------|------|------|------|------|
| 正确性/健壮性 | 84 | 100 | **91** | +7 | 自评高 9 |
| 安全 | 86 | 100 | **91** | +5 | 自评高 9 |
| 功能实现程度 | 74 | 100 | **78** | +4 | 自评高 22 |
| 测试质量 | 41 | ~66 | **89** | +48 | 自评低 23 |
| 架构可维护性 | 58 | ~67 | **76** | +18 | 自评低 9 |
| 代码重复 | 11 | 95 | **73** | +62 | 自评高 22 |
| 规范一致性 | 31 | ~66 | **74** | +43 | 自评低 8 |
| 依赖健康 | 0 | ~92 | **87** | +87 | 自评高 5 |
| 日志卫生 | 47 | 100 | **93** | +46 | 自评高 7 |
| **加权总分** | **55 / F** | **~88.5 / B** | **84.1 / B** | **+29.1** | **自评高 4.4** |

注：自评时点为 07-09/10 修复会话收尾；其后至本轮盲审之间又落地了长期债②（六大组件下沉）③（UI hooks 测试 102 用例）④（chat-to-llm 下沉）⑤（TS7/tailwind4/plugin-react 升级）与 07-10 五路合并审阅修复，故「自评低」的三维（测试/架构/规范）部分是后续工作的功劳，不全是自评保守。

### 逐维归因

**正确性 84→91（+7）**：上轮 2M+3L（聊天保存回滚、导入顺序、向量原子写、pin 前移、bundle 清理）全修，本轮零复现。本轮 1M 是 TD-017 根治后的下一层缺口（per-AU 引擎消除跨 AU 竞态，但同 AU 并发写 + 孤儿分片 GC 的残余竞态仍在）——归因**修复不彻底（新层次）**；2L（章节过切、dirty_resolve 半成功）为**上轮漏报**。

**安全 86→91（+5）**：上轮 4 条（CSP null、fs "**"、http:default、gitignore）全修零复现。本轮 1M（connect-src 通配 http:）是开 CSP 时为 Ollama localhost 放行整个 http: scheme 的**修复残边**；2L 分别是 key 名泄露修复的 error 字段**漏网面**与修复期新增 secureDebug 调试通道的**口径不一致**。

**功能 74→78（+4）——涨幅最小、含全场唯一 HIGH**：上轮 7 条（inert 配置、孤儿 API、焦点 no-op、注释）全修零复现。本轮 1H+1M 同根于上轮安全修复的 fs 收权 × 导出/遗留路径组合——**修复连带，待真机裁决**（修复会话当时已自标环境边界，本轮盲审把该待办的优先级客观化）；1L（core_character 半接线）为**上轮漏报**。

**测试 41→89（+48）——涨幅第二**：上轮 1H（TaskRunner）+8M（hooks 零测试、mock 重复、全句断言）经 TaskRunner 12 用例、长期债③ 102 用例、长期债② 各组件回归测试、mock helper 落地，本轮零复现；UI 测试 404→540、引擎 1277→1315，涨分是真实投入。本轮 1M+3L（benchmark/au_lock 墙钟、snapshot 零覆盖、write_transaction 写序）全部**上轮漏报**。

**架构 58→76（+18）**：上轮 6M（五大组件 + file_utils 层违规）+ chat-to-llm 跨层经长期债②④落地，零复现。本轮 4M：SimpleChatPanel 是巨型组件家族**仅剩的存量成员**（上轮漏报）；dispatch_simple_chat 上轮以「大服务文件」低危计、本轮**升格中危**；execute-settings-tool 工具名双字面量为**上轮漏报**（注意该文件正是长期债②第三块新抽出的模块，抽取时未建共享常量）；hooks 裸 setter 为**上轮漏报**——盲审员不知项目自家 hook 铁律仍独立命中同一问题，点名的 4 个 hook 均是未被长期债②覆盖的存量。2L 中版本计数器事件总线是 07-07 审计修复引入的常驻挂载结构的**已知代价被独立指认**。

**重复 11→73（+62）——涨幅第三**：上轮 3H+8M+2L 几乎全修（9 处文件名副本收敛 domain/paths、适配器共享层、默认值单源、prompt 块共享；form-mappers 有意不动），零复现。本轮 5M+1L **全部上轮漏报**——其中 candidate→fact 映射 4 处已实际漂移（DirtyModal 缺兜底是真实数据不一致隐患）、isAbortError 5 处语义漂移。自评 95 vs 盲审 73 的落差说明：**自评只能对已知清单打分，新一双眼睛就能找到新一批重复**——该维度宜建 lint/CI 防线而非依赖人肉扫。

**规范 31→74（+43）**：上轮 2H 之一「get 契约分裂」已统一修复但**漏了 fandom 仓储**（本轮 1M 复现，file_project 注释自证统一意图而 file_fandom 仍 throw——修复不彻底的典型样本）；au_id/auPath 命名分裂未再被点名。snake/camel 混用 2M 为**存量长期债**（上轮已报、拍板渐进还）；tasks/ 风格孤岛 1M 与 3L（settingsChat 命名、BudgetReport any、catch 四分）为**上轮漏报/同族新实例**。

**依赖 0→87（+87）——涨幅最大**：上轮 5H+4M 漏洞全清（audit 双包 high/critical 归零、js-yaml 免大版本），本轮 audit 仅剩 esbuild dev-only LOW（**上轮已知、父包锁住**）；TS/tailwind/plugin-react 落后大版本已在长期债⑤升级、本轮未再被扣。本轮 1M（运行时平台依赖误列 devDependencies）为**上轮漏报的新类别**；vitest 3/4 跨包分裂疑似升级修复的**连带残留**（报告无从确证）。

**日志 47→93（+46）**：上轮 2H+3M（key 名泄露×5、响应打印、console 绕过×10、telemetry sink）全修零复现，warnAlways 纪律被本轮侧面确认（裸 console 类发现归零）。本轮 1M+1L 同根于上轮低危已点到的「redact 只按字段名匹配」机制缺口——上轮命中 msg 字符串面，本轮发现 err.message 响应体面与数组递归面——归因**修复不彻底（机制根因未收敛，逐面打补丁）**。

### 归因总表（39 条）

| 归因 | 条数 | 代表 |
|------|------|------|
| 修复连带 / 新引入 | 6 | 导出 fs scope(H)、'./fandoms'(M)、CSP connect-src(M)、secureDebug(L)、版本计数器总线(L)、vitest 分裂(L,疑似) |
| 修复不彻底 / 同根残留 | 5 | fandom get(M)、TD-017 同 AU 残余(M)、err.message 入日志(M)、error 字段绕脱敏(L)、redact 数组面(L) |
| 存量长期债（上轮已报未修，按计划渐进还） | 5 | snake/camel ×2(M)、settingsChat(L)、js-yaml major(L)、esbuild(L) |
| 上轮漏报的新发现 | 23 | 重复维 5M+1L 全部、测试维 4 条全部、devDeps 误列(M)、工具名 SSOT(M)、裸 setter(M)、SimpleChatPanel(M) 等 |

### 结论

1. **55 → 84.1（F → B），盲审对盲审 +29.1**：7/9–7/10 治理批次（当日治本 A-H + 长期债②③④⑤ + 五路合并审阅）的有效性被独立复测证实；上轮 86 条发现在本轮的复现率接近零（复现仅 fandom get 一条 + 存量长期债）。
2. **自评 88.5 高估 4.4 分**，高估集中在自评满分的功能（−22）与重复（−22），被测试（+23，含自评后落地的工作）部分抵消。方向教训：**自评对「已修清单」可信，对「未知未知」（新重复、修复连带）系统性盲视**。
3. **全场唯一 HIGH + 功能维 1M 同根于上轮安全收权修复**，且修复会话已自标待真机验证——「Tauri 收权冒烟」待办应升为最高优先级，它同时裁决本轮最重的两条发现。
4. **修复不彻底类 5 条的共同模式**：宣称「统一/全仓」的机制修复（get 契约、redact 脱敏）漏了个别成员或个别面——此类修复需配 grep 全量核对清单收尾，不能逐点打补丁。
5. **重复维「修一批、还能找到一批」**（两轮合计 13M+3H 都真实成立）：宜引入 CI 层防线（jscpd/dupe-lint + 关键判据单源 lint 规则），人肉扫已证明不收敛。

---

## 附注

- 本报告与发现均由 9 个并行盲审 agent（opus-4.8）产出（正确性、功能两员各经一次 stall 自动重试），主模型仅做去重复核（0 条跨维度合并，3 处同根机制标注）、打分与汇总，未增删实质发现。打分完成前主模型未读第一轮报告。
- 发现只报告不修，等用户拍板。
