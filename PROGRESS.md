# FicForge 进度追踪

> 人读的前瞻进度文件（AI 地图见 CLAUDE.md，历史细节见 git log 与 `docs/internal/audit/`）。
> 约定：每个工作会话收尾时更新「当前状态」与「待办」；完成的待办移入「里程碑」一行带走。

## 当前状态（2026-07-08）

供应商模型选择器 + 第二轮审计已 push origin/main。**2026-07-08 大会话：真 key 端到端旅程 + 第三轮全量审计（4 维）+ 一批治本修复 + 记忆栈最后一公里 B1/B2**——本地 main 领先 origin **10 个 commit（未 push，等发话）**，引擎 1262 全绿、双 tsc 0 错。

## 待办

### 需要人工（真机/异机）
- [ ] 真机日常写作流验证：改配置立即生效、切 tab 生成存活、PWA 更新横幅、iOS 刘海 safe-area、离线冷启动、低端机流式帧率
- [x] 真 key 端到端旅程（2026-07-08 跑完）：livetest 探针全跑 + preview 走应用真实引擎模块（testConnection→建圈建 AU→导章→**真 M9 提取→落库→列为同篇记忆**→1M 窗口 badge→补记忆 scan 入口）。摘要/富化/回望/embedding 质量优。**未做**：纯 UI 点击（弹窗/切 tab/badge 像素）+ backfill 实跑 LLM（本机浏览器够不到硅基流动 embedding，走代理才通）+ 自定义 chatPath 网关
- [x] `~/.deepseek` 配置模型名换 `deepseek-v4-flash`（配置已在 `deepseek-v4-flash-260425`/火山方舟；探针 hardcode 也已改成读 config 单一真相源）
- [ ] Android Manifest / variables.gradle 入库（文件在 Windows 构建机）

### 2026-07-08 大会话：治本修复 + 最后一公里（10 commit 未 push）
- [x] **M9 模式 A（JSON 写坏）** `32009be`：evidence 短/单行/免引号 + `salvageMalformedJson` 只补控制字符（对抗审砍掉贪心猜引号的 HIGH 静默截断）。
- [x] **两处 fact-write 数据完整性 HIGH** `d63cf95`：caused_by 幻觉过滤（loose-parse 绕过，被 salvage 放大）+ edit_fact 枚举运行时校验（旧 `v as FactStatus` 静默写坏 status）。
- [x] **M9 模式 B（模型不调工具）根治** `fc16bfe`：agent_loop per-iter tool_choice → 首轮强制 propose_facts + 补齐 forced_tool_choice 降级消费者 + 早停省 token。实测 v4-flash 接受强制、提议率显著上升；对抗审 opus 判 sound、simple_chat inert。
- [x] **最后一公里 B1：caused_by 进续写 prompt** `4f03db5`：build_facts_layer 解析 fact_id → 起因短句（控 token、防裸 id）。
- [x] **最后一公里 B2：剧情线进展陈旧检测 + 按需重算（全栈完）** `c60dc89`(引擎+API) + `554a72e`(React)：`computeThreadStaleness`（零 LLM）+ `regenerate_thread_state`（按需 LLM）+ THREAD_STATE prompt + `getStaleThreads`/`regenerateThreadState` API + ThreadDetail「陈旧徽标 + 刷新进展」按钮。真机眼验：徽标「有 N 条新进展，可能已过时」+ 刷新按钮端到端准确。
  - **已定（用户 2026-07-08 拍板）**：纯按需，不做 confirm 后自动重算（省 token）。日后如需"自动刷新"再加成开关。B2 收工。

### 第三轮审计其余待排（MED，未修）
- [ ] 交互式接受事实非批量锁（并发 undo 可插进批次产生孤儿事实）——mirror backfill 的单锁批量落库
- [ ] embedding 调用不带 AbortSignal（取消 backfill 时在飞 embed 跑满 30s + 白扣费）
- [ ] 手动创建的 fact 静默丢富化字段（只 ReAct 路径 synth `_confidence`；手动路径无 → location/known_to 进不了 prompt）
- [ ] LOW：trash NaN 日期永不清、file_fact revision 锁外自增、trash 恢复名不对称

### 其余最后一公里候选（未做）
- [ ] 归档候选自动提示 —— 功能在但用户发现不了
- [ ] 导入旧文 → 一键补记忆的引导衔接（杀手场景）
- [ ] 选择器 per-model 窗口值编辑；覆盖恢复备份进回收站列表

### 技术债
- [ ] TD-017：RagManager 跨 AU 向量竞态（open · 待排期，修法方向见 docs/TECH-DEBT.md）

## 里程碑（倒序）

- **2026-07-08（晚）** — 第三轮全量审计（4 维并行：harness 可靠性 / 记忆最后一公里 / 上下文组装 / 跨切面正确性）+ 治本修复批次（7 commit 未 push）：M9 模式 A/B 双修、两处 fact-write HIGH 数据完整性、最后一公里 B1(caused_by 进 prompt) + B2(剧情线进展陈旧检测+按需重算)。引擎 1236→1262，两轮独立对抗审（各抓一条真 HIGH：salvage 静默截断 / 无，均整改）。
- **2026-07-08（下午）** — M9 JSON-break（模式 A）修复：Layer A（evidence 短/单行/免引号）+ Layer B（`salvageMalformedJson` 只补串内控制字符，model-agnostic）。独立对抗审 opus 抓出贪心引号启发式的 HIGH 静默截断风险 → 改成不猜引号只补控制字符 + 加防回归测试。引擎 1245 全绿、tsc 0 错。未提交。
- **2026-07-08** — 真 key 端到端验证：3 个 livetest 探针从 hardcode `api.deepseek.com` 改成读 `~/.deepseek/config.toml`（新 `_deepseek.ts` 单一真相源，配合 key 已切火山方舟 v4-flash-260425）+ 修 retrospective 探针 stale stub（`chapterRepo.get` 非 `get_content_only`）；跑通摘要/富化/回望/embedding（质量优，`BASELINE-v4flash.md`）；preview 走应用真实引擎模块验完整数据链（testConnection→建圈建 AU→导章→真 M9 提取→落库→同篇记忆→1M badge→backfill scan）。**发现 M9 v4-flash 间歇降级，待拍板（见待办）。**
- **2026-07-07/08** — 第二轮全量审计闭环（62 发现 + 四轮对抗审 40+ 项全整改）；结构性硬化：双面板常驻挂载、全平台真原子写、章级生成互斥、向量删除生命周期、safeMatter 解析加固、PWA prompt 更新；供应商模型选择器（方案 B）+ 新手引导接入 + 默认模型换 v4-flash；文档整理（审计报告入库、docs/README 索引、API-REFERENCE 标废弃）
- **2026-07-03** — 第一轮代码质量审计：9 发现 → 8 修 + push（trash 回滚/RAG 冷启动/archived 排除/CAS/提取钉章/backfill 取消）
- **2026-06-28 ~ 07-02** — 对话式 × 记忆栈融合 Phase 1-3：单一主力版（双 tab 恒并列、writing_mode 物理退役）、对话接受自动提取、「补全旧章记忆」工具
- **2026-06** — M7 架构简化（同步退役、sidecar 删除）；M8 记忆三层（Fact 富化/Thread/Summary）；M9 ReAct 提取；M10 回顾重写 + 冷热分层；真机全旅程验证
- **2026-04** — Writer 状态下沉重构（22 useState → 1）；D-0039 上下文预算重平衡；简版收敛 Phase 1/2
- **2026-02 ~ 04** — M0-M5 架构迁移：Python 后端 → TypeScript 统一引擎，三端（Tauri/Capacitor/PWA）落地
