# FicForge 系统性优化路线图（2026-04-19）

> 基于当前代码库现状制定，目标不是“最低成本修补”，而是在保证功能持续可交付的前提下，系统性提升实现质量、减少冗余、增强健壮性、可维护性与可扩展性。
> 
> 适用范围：`src-engine/`、`src-ui/src/`
> 
> 制定依据：当前代码实现、模块边界、调用链、重复逻辑、异步模型与敏感数据流转路径。

## 一、目标与原则

### 1.1 总目标

本轮优化的目标不是局部“补洞”，而是建立一套更稳定的长期演进结构，使后续新增功能时：

- 不需要在多个页面和多个服务里重复拼装同一套逻辑
- 不需要依赖“调用方约定”来维持数据一致性
- 不会因为增加一个配置项或一个新入口而扩大敏感数据暴露面
- 不会因为某个 UI 大组件继续膨胀而提高回归风险
- 能够在移动端、桌面端、Web 端维持统一的业务语义与平台差异隔离

### 1.2 核心原则

1. 单一事实来源
   所有关键业务规则只允许在一个层级定义，UI 不自行推导路径、删除语义、默认值或凭据回退规则。

2. 面向用例而非面向大对象
   优先提供“明确语义的摘要查询 / 场景化查询 / 编辑查询 / 命令接口”，而不是把整份 `Settings` / `Project` 暴露给所有调用方自由读写。

3. 安全边界前置
   敏感信息默认不进入普通页面、不进入通用查询结果、不进入未脱敏日志。

4. 事务与异步模型统一
   所有关键写操作必须有明确的一致性边界；所有长链路异步都应使用统一的过期保护/串行化机制。

5. 渐进迁移，但不长期双轨
   可以分阶段迁移，但每一阶段都要明确“新增路径”“兼容层”“旧路径下线条件”，避免旧债永久共存。

6. 先收口，再拆分
   在拆大组件之前，先收紧 API 和数据契约；否则拆分只会把问题扩散到更多文件。

## 二、当前主要结构性问题

### 2.1 配置与项目对象暴露过宽

当前 `getSettings()`、`getProject()` 直接返回完整对象，普通 UI 页面也能读到完整配置与敏感字段。带来的问题：

- 普通页面只想知道“是否已配置”“当前字体设置”“pinned 数量”，却必须拿整份对象
- 调用方自行做派生判断，导致重复逻辑散落
- 凭据和敏感字段进入大量不需要它们的 React 状态与组件树
- 后续字段扩展会进一步放大耦合面

### 2.2 写接口过于通用，靠调用方维持正确性

当前 `updateSettings(updates)`、`updateProject(updates)` 属于宽泛 patch 接口：

- `updateSettings()` 是顶层浅合并的 read-modify-write
- `updateProject()` 直接 `Object.assign`
- 调用方必须知道哪些嵌套字段需要完整传、哪些字段会被覆盖、哪些字段要清空
- 并发写入、局部写入、嵌套对象扩展都容易继续产生隐性 bug

这类接口短期方便，长期会让所有新增功能都走上“页面自己拼 payload”的路径。

### 2.3 UI 侧 orchestration 过重，重复逻辑明显

当前已经出现两个典型信号：

- `WriterLayout.tsx` 既负责页面编排，又负责数据加载、生成流程、草稿管理、确认/撤销、focus、编辑 confirmed chapter 等多类流程
- `Library.tsx` 同时承担 onboarding 判定、导入目标选择、新建 fandom/AU、删除、trash、设置入口等职责

此外，LLM / Embedding / Sync 表单映射在多个页面重复出现：

- 全局设置
- AU 设置
- Onboarding
- 移动端 onboarding / 设置

这会导致：

- 同一规则修改需要改多个入口
- 平台差异逻辑在多个页面复制
- 新功能接入时只能继续复制已有实现

### 2.4 异步保护模式未统一

代码库里既有 `useActiveRequestGuard`，也有大量页面自己维护 `requestIdRef`、`modalRequestIdRef`、`connectionRequestIdRef` 等模式。

问题不只是“重复代码”，更严重的是：

- 不同模块的过期保护语义不一致
- 某些地方只防 stale，不防并发写覆盖
- 某些流程只保护 UI 状态，不保护底层一致性
- 新页面很容易继续复制旧模式，无法形成统一工程约束

### 2.5 一致性边界不够清晰

若干关键流程体现出“业务上是一次操作，落盘上却分多段提交”：

- 导入流程中，`ops/state` 提交与设定文件写入不在同一一致性边界
- 删除 AU/Fandom 的业务语义与底层实际删除对象不完全一致
- 同步冲突解决后的成功状态未完整回写

这些都说明系统里仍有不少“靠调用链约定而不是靠接口语义保证”的流程。

### 2.6 安全模型名义上存在，实质上未闭环

当前已经有 `secure_fields` 抽象和“YAML 不落明文”的方向，这是正确基础；但仍存在几个系统性问题：

- `secureGet/secureSet` 在多平台当前仍是明文 KV/localStorage 方案
- 非设置页也会拿到真实凭据
- UI 侧仍有原始错误对象 `console.error`
- 旧版明文迁移是“读到后写一份到 secure storage”，但不会立刻清理历史明文

这意味着“安全接口”已经存在，但“安全边界”还没有真正建立。

## 三、目标架构

## 3.1 分层目标

### Platform / Secret

- `PlatformAdapter` 继续负责文件与基础能力
- 新增明确的 `SecretStore` 能力层，负责敏感信息存取与迁移
- `secure*` 不再只是 KV 前缀语义，而是真正的凭据存储接口

### Repository

- Repository 只负责持久化对象与存储迁移
- 不负责页面语义、不负责 UI patch 兼容
- `SettingsRepository` / `ProjectRepository` 继续保留，但主要服务于用例层

### Service / Command

- 所有重要写操作收口为“用例命令”
- 例如：保存全局 LLM 配置、保存同步配置、保存 AU 覆盖配置、创建 AU、删除 AU、执行导入、恢复 trash
- 每个命令拥有明确输入、写边界、错误语义和副作用规则

### Query / Summary

- 所有页面默认通过“摘要查询”获取数据
- 摘要查询不返回敏感字段，只返回渲染或判断所需的数据

### UI

- 页面只负责渲染和触发命令
- 表单页面基于共享 mapper / form hook
- 大页面拆成 controller hooks + presentational components

## 3.2 配置与凭据边界目标

为避免 future feature 继续扩大耦合，配置相关接口拆成五类：

1. Summary Query
   返回普通页面真正需要的只读摘要，不含 secret

2. Scoped Query
   面向特定非编辑 use case 的窄查询，例如字体偏好、Writer 会话参数、Workspace 里程碑摘要。
   它仍不返回无关 secret，也不返回与当前用例无关的大对象字段。

3. Edit Query
   仅供设置页面读取可编辑数据，必要时返回真实 secret

4. Command
   明确语义的保存命令，而不是自由 patch

5. Secret Capability
   返回“是否存在 secret”“是否支持持久化”“是否为系统级安全存储”等能力位

## 3.3 异步模型目标

统一三类异步问题：

1. 视图过期保护
   防止导航切换后旧请求覆盖新状态

2. 写入串行化
   防止 read-modify-write 并发覆盖

3. 长流程一致性
   防止一次逻辑操作被拆成多段提交后出现“部分成功”

## 四、优化工作流拆分

## 4.1 工作流 A：配置/项目契约收口

### 目标

- 让配置和项目读写从“整对象自由读写”转向“摘要查询 + 显式命令”
- 降低 UI 冗余与 future feature 的扩散成本

### 主要动作

1. 新增只读摘要接口
   - `getSettingsSummary()`
   - `getProjectSummary(auPath)`

2. 新增场景化窄查询
   - `getFontPreferences()`
   - `getWriterSessionConfig(auPath)`
   - `getWorkspaceSnapshot(auPath)`

3. 新增编辑接口
   - `getSettingsForEditing()`
   - `getProjectForEditing(auPath)`

4. 新增显式保存命令
   - `saveGlobalLlmSettings(payload)`
   - `saveGlobalEmbeddingSettings(payload)`
   - `saveSyncSettings(payload)`
   - `saveAppPreferences(payload)`
   - `saveProjectWritingStyle(auPath, payload)`
   - `saveProjectLlmOverride(auPath, payload)`
   - `saveProjectEmbeddingOverride(auPath, payload)`
   - `saveProjectContextSettings(auPath, payload)`

5. 将 `updateSettings` / `updateProject` 逐步降级为内部兼容层
   - 不再作为新增功能默认入口
   - 标记为迁移期 API
   - 待调用点清空后下线

### 直接收益

- UI 不再反复构造嵌套 patch
- 每个保存动作有独立校验与错误语义
- 扩展配置项时不需要全站找 patch 逻辑

### 验收标准

- 普通页面不再直接依赖完整 `Settings` / `Project`
- 新增功能只通过命令接口写配置
- `updateSettings` / `updateProject` 不再有新增调用点

## 4.2 工作流 B：UI 表单与页面控制器重构

### 目标

- 消除配置类页面的重复映射逻辑
- 控制大组件膨胀
- 让后续新增功能更容易按能力插入，而不是继续堆进单文件

### 主要动作

1. 提炼共享 mapper
   - `mapSettingsToGlobalForm()`
   - `buildGlobalSettingsCommands()`
   - `mapProjectToAuSettingsForm()`
   - `buildAuSettingsCommands()`

2. 提炼共享表单 hook
   - `useGlobalSettingsForm`
   - `useAuSettingsForm`
   - `useLlmConnectionTest`
   - `useEmbeddingConnectionTest`

3. 统一 onboarding / settings 的连接配置表单
   - 抽象 `LlmConnectionForm`
   - 抽象 `EmbeddingConfigForm`
   - 抽象 `SyncConfigForm`

4. 拆分 `WriterLayout`
   推荐拆分顺序：
   - `useWriterBootstrap`
   - `useWriterGeneration`
   - `useWriterDrafts`
   - `useWriterFocus`
   - `useConfirmedChapterEditor`

5. 拆分 `Library`
   推荐拆分顺序：
   - `useLibraryOnboardingGate`
   - `useLibraryCreation`
   - `useLibraryImportSelection`
   - `useLibraryTrashActions`

### 直接收益

- 同一业务规则只改一处
- 页面更容易测试
- 新入口复用成本降低

### 验收标准

- GlobalSettings / AuSettings / Onboarding 不再各自手拼同类 payload
- `WriterLayout` 与 `Library` 的业务副作用明显减少
- 新增一个配置页或入口时，不再复制现有表单逻辑

## 4.3 工作流 C：异步、并发与一致性治理

### 目标

- 建立统一的请求过期保护与写入串行化方案
- 修复当前若干“部分提交”与“成功状态不完整”问题

### 主要动作

1. 统一 UI 侧请求保护
   - 基于 `useActiveRequestGuard` 或升级版统一替换散落的 `requestIdRef`
   - 规定场景：页面加载、切换选择、连接测试、导入分析、聊天请求

2. 为配置写入增加串行化
   - `settings` 写入建立 mutex / promise queue
   - `project` 写入按 `auPath` 建立串行队列

3. 导入流程重构一致性边界
   目标是明确以下三种方案之一并固化：
   - 方案 A：设定写入也进入同一提交边界
   - 方案 B：导入分阶段状态建模，只有完全 materialized 后才记 `ops`
   - 方案 C：拆成“章节导入”与“设定导入”两个显式命令，避免伪原子

4. 补齐成功状态回写
   - 统一同步完成后的 `last_sync` 落地逻辑
   - 统一冲突解决后的结果回写逻辑

5. 收敛删除/恢复的一致性语义
   - 明确“删除 AU/Fandom”到底是目录级软删除，还是锚点级隐藏
   - list / trash / restore / permanent delete 使用同一语义

### 直接收益

- 减少偶发 race 与状态错乱
- 降低同步、导入、删除类问题的排查成本
- 让后续长流程功能接入时有现成模型可用

### 验收标准

- 配置写入没有已知 read-modify-write 竞态
- 导入与同步成功状态具备完整一致性语义
- 删除 / restore / permanent delete 的用户语义与落盘语义一致

## 4.4 工作流 D：安全边界与凭据治理

### 目标

- 把“敏感字段不落 YAML”升级为“敏感字段只在必要范围内存在”
- 建立真实的安全存储能力

### 主要动作

1. 抽象 `SecretStore`
   推荐接口：
   - `get(key)`
   - `set(key, value)`
   - `remove(key)`
   - `has(key)`
   - `getCapabilities()`

2. 平台实现策略
   - Tauri：系统钥匙串 / Stronghold
   - Capacitor：Android Keystore / iOS Keychain
   - Web：默认仅会话保存；如需持久化，则明确为受限能力，不与原生平台等同

3. 明文迁移与回写清理
   - 检测旧版 YAML 明文
   - 迁移到 `SecretStore`
   - 立即回写脱敏后的 YAML
   - 不污染业务 `updated_at` / `revision`

4. 收紧 secret 暴露面
   - 普通 query 不返回真实 secret
   - 设置页以外不持有真实凭据
   - 连接测试只在专用上下文使用 secret

5. 统一日志脱敏
   - UI 侧错误日志统一走脱敏 logger
   - 禁止产品代码直接 `console.error(rawError)`
   - 错误回显使用白名单消息

### 直接收益

- 凭据暴露面显著缩小
- 新增功能不容易绕开安全边界
- 安全方案真正具备平台可演进性

### 验收标准

- 非设置页查询结果不含真实 secret
- 真实 secret 不再默认持久化到 localStorage
- 旧版明文迁移后可自动清理
- UI 原始错误对象不再直接输出到 console

## 4.5 工作流 E：业务语义统一与扩展点设计

### 目标

- 清理当前“名称看似一致、语义却不完全一致”的接口
- 为后续新增功能预留稳定扩展点

### 主要动作

1. 路径与命名规范化
   - 创建 fandom/AU 后，以返回的 canonical path 为唯一事实来源
   - UI 不再自行拼接规范化路径

2. 删除语义统一
   - 明确实体级删除模型
   - `TrashEntry` 明确标识实体类型、恢复范围、是否全树

3. 新功能扩展点前置定义
   - 配置新增字段通过命令接口落地
   - 页面新增流程通过 controller hook 接入
   - 平台差异统一经 capability / adapter 暴露

### 直接收益

- 后续加功能不会继续复制现有歧义
- 用户语义、接口语义、存储语义更一致

## 4.6 工作流 F：测试与回归防线重建

### 目标

- 不让这轮重构成为“结构更漂亮但更难验证”
- 建立针对关键架构边界的测试，而不是只测底层 repo round-trip

### 主要动作

1. 命令层测试
   - settings/project 命令接口
   - 导入一致性
   - 删除 / restore 语义

2. 安全测试
   - secret 不出现在 summary query
   - legacy 明文迁移后 YAML 已脱敏
   - logger 脱敏

3. UI 测试
   - 全局设置 / AU 设置 / onboarding 共享表单逻辑
   - sync 冲突解决后的状态回写
   - 创建 AU 后 canonical path 跳转

4. 关键集成测试
   - import → settings/worldbuilding → ops/state
   - delete → trash → restore → reopen

### 验收标准

- 重构后的关键用例都有命令层或集成层测试
- UI 测试不再只覆盖少量 API hook

## 五、分阶段落地计划

## Phase 0：方案冻结与边界定义

### 交付物

- 本路线图
- 配置/项目命令接口清单
- SecretStore 能力接口草案
- 删除语义与导入一致性方案选型

### 退出条件

- 明确 summary query / scoped query / edit query / command / secret capability 的划分
- 明确删除与导入的一致性语义

## Phase 1：先收口数据契约与敏感边界

### 目标

优先减少未来修改面的扩散风险。

### 主要实施

- 增加 `getSettingsSummary` / `getProjectSummary`
- 增加设置与项目的显式命令接口
- 普通页面迁移到 summary query
- 设置页保留 edit query
- 引入 UI 侧统一脱敏日志入口

### 退出条件

- 非设置页不再依赖含 secret 的宽 `Settings` / `Project`
- 普通页面默认通过 summary query 或 scoped query 读取所需信息
- 不再新增对 `updateSettings` / `updateProject` 的直接依赖

## Phase 2：统一表单映射与页面控制器

### 主要实施

- 抽共享 mapper 与 form hooks
- 重构 GlobalSettings / AuSettings / Onboarding
- 拆 `Library` 流程控制 hook
- 拆 `WriterLayout` 的 generation / drafts / focus / bootstrap

### 退出条件

- 连接测试、LLM/Embedding 映射逻辑只有一套实现
- `WriterLayout` / `Library` 的职责明显收敛

## Phase 3：一致性与删除模型治理

### 主要实施

- settings/project 写入串行化
- 导入一致性边界重构
- sync 冲突成功状态回写收口
- AU/Fandom 删除与恢复语义统一
- canonical path 强制使用返回值

### 退出条件

- 导入/同步/删除不存在已知语义不一致
- 核心长流程不再依赖隐式约定

## Phase 4：真实 SecretStore 接入与迁移

### 主要实施

- Tauri / Capacitor / Web SecretStore 实现
- legacy 明文检测、迁移、回写清理
- summary query 与 edit query 完成彻底分层

### 退出条件

- 多平台 secret 存储模型具备清晰能力说明
- 历史明文可自动清理

## Phase 5：测试补强与旧路径下线

### 主要实施

- 补命令层、集成层、UI 层测试
- 下线宽泛 patch API
- 删除迁移期兼容逻辑

### 退出条件

- 架构切换后的主要边界均有测试保护
- 旧 API 不再承载新功能

## 六、建议的文件级落点

## 6.1 建议新增

- `src-engine/security/secret-store.ts`
- `src-engine/security/tauri-secret-store.ts`
- `src-engine/security/capacitor-secret-store.ts`
- `src-engine/security/web-secret-store.ts`
- `src-ui/src/api/settings-summary.ts`
- `src-ui/src/api/project-summary.ts`
- `src-ui/src/api/settings-commands.ts`
- `src-ui/src/api/project-commands.ts`
- `src-ui/src/ui/settings/forms/global-settings-form.ts`
- `src-ui/src/ui/settings/forms/au-settings-form.ts`
- `src-ui/src/ui/settings/hooks/useGlobalSettingsForm.ts`
- `src-ui/src/ui/settings/hooks/useAuSettingsForm.ts`
- `src-ui/src/ui/writer/useWriterBootstrap.ts`
- `src-ui/src/ui/writer/useWriterGeneration.ts`
- `src-ui/src/ui/writer/useWriterDrafts.ts`
- `src-ui/src/ui/writer/useWriterFocus.ts`
- `src-ui/src/ui/library/useLibraryOnboardingGate.ts`
- `src-ui/src/ui/library/useLibraryCreation.ts`
- `src-ui/src/ui/library/useLibraryImportSelection.ts`

## 6.2 建议重点改造

- `src-ui/src/api/engine-settings.ts`
- `src-ui/src/api/engine-project.ts`
- `src-ui/src/api/engine-fandom.ts`
- `src-engine/services/import_pipeline.ts`
- `src-engine/services/trash_service.ts`
- `src-ui/src/ui/settings/GlobalSettingsModal.tsx`
- `src-ui/src/ui/settings/AuSettingsLayout.tsx`
- `src-ui/src/ui/onboarding/ApiConfigStep.tsx`
- `src-ui/src/ui/onboarding/MobileOnboarding.tsx`
- `src-ui/src/ui/writer/WriterLayout.tsx`
- `src-ui/src/ui/Library.tsx`
- `src-ui/src/hooks/useFeedback.tsx`

## 七、实施约束

1. 不做一次性“大爆炸重写”
   必须允许旧页面在迁移期继续运行，但新功能不得继续依赖旧接口。

2. 每个 Phase 必须可单独验收
   不能把真正的收益全部压到最后一个阶段。

3. 先建新路径，再迁移旧调用点
   不直接在旧接口上无限打补丁。

4. 不为了省事保留长期双轨
   每个迁移期接口都必须有明确下线条件。

5. 不把安全方案做成“文档安全、实现不安全”
   能力接口、平台实现、迁移与日志治理必须一起落地。

6. 不把“契约变更”“页面拆分”“存储语义变更”混在同一批改动
   每一批改动只改变一个主变量，避免功能回归时无法判断到底是接口、页面状态机还是持久化语义出了问题。

7. 非设置页去宽对象，不等于所有页面都只能用 summary
   `useFontSelection`、Writer 会话参数、Workspace 里程碑等页面允许使用 scoped query；真正要禁止的是“为了拿一个状态顺手拉整份含 secret 的大对象”。

8. 新命令接口在第一阶段必须保持行为等价
   尤其是清空字段、保留旧值、默认值补齐、override 回退规则，不得在“切接口”的同时顺手改语义。

9. 页面控制器拆分必须是结构重组，不得顺手改交互语义
   `WriterLayout`、`Library`、设置页、Onboarding 的重构批次里，不允许同时修改用户流程、校验时机、默认值来源或错误文案策略。

10. 项目写入串行化必须复用现有 AU 锁语义
    不在 repository 底层重复加锁，不新增与 `withAuLock` 竞争的第二套 project 级锁，避免重入死锁或锁顺序不一致。

11. 导入一致性治理优先选择“显式阶段模型”，而不是伪全局原子事务
    当前 `WriteTransaction` 的天然边界是 ops / state / chapter。若把 worldbuilding 文件写入强行纳入同一原子边界，必须先有失败恢复模型；否则优先选择 staged semantics。

12. SecretStore 迁移不得隐藏产品行为变化
    Web 端从“本地长期保存”改到“默认仅会话保存”属于用户可感知行为变化，必须带 capability 说明、迁移策略与 UI 提示，不能静默切换。

13. 旧数据与旧垃圾箱条目必须可兼容
    新删除语义、新 secret 迁移策略上线后，历史 `.trash` manifest、旧版 YAML 明文、旧路径规范化结果必须仍能 restore / reopen / resave。

## 八、完成标准

当以下条件同时满足时，可认为本轮系统性优化完成：

- 配置与项目读写不再依赖宽泛 patch 接口
- 普通页面默认无法接触真实 secret
- LLM / Embedding / Sync 表单映射不再多处重复
- `WriterLayout`、`Library` 已完成 controller 拆分
- 导入、同步、删除、恢复语义具备清晰一致性边界
- 多平台 secret 存储具备真实能力，而非明文伪装
- 关键命令、关键集成链路与关键 UI 流程都有测试保护

## 九、建议的执行优先级

如果资源有限，推荐按以下顺序推进：

1. Phase 1：配置/项目契约收口 + 普通页面去 secret
2. Phase 2：共享表单与大组件控制器拆分
3. Phase 3：导入/同步/删除一致性治理
4. Phase 4：SecretStore 真接入与 legacy 明文清理
5. Phase 5：测试补强与旧路径下线

这个顺序的核心原因是：

- 先收口契约，后面拆分不会继续扩散问题
- 先缩小敏感边界，再做安全存储，收益最大
- 先拆表单和控制器，再做新功能，后续迭代成本更低

## 十、结论

当前系统已经具备不错的引擎分层基础，但 UI 契约、命令边界、异步模型和安全边界还没有完全收拢，因此新增功能的真实成本正在逐步上升。

本方案的重点不是“修几个点”，而是把系统从“依赖调用方自律”推进到“依赖接口语义自证正确”。只有这样，后续继续加同步、任务、移动端、Agent、更多设置项时，代码才能保持稳定增长而不是持续堆债。
