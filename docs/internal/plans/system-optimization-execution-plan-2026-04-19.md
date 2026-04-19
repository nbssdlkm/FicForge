# FicForge 系统优化执行细化方案（2026-04-19）

> 本文是 [system-optimization-roadmap-2026-04-19.md](D:\fanfic-system\docs\internal\plans\system-optimization-roadmap-2026-04-19.md) 的执行层细化版。
> 
> 路线图解决“为什么做、按什么顺序做”；本文解决“每个阶段具体做什么、做完会看到什么变化、如何衡量效果”。

## 一、执行目标

本轮优化不追求“最省力改法”，而追求四件事同时成立：

- 功能实现不退化，现有主流程可持续交付
- 冗余逻辑明显下降，业务规则不再散落多处
- 健壮性提升，关键链路不再依赖隐式约定维持正确
- 后续新增功能有稳定扩展点，不必继续堆在大页面和宽泛 patch 上

## 二、当前基线

以下基线来自当前代码扫描，后续可作为验收对照：

| 指标 | 当前基线 | 说明 |
|------|----------|------|
| UI 中直接调用 `getSettings()` 的调用点 | 9 处 | 普通页面与设置页混用完整 settings 对象 |
| UI 中直接调用 `getProject()` 的调用点 | 10 处 | 摘要需求与编辑需求未分层 |
| 手写 `requestIdRef` 类异步防过期文件 | 13 个文件 | 已有共享 guard，但未统一落地 |
| 产品代码中的原始 `console.error` | 2 处 | UI 脱敏日志尚未统一 |
| `WriterLayout.tsx` 规模 | 1213 行，约 25 个 `useState` | 页面、流程、状态、异步副作用混合 |
| `Library.tsx` 规模 | 454 行 | onboarding、创建、导入、删除、trash、settings 混在一起 |
| UI 测试模块数量 | 3 个 | 对设置、导入、删除/恢复、移动端覆盖不足 |
| LLM / Embedding / Sync 表单实现 | 多入口重复维护 | Global Settings / AU Settings / Onboarding / Mobile |

## 三、可行性复核结论

当前计划总体可行，但前提是把“兼容性”和“行为等价”当成第一约束，而不是默认把结构优化与功能语义调整绑在一起推进。

复核后的结论如下：

- 这套计划不会天然破坏现有功能，但只有在“先加新路径、再做行为对照、最后迁移旧调用点”的顺序下才安全。
- 当前文档里“普通页面迁到 summary query”的表述需要收紧。现实代码里，`useFontSelection`、`useSessionParams`、Workspace 里程碑、Onboarding 默认值读取都不是纯 summary 需求；它们需要的是 scoped query，而不是继续拿整份带 secret 的宽对象。
- `WriterLayout`、`Library`、设置页、Onboarding 的拆分是可行的，但只能做结构重组，不能与默认值规则、字段清空规则、连接测试规则的改变混在同一批。
- `SecretStore` 真接入是必要的，但 Web 端“默认仅会话保存”会改变现有体验，必须作为显式产品行为变化处理，而不是实现层静默替换。
- 导入一致性治理可行，但更适合走“显式阶段模型”而不是伪全局原子事务；当前 `WriteTransaction` 的天然边界是 ops / state / chapter，不是任意文件系统写入。
- 删除语义统一可行，但必须兼容历史 `.trash` manifest 和旧删除条目；否则恢复链路会先被新语义打断。

## 四、新增实施约束

1. 每一批改动只允许改变一个主变量
   同一批改动里只能四选一：改契约、改页面结构、改存储语义、改业务语义。禁止把它们叠在一起。

2. 宽对象迁移目标要从“所有非设置页不用 getSettings/getProject”改为“所有非编辑页不再依赖含 secret 的宽对象”
   非编辑页允许使用 scoped query，但必须是窄接口、无无关 secret、无无关大对象字段。

3. 新 command/query 在第一阶段必须保持行为等价
   尤其是以下规则不能顺手改变：字段清空、override 回退、默认值补齐、空字符串语义、连接测试参数选择。

4. 页面拆分不得顺手改交互
   `WriterLayout`、`Library`、设置页、Onboarding 的 controller 拆分阶段，只允许做职责迁移，不允许同时改步骤数、错误提示、保存时机、初始值来源。

5. Project 写入串行化只能复用现有 `withAuLock`
   不新增 repository 底层锁，不在已持锁 service 的下层再次加锁，避免重入死锁。

6. Secret 迁移不能绑定在普通读取路径上做隐式破坏性写回
   旧版明文 YAML 的清理必须走显式、幂等、可恢复的迁移步骤；不能在普通 `get()` 中直接重写业务文件并污染 `updated_at` / `revision`。

7. Web 端 secret 持久化策略变更必须带用户可见说明
   若从“长期保存”调整为“仅会话保存”，必须在设置页/Onboarding 显示能力说明和影响范围。

8. 导入一致性治理优先保证“结果可解释”
   如果暂时无法做到单边界原子，就必须把状态显式建模成阶段，而不是保留“UI 看似成功、底层部分完成”的灰态。

9. 删除语义切换必须兼容旧垃圾箱条目
   新旧 `TrashEntry` 必须都能 list / restore / permanent delete；否则不能切换默认模型。

10. 任何移除旧接口的动作都必须建立在行为对照完成之后
    对照至少覆盖：Global Settings、AU Settings、Mobile Onboarding、Writer 会话参数、字体持久化、Sync 冲突解决、Trash 恢复。

## 五、分阶段任务包

## Phase 0：边界冻结与选型定稿

### P0-1：接口边界冻结

#### 目标

明确五类接口边界，防止后续实现继续边做边改语义：

- `summary query`
- `scoped query`
- `edit query`
- `command`
- `secret capability`

#### 主要产出

- 一份接口清单
- 一份旧接口迁移映射表

#### 输出样式建议

| 旧接口 | 新归属 | 保留/废弃 | 下线条件 |
|--------|--------|-----------|----------|
| `getSettings()` | `getSettingsSummary()` / `getSettingsScopedQuery()` / `getSettingsForEditing()` | 迁移期保留 | 宽对象调用点清空 |
| `getProject()` | `getProjectSummary()` / `getProjectScopedQuery()` / `getProjectForEditing()` | 迁移期保留 | 宽对象调用点清空 |
| `updateSettings()` | 显式 command 集合 | 迁移期保留 | 新增功能禁用 |
| `updateProject()` | 显式 command 集合 | 迁移期保留 | 新增功能禁用 |

#### 预期效果

- 后续每个改动都知道应落在哪层
- 团队不会继续把“页面自己 patch 大对象”当成默认方案

### P0-2：一致性语义选型

#### 目标

把当前最容易变成返工的三件事一次定死：

1. 导入流程的一致性边界
2. AU/Fandom 删除语义
3. trash 恢复后的 secret 行为与 UI 提示

#### 需要形成的结论

- 导入是“强原子”还是“显式分阶段”
- 删除是“实体级软删除”还是“锚点级隐藏”
- `restore` 后是否要求重新输入 API key / WebDAV 密码

#### 预期效果

- Phase 3 不会被架构讨论反复打断
- 删除与恢复逻辑不再继续临时补丁式演化

## Phase 1：收口配置/项目契约与敏感边界

### P1-1：Settings 查询分层

#### 目标

把“含 secret 的完整 settings 对象”从普通页面里移出去。

#### 实施内容

- 新增 `getSettingsSummary()`
- 新增 `getFontPreferences()`
- 新增 `getWriterSessionConfig(auPath?)`
- 新增 `getOnboardingDefaults()`
- 新增 `getSettingsForEditing()`
- 新增 `getSettingsSecretCapabilities()`

#### Summary 建议包含

- 默认模型是否已配置
- embedding 是否已配置
- sync 是否已启用
- 字体配置
- 语言、主题等非敏感偏好

#### 不应包含

- `default_llm.api_key`
- `embedding.api_key`
- `sync.webdav.password`

#### 首批迁移调用点

- `Library.tsx` → `getSettingsSummary()`
- `useFontSelection.ts` → `getFontPreferences()`
- `useSessionParams.ts` / `WriterLayout.tsx` → `getWriterSessionConfig()`
- `MobileOnboarding.tsx` → `getOnboardingDefaults()`

#### 预期效果

- 普通页面不再默认把真实 secret 拉进状态树
- 读取配置的页面开始按“摘要 / 场景化 / 编辑”三种查询分流，而不是继续混用宽对象

### P1-2：Project 查询分层

#### 目标

把摘要需求、场景化需求和编辑需求拆开。

#### 实施内容

- 新增 `getProjectSummary(auPath)`
- 新增 `getWorkspaceSnapshot(auPath)`
- 新增 `getWriterProjectContext(auPath)`
- 新增 `getProjectForEditing(auPath)`
- 新增 `getProjectCapabilities(auPath)`

#### Summary 建议包含

- 基本展示字段
- pinned 数量
- cast_registry 摘要
- 当前 AU 是否有 LLM override / embedding override
- index 状态摘要

#### 首批迁移调用点

- `AuWorkspaceLayout.tsx` → `getWorkspaceSnapshot()`
- `WriterLayout.tsx` / `useSessionParams.ts` → `getWriterProjectContext()`
- `AuLoreLayout.tsx` → `getProjectForEditing()` 或专用 lore query

#### 预期效果

- Writer / Workspace / Lore 不再默认依赖完整宽 Project 对象
- AU 级摘要信息获取更加稳定、轻量

### P1-3：显式 command 接口

#### 目标

停止继续扩散宽泛 patch 写法。

#### 建议新增命令

- `saveGlobalLlmSettings`
- `saveGlobalEmbeddingSettings`
- `saveSyncSettings`
- `saveAppPreferences`
- `saveProjectWritingStyle`
- `saveProjectLlmOverride`
- `saveProjectEmbeddingOverride`
- `saveProjectContextSettings`

#### 命令接口要求

- 输入结构固定
- 内部完成校验、默认值补齐、清空策略
- 返回明确结果，不暴露底层 patch 细节

#### 预期效果

- 新增配置功能时不再需要每个页面自己拼 payload
- 嵌套对象结构变化不会继续把风险推给调用方

### P1-4：普通页面去 secret

#### 目标

让真实 secret 只出现在真正需要编辑或测试连接的上下文。

#### 实施内容

- 非设置页统一改用 summary query 或 scoped query
- 连接测试走专用 edit query + command 路径
- 禁止普通页面持有完整 settings/project 作为“顺手拿来判断状态”的手段

#### 预期效果

- secret 暴露范围显著缩小
- 普通 UI 组件不再携带不必要的敏感字段

### P1-5：UI 日志脱敏入口

#### 目标

UI 层不再直接输出原始错误对象。

#### 实施内容

- 新增 `logUiError(tag, err, ctx?)`
- 替换 `useFeedback.tsx` 和 `App.tsx` 的原始 `console.error`
- 统一 UI 错误消息的白名单回显策略

#### 预期效果

- 错误日志治理与 engine logger 开始对齐
- UI 层不会继续扩散原始异常对象

## Phase 2：表单共享与大页面控制器拆分

### P2-1：共享 mapper / form hooks

#### 目标

把 LLM / Embedding / Sync 的序列化和连接测试规则从页面里抽出来。

#### 实施内容

- 抽 `mapSettingsToGlobalForm`
- 抽 `buildGlobalSettingsCommands`
- 抽 `mapProjectToAuSettingsForm`
- 抽 `buildAuSettingsCommands`
- 抽 `useLlmConnectionTest`
- 抽 `useEmbeddingConnectionTest`

#### 预期效果

- 同一序列化/校验规则只维护一套
- Global Settings / AU Settings / Onboarding 的底层规则开始统一，但页面交互层仍可保留各自差异

### P2-2：Global Settings / AU Settings 迁移

#### 目标

把两个设置页切到共享 form hook 与 command。

#### 预期效果

- 修一个配置 bug，不再需要同时改两个设置页
- 平台差异逻辑不再在多个页面重复判断

### P2-3：Onboarding 迁移

#### 目标

让 onboarding 复用设置体系的底层规则，而不是保留第二套实现。

#### 实施内容

- 复用 LLM connection form
- 复用 embedding config form
- 统一 connection test 调用路径

#### 预期效果

- onboarding 不再持续演化出和设置页不同的底层规则
- 后续新增模型模式时，不需要同时维护两到三套序列化/测试逻辑

### P2-4：Library 控制器拆分

#### 目标

把 `Library.tsx` 从“大容器 + 全流程状态仓库”转成编排层。

#### 拆分建议

- `useLibraryOnboardingGate`
- `useLibraryCreation`
- `useLibraryImportSelection`
- `useLibraryTrashActions`

#### 预期效果

- `Library.tsx` 主文件明显瘦身
- 后续接入更多首页能力时，有稳定挂点

### P2-5：Writer 控制器拆分

#### 目标

减少 `WriterLayout.tsx` 的职责密度。

#### 拆分建议

- `useWriterBootstrap`
- `useWriterGeneration`
- `useWriterDrafts`
- `useWriterFocus`
- `useConfirmedChapterEditor`

#### 预期效果

- Writer 主文件从业务逻辑中心退化为页面壳
- 生成、草稿、focus、编辑等能力可独立演进和测试

## Phase 3：一致性与删除模型治理

### P3-1：settings/project 写入串行化

#### 目标

让并发写冲突由接口层吸收，而不是靠 UI 避开。

#### 实施内容

- `Settings` 全局写入单队列
- `Project` 按 `auPath` 写入队列

#### 预期效果

- read-modify-write 竞态从系统层减少
- 未来新增写入口时不必重复考虑并发覆盖

### P3-2：导入一致性边界重构

#### 目标

修复“业务上一次导入，落盘上多段提交”的问题。

#### 实施内容

- 基于 Phase 0 选型重构 `import_pipeline.ts`
- 补导入完成态与失败态的统一建模

#### 预期效果

- 不再出现 `ops/state` 已提交但 worldbuilding 尚未写完的中间态
- import 的成功语义可解释、可测试

### P3-3：删除 / trash / restore 统一

#### 目标

统一用户语义、存储语义和 UI 表达。

#### 实施内容

- 明确实体级删除模型
- `TrashEntry` 明确恢复范围
- `permanent delete` 语义与真实删除范围保持一致

#### 预期效果

- 删除 AU/Fandom 后不会再出现“看似删了但底层仍残留主体文件”的歧义
- Trash 面板与引擎层语义对齐

### P3-4：同步结果回写收口

#### 目标

统一同步成功与冲突解决成功后的持久化逻辑。

#### 实施内容

- 统一 `last_sync` 的更新与持久化
- 普通成功、逐个冲突解决成功、批量解决成功使用同一收口逻辑

#### 预期效果

- UI 成功状态与设置持久化状态一致

### P3-5：canonical path 强制收口

#### 目标

路径规范化只能在 API/服务层定义一次。

#### 实施内容

- `createFandom` / `createAu` 返回 canonical path
- 调用方统一消费返回值

#### 预期效果

- 路径清洗规则修改时不会再出现 UI 自己拼错路径

## Phase 4：真实 SecretStore 与 legacy 明文清理

### P4-1：SecretStore 抽象落地

#### 目标

从“secure 命名”升级到“真实安全存储能力”。

#### 接口建议

- `get`
- `set`
- `remove`
- `has`
- `getCapabilities`

#### 预期效果

- secret 存储能力成为系统级能力，而不是 adapter 的命名约定

### P4-2：多平台实现

#### 目标

按平台提供真正可解释的 secret 策略。

#### 平台策略

- Tauri：系统钥匙串 / Stronghold
- Capacitor：Keychain / Keystore
- Web：默认仅会话保存；如支持持久化，必须标明是受限能力，并在 UI 中明确告知行为变化

#### 预期效果

- 各平台的安全能力边界清晰透明

### P4-3：legacy 明文迁移与安全回写

#### 目标

不只“复制一份到 secure storage”，而是清理旧明文。

#### 要求

- 迁移后立即回写脱敏 YAML，但迁移动作必须是显式、幂等、可恢复的，不绑定在普通读取路径上
- 不污染业务 `updated_at` / `revision`
- 能幂等运行

#### 预期效果

- 历史明文残留面逐步清空

### P4-4：查询面彻底去 secret

#### 目标

把“谁能拿到真实 secret”变成可解释规则，而不是碰巧如此。

#### 预期效果

- secret 只在 edit/query 与连接测试链路存在
- 普通 query 和普通页面不再接触真实 secret

## Phase 5：测试补强与旧路径下线

### P5-1：命令层测试

#### 目标

给新 command/query 架构建立稳定回归防线。

#### 覆盖重点

- settings/project commands
- import consistency
- delete/restore semantics
- secret migration

#### 预期效果

- 命令层成为主要质量防线，而不是继续只测 repo round-trip

### P5-2：UI 测试

#### 覆盖重点

- Global Settings
- AU Settings
- Onboarding
- Sync conflict resolution
- canonical path navigation

#### 预期效果

- 关键交互不再只依赖人工验证

### P5-3：集成测试

#### 覆盖重点

- import -> settings/worldbuilding -> ops/state
- delete -> trash -> restore -> reopen
- project/settings summary vs edit query behavior

#### 预期效果

- 跨层链路的语义一致性可持续验证

### P5-4：旧路径下线

#### 目标

完成迁移闭环，不留下长期双轨。

#### 主要动作

- 限制并最终删除 `updateSettings` / `updateProject` 作为通用入口
- 删除旧表单拼装逻辑
- 删除迁移期兼容分支

#### 预期效果

- 代码库复杂度真正下降，而不是“新架构加在旧架构旁边”

## 六、各阶段完成后的可见效果

## 4.1 Phase 1 完成后

- 普通页面不再默认拿完整 settings/project
- 配置项新增开始通过 command 落地
- secret 暴露面明显收缩

## 4.2 Phase 2 完成后

- 设置页与 onboarding 使用统一规则
- Writer / Library 主文件明显瘦身
- 修配置类问题时改动面显著变小

## 4.3 Phase 3 完成后

- 导入、同步、删除、恢复的结果语义开始稳定
- 部分成功与状态撕裂类问题显著下降

## 4.4 Phase 4 完成后

- 多平台 secret 存储不再是明文伪装
- 历史明文迁移可自动清理

## 4.5 Phase 5 完成后

- 新架构被测试和下线路径固化
- 后续功能迭代可以围绕 command/query/form hook/controller hook 持续演进

## 七、建议目标值

| 指标 | 当前基线 | 建议目标 |
|------|----------|----------|
| UI 中直接调用 `getSettings()` 的调用点 | 9 处 | 旧宽对象调用点归零；由 summary/scoped/edit query 替代 |
| UI 中直接调用 `getProject()` 的调用点 | 10 处 | 旧宽对象调用点归零；由 summary/scoped/edit query 替代 |
| 手写 `requestIdRef` 类异步防过期文件 | 13 个文件 | 收敛到 3 个以内特例，其余统一共享 guard |
| 产品代码中的原始 `console.error` | 2 处 | 0 |
| `WriterLayout.tsx` 主文件 | 1213 行 / 约 25 个 `useState` | 主文件降到 400-600 行区间，流程逻辑外提 |
| `Library.tsx` 主文件 | 454 行 | 降到 200-280 行区间 |
| UI 测试模块数量 | 3 个 | 增长到 8 个以上关键模块 |
| 非设置页持有真实 secret 的场景 | 多处存在 | 0 |
| 桌面/移动端 secret 落盘方式 | 明文 KV/localStorage | 系统级安全存储 |

## 八、预期收益

## 6.1 对开发效率

- 新增一个配置项时，改动范围预计从“多个页面 + 多个 patch 调用点”收敛到“command + mapper + form component”。
- 配置类 bug 修复会从“全局搜 payload”转向“修改共享命令或共享 mapper”。

## 6.2 对健壮性

- 导入、同步、删除、恢复等链路的中间态和部分成功问题会明显下降。
- 写入竞态从页面绕开转为接口层治理。

## 6.3 对可维护性

- 大页面主文件瘦身后，阅读路径更短，修改风险更可控。
- 表单和配置规则共享后，未来修改的影响面更小。

## 6.4 对可扩展性

- 后续新增更多设置项、平台差异、任务能力、Agent 能力时，有稳定扩展点可挂接。
- 新页面不必继续复制旧页面的 form 和 request guard 实现。

## 九、执行中的判断标准

如果后续实施过程中出现以下情况，说明方案开始偏离目标，需要及时校正：

- 新功能仍然优先走 `updateSettings` / `updateProject`
- 普通页面仍然为了一个状态去拿完整、含 secret 的 settings/project
- 新页面继续复制一份连接测试、表单映射或 `requestIdRef`
- 安全方案只改接口名，没有改变真实存储与暴露面
- 迁移期兼容逻辑没有明确下线时间
- 页面拆分批次里混入默认值规则、错误文案、连接测试行为变化
- Web 端 secret 持久化策略变化没有用户可见说明

如果出现以下信号，说明方案开始产生正向效果：

- 新配置功能接入时，改动文件数量明显减少
- 配置类和删除/恢复类 bug 的定位速度明显提升
- Writer / Library 的新增功能更多落在 hook / command 层，而不是主页面文件
- 团队对“页面层、命令层、查询层、安全层各做什么”形成稳定共识
