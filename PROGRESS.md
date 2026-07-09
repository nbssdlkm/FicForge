# FicForge 进度追踪

> 人读的前瞻进度文件（AI 地图见 CLAUDE.md，历史细节见 git log 与 `docs/internal/audit/`）。
> 约定：每个工作会话收尾时更新「当前状态」与「待办」；完成的待办移入「里程碑」一行带走。

## 当前状态（2026-07-09）

**2026-07-09 大会话：第三轮审计 MED/LOW 全清 + TD-017 根治（最后一条技术债）+ 最后一公里剩项收尾。** 至此已知 bug / 技术债 / 审计待排全部闭环。本地 main 领先 origin **17 个 commit（未 push，等发话）**——本会话新增 5 个（`734eaa4`→`47599a7`）。引擎 1276 + UI 403 全绿、双 tsc 0 错、i18n 对称、工作区干净。**代码层面已达可打包发布**（剩余仅真机/异机人工验证，见下）。

## 待办

### 需要人工（真机/异机，代码无法覆盖）
- [ ] 真机日常写作流验证：改配置立即生效、切 tab 生成存活、PWA 更新横幅、iOS 刘海 safe-area、离线冷启动、低端机流式帧率
- [ ] 真 key 端到端**实跑** LLM 旅程剩项：backfill 实跑（本机浏览器够不到硅基流动 embedding，走代理才通）+ 自定义 chatPath 网关 + 纯 UI 点击层
- [ ] Android Manifest / variables.gradle 入库（文件在 Windows 构建机）
- [ ] 新 UI 的可视化眼验（需 seeded 数据，靠点击铺设不划算，留真机旅程）：归档候选徽标（带候选的 AU）、导入完成态引导（导 bundle/原始文件夹）

### 2026-07-09 大会话：第三轮审计闭环 + TD-017 + 最后一公里（5 commit 未 push）
- [x] **第三轮审计 MED 三修** `734eaa4`：①交互式接受事实改批量单锁落库（`addFactsBatch` 单锁 + 逐章存在性 CAS + `writtenIndices` 精确半成功去重，防并发 undo 插批次产生孤儿）②embedding 加 AbortSignal（与内部 30s 超时联动，取消 backfill 时在飞 embed 立即中止）③手动 fact 富化字段进 prompt（`buildFactEnrichmentSuffix` 门控改「无 _confidence=手动 ground truth 即注入；有=ReAct 按 gate」，ReAct 逐字节不变）。对抗审采纳 3 发现（Facts 页半成功去重 + 空串守卫 + slice 混章错位改 writtenIndices）。
- [x] **第三轮审计 LOW 三修** `f5d4c88`：①trash NaN 日期回退 deleted_at+retention（原恒 false 永不清）②file_fact revision 锁内基于磁盘自增（原锁外基于 caller 值，并发算出同 revision）③trash 恢复名对称（删除侧 remove 有条件、恢复侧 add 无条件的不幂等 → 删除时预判在册存 metadata、恢复据 flag 补）。对抗审精准定位 LOW-3。
- [x] **TD-017 根治（最后一条技术债）** `16fdc5b` + `622f093`(doc)：RagManager 改 per-AU 引擎实例（`Map<auPath, JsonVectorEngine>` + promise 缓存 get-or-create + LRU 驱逐），彻底消除跨 AU 共享内存竞态污染。对抗审两 MEDIUM 整改：in-flight load 被 evict 后 epoch 守卫防复活 + pin 在飞引擎防驱逐丢更新。
- [x] **最后一公里剩项** `47599a7`：①归档候选徽标（AU 设置扫候选数 → 高级操作按钮显示 N，提升可发现性）②导入完成态补记忆引导（RestoreBundleModal 成功后引导去「补全旧章记忆」，部分恢复告警如实透出）。核实 per-model ctx 编辑**已实现**（非权威模型本就可编辑）；覆盖备份进回收站**暂缓**（触 trash 核心、语义歧义、备份未丢，边际价值）。

### 技术债
- ✅ **全部闭环**：TD-001…TD-017 全部已修复 / 已消解（2026-07-09 TD-017 收官）。

## 里程碑（倒序）

- **2026-07-09** — 第三轮审计 MED/LOW 全清（交互接受批量单锁 / embedding 可取消 / 手动 fact 富化 / trash NaN 清理 / revision 锁内自增 / 恢复名对称）+ **TD-017 根治**（RagManager per-AU 引擎，最后一条技术债）+ 最后一公里剩项（归档徽标 / 导入补记忆引导）。5 commit 未 push；每批修→独立对抗审（opus）→判别性测试→提交，累计采纳对抗审发现 8 条全整改。引擎 1262→1276、UI 391→403 全绿、双 tsc 0。**已知 bug / 技术债 / 审计待排全部闭环，代码层达可打包发布。**

- **2026-07-08（晚）** — 第三轮全量审计（4 维并行：harness 可靠性 / 记忆最后一公里 / 上下文组装 / 跨切面正确性）+ 治本修复批次（10 commit 未 push）：B2 全栈（含 React 陈旧徽标+刷新按钮）：M9 模式 A/B 双修、两处 fact-write HIGH 数据完整性、最后一公里 B1(caused_by 进 prompt) + B2(剧情线进展陈旧检测+按需重算)。引擎 1236→1262，两轮独立对抗审（各抓一条真 HIGH：salvage 静默截断 / 无，均整改）。
- **2026-07-08（下午）** — M9 JSON-break（模式 A）修复：Layer A（evidence 短/单行/免引号）+ Layer B（`salvageMalformedJson` 只补串内控制字符，model-agnostic）。独立对抗审 opus 抓出贪心引号启发式的 HIGH 静默截断风险 → 改成不猜引号只补控制字符 + 加防回归测试。引擎 1245 全绿、tsc 0 错。未提交。
- **2026-07-08** — 真 key 端到端验证：3 个 livetest 探针从 hardcode `api.deepseek.com` 改成读 `~/.deepseek/config.toml`（新 `_deepseek.ts` 单一真相源，配合 key 已切火山方舟 v4-flash-260425）+ 修 retrospective 探针 stale stub（`chapterRepo.get` 非 `get_content_only`）；跑通摘要/富化/回望/embedding（质量优，`BASELINE-v4flash.md`）；preview 走应用真实引擎模块验完整数据链（testConnection→建圈建 AU→导章→真 M9 提取→落库→同篇记忆→1M badge→backfill scan）。**发现 M9 v4-flash 间歇降级，待拍板（见待办）。**
- **2026-07-07/08** — 第二轮全量审计闭环（62 发现 + 四轮对抗审 40+ 项全整改）；结构性硬化：双面板常驻挂载、全平台真原子写、章级生成互斥、向量删除生命周期、safeMatter 解析加固、PWA prompt 更新；供应商模型选择器（方案 B）+ 新手引导接入 + 默认模型换 v4-flash；文档整理（审计报告入库、docs/README 索引、API-REFERENCE 标废弃）
- **2026-07-03** — 第一轮代码质量审计：9 发现 → 8 修 + push（trash 回滚/RAG 冷启动/archived 排除/CAS/提取钉章/backfill 取消）
- **2026-06-28 ~ 07-02** — 对话式 × 记忆栈融合 Phase 1-3：单一主力版（双 tab 恒并列、writing_mode 物理退役）、对话接受自动提取、「补全旧章记忆」工具
- **2026-06** — M7 架构简化（同步退役、sidecar 删除）；M8 记忆三层（Fact 富化/Thread/Summary）；M9 ReAct 提取；M10 回顾重写 + 冷热分层；真机全旅程验证
- **2026-04** — Writer 状态下沉重构（22 useState → 1）；D-0039 上下文预算重平衡；简版收敛 Phase 1/2
- **2026-02 ~ 04** — M0-M5 架构迁移：Python 后端 → TypeScript 统一引擎，三端（Tauri/Capacitor/PWA）落地
