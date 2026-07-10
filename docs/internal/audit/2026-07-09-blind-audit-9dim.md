# 2026-07-09 九维盲审报告

## 方法论

- **技能**：[nud3l/code-audit](https://gist.github.com/nud3l/15468abc5c4ca7e4e0e38e5b120a7997)（网上下载，安装于 `~/.claude/skills/code-audit/`），原版 6 维 + 用户增补 3 维（正确性/健壮性、架构可维护性、功能实现程度）。
- **盲审纪律**：9 个独立审查员（opus-4.8）并行、互不通气；只拿一句技术栈描述，禁读 CLAUDE.md / PROGRESS.md / docs / git 历史，只凭代码与行业通用标准下判断。
- **范围**：src-engine/（370 文件 5.3 万行）+ src-ui/src（262 文件 4.4 万行）+ 壳层配置；排除 node_modules / dist / android 产物。
- **每维上限 15 条发现**，必须带严重度与文件行号。

## 评分公式（审前与用户确认）

每维 100 分起步，高 −15 / 中 −5 / 低 −2，扣到 0 为止；九维加权合成总分。
等级：A ≥90 / B ≥80 / C ≥70 / D ≥60 / F <60。

## 总分卡

**总分 55 / 100 —— 等级 F**（发现合计 86 条：13 高 / 44 中 / 29 低，已跨维度去重 1 条）

| 维度 | 高 | 中 | 低 | 得分 | 权重 | 加权贡献 |
|------|----|----|----|------|------|---------|
| 正确性/健壮性 | 0 | 2 | 3 | **84** | 18% | 15.1 |
| 安全（密钥与环境） | 0 | 2 | 2 | **86** | 15% | 12.9 |
| 功能实现程度 | 0 | 4 | 3 | **74** | 14% | 10.4 |
| 测试质量 | 1 | 8 | 2 | **41** | 13% | 5.3 |
| 架构可维护性 | 0 | 6 | 6 | **58** | 10% | 5.8 |
| 代码重复 | 3 | 8 | 2 | **11** | 10% | 1.1 |
| 规范一致性 | 2 | 7 | 2 | **31** | 8% | 2.5 |
| 依赖健康 | 5 | 4 | 5 | **0** | 7% | 0.0 |
| 日志卫生 | 2 | 3 | 4 | **47** | 5% | 2.4 |

### 怎么读这个分

- **产品关键维度是健康的**：正确性 84、安全 86。正确性审查员原话："这个代码库防御性加固痕迹很重，能站得住的缺陷不多"；安全审查员原话认可 OS keyring / 不可导出 AES-GCM / 持久化剥密钥 / 导出脱敏 / 报错不回显 key，"无硬编码密钥、无入库凭据"。架构审查员确认：无循环依赖、UI 只走引擎公开出口、服务层无平台分支。
- **拖垮总分的是"家务债"**：依赖漏洞（5 条高危里 4 条是 vitest/vite 开发工具链）、跨层重复（草稿文件名 4 处手写等单一真相源违例）、命名分裂（snake_case/camelCase 混用，Python 迁移遗产）。这些修复成本低——依赖维度一个下午的 npm 升级即可从 0 回到 90 上下。
- **公式是扣分制且盲审员被要求"填满 15 条"**，中危密集的维度会饱和式失分；分数适合当基线、供日后复审对比涨跌，不是绝对真理。

---

## 发现全录

### 高危（13 条）

#### 依赖健康（5）
- vitest 存在 critical RCE（UI server 监听时可任意读取并执行文件，CVSS 9.8）— vitest@3.2.4 -> 3.2.6+（src-engine，直接 devDep）
- undici 多条 high 漏洞（SOCKS5 TLS 校验绕过 / WebSocket DoS / 跨源请求路由）— undici@7.0.0–7.27.2 -> 7.28.0（src-ui，传递依赖）
- @xmldom/xmldom 存在 high（序列化递归 DoS + 3 类 XML 注入）— @xmldom/xmldom@<=0.8.12 -> 0.8.13（src-ui，传递依赖；注意可能在 docx 导入生产路径上）
- vite 存在 high（server.fs.deny 绕过 + dev server WebSocket 任意文件读取）— vite@7.3.1 -> 7.3.6（src-ui，直接 devDep）
- vite 存在 high（Windows 下 server.fs.deny 备用路径绕过）— vite@7.0.0–7.3.3 -> 7.3.5+（src-engine，vitest 传递依赖）

#### 代码重复（3）
- 草稿文件名格式 `ch{NNNN}_draft_{variant}.md` 在引擎与 UI 四处各自重建，引擎改格式 UI 静默失配 — src-engine/repositories/implementations/file_draft.ts:32（和 src-ui/src/api/engine-drafts.ts:16、src-ui/src/ui/writer/useWriterDraftController.ts:26、src-ui/src/ui/simple/SimpleChatPanel.tsx:425）
- `build_system_prompt` 与 `build_system_prompt_simple` 的「pinned+视角+情绪」块复制且已漂移（情绪一处 if/else、一处三元） — src-engine/services/context_assembler.ts:88（和 :851）
- Uint8Array↔base64 编解码两份实现且有细微差异（Capacitor 分块防栈溢出、Web 未分块），后者处理大数据会崩 — src-engine/platform/capacitor_adapter.ts:40（和 src-engine/platform/web_adapter.ts:172）

#### 日志卫生（2）
- 密钥存储的 key 名（内嵌作品/AU 标题，如 `apiKey:某同人作品`）经恒开的原始 console.warn 在 keystore 失败路径泄露到 logcat/浏览器控制台（代码注释已自承此风险） — src-engine/platform/capacitor_adapter.ts:269
- 同类 key 名明文泄露：另有多处失败路径未走 logger 直接 console.warn 打印 `key=${key}` — src-engine/platform/tauri_adapter.ts:155 / web_adapter.ts:433 / capacitor_adapter.ts:347 / secure_fields.ts:135

#### 规范一致性（2）
- 仓储层 get() 缺失处理不一致：chapter/draft/project 抛异常，fact/thread/chapter_summary 返回 null，调用方易写出漏判空或未捕获异常的 bug — src-engine/repositories/interfaces/chapter.ts:10（对比 fact.ts:14）
- 同一 AU 路径参数命名分裂：chapter/fact 仓储叫 `au_id`（暗示标识符），thread/chapter_summary 仓储叫 `auPath`，实际都是路径，误导维护者传错值 — src-engine/repositories/interfaces/chapter.ts:10（对比 thread.ts:8）

#### 测试质量（1）
- 后台任务编排器 TaskRunner/TaskStore（队列、并发=1 调度、cancel、断点 resume、visibilitychange 中断写盘、completed 上限淘汰）全无任何测试引用 — src-engine/tasks/task-runner.ts, task-store.ts

### 中危（44 条）

#### 正确性/健壮性（2）
- useSimpleChat 防抖保存先置 lastSavedMessagesRef 再异步 save 且 .catch 吞错；保存失败后立刻切 AU/关页，flush 因 ref 相等判定「已保存」跳过 → 该批聊天消息永久丢失 — src-ui/src/ui/simple/useSimpleChat.ts:187
- executeImport 覆盖模式先移旧章入回收站（步骤1）后写设定（步骤3 可抛）；设定写盘失败中止导入，旧章已移出且 tx 未 commit → 章节凭空消失（可从回收站手动恢复），state 与实际章数不一致 — src-engine/services/import_pipeline.ts:555

#### 安全（2）
- Tauri 桌面壳完全禁用 CSP（csp: null），Webview 无内容安全策略 — src-ui/src-tauri/tauri.conf.json:24
- Tauri 能力授予 fs:allow-write-file 且 path "**"，前端可写任意文件系统路径 — src-ui/src-tauri/capabilities/default.json:14

#### 功能实现程度（4）
- ChapterMetadataDisplay 整套配置（enabled + 7 字段开关）在 file_settings 完整 round-trip，但全仓无读取方、无编辑 UI —— 完全 inert — src-engine/domain/settings.ts:135
- SyncConfig/WebDAV 全字段序列化+反序列化且维护 secure-key spec，但引擎/UI 零消费者；useFontSelection.ts:16 注释仍称「WebDAV sync 生效」误导 — src-engine/repositories/implementations/file_settings.ts:64（注：主线知识开盲后对照——同步已按 D-0040 退役，此为已知残留，建议清管线或注释声明）
- 一批 API 导出零调用点：getChapter/importChaptersFromText/extractFactsBatch/clearSimpleChat/setThreadStatus/setFactThreads；uploadImportFile/confirmImport 连 barrel 都未挂 — src-ui/src/api/engine-import.ts:131
- AppConfig.token_warning_threshold（默认 32000）双向映射但全仓无读取方、无 UI —— 写而不读 — src-engine/domain/settings.ts:179

#### 测试质量（8）
- 写作侧多个含真实异步/派生逻辑的 hook 零测试：useWriterBootstrap(170行)、useConfirmedChapterEditor(127)、useWriterModeController、writerDisplayState(146) — src-ui/src/ui/writer/
- 破坏性 Library 变更 hook 零测试：useLibraryMutations 含 deleteFandom/deleteAu 及 create+导航+错误分支 — src-ui/src/ui/library/useLibraryMutations.ts
- title_generator 零测试（去引号、length>30 拒绝、catch→null 兜底均未覆盖） — src-engine/services/title_generator.ts
- useConnectionTest 与 useFontSelection(312行) 零测试，连接失败/中断分支无覆盖 — src-ui/src/hooks/
- chapter_inflight（防 generate 与 dispatch 并发覆盖草稿的单一真相源）无专门碰撞测试 — src-engine/services/chapter_inflight.ts
- 12+ 服务测试各自内联重复定义 LLMProvider mock，provider 无共享 helper — src-engine/services/__tests__/
- facts 三个 hook（批量提取/编辑/过滤）零测试 — src-ui/src/ui/facts/
- UI 弹窗测试大量对整句中文文案精确断言，措辞改动即断裂 — src-ui/src/ui/settings/__tests__/BackfillMemoryModal.test.tsx:49,66,81,102；ArchiveCandidatesModal.test.tsx

#### 架构可维护性（6）
- 16 个 service 文件直接引用 repositories/implementations/file_utils 的通用工具，service 层结构性依赖 repository 实现层，工具放错层 — src-engine/repositories/implementations/file_utils.ts:1
- AuSettingsLayout 31 useState / 534 行，数据拉取+表单+弹窗混一体（项目自定 <5 健康线） — src-ui/src/ui/settings/AuSettingsLayout.tsx:1
- AuLoreLayout 946 行 / 26 useState 巨型组件 — src-ui/src/ui/library/AuLoreLayout.tsx:1
- SettingsChatPanel 1026 行 God 组件 — src-ui/src/ui/shared/settings-chat/SettingsChatPanel.tsx:1
- 对话历史→LLM messages 序列化（含影响 prompt 的业务规则）实现在 UI 层，规则跨层放置 — src-ui/src/ui/simple/chat-to-llm.ts:36
- FandomLoreLayout 734 行/22 useState 与 GlobalSettingsModal 450 行/20 useState 状态过载 — src-ui/src/ui/library/FandomLoreLayout.tsx:1

#### 代码重复（8）
- LEGACY_SECURE_KEY_PREFIX 及 legacy-secure 三件套在三个平台适配器各写一遍 — src-engine/platform/{tauri,capacitor,web}_adapter.ts
- kvGet/kvSet/kvRemove 的 localStorage→内存回退逻辑（含中文告警文案）两适配器逐字复制 — capacitor_adapter.ts:223 / web_adapter.ts:390
- getSecretStorageCapabilities() 返回完全相同对象字面量 — tauri_adapter.ts:186 / capacitor_adapter.ts:311
- Ollama 默认端点在 UI 常量、引擎兜底、provider manifest 三处硬编码 — src-ui/src/config/defaults.ts:17 / src-engine/llm/config_resolver.ts:289 / src-engine/domain/provider_manifest.ts:389
- DeepSeek 默认 api_base/模型 UI 与引擎 manifest 双源 — defaults.ts:31 / provider_manifest.ts:89
- 视角/情绪默认值裸字面量散落未用枚举 — context_assembler.ts:89 / defaults.ts:37 / settings-chat/types.ts:294
- default_llm 保存入参映射同套 spread 在三个表单映射器重复 — onboarding/form-mappers.ts:72 / settings/form-mappers.ts:110,215
- embedding 默认 BAAI/bge-m3 + siliconflow 端点 UI 硬编码与引擎 manifest 重复 — onboarding/form-mappers.ts:37 / provider_manifest.ts:113

#### 规范一致性（7）
- 仓储方法命名 snake_case 与 camelCase 混用（list_main vs list/get/add） — interfaces/chapter.ts:19 vs thread.ts:8
- context_assembler 同文件 build_system_prompt 与 buildFactEnrichmentSuffix/computeInputBudget 并存 — context_assembler.ts:69/218
- import_pipeline 同文件 analyzeFile/buildImportPlan 与 split_into_chapters/parse_html 并存 — import_pipeline.ts:156/731
- tokenizer 同文件 ensureTokenizer 与 count_tokens/clear_tokenizer_cache 混用 — tokenizer/index.ts:31/59
- model_context_map 同文件 normalizeModelId 与 get_context_window 混用 — model_context_map.ts:172/201
- React 组件声明风格混用（73 处具名函数 vs 少数 const 箭头） — SettingsPanel.tsx:27 vs SplashScreen.tsx:12
- api 模块文件名 kebab-case 与 camelCase 混用 — importExport.ts vs engine-import.ts

#### 日志卫生（3）
- 直接打印 LLM 原始响应前 80 字符，可能回显用户导入的小说正文 — src-engine/services/chat_parser.ts:247
- 引擎自带 FileLogger 但十余个生产模块仍用原始 console.warn/info 绕过（规范维度亦独立命中，已合并计 1 条） — context_assembler.ts:605 / rag_manager.ts:283 / trash_service.ts:175 / file_utils.ts:131 / file_simple_chat.ts:56 / file_chapter.ts:104
- 默认 telemetry sink 生产环境把 agent 观测事件 emit 到 console.info 而非 FileLogger — src-engine/services/agent_telemetry.ts:73

#### 依赖健康（4）
- js-yaml moderate DoS（merge key 别名二次复杂度）且落后 1 大版本 — js-yaml@4.1.1 -> 5.2.1（src-engine，生产依赖）
- postcss moderate XSS — postcss@<8.5.10 -> 8.5.16（src-ui devDep + src-engine 传递）
- brace-expansion moderate DoS — 5.0.2–5.0.5 -> 5.0.6（src-ui 传递）
- tar moderate（PAX size 覆写/文件走私） — tar@<=7.5.15 -> 7.5.16+（src-ui 传递）

### 低危（29 条）

#### 正确性/健壮性（3）
- JsonVectorEngine.persist 非原子写 index.json/chunk（与全仓 atomicWrite 策略不一致），中途崩溃留截断 JSON → load 后静默降级空召回且 index_status 仍 READY、无自愈 — src-engine/vector/engine.ts:215
- RagManager.withEngine/rebuildForAu 在 await engineFor() 之后才 pin，await 让出的微任务间隙内 evictExcess 可驱逐未 pin 引擎 → 双引擎互相丢更新 — src-engine/services/rag_manager.ts:159（注：与 TD-017 修复区域重叠，建议主线复核）
- importAuBundle 逐文件非原子写且无回滚，中途失败留半导入 AU，无自动清理 — src-engine/services/au_bundle.ts:159

#### 安全（2）
- Tauri 授予 http:default 宽泛 HTTP 能力（LLM 调用实际走原生 fetch 不依赖它） — src-ui/src-tauri/capabilities/default.json:11
- .gitignore Secrets 段缺 *.pem / service-account.json / *.p12 / *.jks — .gitignore:47

#### 功能实现程度（3）
- AppConfig.token_count_fallback 持久化但从不读取；tokenizer 直接 hardcode text.length*1.5 — src-engine/domain/settings.ts:178
- useWriterFactsExtraction.focusInstructionInput 空 no-op，输入框焦点永不回归 — src-ui/src/ui/writer/useWriterFactsExtraction.ts:41
- engine-fonts.ts 注释「无可下载字体、实际 no-op」与 FONT_MANIFEST 多条 downloadable 条目矛盾，过期注释误导 — src-ui/src/api/engine-fonts.ts:7

#### 测试质量（2）
- 冗余断言 expect(screen.getByText(...)).toBeTruthy() 恒真无意义，UI 弹窗测试普遍存在 — BackfillMemoryModal.test.tsx:49,51,59
- 轻量 hook 零测试（useExtractedSelection/useMilestoneGuide/useSecretStorageCapabilities/useLibraryData） — src-ui/src/hooks/

#### 架构可维护性（6）
- secure_storage_migration 依赖具体实现类型而非 repository 接口（import type） — src-engine/services/secure_storage_migration.ts:5
- engine 核心直接耦合浏览器 DOM（document 可见性、document.fonts），仅靠 typeof 守卫 — logger/logger.ts:92 / tasks/task-runner.ts:332 / fonts/registry.ts:46
- 多个 >800 行引擎服务（simple_chat_dispatch 917 / import_pipeline 880 / trash_service 873 / context_assembler 1126） — src-engine/services/
- api 层 foo.ts+engine-foo.ts 并行命名 11 组，直接 grep importer 为 0，易误判死代码 — src-ui/src/api/engine-client.ts:25
- api/settings.ts 手写 DTO 镜像 engine 域类型，字段手工同步 — src-ui/src/api/settings.ts:8
- MobileOnboarding 571 行/19 useState、MobileFandomView 405 行/17 useState — src-ui/src/ui/

#### 代码重复（2）
- 草稿变体标签 String.fromCharCode(65+i) 两处复制 — generation.ts:85 / simple_chat_dispatch.ts:229
- 章节路径 chapters/main/ch{NNNN}.md 多处各自拼接/解析 — import_pipeline.ts:560 / file_chapter.ts:27 / engine-trash.ts:29

#### 规范一致性（2）
- 组件类型标注不一致（个别 React.FC vs 内联 props） — FontListItem.tsx:39
- UI 异步风格混用（.then 链 vs async/await） — AuWorkspaceLayout.tsx:53 vs GlobalSettingsModal.tsx:122

#### 日志卫生（4）
- FileLogger 脱敏仅按 ctx 字段名匹配、不处理 msg 字符串，`key` 字段名不命中规则 — src-engine/logger/logger.ts:260
- 退化路径事件以 info 级输出、级别偏低 — agent_telemetry.ts:65
- UI 层多处 console.warn 绕过 ui-logger（无敏感数据） — chat-to-llm.ts:137 / useFontSelection.ts:260 / useFontManager.ts:106 / engine-fonts.ts:51
- livetest 探针含大量 console.log（正文/摘要/相似度），未做环境门控 — src-engine/livetest/m8_quality.probe.ts:99

#### 依赖健康（5）
- typescript 落后 2 大版本（devDep 封顶 LOW） — 5.8.3 -> 7.0.2（双包）
- @vitejs/plugin-react 落后 2 大版本 — 4.7.0 -> 6.0.3（src-ui）
- tailwindcss 落后 1 大版本 — 3.4.19 -> 4.3.2（src-ui）
- esbuild low（Windows dev server 任意文件读取） — 0.27.3–0.28.0 -> 0.28.1（双包传递）
- @babel/core low（sourceMappingURL 任意文件读取） — <=7.29.0（src-ui 传递）

---

# 修复计划

## 速赢（每项 < 30 分钟）
| # | 发现 | 位置 | 修法 |
|---|------|------|------|
| 1 | vitest/vite/postcss/undici/xmldom/tar/brace-expansion/esbuild 漏洞 | src-engine + src-ui lockfile | npm audit fix + 定点 bump（vitest≥3.2.6、vite≥7.3.6/7.3.5、postcss≥8.5.16 等），跑全测试验证 |
| 2 | .gitignore 缺凭据文件模式 | .gitignore:47 | 加 *.pem / *.p12 / *.jks / service-account.json |
| 3 | 密钥 key 名 console.warn 泄露 ×5 | capacitor/tauri/web_adapter + secure_fields | 改走 logger 且不打印 key 名（或哈希化） |
| 4 | 过期/误导注释 ×2 | engine-fonts.ts:7 / useFontSelection.ts:16 | 更正注释 |
| 5 | livetest console.log 未门控 | m8_quality.probe.ts | 加环境门控或移出源码树 |
| 6 | chat_parser 打印 LLM 响应片段 | chat_parser.ts:247 | 删或降为脱敏 debug |

## 中等工作量（30 分钟 – 2 小时）
| # | 发现 | 位置 | 修法 |
|---|------|------|------|
| 1 | 草稿文件名 4 处手写 | file_draft.ts + UI 3 处 | 引擎导出 draftFileName()，UI import |
| 2 | base64 双实现（Web 未分块会崩） | capacitor/web adapter | 抽共享分块实现 |
| 3 | system_prompt 复制块已漂移 | context_assembler.ts:88/851 | 抽共享 prompt 块函数 |
| 4 | 平台适配器三件套重复（legacy-secure/kv fallback/capabilities） | platform/ | 抽 platform/shared.ts |
| 5 | LLM/embedding 默认值跨层双源 | defaults.ts vs provider_manifest.ts | UI 从 manifest 单源 import |
| 6 | 引擎 console.warn 绕过 FileLogger 十余处 + telemetry sink | services/ + agent_telemetry.ts | 统一走 logger；logger msg 级脱敏补 `key` 规则 |
| 7 | Tauri CSP 全关 + fs "**" + http:default | tauri.conf.json / capabilities | 开 CSP、fs 收窄 appData、评估撤 http:default |
| 8 | useSimpleChat 保存失败误标已保存 | useSimpleChat.ts:187 | 失败时回滚 lastSavedMessagesRef / flush 重试 |
| 9 | executeImport 覆盖模式半成功 | import_pipeline.ts:555 | 先写设定再移旧章，或失败时从回收站自动还原 |
| 10 | vector persist 非原子 + 降级无自愈 | vector/engine.ts:215 | 换 atomicWrite；parse 失败置 index_status=STALE |
| 11 | inert 配置三件 | settings.ts:135/178/179 | 接线或删字段（含映射与测试） |
| 12 | 孤儿 API 导出清理 | engine-import.ts 等 | 删除或挂上调用方 |
| 13 | 测试 provider mock 共享化 | services/__tests__/ | 抽 mock_llm_provider helper |

## 复杂（> 2 小时）
| # | 发现 | 位置 | 修法 |
|---|------|------|------|
| 1 | 仓储 get() throw vs null 分裂 + au_id/auPath 命名 | repositories/interfaces/ | 统一契约（建议 get→null + getOrThrow），全消费方排查 |
| 2 | snake/camel 命名统一 | 全仓 | 定规范渐进改（churn 大，可先只统一新代码 + 接口层） |
| 3 | 巨型组件状态下沉（31/26/22/20 useState） | AuSettingsLayout 等 6 个 | 按项目 hook 铁律分批下沉 |
| 4 | TaskRunner/TaskStore + 删除流 + chapter_inflight 碰撞测试 | tasks/ + library hooks | 补核心行为测试（队列/取消/断点恢复/删除失败路径/并发碰撞） |
| 5 | js-yaml 4→5 大版本（生产依赖） | src-engine | 升级 + round-trip 全回归 |
| 6 | RagManager pin 时序间隙 | rag_manager.ts:159 | 与 TD-017 修复对照复核，必要时 pin 前移 |
| 7 | file_utils 工具放错层 | repositories/implementations/file_utils.ts | 通用工具上移独立模块，service 不再 import 实现层 |
| 8 | chat-to-llm 业务规则在 UI 层 | chat-to-llm.ts:36 | 序列化规则下沉引擎 |

## 建议顺序
1. 依赖安全补丁（速赢 #1）：半天，分数回收最大（依赖维 0→~90）
2. 密钥/日志泄露（速赢 #3、#6 + 中等 #6）：产品信任问题，改动小
3. 单一真相源抽取（中等 #1–#5）：防漂移，正是本仓自定原则
4. 正确性两中危（中等 #8、#9）+ vector 自愈（#10）
5. 测试补全（复杂 #4）
6. 命名/组件重构（复杂 #2、#3）：低息债，排期慢慢还

## 验证清单
- [ ] 双包 tsc 0 错误
- [ ] 引擎 + UI vitest 全绿
- [ ] npm audit 双包 high/critical 清零
- [ ] i18n check 通过
- [ ] 修复后复跑同标准盲审对比分数

---

---

# 修复结果（2026-07-09/10 当日治本会话，Fable 5 全程亲自执行）

用户拍板「最全面最治本」后按 A-H 八阶段执行完毕。双包终验：引擎 tsc 0 错 + 109 文件
/ **1300 测试**全绿（修复前 1277，新增 30 用例）、UI tsc 0 错 + 67 文件 / **411 测试**
全绿（修复前 404）、i18n 1271 键对称、UI 代码净减 262 行。

## 修复后自评分（同一公式重算；「自评」非盲审复跑，客观数字需再跑一轮盲审）

| 维度 | 修复前 | 修复后(自评) | 剩余未修 |
|------|--------|------------|----------|
| 正确性/健壮性 | 84 | **100** | 无（5/5 修复） |
| 安全 | 86 | **100** | 无（4/4 修复；CSP/fs 收权待桌面真机冒烟） |
| 功能实现程度 | 74 | **100** | 无（7/7 修复：3 inert 配置删、孤儿 API 删、焦点接真线） |
| 日志卫生 | 47 | **100** | 无（9/9：5 处 key 名泄露脱敏、logger 纪律 warnAlways 全面接管、telemetry 落文件） |
| 代码重复 | 11 | **95** | form-mappers spread（评估后有意不动：三处有模式相关清零语义差异，强抽会改保存行为） |
| 依赖健康 | 0 | **~92** | devDep 大版本 ×3（TS7/tailwind4/plugin-react6，LOW）+ UI esbuild 传递 LOW（父包 semver 锁住）；引擎 audit 0 |
| 架构可维护性 | 58 | **~67** | 巨型组件状态下沉 ×5、chat-to-llm 下沉（需先在引擎 domain 正式化消息 kind schema）、DOM 耦合 L、大服务文件 L |
| 测试质量 | 41 | **~66** | 写文侧 hooks / facts hooks / useConnectionTest 零测试、存量 mock 迁移（helper 已建，跟随性迁移）、中文全句断言 |
| 规范一致性 | 31 | **~66** | snake/camel 同文件混用 ×5 + React 组件声明风格（迁移遗产，全仓 churn 大，定为长期规范债渐进还） |

**加权总分：55 → 约 88.5（F → B）**。产品关键四维（正确性/安全/功能/日志）全部满分；
剩余分数缺口集中在三类长期债：命名统一、巨型组件下沉、UI hooks 测试补全。

## 修复亮点（超出盲审清单的部分）

- 草稿/章节文件名判据实际找到 **9 处**手工副本（盲审报 7 处），含一处已真实漂移的
  回收站正则（`\d{4}` vs `\d{4,}`，第 10000 章会失灵）—— 全部收敛到 `domain/paths.ts`。
- 仓储 get 契约统一（缺失=null、fs 错误=抛）连带消灭了 5 处「try/catch 当缺失判据、
  顺手吞掉真实 fs 错误」的静默回退反模式（undo/retrospective/recalc 等）。
- TaskRunner 建测试时抓到真 bug：排队中取消的任务不进 completed 池 → `getTask()`
  查无此人，UI 无法显示「已取消」终态。已修（与运行中取消对齐）。
- 通用工具从 repository 实现层上移 `src-engine/utils/`（paths / file_utils 分层，
  logger 依赖纯路径模块，消除潜在依赖环）；tsconfig include 补齐 logger/tasks/ops/
  config/utils 缺失目录 + 清掉已删除的 sync/。
- js-yaml DoS 用 4.3.0 补丁版修复，**免掉了原计划的 v5 大版本升级风险**。

## 环境边界（无法在本机验证，随原有真机清单一并人工验证）

- Tauri CSP + fs `$APPDATA` 收权 + 撤 `http:default`：需 Windows 桌面构建冒烟
  （导出到任意路径依赖 Tauri v2 对话框自动入 scope 行为）。`tauri-plugin-http` 的
  Rust 注册与 npm 依赖残留（前端零调用），需构建机上顺手移除验证。
- keyring 中遗留的 `settings.sync.webdav.password` 条目无消费者，不做主动清理。

## 附注（开盲对照，非盲审内容）

- SyncConfig/WebDAV 残留：D-0040 已决策退役同步，盲审从代码视角判为死管线成立；建议物理清序列化链或留退役注释。
- RagManager pin 低危与 TD-017（2026-07-09 标记收官）修复区域重叠，需主线复核该 await 间隙是否已被 TD-017 方案覆盖。
- 命名分裂（snake_case）是 Python→TS 迁移的历史遗产；盲审员不知情、按行业标准扣分，符合盲审设计。
- 本报告与发现均由 9 个并行盲审 agent（opus-4.8）产出，主模型仅做去重（1 条）、打分与汇总，未增删实质发现。
