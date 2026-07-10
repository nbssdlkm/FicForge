# FicForge 进度追踪

> 人读的前瞻进度文件（AI 地图见 CLAUDE.md，历史细节见 git log 与 `docs/internal/audit/`）。
> 约定：每个工作会话收尾时更新「当前状态」与「待办」；完成的待办移入「里程碑」一行带走。

## 当前状态（2026-07-09/10）

**2026-07-09/10 盲审会话：网上下载 code-audit 技能做 9 维盲审（55/F 基线）→ 用户拍板「最全面最治本」→ A-H 八阶段修复全部完成（未提交，等确认）。** 盲审 86 条发现中产品关键四维（正确性/安全/功能实现/日志）全部清零；依赖漏洞双包清零（引擎 audit 0，UI 剩 1 条 dev-only LOW 被父包锁住）；单一真相源抽取（章节/草稿命名 9 处副本收敛 `domain/paths.ts`、平台适配器共享层、默认值单源）；仓储 get 契约统一（缺失=null / fs 错误=抛）；3 组 inert 配置 + WebDAV 序列化残留 + 8 个孤儿 API 物理清退；Tauri CSP/fs 收权；新增 30 测试（TaskRunner 从零到 12 用例，顺手修 1 真 bug）。修复后自评约 88.5/B。终验：引擎 1300 + UI 411 全绿、双 tsc 0 错、i18n 1271 对称。报告：`docs/internal/audit/2026-07-09-blind-audit-9dim.md`（含发现全录 + 修复对照 + 长期债清单）。

## 待办

### 需要人工（真机/异机，代码无法覆盖）
- [ ] **盲审修复批提交**（本会话工作区改动 ~110 文件，等人工说「提交」）
- [ ] Tauri 壳收权冒烟（盲审修复引入）：CSP 开启后桌面端全流程 + 导出到任意路径（依赖 v2 对话框自动入 scope）；构建机上顺手移除 tauri-plugin-http 的 Rust 注册 + npm 依赖（前端零调用）
- [ ] 真机日常写作流验证：改配置立即生效、切 tab 生成存活、PWA 更新横幅、iOS 刘海 safe-area、离线冷启动、低端机流式帧率
- [ ] 真 key 端到端**实跑** LLM 旅程剩项：backfill 实跑（本机浏览器够不到硅基流动 embedding，走代理才通）+ 自定义 chatPath 网关 + 纯 UI 点击层
- [ ] Android Manifest / variables.gradle 入库（文件在 Windows 构建机）
- [ ] 新 UI 的可视化眼验（需 seeded 数据，靠点击铺设不划算，留真机旅程）：归档候选徽标（带候选的 AU）、导入完成态引导（导 bundle/原始文件夹）

### 2026-07-09 大会话：第三轮审计闭环 + TD-017 + 最后一公里（5 commit 未 push）
- [x] **第三轮审计 MED 三修** `734eaa4`：①交互式接受事实改批量单锁落库（`addFactsBatch` 单锁 + 逐章存在性 CAS + `writtenIndices` 精确半成功去重，防并发 undo 插批次产生孤儿）②embedding 加 AbortSignal（与内部 30s 超时联动，取消 backfill 时在飞 embed 立即中止）③手动 fact 富化字段进 prompt（`buildFactEnrichmentSuffix` 门控改「无 _confidence=手动 ground truth 即注入；有=ReAct 按 gate」，ReAct 逐字节不变）。对抗审采纳 3 发现（Facts 页半成功去重 + 空串守卫 + slice 混章错位改 writtenIndices）。
- [x] **第三轮审计 LOW 三修** `f5d4c88`：①trash NaN 日期回退 deleted_at+retention（原恒 false 永不清）②file_fact revision 锁内基于磁盘自增（原锁外基于 caller 值，并发算出同 revision）③trash 恢复名对称（删除侧 remove 有条件、恢复侧 add 无条件的不幂等 → 删除时预判在册存 metadata、恢复据 flag 补）。对抗审精准定位 LOW-3。
- [x] **TD-017 根治（最后一条技术债）** `16fdc5b` + `622f093`(doc)：RagManager 改 per-AU 引擎实例（`Map<auPath, JsonVectorEngine>` + promise 缓存 get-or-create + LRU 驱逐），彻底消除跨 AU 共享内存竞态污染。对抗审两 MEDIUM 整改：in-flight load 被 evict 后 epoch 守卫防复活 + pin 在飞引擎防驱逐丢更新。
- [x] **最后一公里剩项** `47599a7`：①归档候选徽标（AU 设置扫候选数 → 高级操作按钮显示 N，提升可发现性）②导入完成态补记忆引导（RestoreBundleModal 成功后引导去「补全旧章记忆」，部分恢复告警如实透出）。
- [x] **两剩项治本**（用户追问「怎么还有剩项」→ 做完）`a8160d6`：①per-model 上下文窗口**可覆盖**——工作流 trace 证实生成端 `get_context_window` 优先认保存的 `context_window`（覆盖真生效非假功能），解锁权威模型 ctx 编辑 + 恢复默认 + 自动校正放宽为「仅空值 seed」②覆盖备份**进回收站列表**——`backupBeforeOverwrite` 写完 sidecar 后 append 单文件 TrashEntry（`overwrite_backup` 类型、`cast_registry_removed:false` 复用 LOW-3 门），restore/list/purge/permanent_delete 单文件分支原生正确、零改动。对抗审采纳 3 发现（backup id 4→8 位防碰撞、trashSource 检查前移、ctx 纳入脏快照）。

### 技术债
- ✅ **全部闭环**：TD-001…TD-017 全部已修复 / 已消解（2026-07-09 TD-017 收官）。

### 长期债（盲审 2026-07-09 判定为低息，渐进还）
- [ ] snake/camel 命名同文件混用（迁移遗产，5 文件 + React 组件声明风格）
- [ ] 巨型组件状态下沉（AuSettingsLayout 31 useState / AuLoreLayout / SettingsChatPanel / FandomLore / GlobalSettings / Mobile 两个，按 hook 铁律分批）
- [ ] UI hooks 测试补全（写文侧 useWriterBootstrap 等 / facts 三 hook / useConnectionTest / useFontSelection）+ 存量 LLM mock 迁移共享 helper（`services/__tests__/mock_llm_provider.ts` 已建）
- [ ] chat-to-llm 业务规则下沉引擎（前置：消息 kind schema 先在引擎 domain 正式化）
- [ ] @vitejs/plugin-react 6.x（长期债⑤唯一剩项）：6.x 的 peer 依赖是 vite ^8.0.0（现 vite 7.3.6），待将来 vite 大版本升级时顺手带上；已停在 5.2.0（peer 兼容 vite ^4–^8）
- [ ] tailwind 4 浏览器底线确认（产品层面）：v4 需要 Safari 16.4+ / Chrome 111+。审阅已查明确切失效形态：旧设备上不是「变淡」而是 96 条 var 基主题色 /N 底纹**回退为 100% 实心**（8% 底纹变整块实色、`bg-error/10 text-error` 同色对文字糊底不可读）；字面色 `bg-black/50` 遮罩不受影响（alpha 烘进回退值）—— 需确认目标用户群可接受，真机验证时留意

## 里程碑（倒序）

- **2026-07-10（续）** — 长期债⑤升级的 xhigh 档独立审阅（10 视角并行找 + 12 候选逐条对抗验证 + 补漏扫）：11 条入报告（2 medium 为 v4 hover 门控引入的真实触屏回归），全部当场修复 —— ①剧情线节点移除/AU 删除按钮加 `pointer-coarse:opacity-100`（触屏常显，二者均为对应操作唯一入口）②`dark:` 变体经 `@custom-variant` 接回 `.theme-night` 类开关（存量问题：183 处 dark:* 此前只跟 OS 深色模式走，四种组合修后全正确）③preflight 兜底边框色 #e5e7eb→`var(--color-rule)`（元素级穷举证实今天零消费、原值双主题不分）④engine readBinary/storage.read 类型收窄补全（与下载链同约定）⑤rule/N 修饰符防回潜守卫测试 ⑥tokens.ts/DESIGN-SYSTEM.md 3 处悬空 tailwind.config.ts 指针 + App.css 两处注释按实测校准。审阅另查明浏览器底线确切失效形态（已并入上方待办）。验证：引擎 1300 + UI 412（+1 守卫）全绿、双 tsc 0、build + i18n 对称、dist CSS 逐条实证、preview 探针活体验证（dark 接线四态 / 兜底色随主题 / 触屏规则编译落地）。
- **2026-07-10** — 长期债⑤ devDep 大版本升级 3 件（worktree 分支 3 commit，等确认）：①@vitejs/plugin-react 4.x→5.2（6.x 被 vite ^8 peer 阻塞，留待办）②typescript ~5.8.3→~7.0.2 双包（UI tsconfig 删 baseUrl + engine 3 处 BufferSource 类型收窄，零运行时改动；连带 i18next/react-i18next 小版本刷新解 TS7 peerOptional 冲突）③tailwindcss 3.4→4.3（官方迁移工具两跑两崩 → 手动迁移：App.css 换 @import + `@theme inline` 规避 4 处同名自引用、postcss 换 @tailwindcss/postcss、删 tailwind.config.ts/autoprefixer/postcss、模板类名 v4 改名 55+ 处、preflight 兼容补丁、摘掉 4 处 v3 静默无效的 rule/N 修饰符防 v4 生效后线条变淡）。每步全套验证：引擎 1300 + UI 411 + 双 tsc 0 + build + i18n 1271；tailwind 另做 dist CSS 实证 + preview 全站眼验（明暗双主题 × 桌面/移动 × 库/对话/写文/弹窗，console 零报错）。
- **2026-07-09/10** — 九维盲审（下载 nud3l/code-audit 技能 + 自定 3 维 + 透明评分公式，9 个 opus 盲审员并行，55/F 基线）→ 同日「最全面最治本」修复 A-H 八阶段：依赖漏洞双包清零（js-yaml 免大版本）、单一真相源大扫除（章节/草稿命名 9 副本→domain/paths、适配器共享层、默认值单源、prompt 块共享）、密钥 key 名泄露 5 处脱敏 + warnAlways 日志纪律、正确性 5 项（聊天保存失败回滚重试 / 导入顺序重排 / 向量原子写+损坏自愈 / RagManager pin 前移 / bundle 半成品清理）、死配置与孤儿管线物理清退、仓储 get 契约统一（顺手消灭 5 处吞 fs 错误的静默回退）、Tauri CSP/fs 收权、新增 30 测试修 1 真 bug。1277→1300 + 404→411 全绿。自评 55→88.5。
- **2026-07-09** — 第三轮审计 MED/LOW 全清（交互接受批量单锁 / embedding 可取消 / 手动 fact 富化 / trash NaN 清理 / revision 锁内自增 / 恢复名对称）+ **TD-017 根治**（RagManager per-AU 引擎，最后一条技术债）+ 最后一公里全部做完（归档徽标 / 导入补记忆引导 / per-model ctx 覆盖 / 覆盖备份进回收站）。7 commit 未 push；每批修→独立对抗审（opus）→判别性测试→提交，最后两项还先用工作流并行 trace 数据流确认可干净落地；累计采纳对抗审发现 11 条全整改。引擎 1262→1277、UI 391→404 全绿、双 tsc 0。**已知 bug / 技术债 / 审计待排 / 最后一公里全部闭环，代码层达可打包发布。**

- **2026-07-08（晚）** — 第三轮全量审计（4 维并行：harness 可靠性 / 记忆最后一公里 / 上下文组装 / 跨切面正确性）+ 治本修复批次（10 commit 未 push）：B2 全栈（含 React 陈旧徽标+刷新按钮）：M9 模式 A/B 双修、两处 fact-write HIGH 数据完整性、最后一公里 B1(caused_by 进 prompt) + B2(剧情线进展陈旧检测+按需重算)。引擎 1236→1262，两轮独立对抗审（各抓一条真 HIGH：salvage 静默截断 / 无，均整改）。
- **2026-07-08（下午）** — M9 JSON-break（模式 A）修复：Layer A（evidence 短/单行/免引号）+ Layer B（`salvageMalformedJson` 只补串内控制字符，model-agnostic）。独立对抗审 opus 抓出贪心引号启发式的 HIGH 静默截断风险 → 改成不猜引号只补控制字符 + 加防回归测试。引擎 1245 全绿、tsc 0 错。未提交。
- **2026-07-08** — 真 key 端到端验证：3 个 livetest 探针从 hardcode `api.deepseek.com` 改成读 `~/.deepseek/config.toml`（新 `_deepseek.ts` 单一真相源，配合 key 已切火山方舟 v4-flash-260425）+ 修 retrospective 探针 stale stub（`chapterRepo.get` 非 `get_content_only`）；跑通摘要/富化/回望/embedding（质量优，`BASELINE-v4flash.md`）；preview 走应用真实引擎模块验完整数据链（testConnection→建圈建 AU→导章→真 M9 提取→落库→同篇记忆→1M badge→backfill scan）。**发现 M9 v4-flash 间歇降级，待拍板（见待办）。**
- **2026-07-07/08** — 第二轮全量审计闭环（62 发现 + 四轮对抗审 40+ 项全整改）；结构性硬化：双面板常驻挂载、全平台真原子写、章级生成互斥、向量删除生命周期、safeMatter 解析加固、PWA prompt 更新；供应商模型选择器（方案 B）+ 新手引导接入 + 默认模型换 v4-flash；文档整理（审计报告入库、docs/README 索引、API-REFERENCE 标废弃）
- **2026-07-03** — 第一轮代码质量审计：9 发现 → 8 修 + push（trash 回滚/RAG 冷启动/archived 排除/CAS/提取钉章/backfill 取消）
- **2026-06-28 ~ 07-02** — 对话式 × 记忆栈融合 Phase 1-3：单一主力版（双 tab 恒并列、writing_mode 物理退役）、对话接受自动提取、「补全旧章记忆」工具
- **2026-06** — M7 架构简化（同步退役、sidecar 删除）；M8 记忆三层（Fact 富化/Thread/Summary）；M9 ReAct 提取；M10 回顾重写 + 冷热分层；真机全旅程验证
- **2026-04** — Writer 状态下沉重构（22 useState → 1）；D-0039 上下文预算重平衡；简版收敛 Phase 1/2
- **2026-02 ~ 04** — M0-M5 架构迁移：Python 后端 → TypeScript 统一引擎，三端（Tauri/Capacitor/PWA）落地
