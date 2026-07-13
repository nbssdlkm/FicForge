# 2026-07-12 九维盲审报告（第五轮）

## 方法论（与前四轮完全同口径）

- **盲审纪律**：9 个独立盲审员（opus）并行、互不通气、一人一维；只拿一句结构事实描述（两包目录形状 + 文件规模 276/338）；禁读 CLAUDE.md / PROGRESS.md / docs / git 历史 / 任何 audit 报告 / TECH-DEBT 台账；只凭 src-engine/ 与 src-ui/src 源码和行业通用标准下判断。
- **范围**：src-engine/（排除 dist/node_modules）+ src-ui/src + 壳层安全配置（tauri.conf.json / capacitor.config.json 仅安全维）+ 双包 package.json/lockfile（依赖维在两包各跑 npm audit / npm outdated）。
- **每维上限 15 条**，必须带严重度 + file:line + 证据 + 建议；审员报告前强制回读所引行核验，「宁缺毋滥」。
- **主审核验**：本轮零 HIGH，主审核验面下沉到 **12 条 MEDIUM 全部逐行回读实证坐实**（undo 重建无边界 / chapter_length 1500 vs 2000 实值漂移 / biome 命名围栏通配白名单 / loadMdFiles 静默吞错 / stale_index 零消费 / assembler 1304 行 / getPlatform-web 特判 / 内联类型副本 / 覆盖判据镜像 / confirm 级联住 api 层 / 适配器契约缺口 / 400 降级零覆盖——证据行全部复核无误）。
- **跨维去重**：0 条同缺陷重复计分；1 处同根标注——安全 L2（错误体直透 UI toast）与日志 L3（错误体进可导出日志）同根于 `extractErrorDetail` 的 200 字节切片，修点不同（UI 脱敏面 vs 日志提炼面）分开计分，沿 R2「计分各算 + 同根注」先例。
- **口径披露（本轮特有，影响可比性评估）**：主审在同一会话内先完成了 F1-F4 修复战役（R3 低危清扫 / TD-019 / TD-020 / TD-021），对 R1-R4 分数存在会话内暴露。缓解：①9 名盲审员对项目历史完全无暴露（真盲）；②分数由评分公式从盲审员的发现计数**机械导出**，主审只做实证核验与去重、不改严重度标定；③打分封板后才做盲对照。此披露如实入档，读分时自行斟酌。

## 评分公式（与前四轮完全一致）

每维 100 分起步，高 −15 / 中 −5 / 低 −2，扣到 0 为止；九维加权合成总分。
等级：A ≥90 / B ≥80 / C ≥70 / D ≥60 / F <60。

## 总分卡

**总分 87.2 / 100 —— 等级 B**（发现合计 41 条：**0 高** / 12 中 / 29 低）

| 维度 | 高 | 中 | 低 | 得分 | 权重 | 加权贡献 |
|------|----|----|----|------|------|---------|
| 正确性/健壮性 | 0 | 1 | 3 | **89** | 18% | 16.0 |
| 安全（密钥与环境） | 0 | 0 | 3 | **94** | 15% | 14.1 |
| 功能实现程度 | 0 | 1 | 5 | **85** | 14% | 11.9 |
| 测试质量 | 0 | 2 | 1 | **88** | 13% | 11.4 |
| 架构可维护性 | 0 | 3 | 3 | **79** | 10% | 7.9 |
| 代码重复 | 0 | 3 | 3 | **79** | 10% | 7.9 |
| 规范一致性 | 0 | 1 | 4 | **87** | 8% | 7.0 |
| 依赖健康 | 0 | 0 | 3 | **94** | 7% | 6.6 |
| 日志卫生 | 0 | 1 | 4 | **87** | 5% | 4.4 |

### 怎么读这个分：五轮首次零 HIGH，B 段天花板

**五轮对照：55/F（R1）→ 84.1/B（R2）→ 83.2/B（R3）→ 81.5/B（R4）→ 87.2/B（R5，五轮最高）。**

1. **全九维零 HIGH 是五轮首次**（R1 累计多枚、R2 1 枚、R3 2 枚、R4 3 枚）。R4 的三条 HIGH（无 lint 工具链 / snake-camel 双体系 / lore 持久化住 UI）经 E 批治本后本轮零复现：规范审员主动确认「import 别名统一零深穿、biome-ignore 115 处全带理由、非测试零 as any」；架构维不再有引擎旁路发现。
2. **曾经的重灾区大幅回升**：架构 61→79（+18）、重复 59→79（+20）、规范 57→87（+30）。三维在 R4 被扣 3 条 HIGH + 12 条 M，本轮合计 0 HIGH + 7 M——E 批「机制两枪」（Biome 围栏 + lore 下沉）与 E9 命名收敛的直接兑现。
3. **正确性 92→89（−3）非回归**：R4 四条 L 全部消失（E5/E8 修复被独立复测证实），本轮 1M+3L 是更深采样翻出的**新存量**（undo 降级路径的导入场景边界——五轮首次有审员钻到这条降级分支）。
4. **四名审员主动给出正面背书**（盲态下）：安全「极其硬化」、测试「unusually strong」、日志「genuinely mature」、重复「单一真相源相当自觉」——与 R1 时代的评语对照鲜明。
5. 分数仍适合看趋势不宜当绝对值（R2 起历轮口径注记依旧成立）；本轮主审口径披露见方法论节。

## 发现全录（41 条）

### 高危（0 条）

无。

### 中危（12 条）

#### 正确性/健壮性（1）
- **M1 undo 降级路径重建 characters_last_seen 把「正在被撤销的章」也计入** — undo_chapter.ts:437（rebuildCharactersLastSeen 无 `< n` 边界；调用发生在 tx.commit 之前、第 n 章仍在盘上）。触发面：前一章无 confirm 快照（典型=导入作品）→ 撤销后角色被持久记为「最后见于已删除的第 n 章」。姊妹路径 dirty_resolve.ts:278 明确限定 `<= n-1`，证明是遗漏非有意。修法：传入 n 并过滤。*（主审已回读坐实。）*

#### 功能实现程度（1）
- **M1 stale_index 算出并 yield 给 UI 但前端零消费** — generation.ts:260 写、context_summary.ts:39 声明，全仓仅此两处引用；ContextSummaryBar 不读。「本次检索用了过期索引」信号从未到达用户（仅有基于 state.index_status 的独立横幅旁路缓解）。修法：ContextSummaryBar 消费或删字段止损。*（主审 grep 复核：全仓引用恰两处。）*

#### 测试质量（2）
- **M1 Tauri/Capacitor 文件 I/O 适配器零单元覆盖** — adapter_contract.test.ts 契约套只参数化 Mock+Web；两端的 rename 覆盖语义（atomicWrite 的正确性前提）无测试拦截。修法：为两 plugin 写内存 FS mock 纳入契约套。
- **M2 callSettingsLlm 的 400 去 tools 降级/错误重分类分支零覆盖** — settings_chat.test.ts 仅 2 条 happy-path；实现 settings_chat.ts:137-156 的「400→去 tools 重试 vs 原样重抛」分类无用例，变异不敏感。*（主审 grep 复核：测试文件零 400/status_code 断言。）*

#### 架构可维护性（3）
- **M1 confirm/undo/回溯级联的领域编排住 UI api 层** — engine-chapters.ts:69/251/263（锁内两阶段回溯 + CAS + index 门控在 UI 包编排），引擎无法被 headless/后台第二消费者复用。修法：收进引擎 services（如 confirmChapterWithMemory）。
- **M2 context_assembler.ts 1304 行上帝文件** — prompt 拼装 + 预算数学 + 写文/对话双编排管线同文件。修法：拆 prompt_blocks / context_budget / assembler。
- **M3 平台细节泄漏核心** — au_bundle.ts:271 `getPlatform()==="web"` 特判（IndexedDB 空目录语义）。修法：PlatformAdapter 加 statEntry 语义能力。

#### 代码重复（3）
- **M1 engine-settings.ts 内联重声明本包已导出的命名类型** — :470-481 与 settings.ts DefaultLlmSettingsInput 逐字段同（且同文件已 import 并他处使用）；:532-541 与 TestConnectionRequest 同构。字段演进时内联副本静默漏改。
- **M2 「AU 覆盖全局 LLM」判据两处手写** — engine-project.ts:44-55 与 form-mappers.ts:172-181 同一 7 条析取式镜像，互不引用。
- **M3 chapter_length 默认值跨层实值漂移** — 引擎 1500（domain/project.ts:157 + assembler 4 处硬编码）vs UI 2000（form-mappers 2 处）：未持久化时引擎按 1500 算预算、表单回显 2000，用户所见与实际生效不一致。修法：DEFAULT_CHAPTER_LENGTH 单源 + 对齐取值。*（主审已回读双侧坐实——本轮最实的产品向发现。）*

#### 规范一致性（1）
- **M1 biome useNamingConvention 兜底通配架空非函数标识符围栏** — biome.json:44-45 第一条只管 function、第二条 `{ "match": ".*" }` 无 formats 全放行；4 个 snake 局部变量漏过是实证。规则挂 error 造成「全仓命名受控」假象。修法：按 selector 分治收窄兜底。*（主审对 biome.json 有直接认知，坐实。）*

#### 日志卫生（1）
- **M1 设定文件读取失败静默丢弃，生成上下文无声缺章** — generation.ts:108（loadMdFiles `catch {}`；同型 settings_chat.ts:201/284）。文件存在但 readFile 失败时角色卡被无声移出 LLM 上下文，零诊断。修法：warnAlways 留痕（仅记文件名）。

### 低危（29 条，按维摘要）

**正确性（3）**：characters_last_seen 合并的 Object.hasOwn 防护 4 处做 3 处漏（undo:442 / dirty:228,288 / recalc:94 裸读——同族根因未收敛，建议抽共享 helper 六处同源）；parseChatGptMapping DFS 无 visited（children 环栈溢出、DAG 重复计入，chat_parser.ts:541/574）；chat_parser role 裸 `as string` 后 toLowerCase（单行数字 role 使整份 JSONL 静默降级纯文本，:295/299/509）。

**安全（3）**：fetchProviderModels 发 key 无 plaintext_http 告警（engine-settings.ts:318-324，与 testConnection/生成链不同口径）；提供商错误体前 200 字节未脱敏直透 UI toast（openai_compatible.ts:575-581 → GlobalSettingsModal.tsx:70，*与日志 L3 同根不同修点*）；Tauri CSP connect-src `https:` 通配=密钥外泄残余面（script-src 'self' 压制前置条件、任意服务商功能刚需，知情取舍留档）。

**功能（5）**：Project 三个持久化字段零消费者（ignore_core_worldbuilding / agent_pipeline_enabled / current_branch——M6/分支旧设计残留）；Settings.license 整组（tier/feature_flags/api_mode）round-trip 完整零门控；Fact.source 有完整写/校验/编辑链但值从不被消费（「Phase 2 消费」承诺未落地）；ContextSummary.chapters_injected 声明后零写零读（彻底死字段）；VectorRepository.rebuild_index 接口方法零生产调用（名 rebuild 实 clear，已被 rebuildForAu 取代）。

**测试（1）**：undo golden last_scene_ending 仅 toBeTruthy（非判别，与同测试 characters_last_seen 口径不齐）。

**架构（3）**：位置参数爆炸（retrospective.ts:215 九参、rag_manager/facts_extraction 八参——deps 对象化）；UI 组件直连 getEngine().adapter（ApiConfigStep.tsx:78，建议 api 层导出 getCurrentPlatform）；工具扩展点分散 4 处（executor if 链 + zod + 联合类型 + 校验分支，建议注册表单源）。

**重复（3）**：FactsModals fact_type 下拉手写 6 枚举值（同文件 weight 已用 NARRATIVE_WEIGHT_VALUES 正确范式，FACT_TYPE_VALUES 已导出未用）；LlmQueryInfo/ProjectLlmQueryInfo 平行类型+平行 mapper（7 字段逐字同）；会话 LLM 形状 6 字段两处平行声明（generate.ts/settings-chat.ts）。

**规范（4）**：错误码字段三拼法并存（error_code/errorCode/code 于 LLMError/ApiError/FontError/FetchModelsError）；六个自定义错误类零 instanceof 消费且与裸 Error 同函数并存（dirty_resolve.ts:94 vs :119）；UI 文件命名分裂（cardChrome.tsx 组件用 camel、acceptExtracted/writerDisplayState vs kebab 主流）；双包同 bundler 解析但相对 import 扩展名约定相反（engine 2372 处 .js vs UI 797 处无后缀）。

**依赖（3）**：vite 7.3.6→8.1.4 落后一 major（协同 plugin-react 6；vite-plugin-pwa peer 已容 ^8，无阻塞——即 TD-018 既有裁决的现状复述）；@capacitor/cli 应归 devDependencies（构建 CLI 零 import）；四个零 import 依赖为 peer/平台满足项非死依赖（防误删白名单提示，半正面发现）。双包 npm audit 0、lockfile 全官方源、integrity 全覆盖。

**日志（4）**：useWriterBootstrap listFacts `.catch(()=>[])` 与三兄弟 swallowToNull 不一致（:42/:94）；AI 标题生成 UI 侧整段静默 catch（engine-chapters.ts:131——引擎侧 F1 已补痕、UI 包装层漏，同族残边）；供应商错误体前 200 字进 error 日志、脱敏仅标准形态（*与安全 L2 同根*）；导入回滚删除失败静默（import_pipeline.ts:437）。

## 盲对照（打分封板后进行）

- **R4 三条 HIGH 全部零复现**：①无 lint 工具链 → 规范审员在盲态下主动背书围栏在岗（本轮 M1 是围栏**覆盖面**缺口，是站在「围栏存在」之上的更深一层发现）；②snake/camel 双体系 → E9 的 110 函数收敛后仅剩 4 个局部变量（恰从 M1 的通配白名单漏过）+ 文件名风格 L；③lore/fandom 住 UI → 零复现，架构 M1（confirm 级联住 api 层）是同方向上**新采样的更深存量**，非同一条。
- **R4 其余 45 条零复现**；E 批 42 修复项复现率 0。F1-F4（本会话四批）同样零复现：a11y 零发现、别名/重扫零发现、TD-021 金标被测试审员点名背书（「已用 UPDATE_GOLDEN && !CI 正确围栏，非自证金标」）。
- **同族残边 2 条如实记账**：①E5 修 Object.hasOwn ×3 后，正确性 L1 翻出另 3 处裸读（机制根因未收敛——逐点打补丁的老教训第三次应验，建议 helper 单源一次收口）；②F1 给 title_generator 引擎侧补痕后，日志 L2 指出 UI 包装层（engine-chapters.ts:131）仍整段静默。
- **「修掉的不再来、每轮挖出新的」格局第五次成立**：本轮 12 M 中 11 条为前四轮从未点名的存量（唯 chapter_length 漂移属 R2 重复维同族但具体点位新）。

## 收官待决（只报不修，等拍板）

12 条 MEDIUM 按修复价值主审排序建议（非拍板，仅供参考）：

1. **正确性 M1（undo 边界）** —— 唯一有数据错误面的发现，修法一行边界过滤 + 判别测试，建议优先。
2. **重复 M3（chapter_length 1500/2000 漂移）** —— 用户可感知的不一致，单源常量半小时量级。
3. **日志 M1 + 测试 M2、规范 M1** —— 低风险高性价比（补痕/补测/收窄围栏配置）。
4. **架构 M1/M2、测试 M1** —— 结构性工程，建议独立批次排期（M1 尤其动核心编排，需 golden 护航）。
5. 其余 M 与 29 L —— 与历轮同性质渐进债，按「触碰顺手清」或专项小批。

是否开 G 批修复战役、修多深，等用户拍板。
