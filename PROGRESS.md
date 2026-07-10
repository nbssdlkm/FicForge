# FicForge 进度追踪

> 人读的前瞻进度文件（AI 地图见 CLAUDE.md，历史细节见 git log 与 `docs/internal/audit/`）。
> 约定：每个工作会话收尾时更新「当前状态」与「待办」；完成的待办移入「里程碑」一行带走。

## 当前状态（2026-07-09/10）

**2026-07-10 长期债②第三块**：SettingsChatPanel 状态下沉完成 —— 1026 行 God 组件 → 115 行纯编排层，按 hook 铁律拆 3 个职责单一 hooks（`useSettingsChatSupportData` 支撑数据 + freshness 缓存桥 / `useSettingsChatConversation` 消息流·输入·busy 全景 / `useSettingsChatToolActions` 工具卡确认·跳过·撤销·批量）+ 工具执行/撤销下沉为**纯 async 模块** `execute-settings-tool.ts`（不碰 React 状态，与简版 useSimpleToolExecutor 平行不合并）；跨 hook 只传 value 与语义化 method（`cacheLatestLoreFiles` / `begin·endPostMutationRefresh` / `findToolCard` 等），零裸 setter 外泄（`setInputText` 为受控绑定例外已注释）。渲染子组件 History/Input/ToolCallCard 本就齐全，第二阶段改为补回归测试：新增 4 用例锁 发消息出工具卡/确认→撤销全生命周期/发送失败回滚（输入不丢）/切上下文清空。验证：UI tsc 0 错 + 80 文件 508 用例全绿（+4）；preview 眼验 AU「改设定」+ Fandom资料 双模式面板渲染、无 key 发送→报错 toast→用户消息回滚→输入保留 全程零 console 报错（工具卡确认/撤销需真 LLM 响应，靠新回归测试锁）。

**2026-07-10 长期债②第四块**：FandomLoreLayout 状态下沉完成 —— 21 useState + 4 pending ref → 0（734 → 413 行），完全复制 AuSettingsLayout 打法拆 4 个职责单一 hooks（`useFandomLoreFiles` 侧栏数据+垃圾箱恢复 / `useFandomLoreEditor` 选中+编辑+增删改读 / `useFandomLoreChrome` 弹窗+AI面板+搜索+折叠 / `useFandomLoreDirtyGuard` 弃改确认，4 个互斥 pending ref 收敛为单判别联合）；跨 hook 全走语义化方法（appendFile/removeFile/invalidateInflightLoad 等），FandomLoreModals 契约同步去裸 setter；顺手抽 `FandomLoreCategory`/`fandomDirNameOf` 进 lore-utils 单一真相源 + 删除按钮补 aria-label。新增 9 条布局回归测试锁 加载回显/读入/保存 payload/弃改三分支/新建含重名拦截/删除级联/切 fandom 复位。验证：UI tsc 0 错 + 513 测试全绿（+9），preview 眼验 建圈→资料页→新建双分类→脏编辑弃改接续→保存→删除进垃圾箱→AI 面板开合 零 console 报错（顺手把 vite/launch.json 改成支持 PORT 改派端口，preview 不再抢 1420）。

**2026-07-10 长期债②第二块**：AuLoreLayout 状态下沉完成 —— 946 → 600 行、25 useState → 0（原台账记 26），完全复制 AuSettingsLayout 打法拆 4 hooks：`useAuLoreData`（project/角色/世界观双列表 + loadKey + trash token，列表局部更新走语义化方法）/ `useAuLoreEditor`（选中/正文/别名/预览/搜索/折叠，loadKey 触发 reconcile + 列表 ref shim）/ `useAuLoreModals`（四弹窗 + 新建名 + pin 里程碑横幅）/ `useAuLoreActions`（保存/删除/新建/导入/pin 五个写路径共用单一 isSaving 互斥闸 → 单 owner；deps 只传值+动词方法、整体 ref shim）；AuLoreModals props 语义化（setXxxOpen → closeXxx）。顺手修 3 个存量 bug：①`files` 列表误按当时 selectedCategory 拉取（停在世界观分类时切 AU/导入会把世界观列表灌进角色区）→ 固定拉 characters 并 reconcile 按分类对表；②新建/读失败路径不重置别名 → 上一文件的别名会被误写进新文件；③回收站恢复角色 `entity_name` 带 .md 后缀 → 列表显示 `x.md.md` 且 cast registry 被插入带后缀名（preview 实测抓到，修复 + 测试锁定）。新增 9 条布局回归测试（双列表加载判据/别名 round-trip/新建回滚链/删除清理/导入过滤+reload/pin 引导/回收站分流/切 AU）。验证：UI tsc 0 错 + 513 测试全绿（+9）+ i18n 1271 对称 + preview 双端眼验（桌面 1280 + 移动 375）零 console 告警。
**2026-07-10 长期债②移动端收尾两块**：MobileOnboarding 19 useState → 0（571 → 454 行，2 hooks：`useMobileOnboardingSettingsForm` 设置表单+水合+连接测试，表单默认值/水合/保存 payload 全复用既有 form-mappers 单一真相源 / `useMobileOnboardingFlow` 步进+首篇作品+提交收尾）+ MobileFandomView 17 useState → 0（405 → 289 行，3 hooks：`useMobileFandomFiles` 数据 / `useMobileFandomFileEditor` 详情读改存删 / `useMobileFandomViewChrome` 分类 tab+弹窗；顺手补切圈子详情态复位——原实现会残留上一圈选中文件）。新增 9 条回归测试（六步走完提交 payload / 连接测试门控 / 提交失败留错可重试 / 文件 CRUD / 切圈复位）。基础设施顺手：vite `server.port` 接受 PORT env 覆盖 + launch.json `autoPort`（并行会话 preview 端口冲突解，tauri dev 不受影响仍 1420）。验证：双 tsc 0 错 + UI 513 全绿（504+9）+ preview 375px 全链眼验（引导步进/表单值跨步保留/测试连接与下一步门控三态/圈子建-编-存-删-进垃圾箱/AI 助手开合）零 console 告警。

**2026-07-09 长期债②第一块**：AuSettingsLayout 状态下沉完成 —— 31 useState → 0（534 → 338 行），按 hook 铁律拆 4 个职责单一 hooks（`useAuSettingsData` 数据拉取 / `useAuSettingsForm` 表单+保存 / `useAuSettingsModals` 弹窗 / `useAuSettingsAdvancedOps` 高级操作）；表单收敛为 `AuSettingsFormState` 单对象，hydrate 以 loadKey 触发 + project 走 ref shim（cast 移除局部更新不吞未保存编辑）；新增 4 条布局回归测试锁 hydrate/保存 payload/切 AU 重灌/cast 移除。验证：UI tsc 0 错 + 415 测试全绿（+4），headless Chrome 真 UI 眼验 15 步（建 AU→设置页表单/保存 round-trip/双覆盖开合/四弹窗/recalc）零 console error。剩余五个大组件同打法逐会话复制。

**2026-07-09（夜）长期债③首批清偿：零测试 UI hooks 按风险清单①-⑦全部补齐。** 10 个新测试文件 / 102 用例，失败路径优先：useWriterBootstrap（auPath 切换竞态丢弃迟到响应 / 四路部分失败降级 / refresh 瞬时失败保旧值）、useConfirmedChapterEditor（保存失败保留用户改动）、writerDisplayState（章号口径回归 / meta 回退链 / 分层条占比）、useConnectionTest（reset 中断在途请求 / error_code→i18n 兜底映射 / 双 run 竞态）、useFontSelection（双层存储对称性 / persist 失败 warnUi / 同帧双 setter stale-closure 防护 / legacy 迁移）、facts 三 hook（批量失败保留选择 / AU 切换竞态 / stale 伪筛选判据）、library 两 hook（导入中建 fandom 断点续流 / 引导 vs API 警告分流门不对称失败策略）。引擎测试 LLM mock 迁移按「触碰才迁」门槛本次零对象（未触碰引擎测试文件）。质量验证三层：4 处变异验证（bootstrap stale 检查 / font ref 同步 / connection stale 检查 / editor catch 清空，均精准命中对应测试且不误伤）+ 独立对抗审 opus 判 **safe-with-nits**（无 HIGH/MEDIUM；采纳 2 LOW：失败清空断言改「先建立非空态再断言清空」+ 补切章 cancelled 竞态覆盖 + 台账文件数 9→10 笔误修正）。终验：引擎 1300 + UI 513（411→513）全绿、双 tsc 0 错。

**2026-07-09/10 盲审会话：网上下载 code-audit 技能做 9 维盲审（55/F 基线）→ 用户拍板「最全面最治本」→ A-H 八阶段修复全部完成（未提交，等确认）。** 盲审 86 条发现中产品关键四维（正确性/安全/功能实现/日志）全部清零；依赖漏洞双包清零（引擎 audit 0，UI 剩 1 条 dev-only LOW 被父包锁住）；单一真相源抽取（章节/草稿命名 9 处副本收敛 `domain/paths.ts`、平台适配器共享层、默认值单源）；仓储 get 契约统一（缺失=null / fs 错误=抛）；3 组 inert 配置 + WebDAV 序列化残留 + 8 个孤儿 API 物理清退；Tauri CSP/fs 收权；新增 30 测试（TaskRunner 从零到 12 用例，顺手修 1 真 bug）。修复后自评约 88.5/B。终验：引擎 1300 + UI 411 全绿、双 tsc 0 错、i18n 1271 对称。报告：`docs/internal/audit/2026-07-09-blind-audit-9dim.md`（含发现全录 + 修复对照 + 长期债清单）。

**2026-07-09 追加（worktree 分支 `claude/suspicious-mcnulty-c2dcb4`，未提交等确认）：长期债④ chat-to-llm 下沉引擎两步走完成**——kind union 正式化进 domain + 转换函数迁 `services/chat_to_llm.ts`，golden 基线证输出逐字节不变，双包 tsc + 测试全绿。详见里程碑「长期债④偿清」条。

**2026-07-10 长期债②第五块（worktree 分支 `claude/vigilant-turing-df40c1`，未提交等确认）：GlobalSettingsModal 状态下沉完成** —— 19 useState → 0（450 → 320 行），按 hook 铁律复制 AuSettingsLayout 打法拆 4 个 hooks（`useGlobalSettingsData` 数据拉取 / `useGlobalSettingsForm` 表单+脏检查基线+保存 / `useGlobalSettingsModals` 子弹窗 / `useReactExtractionPref` 提取开关即时保存+失败回滚）；表单收敛为 `GlobalSettingsFormState` 单对象，hydrate 以 loadKey 触发 + settings 走 ref shim；form-mappers 与保存 payload 零改动（盲审「有意不动」判定守住）。新增 4 条状态下沉回归测试（关→开重灌不残留 / 提取开关 hydrate+即时落库 / 落库失败回滚 / 加载失败基线保持 null），既有脏检查行为锁 4 条原样全绿。顺手：vite.config 端口支持 PORT 环境变量覆盖（默认仍 1420，tauri dev 不受影响；解决 preview 多会话端口冲突）。验证：双 tsc 0 错 + UI 508 测试全绿（504→508）+ preview 眼验全流程零 console 告警（hydrate 回显 / 脏检查弹确认+丢弃 / 保存 round-trip 关窗重开回显 / LLM 测试连接错误路径+改字段重置 / embedding 选商带出 apiBase+按钮门控 / 提取开关跨开关持久化）。

## 待办

### 需要人工（真机/异机，代码无法覆盖）
- [ ] **盲审修复批 push**（已分 5 commit 提交并合本地 main `647e67c`，origin 未 push，等人工确认）
- [ ] **长期债③测试批合入**（分支 `claude/zen-ramanujan-3e370b` 1 commit：10 测试文件 + PROGRESS，已过对抗审 + 变异验证，等人工说「合并」）
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
- [x] 巨型组件状态下沉（按 hook 铁律分批）：✅ AuSettingsLayout（2026-07-09，31 useState→0，4 hooks + 4 回归测试）；✅ AuLoreLayout（2026-07-10，25 useState→0，4 hooks + 9 回归测试 + 顺手修 3 存量 bug）；✅ SettingsChatPanel（2026-07-10，1026→115 行，3 hooks + 执行器纯模块 + 4 回归测试）；✅ FandomLoreLayout（2026-07-10，21 useState + 4 ref→0，4 hooks + 9 回归测试）；✅ GlobalSettingsModal（2026-07-10，19 useState→0，4 hooks + 4 回归测试）；✅ MobileOnboarding + MobileFandomView（2026-07-10，19+17 useState→0，5 hooks + 9 回归测试）。**六块全部清完，长期债②收官**
- [ ] 存量引擎测试的内联 LLM mock 迁移共享 helper（`services/__tests__/mock_llm_provider.ts` 已建；跟随性重构——哪个测试文件被触碰就顺手迁哪个，不做专门迁移趟）。UI hooks 测试补全已于 2026-07-09 首批清偿（见里程碑）。对抗审留的两条可选尾巴：useFactEditor saveSuccess 的 2s timer 无 clearTimeout（卸载后空转，无害泄漏，改需动 impl）；onboarding gate 三条静默负向断言依赖单次微任务冲刷（当前实现下已核实非假绿，impl 加深 await 链时需改 waitFor 正向信号）
- [ ] @vitejs/plugin-react 6.x（长期债⑤唯一剩项）：6.x 的 peer 依赖是 vite ^8.0.0（现 vite 7.3.6），待将来 vite 大版本升级时顺手带上；已停在 5.2.0（peer 兼容 vite ^4–^8）
- ✅ tailwind 4 浏览器底线：**已拍板（2026-07-10，用户）不考虑旧设备兼容**，按 Safari 16.4+ / Chrome 111+ 底线走；真机验证无需专门留意此项。（背景存档：旧设备上 var 基 /N 底纹会回退 100% 实心、同色对不可读；字面色遮罩不受影响）

## 里程碑（倒序）

- **2026-07-10（长期债②第三块）** — SettingsChatPanel 状态下沉：1026 行 God 组件 → 115 行编排层 + 3 hooks（supportData / conversation / toolActions）+ execute-settings-tool 纯 async 模块（执行/撤销 I/O 与 React 状态彻底分离；与简版 useSimpleToolExecutor 平行不合并，同一 helper 栈两种工具面）。跨 hook 零裸 setter，freshness 缓存经语义化 bridge 方法回写。新增 SettingsChatPanel 回归测试 4 用例（发消息出卡/确认→撤销全生命周期/失败回滚/切上下文清空）。UI tsc 0 + 508 全绿（+4）、preview 双模式眼验零 console 报错。
- **2026-07-10（续）** — 长期债⑤升级的 xhigh 档独立审阅（10 视角并行找 + 12 候选逐条对抗验证 + 补漏扫）：11 条入报告（2 medium 为 v4 hover 门控引入的真实触屏回归），全部当场修复 —— ①剧情线节点移除/AU 删除按钮加 `pointer-coarse:opacity-100`（触屏常显，二者均为对应操作唯一入口）②`dark:` 变体经 `@custom-variant` 接回 `.theme-night` 类开关（存量问题：183 处 dark:* 此前只跟 OS 深色模式走，四种组合修后全正确）③preflight 兜底边框色 #e5e7eb→`var(--color-rule)`（元素级穷举证实今天零消费、原值双主题不分）④engine readBinary/storage.read 类型收窄补全（与下载链同约定）⑤rule/N 修饰符防回潜守卫测试 ⑥tokens.ts/DESIGN-SYSTEM.md 3 处悬空 tailwind.config.ts 指针 + App.css 两处注释按实测校准。审阅另查明浏览器底线确切失效形态（已并入上方待办）。验证：引擎 1300 + UI 412（+1 守卫）全绿、双 tsc 0、build + i18n 对称、dist CSS 逐条实证、preview 探针活体验证（dark 接线四态 / 兜底色随主题 / 触屏规则编译落地）。
- **2026-07-10** — 长期债⑤ devDep 大版本升级 3 件：①@vitejs/plugin-react 4.x→5.2（6.x 被 vite ^8 peer 阻塞，留待办）②typescript ~5.8.3→~7.0.2 双包（UI tsconfig 删 baseUrl + engine 3 处 BufferSource 类型收窄，零运行时改动；连带 i18next/react-i18next 小版本刷新解 TS7 peerOptional 冲突）③tailwindcss 3.4→4.3（官方迁移工具两跑两崩 → 手动迁移：App.css 换 @import + `@theme inline` 规避 4 处同名自引用、postcss 换 @tailwindcss/postcss、删 tailwind.config.ts/autoprefixer/postcss、模板类名 v4 改名 55+ 处、preflight 兼容补丁、摘掉 4 处 v3 静默无效的 rule/N 修饰符防 v4 生效后线条变淡）。每步全套验证：引擎 1300 + UI 411 + 双 tsc 0 + build + i18n 1271；tailwind 另做 dist CSS 实证 + preview 全站眼验（明暗双主题 × 桌面/移动 × 库/对话/写文/弹窗，console 零报错）。
- **2026-07-09（长期债④偿清）** — chat-to-llm 两步下沉引擎：①消息 kind 判别 union 正式化进 `src-engine/domain/simple_chat.ts`（顶层消息 type alias 化使 union 直赋宽容壳、`asSimpleChatMessages` 唯一窄化点、ToolUndoMeta 一并入 domain），UI `simple/types.ts` / `settings-chat` 改薄 re-export，useSimpleChat 四处 `as unknown as` 双向 cast 清零，仓储宽容读取契约与测试零改动；②`chatToOpenAIMessages` 移至 `services/chat_to_llm.ts`（裸 console.warn 收编 warnAlways 日志纪律），UI 保薄 re-export 让 import 路径不变，14 用例行为测试随迁引擎。硬约束达成：搬前对旧实现捕获 golden 基线（32 消息固定输入全分支覆盖，JSON.stringify 全串 + 告警文案逐字节断言），搬后经 re-export 路径同基线全绿。引擎 1315 + UI 397 + 双 tsc 0 错。
- **2026-07-09（夜）** — 长期债③首批清偿：零测试 UI hooks 按风险优先级①-⑦全部补齐（10 测试文件 / 102 用例，失败路径优先于快乐路径；样板沿用 useLibraryMutations.test.tsx 的 renderHook + vi.mock engine-client 三类路径法）。覆盖异步编排竞态、破坏性写路径失败保留、双层存储对称性、纯派生函数。4 处变异验证证判别力 + 独立对抗审 opus 判 safe-with-nits（无 HIGH/MEDIUM，采纳 2 LOW）。UI 411→513 全绿、引擎 1300 不动、双 tsc 0 错。
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
