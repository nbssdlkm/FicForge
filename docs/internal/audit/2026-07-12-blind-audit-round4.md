# 2026-07-12 九维盲审报告（第四轮）

## 方法论（与前三轮完全同口径）

- **技能**：`~/.claude/skills/code-audit/`（同前三轮），原版 6 维 + 用户增补 3 维（正确性 / 功能实现程度 / 架构）。
- **盲审纪律**：9 个独立盲审员（opus）并行、互不通气、一人一维；只拿一句结构事实描述（两包目录形状 + 文件规模），禁读 CLAUDE.md / PROGRESS.md / docs / git 历史 / 任何 audit 报告，只凭 src-engine/ 与 src-ui/ 源码和行业通用标准下判断。**打分封板之前主审未读任何历史报告**（防锚定），封板后才开盲对照。
- **范围**：src-engine/（排除 dist/node_modules）+ src-ui/src + 壳层安全配置（tauri.conf.json / capacitor.config.json 仅安全维）+ 双包 package.json/lockfile（依赖维在两包各跑 npm audit / npm outdated）。
- **每维上限 15 条发现**，必须带严重度 + file:line + 证据 + 建议；审员报告前强制回读所引行核验，「宁缺毋滥」（与 R2/R3 同口径）。
- **主审核验**：3 条 HIGH 全部经主审逐行回读实证坐实（无 lint 工具链——find 全仓零配置 + 双 package.json 零 lint 脚本 + devDeps 未装；snake/camel 混用——config_resolver.ts 同文件混用 + 引擎 export 函数 snake 84 vs camel 264；UI lore 直连 adapter——engine-lore.ts:45-53 手拼路径 + adapter.mkdir/writeFile）。另处理两起审员输出异常：①架构审员引述「CLAUDE.md hook 规则 5」的盲区泄漏嫌疑——排除，源码注释本身多处自带该措辞（useAuSettingsForm.ts:49、backfill_memory.ts:63 等），属盲区内合法习得；②日志审员附注「eslint no-console 强制生效」与规范维矛盾——裁定规范维正确（全仓无 linter，eslint-disable 注释是装饰性的），日志维该附注为推断错误但不影响其发现本身。
- **跨维度去重复核**：0 条同缺陷重复计分；3 处同根/同族标注（frontmatter 双正则 × 绕 safeMatter、规范维引号/组件风格 × 无 lint 工具链根因、正确性 atomicWrite 家族），修点不同分开计分，与 R2「计分各算 + 同根注」先例一致。
- **口径披露（影响可比性）**：本轮规范维出现 2 条 HIGH（前三轮该维从未有 HIGH），是「系统性大面积失控」标定被本轮审员用满，非新问题涌现（两条实体分别为四轮共同盲区的存量与 R1 起连续在案的长期债①）。敏感性分析见「怎么读这个分」——分数适合看趋势，不宜当绝对值（R2 报告原话，本轮依旧成立）。

## 评分公式（与前三轮完全一致）

每维 100 分起步，高 −15 / 中 −5 / 低 −2，扣到 0 为止；九维加权合成总分。
等级：A ≥90 / B ≥80 / C ≥70 / D ≥60 / F <60。

## 总分卡

**总分 81.5 / 100 —— 等级 B**（发现合计 48 条：3 高 / 15 中 / 30 低）

| 维度 | 高 | 中 | 低 | 得分 | 权重 | 加权贡献 |
|------|----|----|----|------|------|---------|
| 正确性/健壮性 | 0 | 0 | 4 | **92** | 18% | 16.6 |
| 安全（密钥与环境） | 0 | 1 | 2 | **91** | 15% | 13.7 |
| 功能实现程度 | 0 | 1 | 3 | **89** | 14% | 12.5 |
| 测试质量 | 0 | 1 | 4 | **87** | 13% | 11.3 |
| 架构可维护性 | 1 | 4 | 2 | **61** | 10% | 6.1 |
| 代码重复 | 0 | 7 | 3 | **59** | 10% | 5.9 |
| 规范一致性 | 2 | 1 | 4 | **57** | 8% | 4.6 |
| 依赖健康 | 0 | 0 | 5 | **90** | 6.3 → 7% | 6.3 |
| 日志卫生 | 0 | 0 | 3 | **94** | 5% | 4.7 |

### 怎么读这个分：−1.7 的表面下是「产品风险」与「家务债」的分化

**四轮盲审对盲审：55/F（R1）→ 84.1/B（R2）→ 83.2/B（R3）→ 81.5/B（R4）。** B 段稳态第三次确认，且本轮的分数构成发生了值得注意的分化：

1. **权重前四的产品风险维全部处于四轮历史最佳位**：正确性 92（四轮 84/91/73/92——R3 的 confirm 丢章 HIGH 与双写/回滚 2M 经 D 批治本后，本轮零高中危，是该维四轮首次无 M 以上发现）、安全 91（R3 的 bundle 泄漏 HIGH 被 D2 修复，本轮安全审员主动确认「已修复且纵深防御」）、功能 89（持平 R3 高位，M3 三批消费端经独立核验全接通）、测试 87（微降 1 分属噪声）。**合计 60% 权重的维度全部 ≥87。**
2. **−1.7 的下探全部来自家务债三维**：架构 84→61（−2.3 加权）、重复 82→59（−2.3）、规范 82→57（−2.0），被产品维回升（正确性 +3.4、安全 +1.2 加权）抵掉大半。三维下跌的内容 = 新审员在更细的粒度上挖出新一批存量重复（重复维 7 条 M 全为前三轮漏报）+ 两条长期存量被首次/再次标 HIGH。
3. **严重度口径敏感性**：规范维 2 条 HIGH（无 lint 工具链、snake/camel 混用）若按 R2/R3 审员对同族问题的 MEDIUM 标定计，规范维 = 77、总分 = **83.1 ≈ R3 持平**；架构 HIGH 若同理降 M 则总分 83.6。即本轮 −1.7 中约一半以上是审员严重度标定方差，**不是质量倒退**——17 个治本/消费端 commit 合入后核心链路零回归（详见盲对照）。
4. **本轮两条真·头条均是四轮 27 个盲审员的共同盲区存量**：①全仓无任何 lint/format 工具链（R2 结论第 5 条就建议过「上 CI 防线」，但四轮从未有人把它列为发现——而它正是重复/规范两维「修一批又长一批」的机制性根因）；②lore/fandom 持久化整个住在 UI api 层（引擎 12 个实体有 repository，唯独 lore 没有，路径安全白名单也定义在 UI——迁移期遗留的结构性事实，16 处 raw adapter I/O）。两条都不是回归，是采样第四轮才命中的深层存量。

---

## 发现全录（48 条）

### 高危（3 条）

#### 架构可维护性（1）
- **Lore/Fandom 持久化在 UI api 层直连 PlatformAdapter：手拼存储路径 + 安全白名单 + 目录布局，绕过引擎 repository 体系** — src-ui/src/api/engine-lore.ts:31-53 / engine-fandom.ts:265
  saveLore 内 `filePath=${basePath}/${safeCategory}/${safeFilename}` + `adapter.mkdir/writeFile`（:45-53）；路径安全 sanitizePathSegment 白名单 `/[^\p{L}\p{N}._ -]+/gu`（:12,:31）定义在 UI 并自注「导出给 engine-fandom.ts 等模块复用（单一真相源）」——真相源落在 UI 侧；引擎有 12 个实体的 repo 却无 lore repo，fandom 有 FileFandomRepository 仍被 `${dataDir}/fandoms/...` 直读绕过（api 两文件共 16 处 raw adapter I/O）。存储布局/路径安全这类引擎级契约散落 UI，三端行为一致性只靠 UI 单实现维系。
  建议：把 lore/fandom CRUD + 路径安全下沉为引擎 LoreRepository/service，UI api 只做薄转发。*（主审已逐行核验坐实。）*

#### 规范一致性（2）
- **整个仓库无任何 ESLint/Prettier/Biome/EditorConfig 配置、两包 package.json 均无 lint 脚本，风格一致性完全无工具约束（仅 tsc strict 覆盖类型层）** — src-engine/package.json:14-18, src-ui/package.json:6-16
  find 全仓无 `.eslintrc*`/`eslint.config.*`/`.prettierrc*`/`biome.json`/`.editorconfig`；双包 scripts 仅 build/test；devDeps 未装 eslint/prettier。源码中的 `eslint-disable` 注释为装饰性（无 linter 消费）。规范/重复两维反复出现的引号分裂、命名混用、any 逃逸、重复判据，机制性根因正是无防线。
  建议：引入 Prettier（统一引号/分号/import）+ ESLint（no-explicit-any、no-console、命名规则、import 顺序），加 `lint`/`format` 脚本并接入 CI。*（主审已核验坐实；R2 结论曾建议 CI 防线，四轮首次成为计分发现。）*
- **引擎层函数命名两套体系大面积并存：camelCase 与 snake_case（export 函数 264 vs 84），且 config_resolver.ts 等同文件内混用** — src-engine/llm/config_resolver.ts:165 vs :43,:96
  `resolve_llm_config`/`resolve_llm_params`（snake）与 `toManualContextWindow`/`normalizeBaseUrl`（camel）同文件；tokenizer/file_utils/rag_retrieval 整片 snake。Python 迁移遗留，R1 起连续四轮被点名（长期债①，既有裁决=渐进还），本轮审员按「系统性大面积混用」标定升格 HIGH。
  建议：定 camelCase 主约定，把 snake_case 函数（非序列化字段）批量改名 + 保留别名过渡，杜绝同文件混用。*（主审已核验坐实。）*

### 中危（15 条）

#### 安全（1）
- **Tauri CSP 的 connect-src 允许裸 `http:`（任意明文主机），带 `Authorization: Bearer <apiKey>` 的请求可经明文 HTTP 发往任意端点** — src-ui/src-tauri/tauri.conf.json:30
  `"connect-src": "ipc: http://ipc.localhost 'self' https: http:"`。*（R2 判 M → R3 因 B2 明文告警缓解降 L → 本轮审员未采信缓解、回升 M：告警是软缓解，CSP 通配是硬放行。第三次点名。）*
  建议：明文放行收窄到本地 Ollama（`http://localhost:* http://127.0.0.1:*`），去掉通配 `http:`。

#### 功能实现程度（1）
- **图书馆首页与事实页存在硬编码中文用户文案，绕过 i18n（英文界面下仍显中文）** — src-ui/src/ui/library/LibraryFandomSections.tsx:136,218,326,329
  `{chapterTotal} 章` / `最近` / `<span>未开始</span>`；同类 Library.tsx:93 `label: '章'`（旁 :92 用 t()）、FactsLayout.tsx:410 `新建` 按钮。i18n 键对称性校验（1284 键）拦不住「根本没走 t()」的文案。
  建议：全部改走 `t(...)`（新增 library.chapterUnit / library.notStarted / facts.addButton 等键，en/zh 同补）。

#### 测试质量（1）
- **UI api/ 编排层（「生成→接受→记忆」流水线的前端入口）零直接测试，含防御性 error/降级分支** — src-ui/src/api/engine-generate.ts:16、engine-threads.ts:119、engine-import.ts:84、engine-simple-chat.ts:42
  四模块 test-imports=0；engine-generate 有 local 模式拦截 + thread 读失败降级、addFactToThread 是注释自认非原子的 RMW、markSimpleChatDraftAccepted 是 draft→accepted 状态机。
  建议：对入口错误分支（UNSUPPORTED_MODE、thread 降级）与 RMW/状态机做直接单测，别只在 useWriterGeneration 里整体 mock 掉。

#### 架构可维护性（4）
- **simple_chat_dispatch.ts 巨型模块（1091 行）混装多职责，buildAgentLoopConfig 单函数 ~285 行** — src-engine/services/simple_chat_dispatch.ts:623-907
  同文件含工具分类/读工具执行/写意图启发/telemetry/会话解析/loop 配置/事件翻译。*（R2 曾以 471 行上帝函数判 M，C2 拆出子函数后 R3 未点名；本轮按文件级混装再指认——拆分只做了函数层，未做文件层。）*
  建议：读工具执行、工具分类、事件翻译拆独立文件，buildAgentLoopConfig 按子块提取。
- **存储文件名 `"project.yaml"`/`"state.yaml"` 字面量散落 6+ 引擎文件且 UI 也硬编码，无单一常量** — src-engine/services/au_bundle.ts:164-166 / trash_service.ts:379,829 / settings_chat.ts:166,315 / au_lock.ts:101 / src-ui/src/ui/RestoreBundleModal.tsx:24
  au_bundle `canonBase==="project.yaml"` 是 bundle 消毒判据、UI 用它判 AU 根——判据级字面量跨包散落。*（R2 收敛的是章节/草稿文件名 9 处副本，project.yaml/state.yaml 家族从未收敛——同族新成员。）*
  建议：引擎导出 PROJECT_YAML/STATE_YAML 常量，所有判据 import 复用。
- **UI 用裸正则重实现 frontmatter 分隔解析，绕过引擎强制的 safeMatter（缺「正文以 --- 开头被吞」防护）** — src-ui/src/ui/shared/settings-chat/frontmatter-utils.ts:36-46
  splitYamlFrontmatter `normalized.match(/^---\n([\s\S]*?)\n---\n?/)`；引擎 domain/frontmatter.ts:37 明注「所有 frontmatter 解析点必须走 safeMatter」。
  建议：引擎补「保留行序」分隔 helper（含既有硬化）供 UI 复用，UI 不再自写正则。*（同族注：重复维另有 UI 内两份正则互异的 LOW，修点不同分开计分。）*
- **引擎核心多处直接触碰 `document` 浏览器全局，越过 platform/ 适配层** — src-engine/tasks/task_runner.ts:335-352 / logger/logger.ts:96-100 / fonts/registry.ts:46-93
  `document.addEventListener("visibilitychange")`、`document.visibilityState`、`document.fonts.add()`；虽有 `typeof document` 兜底，但生命周期能力不在 PlatformAdapter 内。*（R3 判 L（task_runner/logger 两处）→ 本轮 +fonts/registry 成员、升 M。渐进债在案。）*
  建议：visibility/lifecycle 能力纳入 PlatformAdapter，核心层依赖注入。

#### 代码重复（7）
- **`dictToLLMConfig` 在两个 repo 文件里字节级重复，LLMConfig 增删字段须两处同改** — src-engine/repositories/implementations/file_settings.ts:169（与 file_project.ts:174）
  两处 `createLLMConfig({ mode, model, api_base, api_key, ..., ...(d.chat_path? ...) })` 完全一致。
  建议：抽公共 dictToLLMConfig，两 repo import。
- **设定对话工具执行器与简版工具执行器把 6 个共有工具的处理体整段复制（含回滚原子性、legacy 读回退），双份维护易漂移** — src-ui/src/ui/shared/settings-chat/execute-settings-tool.ts:196,232,313,332（与 useSimpleToolExecutor.ts:173,211,249,266）
  create/modify_character、create/modify_worldbuilding、add_pinned、update_writing_style 两文件 body 近乎逐行相同（仅 basePath↔auPath 变量名差异）。*（= R3 架构 M6，既有裁决「平行不合并——同一 helper 栈的两种工具面」，第三次被点名。裁决是否维持见待决段。）*
  建议：每个工具执行体抽共享 `runXxxTool(ctx)` 纯函数，两执行器只做 dispatch。
- **同一套工具参数契约在 JSON Schema、Zod、UI 校验三处独立手工维护（跨包），`["main","supporting","minor"]` 枚举被抄三份** — src-engine/domain/settings_tools.ts:23、simple_tools_zod.ts:27、src-ui/src/ui/shared/settings-chat/types.ts:184
  create_character_file 的必填/可选字段在 JSON Schema 与 Zod 各声明一遍。*（R2 修的是工具「名」常量单源（B5），参数契约是同族更深一层。）*
  建议：importance 枚举提为引擎导出常量；Zod 与 JSON Schema 单源派生。
- **UI 多处硬编码 narrative_weight 选项与 fact-type 默认，绕过已导出的单一真相源** — src-ui/src/ui/facts/FactsLayout.tsx:186-188（与同文件 326-328）
  `<option value="low/medium/high">` 同文件抄两遍；`'plot_event'`/`'medium'` 默认散落 execute-settings-tool.ts:351、ToolCallEditor.tsx:244、WriterModals.tsx:200、api/facts.ts:51；types.ts 已有 NARRATIVE_WEIGHT_OPTIONS。
  建议：map NARRATIVE_WEIGHT_VALUES；默认统一取枚举常量。
- **模型参数默认 `{temperature:1.0, top_p:0.95}` 在引擎三处独立手工维护** — src-engine/domain/settings.ts:17-18（与 llm/config_resolver.ts:271、file_settings.ts:192-193）
  createModelParams 定义之外，resolve_llm_params 与 dictToModelParams 各自再写一份字面量。
  建议：后两处改调 createModelParams()。
- **UI 侧 `DraftGeneratedWith` 逐字段手抄引擎已导出的 `GeneratedWith`（9 字段全同），新增字段会被静默丢** — src-ui/src/api/drafts.ts:5-15（与 src-engine/domain/generated_with.ts）
  两接口 9 字段完全一致；drafts.ts 未 import 引擎类型。*（D6 单源化的是引擎内 YAML 映射 4 处；UI interface 手抄是同族第 5 面，修点不同。）*
  建议：删 DraftGeneratedWith，`import type { GeneratedWith } from "@ficforge/engine"`。
- **`dictToProject` 重复声明 `createProject` 已给的默认值，且 revision 默认已实际漂移（0 vs 1）** — src-engine/repositories/implementations/file_project.ts:231-256（与 domain/project.ts:116-138）
  createProject `revision: 0`（project.ts:121）而 dictToProject `(d.revision as number) ?? 1`（file_project.ts:240）；chapter_length 1500 / core_guarantee_budget 400 / rag_decay 0.05 亦两处各写。**「双处手工维护随时间漂移」的实锤样本**——主审已回读双侧坐实。
  建议：dictToProject 仅传「YAML 真有的字段」，缺省键交 createProject 兜底。

#### 规范一致性（1）
- **UI 包 import 引号风格失控：仅单引号 81 文件 / 仅双引号 109 文件 / 单文件内混用 22 个，引擎层则 100% 双引号** — src-ui/src/ui/Library.tsx:7
  Library.tsx :7 双引号夹在 :5-27 一片单引号 import 之间。*（同根注：无 lint 工具链 HIGH 的直接症状，修复动作同为 Prettier 落地，分开计分与 R2 规范维先例一致。）*
  建议：Prettier `--write` 全量归一（推荐与引擎一致的双引号）。

### 低危（30 条）

#### 正确性/健壮性（4）
- **全仓强制的 atomicWrite 崩溃安全纪律被绕过：导入设定文件用裸 `adapter.writeFile` 直写（同文件章节/ops 走 atomicWrite）** — src-engine/services/import_pipeline.ts:476,496（另 snapshot.ts:69,94）
  进程被杀/断电时留半截 worldbuilding .md。*（R3 L 已点 snapshot/ops_archive 面，渐进债在案；import_pipeline 设定文件面为新成员。）*
  建议：改走 atomicWrite，与全仓 tmp+rename 纪律对齐。
- **snapshot 的 watermark 先于归档追加落盘 + 归档非原子：追加失败/撕裂会让 ops_archive 与 archivedOpsCount 永久失配，下轮 slice 跳过未归档 ops** — src-engine/services/snapshot.ts:64,94
  :64 已写 `archivedOpsCount: ops.length` 进快照，:94 才追加归档。当前 checkAndSnapshot 未 export（M6 前休眠），无现网数据丢失。
  建议：归档成功后再回写 watermark；两文件均用 atomicWrite。接入 M6 前修复。
- **以普通对象当 Map、用用户可控角色名做 `in`/下标键，与 Object.prototype 成员冲突** — src-engine/domain/character_scanner.ts:54（并 confirm_chapter.ts:158、import_pipeline.ts:628）
  名为 `constructor`/`toString` 的角色 `in` 恒真、扫描前即被跳过，永不被记为出场；下标读回拿到继承函数致比较恒 false。
  建议：`Object.create(null)` / Map / hasOwnProperty.call。
- **RAG 活跃角色过滤丢失别名归一化：retrieve_rag_for_context 未把 character_aliases 传入 build_active_chars，与同请求的 last_seen 扫描（用别名）不对称** — src-engine/services/rag_retrieval.ts:399
  build_active_chars 只传 5 参、缺第 6 个 character_aliases。*（项目侧已有记账：别名表接通验收时明确挂的「rag_retrieval 检索别名扩展」后续卡——盲审独立命中同一点，客观化了该卡优先级。）*
  建议：按已挂任务卡接通（args + chunker 索引侧两头同改）。

#### 安全（2）
- **Web/PWA secret store 在 WebCrypto/IndexedDB 不可用（隐私模式等）时回退明文 localStorage 存 api_key** — src-engine/platform/web_adapter.ts:183
  属有意降级且 capability 诚实上报 encrypted_at_rest=false。
  建议：明文回退时对用户显式告警「本环境密钥未加密」。
- **Tauri CSP 的 style-src 含 `'unsafe-inline'`** — src-ui/src-tauri/tauri.conf.json:26
  script-src 已锁 'self'、无 unsafe-eval，脚本注入面已封，风险很低。
  建议：可迁 nonce/hash 则收紧，否则可接受。

#### 功能实现程度（3）
- **DOCX 导入为未完成特性：分支抛硬编码英文 Error，依赖 mammoth.js 未装（入口已注释、实际不可达）** — src-ui/src/ui/import/ImportFlow.tsx:350-352 *（R3 L 在案，渐进债。）*
  建议：装 mammoth.js 接活或整段删除死分支。
- **已退役 local 模式的残留死 UI 分支（选择器永不提供 local，分支不可达）** — src-ui/src/ui/settings/GlobalSettingsModal.tsx:156、AuSettingsLayout.tsx:148 *（R3 L「本地模型死脚手架」在案。）*
  建议：删 local 分支及 localModelPath 字段，或 capabilities 明确 coming_soon。
- **coming_soon 能力为永不触发的脚手架：矩阵无任何模式标 coming_soon，渲染分支恒不可达** — src-engine/llm/capabilities.ts:102、LlmModeSelect.tsx:77-79、ApiConfigStep.tsx:125 *（上条同族扩展成员。）*
  建议：保留扩展点可，加「当前无消费者」注释防漂移。

#### 测试质量（4）
- **i18n useAppTranslation mock 工厂在 8 个测试文件各自重声明且实现漂移（三种口径）；useFeedback mock 亦在约 15 文件重复** — AuWorkspaceLayout.keepMounted.test.tsx:21、messages.memo.test.tsx:14、WriterLayout.integration.test.tsx:29
  建议：抽 test/mocks/ 共享工厂。*（R2 修过一批 mock 重复，此为未覆盖残余面。）*
- **`getByText(...).toBeTruthy()` 冗余断言反模式散布 16 个 UI 测试文件** — FetchModelsSheet.test.tsx:46、AuLoreLayout.test.tsx:129
  RTL getBy* 命中失败即抛，.toBeTruthy() 制造「有断言」假象。*（R3 L「断言空转」同族扩展面。）*
  建议：改实质断言或直接以查询作存在性断言。
- **messages.memo.test.tsx 3 个「same ref → stable」测试并未验证其命名的 memo 行为（纯组件无论是否 memo 都过）** — messages.memo.test.tsx:23,53,83
  建议：memo 用渲染计数 spy 测，否则删「稳定性」半、保留「不同 props → 更新」半。
- **若干含真实逻辑的 UI hook 无测试（含导出纯函数 getCandidateKey）** — useExtractedSelection.ts:7、useLibraryData.ts:11、useSecretStorageCapabilities.ts:13、useMilestoneGuide.ts:9 *（R2 修复 102 用例后的残余成员。）*
  建议：至少补 getCandidateKey 键唯一性 + capabilities 降级测试。

#### 架构可维护性（2）
- **FactsLayout.tsx 896 行 god 组件：数据加载与大段渲染同居一体** — src-ui/src/ui/facts/FactsLayout.tsx:40-66 *（SimpleChatPanel（已拆）同族的新成员。）*
  建议：取数移 useFactsData，渲染拆 filter-bar/list/modals。
- **useSimpleChat 以 props 注入一批 setX 命名的跨 hook 修改器（setDraftContent/setDraftLabel/setDraftStatus/setToolCallStatus），违项目自定「注入方法动词命名」约定** — src-ui/src/ui/simple/useSimpleChat.ts:72-95
  带语义 id 参数、非裸 setState，但命名违约定。*（B4 裸 setter 清理后的残余面；主审已回读坐实。）*
  建议：改 updateDraftContent/markDraftLabel 等动词命名。

#### 代码重复（3）
- **rag 检索里 chapters 与 summaries 两段「时间衰减 + 重排序」近乎复制（注释自承「与 chapters 一致」）** — src-engine/services/rag_retrieval.ts:186-194（与 204-213）
  建议：抽 decayAndSort helper，衰减公式单点维护。
- **settings 语言解析一行逻辑在 API 层重复约 8 次，且两种口径不一致（严格归一 vs 宽松透传）** — engine-tokens.ts:34 / engine-simple-dispatch.ts:67（与 engine-facts.ts:45、engine-chapters.ts:115,177,455）
  建议：提 `resolveLang(settings): "zh"|"en"`，统一严格口径。
- **frontmatter 前置块剥离在 UI 两处各写一份正则且判据不一致（CRLF 处理不同）** — SettingsMarkdown.tsx:44（与 frontmatter-utils.ts:36）
  建议：SettingsMarkdown 复用 splitYamlFrontmatter。*（同族注：架构维「绕 safeMatter」M 的姊妹面。）*

#### 规范一致性（4）
- **UI 组件定义风格不统一：`export function` 76 处 vs `export const () =>` 22 处** — AuSettingsLayout.tsx:31、FactCard.tsx:11 *（无 lint 根因症状。）*
  建议：约定其一，ESLint 固化。
- **UI 在引擎已导出精确类型处仍用 any 逃逸（引擎层 0 any），边界 5+ 处** — FactCard.tsx:11（fact: any）、engine-settings-chat.ts:21 *（R3 L「FactCard fact:any」在案未修 + 同族。）*
  建议：用引擎 Fact/消息类型替换，开 no-explicit-any。
- **api/ 文件命名单复数不一致：fandoms.ts ↔ engine-fandom.ts 配对漂移** — src-ui/src/api/fandoms.ts、engine-fandom.ts *（R2 L 在案未修。）*
  建议：统一基名。
- **静默吞异常用裸 `catch {}`，未走项目 logCatch 约定，两处** — capacitor_adapter.ts:308、web_adapter.ts:508
  建议：走 logCatch 或注释「为何可忽略」。

#### 依赖健康（5）
- **src-ui 传递依赖 esbuild dev server 任意文件读取漏洞（Windows，仅 dev）** — esbuild@0.27.4 → ≥0.28.1，GHSA-g7r4-m6w7-qqqr，CVSS 2.5，fixAvailable *（R2/R3 在案，第三次出现，被父包 semver 锁。）*
  建议：npm audit fix 或升 vite/vitest 拉起。
- **@types/js-yaml@4.0.9 陈旧且冗余：js-yaml 5.x 自带类型，不存在 @types 5.x** — src-engine devDeps *（R3 L 在案未修。）*
  建议：移除 @types/js-yaml。
- **src-ui 两个生产依赖 JS 源码零 import（Rust/capability 侧不在审计范围，非定论）** — @tauri-apps/plugin-http@^2.5.8、plugin-opener@^2.5.3
  建议：确认 Rust 侧用途，双侧均未接入则移除。*（plugin-http 移除已在 PROGRESS 待办在案。）*
- **vite 7.3.6→8.1.4、@vitejs/plugin-react 5.2.0→6.0.3 各落后 1 大版本（均 devDeps）** *（R3 L 在案。）*
  建议：择期评估升级，非紧急。
- **两包多处 minor/patch 可更新（@capacitor/* 8.3→8.4.1、@tauri-apps/api 2.10→2.11、react 19.2.4→19.2.7 等，无漏洞）**
  建议：常规 npm update 拉齐，低优先。

#### 日志卫生（3）
- **UI 的 warnUi console 降级路径未对 error 脱敏，与引擎 warnAlways「降级同样过脱敏」口径不一致** — src-ui/src/utils/ui-logger.ts:23
  影响仅限 logger 初始化前且 console 不入导出日志。*（redactCtx 家族的 UI 新面；引擎侧三面已在 B2 修复。）*
  建议：降级前复用引擎 redact 逻辑。
- **约 21 处后台数据加载 `.catch(() => null)` 静默吞失败原因，绕过 catchAndLog 约定，排障无痕迹** — useWriterBootstrap.ts:46,48,49（另 useSimpleChatPanelConfig.ts:48-51、useSettingsChatSupportData.ts:65、MobileSettingsView.tsx:62-63）*（R3「静默吞错」同族渐进债。）*
  建议：兜底值保留同时 debug 级记因。
- **生产 initLogger 未传 minLevel，默认 "debug" 全量写盘、无环境分级（当前引擎 0 处 debug 调用，属前瞻隐患）** — src-ui/src/App.tsx:73,87,97
  建议：生产传 `{ minLevel: 'info' }` 预留闸门。

---

## 与第三轮盲对照（打分封板后开盲）

### 四轮分数对照

| 维度 | R1(07-09) | R2(07-11) | R3(07-11) | R4(07-12) | R3→R4 归因 |
|------|-----|-----|-----|-----|------|
| 正确性/健壮性 | 84 | 91 | 73 | **92** | R3 的 1H+2M 经 D1/D3 治本全消失；本轮 4L 中 2 条渐进债在案、2 条新增（Object.prototype 键冲突、rag 别名——后者项目已有记账卡）。**四轮首次零 M 以上。** |
| 安全 | 86 | 91 | 83 | **91** | R3 的 bundle 泄漏 HIGH 经 D2 消失（本轮审员主动确认「已修复且纵深防御」）；剩 CSP http:（第三次点名，L↔M 口径摆动）+ 2 新 L。 |
| 功能实现程度 | 74 | 78 | 89 | **89** | R3 M3「写而不读」经 M3 三批建消费端消失（主审复核：hidden_from 入 build_fact_knowledge_clause 门控、story_time_order 入 context_assembler 排序）；DOCX/local 死桩渐进债依旧；新增硬编码中文文案 M。 |
| 测试质量 | 41 | 89 | 88 | **87** | R3 M4/M5 经 D4 消失；新增 UI api 编排层零测试 M + 4 个同族残余 L。基本持平。 |
| 架构可维护性 | 58 | 76 | 84 | **61** | R3 2M 经 D7/裁决处理；本轮 1H（lore UI 直连——四轮共同盲区存量首次命中）+4M（1 条 C2 残余面、1 条 R2 未覆盖同族、1 条渐进债升格、1 条新增）。 |
| 代码重复 | 11 | 73 | 82 | **59** | R3 M8/M9 经 D6 消失；本轮 7M 中 1 条=裁决在案的双执行器（第三次点名）、6 条全新（含 revision 默认已实际漂移的实锤）。「修一批、新审员再挖一批」第三次应验。 |
| 规范一致性 | 31 | 74 | 82 | **57** | 长期债①（snake/camel）第四轮连续在案、本轮升格 HIGH；无 lint 工具链首次入榜即 HIGH（四轮共同盲区）；其余 1M+4L 半数在案未修。 |
| 依赖健康 | 0 | 87 | 87 | **90** | 双包 audit 仅剩 esbuild dev-only LOW（第三次）；R3 M12 镜像 registry **仍在但本轮漏报**（主审复核 engine 24/UI 140 处 npmmirror）——若计入应再 −5。 |
| 日志卫生 | 47 | 93 | 89 | **94** | R3 M13 吞错经 D5 消失；剩 3 条边角 L（redact UI 新面、catch 静默同族、minLevel 前瞻）。 |
| **加权总分** | **55 / F** | **84.1 / B** | **83.2 / B** | **81.5 / B** | 见「怎么读这个分」 |

### R3 计分项（2H + 13M）逐条下落

| R3 条目 | 处置 | R4 下落 |
|---------|------|---------|
| H1 confirm 丢章 | D1 治本 | **消失**（R4 正确性员精读 write_transaction/confirm_chapter 未点名）✓ |
| H2 bundle 泄漏全局 key | D2 治本 | **消失**（R4 安全员主动确认已修 + 纵深防御）✓ |
| M1 project.yaml 双写竞态 | D3 治本 | **消失** ✓ |
| M2 覆盖导入回滚缺章 | D3 治本 | **消失** ✓ |
| M3 三字段写而不读 | M3 三批建消费端 | **消失**（主审 grep 复核消费端真实在）✓ |
| M4 路径穿越守卫零测试 | D4 治本 | **消失** ✓ |
| M5 inflight 释放零断言 | D4 治本 | **消失** ✓ |
| M6 双工具执行器 | 裁决「平行不合并」 | **复现**（R4 重复维 M，第三次点名）→ 裁决是否维持待拍板 |
| M7 双预算级联 | D7 治本 | **消失** ✓ |
| M8 GeneratedWith↔YAML 4 处 | D6 治本 | **消失**（R4 挖出 UI interface 手抄的同族第 5 面，修点不同）✓ |
| M9 toCanonicalCreateKey 拷贝 | D6 治本 | **消失** ✓ |
| M10 file_thread/summary auPath | 裁决长期债① | 未逐条复现（归并进 R4 规范 H2 同族） |
| M11 simple_chat camelCase 持久化 | 裁决长期债① | 未逐条复现（同上归并） |
| M12 lockfile 混镜像 registry | 环境侧待办 | **仍在但 R4 漏报**（主审复核实证）——盲审是概率采样的又一实证 |
| M13 提取链三层吞错 | D5 治本 | **消失** ✓ |

**10/10 治本项（D1-D7 + M3 三批）全部未复现 = 修复有效性与零回归的独立复测证据。** R3 的 24 条 L（渐进债）中 7 条被本轮重新点名（CSP、DOCX、local、document、esbuild、@types/js-yaml、vite），其余未点名者多数推定仍在（渐进债未修，采样方差）。

### R4 的 48 条归因

| 归因 | 条数 | 代表 |
|------|------|------|
| 上轮已知未修（渐进债 / 裁决在案 / 长期债） | 14 | CSP http:(M,第三次)、双执行器(M,第三次)、snake/camel(H,第四次)、DOCX/local/coming_soon(L)、document 直依赖(M,升格)、atomicWrite 绕过(L,+新成员)、esbuild/@types/vite(L)、any/单复数/.catch 静默(L) |
| 既往修复的残余面 | 4 | simple_chat_dispatch 文件级 1091 行(M，C2 拆函数未拆文件)、useSimpleChat setX 入参(L，B4 残余)、i18n mock 漂移(L)、4 hooks 无测试(L，102 用例批残余) |
| 全新发现（含四轮共同盲区） | 30 | **无 lint 工具链(H)**、**lore/fandom UI 直连引擎旁路(H)**、重复维 6M+3L（含 dictToProject revision 已漂移实锤）、硬编码中文文案(M)、UI api 层零测试(M)、frontmatter 绕 safeMatter(M)、project.yaml 字面量(M)、Object.prototype 键冲突(L)、web 明文回退(L)等 |

### 结论

1. **B 段稳态第三次确认（84.1 → 83.2 → 81.5），且构成分化**：60% 权重的产品风险四维全部 ≥87、处四轮最佳（正确性 92 为四轮首次零中高危）；下探完全由家务债三维贡献，其中约一半以上是严重度口径方差（敏感性：规范 2H 按前三轮 M 口径计则总分 83.1 ≈ 持平）。
2. **D 批 + M3 三批 + 别名表 17 commit 的独立复测结论 = 零回归、修复全部生效**：R3 的 2 HIGH 双双消失且安全员主动确认防御纵深；10 治本项复现率 0。
3. **「每轮深挖翻出新存量」第三次应验，且本轮命中两条机制级头条**：①无 lint 工具链——它不是又一条家务债，而是重复/规范两维四轮「修一批长一批」的**根因**（R2 结论建议过、四轮首次成为计分发现）；②lore/fandom 持久化住在 UI——迁移期遗留的最后一块「引擎旁路」。两条都属「修一次、终结一族」的杠杆点。
4. **盲审采样方差的两面实证**：R3 M12（镜像 registry）仍在但本轮漏报；rag 别名缺口项目侧已有记账卡、本轮被独立命中——盲审对「已知清单」既可能漏也可能重合，其不可替代价值仍是「未知未知」（本轮 30 条全新发现）。
5. **修复不彻底的老模式再现一例**：C2 把 471 行上帝函数拆成子函数，但文件级混装（1091 行）未动——「宣称拆分的重构需定义完成判据（文件/职责级 vs 函数级）」。

---

## 待决（只报不修，等拍板）

**拍板点：第四轮发现的处置——是否开 E 批，以及打不打「机制级」两枪。**

- **背景**：本轮 48 条里，3 条 HIGH 全是老存量（两条是四轮 27 个盲审员共同漏过的结构性事实，一条是拍板过渐进还的命名债），15 条 M 里 6 条是重复维新挖的单源化机会。产品风险四维干净（零高中危），家务债三维被挖出新批次。
- **影响**：不修不影响当下用户可感知功能（HIGH 无一是行为 bug）；但无 lint 工具链会让重复/规范两维每轮盲审都再长一批（已三次应验），lore UI 直连会让三端存储行为靠单实现苦撑。
- **后果**：若只修 HIGH 不装防线，下一轮盲审大概率仍在 81-84 区间（新审员继续挖同族）；若装上 lint/CI 防线 + lore 下沉，家务债两维的「长新债速度」会被机制性掐断，分数才有资格突破 85。
- **为何推荐**：推荐 E 批 =「两枪机制 + 顺手清单」——①Prettier+ESLint 落地接 CI（一次性 --write 全量 + 规则固化，顺带消掉引号 M、组件风格 L、any L）；②lore/fandom CRUD 下沉引擎 repository（终结最后的引擎旁路 + 路径安全回归引擎）；③重复维 7M 里挑 dictToLLMConfig/dictToProject/GeneratedWith/模型默认 4 条纯机械单源化（半天量级、零行为变化）。CSP http: 与双执行器维持既有裁决或一并翻案，由你定。
- **为何要你拍**：①lint 全量 format 会产生一次跨全仓的大 diff（几百文件、纯格式），影响 git blame 与在途工作的 rebase 成本，时机得你选；②lore 下沉是接口层变更（UI api 契约要动），与你手上排期的功能节奏冲突与否只有你知道；③双执行器「平行不合并」是你拍过的裁决，第三次被点名后维持还是翻案是产品维护策略，不是技术对错。

---

## 附注

- 本报告与发现均由 9 个并行盲审员（opus）产出；主审仅做 HIGH 实证核验（3/3 坐实）、异常裁定（盲区泄漏嫌疑排除 ×1、审员间矛盾裁定 ×1）、去重复核（0 合并、3 同根注）、打分与盲对照，未增删实质发现。打分封板前主审未读任何历史报告。
- 测试基线（审前）：引擎 1467 passed +3 skipped、UI 585 passed、双 tsc 0 错、i18n 1284 键对称。
- 发现只报不修，等用户拍板。
