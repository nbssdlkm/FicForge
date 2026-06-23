# 已知技术债

## TD-001: Capacitor 平台 WebDAV 同步 CORS 问题

**状态:** 已消解（M7 / D-0040，2026-06）—— `engine-sync.ts` 及 WebDAV 同步引擎（`sync_adapter.ts` / `sync_manager.ts`）已删除，移动端不再有应用内同步，本债不再适用。以下为历史记录。  
**优先级:** ~~中~~（已失效）  
**涉及文件:** ~~`src-ui/src/api/engine-sync.ts`~~（已删）, `src-ui/capacitor.config.json`

Tauri 桌面端已通过 `@tauri-apps/plugin-http` 绕过 CORS，但 Capacitor (Android/iOS) 平台仍使用 `globalThis.fetch`。Android WebView 运行在 `https://localhost`（`androidScheme: "https"`），向坚果云等外部 WebDAV 服务器发请求会被 CORS 拦截。

**修复方向:**

- 方案 A: 在 `capacitor.config.json` 中启用 `CapacitorHttp`（Capacitor 8 内置），自动将跨域 fetch 路由到 native HTTP 层：
  ```json
  { "plugins": { "CapacitorHttp": { "enabled": true } } }
  ```
- 方案 B: 在 `getPlatformFetch()` 中增加 Capacitor 分支，使用 `@capacitor-community/http` 插件

方案 A 更简单但会全局 patch `window.fetch`，需评估副作用。方案 B 更精确但需额外依赖。两种方案都需要在移动端实际测试。

---

## TD-002: testWebDAVConnection 与 WebDAVSyncAdapter Auth 头重复构造

**状态:** 已修复（v0.3.0）；相关代码已随同步退役整体删除（M7 / D-0040，2026-06），仅存历史记录。  
**修复方式:** 在 `WebDAVSyncAdapter` 上新增 `testConnection()` 方法，`testWebDAVConnection()` 复用该方法，消除了 Auth 编码和 URL 构造的重复代码。

---

## TD-003: undo 手动状态回滚不产生 ops 条目

**状态:** ✅ 已修复（2026-06-23）—— `collectManualStatusRollback` 现在为每个回滚的 fact 追加一条 `update_fact_status` op（`old_status` = 当前状态、`new_status` = 回滚目标、`reason: "undo_manual_rollback"`），与事务一并提交，使 `rebuildFactsFromOps()` 重建结果与 repo 一致。同时**排除 `reason` 以 `undo_` 开头的 op 不参与回放**（`isUndoGeneratedStatusOp`），避免「confirm→undo→reconfirm→undo」二次 undo 把上次 undo 的反向 op 再反一次（doc 原本要求的语义区分）；该过滤在单次 undo 中为空操作（这些 op 此刻还在事务里未落盘）。golden 测试 `undo_chapter_golden.test.ts` 的「KNOWN GAP」断言已改为验证 rebuild 一致 + 反向 op 落账。
**优先级:** ~~低~~（已修复）
**涉及文件:** `src-engine/services/undo_chapter.ts`

**原诊断（历史）：** undo_latest_chapter 在撤销章节时，会通过 `collectManualStatusRollback` 恢复该章节内手动变更的 fact 状态（如 deprecated → active）。但这个回滚操作直接修改 fact repo，**不产生对应的 ops 条目**。因此 `rebuildFactsFromOps()` 重建结果与 repo 实际状态不一致。仅在"某章节内手动 deprecate 了一个 fact → 撤销该章节 → 从 ops 重建"这一特定流程下出现（D-0040 同步退役后，仅影响本地 ops 审计日志的 rebuild 不变量）。

---

## TD-004: 敏感数据存储未加密 —— 已修复（三端全加密）

**状态:** 已修复（2026-06）—— 三端 secret 均加密落盘。原写法「所有平台明文 / XL」已严重过时。
**涉及文件:** `src-engine/platform/{tauri_adapter,capacitor_adapter,web_adapter}.ts`、`adapter.ts`（capability 类型）

三端实况：
- **Tauri** ✅：`keyring` v3.6.3 crate（windows / apple / linux native），`secure_store.rs` 走 OS keyring。`encrypted_at_rest: true`。
- **Capacitor** ✅：`@aparajita/capacitor-secure-storage` ^8.0.0（Android Keystore / iOS Keychain）。`encrypted_at_rest: true`。
- **Web** ✅（本轮）：`web_adapter.ts` 用 `crypto.subtle` AES-GCM。256-bit **不可导出** key 存独立 IndexedDB `ficforge_keystore`（与文件 DB `ficforge_fs` 隔离，不污染 listDir）；密文（`encv1:iv.ct`，每次随机 12-byte IV）存 sessionStorage（**仍会话级**，关标签即清）。旧 localStorage `__secure__:` 明文首读时加密迁移。`crypto.subtle`/IndexedDB 不可用或 key 打不开（隐私模式）时优雅退回明文。`backend: web_crypto_aes_gcm`，`encrypted_at_rest: true`（动态：仅当 key **真就位**才报 true，init() 预热；防隐私模式下假「已加密」横幅 + 防迁移误删 YAML 明文）。
- **旧明文迁移** ✅：`secure_storage_migration.ts` + `App.tsx` 启动触发，gate `encrypted_at_rest === true`（三端均执行）。
- **日志脱敏** ✅：`logger.ts` `REDACT_RE`。
- **capability 类型去重** ✅：`SecretStorageCapabilities` 从 engine 单一导出，UI 不再手维护 3 份 union。

**产品决策（已拍板）:** Web secret 走**会话级**（不跨会话持久），符合 iOS = PWA 兜底定位。后果：working-crypto web 上，启动迁移把旧 YAML 明文搬进 session-only 存储 → 用户每会话重填 key（仅影响 pre-secure-fields 旧明文用户；近期保存过的用户 YAML 已是 `<secure>` 占位符，迁移 no-op）。IDB 打不开时 capability 诚实报明文 → 迁移跳过，不销毁明文。

**威胁模型（诚实）:** Web 无 OS keychain。本方案防被动存储窥探 / 磁盘拷贝（单拿 IDB dump 或单拿 sessionStorage dump 都解不开），**不防** 页内 XSS（能 JS 调 decrypt）。

**测试:** `web_adapter.test.ts`（明文回退 / 密文非明文 / 往返 / 旧明文加密迁移 / 解密失败→null / IDB 打开失败→诚实明文）；`secure_storage_migration.test.ts` 不变。

**遗留（非阻塞）:** 迁移测试只覆盖 persistent（os_keyring）后端，未覆盖 session_only 目的地 —— web 上「迁移在会话内无损」无专测（危险路径已由 web_adapter IDB-failure 测试守护）。

---

## TD-005: Embedding 功能不完整（AU 覆盖未接入；本地 sidecar 已随退役消解）

**状态:** 已修复（2026-06）—— 5b（本地 sidecar embedding）随 M7 sidecar 退役消解；5a（AU 级 embedding_lock 覆盖）本轮修复：`createEmbeddingProvider` 加 `project?` 参数 + 3 个调用点（`rebuildIndex` / `generateChapter` / `confirmChapter`）传 proj，优先级 `embedding_lock`（api_key+api_base 都配齐）> 全局，半配置安全回退。测试 `src-ui/src/api/__tests__/engine-state.embedding.test.ts`。注：工厂在 `src-ui/src/api/engine-state.ts`（非 engine 层，原写法定位有误）。
**优先级:** 中（文档/UI 承诺了该能力但实际不工作，用户无感）
**涉及文件:** `src-engine/llm/embedding_provider.ts`, `src-engine/llm/capabilities.ts`,
`src-ui/src/api/engine-state.ts`, `src-ui/src/api/engine-generate.ts`,
`src-ui/src/api/engine-chapters.ts`

两个相关缺陷捆绑修复：

### 5a. AU 级 embedding_lock 覆盖从未生效

`Project` 数据模型里有 `embedding_lock` 字段（`AuSettingsLayout` 允许用户为单个 AU
配置独立的 embedding 服务），但 `createEmbeddingProvider(sett)` 只读取全局
`settings.embedding`，**完全无视 `project.embedding_lock`**。

### 5b. 本地 Embedding（Python sidecar）—— 已随退役消解（M7，2026-06）

原缺陷：TS 引擎只有 `RemoteEmbeddingProvider`，从未接入 sidecar 的 `/embed`。
**M7 决策直接退役 sidecar**（删 `src-python/`）而非补接入 —— 本地 embedding 不再是目标。
`capabilities.ts` 的 `EMBEDDING_MATRIX.tauri.local` 已从 `coming_soon` 改为
`platform_unsupported`（UI 不渲染）。本地向量需求走云端 embedding API；若将来要桌面
离线，重开独立 feature 分支。**本子项无需再修。**

**修复方向（仅剩 5a — AU 级 embedding_lock 覆盖）:**

1. `createEmbeddingProvider` 改签名：`(sett, project?) => EmbeddingProvider | undefined`；
   优先级：`project.embedding_lock.api_key` → `settings.embedding (api)`；
2. 所有调用点传入 `project`（`engine-generate.ts`、`confirmChapter` 里的
   indexChapter 调用、`rebuildIndex`）；
3. `embedding_lock` 在 `file_project.ts` 里已加入 `projectSecureSpecs`（P0-3），
   `embedding_lock.api_key` 不进 `project.yaml` 明文 —— 本修复只影响"读取后如何使用"；
4. 补测：generation/RAG 的 "AU embedding_lock 优先于 settings" 断言。

**关联:** 与 TD-004（secureStorage 真加密）、TD-006（MobileOnboarding
embedding 默认 mode）放在同一轮"embedding + 凭据一致性"修复批次。

---

## TD-006: MobileOnboarding 的 embedding 默认 mode 不适合移动端

**状态:** 已消解（2026-06 复核 + 修复）。两层都已处理：① **文案早已诚实** —— onboarding embedding 步骤标「（可选）」，hint「跳过后AI仍可正常续写，只是无法自动检索历史内容」，skip「稍后到设置里补上」，用户不再被误导。② **死的 LOCAL 模式不再持久化** —— local embedding 三端均不支持（sidecar 退役），`form-mappers.ts:94` + `saveGlobalSettings`（engine-settings.ts）改为恒 `mode: api`（跳过时落空字段 → `createEmbeddingProvider` 返回 undefined → RAG 优雅 STALE）。测试 `src-ui/src/ui/onboarding/__tests__/form-mappers.test.ts`。注：原 cited line `MobileOnboarding.tsx:231` 已漂移到 `form-mappers.ts:94`；RAG 失败的真实近因是「空 api_base/api_key」而非 mode 值（`createEmbeddingProvider` 根本不读 mode）。
**③「内置 embedding」概念已端到端清除（本轮残留消除）:** local embedding 三端均不支持，故「内置 vs 自定义」整套区分已删 —— GlobalSettingsModal 的 checkbox + 内置提示删除、三端统一恒显 embedding 输入框；连带删 `EmbeddingSettingsSaveInput.use_custom_config` 类型字段、`saveGlobalSettingsForEditing` 的 `!isTauri()` 门控、`settings/form-mappers.ts` 的 `useCustomEmbedding`、AuSettingsLayout 的 `builtinEmbeddingLabel` 回退（改 `noEmbeddingModel`）、4 个废 i18n key（中英各 4）。embedding 现在三端统一就是「填 API / 留空=未配置」。
**优先级:** ~~低~~（已消解）
**涉及文件:** `form-mappers.ts`(onboarding+settings)、`api/engine-settings.ts`、`api/settings.ts`、`ui/settings/{GlobalSettingsModal,AuSettingsLayout}.tsx`、`locales/{zh,en}.json`

**以下为原诊断（历史，已不准确，保留备查）:** 原写法称 `MobileOnboarding.tsx:231` 的
`mode: useCustomEmbedding ? LLMMode.API : LLMMode.LOCAL` 会让跳过 embedding 的用户落
`LLMMode.LOCAL` → 移动端 RAG 索引永远失败，并提议在 MobileOnboarding 内引入
`getEmbeddingModeAvailability(platform)` 做 UI 门控。实况修正（见上方状态）：① 该三元已
迁到 `form-mappers.ts:94`，`MobileOnboarding.tsx:231` 早不是它；② RAG 失败的真实近因是
空 api_base/api_key 而非 mode 值；③ `getEmbeddingModeAvailability` 这个 helper **早已存在**
于 `capabilities.ts:133`，本轮未走「UI 门控」路线，而是更简的写侧修复（恒 `api`）；桌面
GlobalSettingsModal 的「内置 embedding」UI 也已在本轮一并删除（见上方 ③）。

---

## TD-007: WebDAV 同步冲突写入不持 AU 锁

**状态:** 已消解（M7 / D-0040，2026-06）—— `engine-sync.ts` 的冲突解决路径已随同步退役删除，本债不再可触发。以下为历史记录。
**优先级:** ~~低~~（已失效）
**涉及文件:** ~~`src-ui/src/api/engine-sync.ts`~~（已删）

`engine-sync.ts` 的冲突解决路径（`applyFileConflictResolution` 等）在用户选择
"用远端覆盖本地"时调 `adapter.writeFile(localFullPath, remoteContent)` 直接覆盖
本地文件。如果此时某个 AU 正在进行 `confirmChapter` / `generateChapter` 等写入，
刚写好的 chapter.md / ops.jsonl 可能被远端旧版本覆盖，或写入过程读到半新半旧。

**修复方向:**

1. 在冲突解决写入时，按文件所属 AU 解析 au_id，用 `withAuLock(auPath, ...)` 包裹
   `writeFile` 段；
2. 跨 AU 的批量冲突解决按 AU 分组，每个 AU 独立加锁；
3. 同步"列文件对比差异"阶段无需加锁（纯读），只需在真正落盘时加锁。

**关联:** 与 TD-001（Capacitor WebDAV CORS）放在同一轮"同步机制完善"修复。

---

## TD-008: 从 Trash 恢复 AU 后 api_key 为空的 UX 提示缺失

**状态:** ✅ 已部分修复（2026-06-23，采纳 doc 方案 B）—— `AuSettingsLayout` 在「覆盖被识别为开启 + API 模式 + key 留空」时，于 API Key 输入框下显示琥珀色提示（i18n `settings.story.apiKeyEmptyHint`，中英），陈述「key 为空 + 删除并恢复 AU 会清除密钥需重填」这一事实但不断言成因，故无误报。判据抽成纯函数 `shouldWarnEmptyAuApiKey(isOverride, mode, apiKey)`（form-mappers.ts，单一真相源），单测 `form-mappers.au-apikey.test.ts` 5 例。删除即清密钥的设计（engine-fandom `deleteAu`）有意为之未改。

**已知局限（多代理审阅 2026-06-23 发现）→ 深挖后定位到 TD-016**：`isLlmOverride` 由 `hydrateAuSettingsForm` 从 llm 各字段**真值推断**，无独立持久化开关位。对**只覆盖 key**（model/api_base 沿用全局）的 AU，删除→恢复把唯一非空字段也清空后推断退回 `false`，提示不出现。当初设想用持久化 `llm_override_enabled` 标志根治，但**端到端实测（2026-06-23）发现「只覆盖 key」根本不是一个能工作的功能**（见 TD-016）：AU 级 api_key 覆盖在正文续写路径上无效，加标志只会让设置里**显示一个不工作的覆盖 + 误导用户重填没用的 key**，故**放弃该方案**。真正的根因（writer 路径丢 AU key）已由 TD-016 修复。本提示对「整段覆盖（model/api_base 非空）+ key 被清」这一可工作场景仍正确触发。
**优先级:** ~~低~~（提示已上；持久化覆盖标志的根治为后续）
**涉及文件:** `src-ui/src/ui/settings/AuSettingsLayout.tsx`、`src-ui/src/ui/settings/form-mappers.ts`、`src-ui/src/locales/{zh,en}.json`

`deleteAu` / `deleteFandom` 在软删除时**立即**清理 secure storage 里的 api_key
（见 engine-fandom.ts 的注释：降低凭据泄漏窗口，符合安全最佳实践）。但 trash 里
保留了 project.yaml（含占位符 `<secure>`），用户从 trash 恢复后：
- FileProjectRepository.get 读取占位符 → secureGet 返回 null → 字段被设为空
- 用户在 AU 设置里看到 api_key 空了，可能疑惑"我之前填过为什么没了"

**修复方向:**

- 在 TrashPanel 恢复操作的确认对话框里提示："恢复后需要重新填写 API Key"；或
- 在 AuSettingsLayout 的 LLM 覆盖区，如果检测到 `proj.llm.api_key === ""`
  且 `proj.llm.mode === "api"`，显示一次性提示"API Key 在恢复时已清除，请重新填写"。

本设计（立即清理 secure storage）有意为之，不改；只需 UX 提示更友好。

---

## TD-009: `updateSettings` 并发 race（read-modify-write 无锁）

**状态:** ✅ 已修复（2026-06-23 复核确认）—— M7 重构（commit `9cedabe`）已移除通用 `updateSettings`，所有 settings 写入改走 `withSettingsWrite` → `withSettingsWriteLock`（promise-chain 串行 mutex）。6 个写入点全部串行化，read-modify-write 不再交错；`settings.get()` 每次从磁盘重读返回全新对象，无共享引用。回归测试 `engine-settings.test.ts` 的「preserves both fields across concurrent settings commands」（`SlowMockAdapter` 注入 5ms 读 / 20ms 写延迟强制 race 窗口）守护。以下为原诊断（历史，已不适用）。
**优先级:** ~~低~~（已修复）
**涉及文件:** `src-ui/src/api/engine-settings.ts`

`updateSettings(updates)` 的实现是 `const current = await settings.get(); ...合并...; await settings.save(current);` 典型的无锁 read-modify-write。两个并发调用交错时发生经典 race：

```
调用 A: get() → 拿到 old
调用 B: get() → 拿到 old
调用 A: save(old + A 的改动)
调用 B: save(old + B 的改动)  ← 覆盖 A 的改动
```

**字体场景**：用户在同一渲染帧（1/60 秒）内连续切两个字体下拉 → 两个 setter 各自触发 `persist` → 两个并发 `updateSettings` → settings.yaml 丢失其中一次改动。localStorage 是同步写入不受影响，本地显示正确；只是跨设备同步到其他设备时那个字段停留在旧值。`<select>` 的 onChange 是阻塞事件，正常 UI 操作极难达到这个时序。

**修复方向:**

- 方案 A: `updateSettings` 内部维护一个串行队列（Promise chain mutex），所有调用按顺序执行。~10 行
- 方案 B: settings.yaml 引入 version / etag 做乐观并发控制，冲突重试。工作量大但最严谨
- 方案 C: 调用方自行保证不并发（当前事实状态）

**关联:** 字体 `useFontSelection.persist` 已通过传完整 4 字段快照规避了"丢字段"的衍生后果，真正触发时也只是"两次改动只落地一次"。TD-010 同属 engine-settings 层，建议同轮修。

---

## TD-010: `updateSettings` 嵌套对象浅合并

**状态:** ✅ 已消解（2026-06-23 复核确认）—— 通用 `updateSettings` 浅合并函数已随 M7 重构删除。现在每个 settings 写入是领域专用 mutator（`saveFontPreferences` / `saveAppPreferences` / `saveDefaultLlmSettings` 等），各自**显式展开**嵌套对象（如 `app: { ...current.app, fonts: { ...current.app.fonts, ...payload } }`），不存在「第二层对象被整体替换丢兄弟字段」的通用路径。并发兄弟字段写入由 `engine-settings.test.ts` 覆盖。以下为原诊断（历史，已不适用）。
**优先级:** ~~低~~（已消解）
**涉及文件:** `src-ui/src/api/engine-settings.ts`

`updateSettings` 的合并逻辑只在**顶层 key** 做 spread 浅合并：

```ts
currentRec[key] = { ...(currentRec[key]), ...val };
```

对 `{ app: { fonts: { ui_latin_font_id: "X" } } }` 这种**第二层嵌套对象**，`app.fonts` 会被新值整体替换，丢失其他 3 个 font id。

**字体现状**：`useFontSelection.persist` 总是传完整 4 字段快照规避了这个坑，唯一写入点安全。代码内已加注释警告。

**未来风险**：任何新增的 `updateSettings({ app: { fonts: { 部分字段 } } })` 调用都会踩坑。其他嵌套字段（`sync.webdav`、`chapter_metadata_display.fields` 等）理论上也有同样风险。

**修复方向:**

- 方案 A: `updateSettings` 改递归深合并（需评估现有语义依赖 ——例如 `sync.webdav = undefined` 的整体清除语义是否被使用）
- 方案 B: 为字体增加 `updateFontSettings(partial)` 专用 API，不走通用 `updateSettings`
- 方案 C: 保持现状，靠注释 + code review 防护

**关联:** TD-009 同在 engine-settings 层，建议在"settings 写入重构"批次里一并解决。

---

## TD-011: 字体下载进度跨 Modal 生命周期丢失

**状态:** ✅ 已修复（2026-06-23）—— 进度真相源下沉到 `FontsService` 单例。新增内部 `progresses` Map（`install` 推进时更新、`finally` 清空）+ `currentProgresses()` 快照查询 + `subscribeDownloads(listener)` 订阅（progress / settled 事件，监听器抛错隔离）。`install` 始终用内部 `trackProgress` 包裹下载，**不依赖调用方是否传 onProgress**，故上一个 Modal 生命周期发起的下载也被记录。`useFontManager` 改为：mount 时先 `currentProgresses()` 播种、再 `subscribeDownloads` 订阅增量，unmount 时退订；进度与清理全由订阅驱动（`download` 不再自接 onProgress / 不再 finally 清进度），`settled` 时 `refresh()` 重算状态（后台完成的下载翻成 installed），`refresh` 保留 `error` 态不被冲掉。下载中关闭再打开 Modal，进度条续上不丢。新增测试：engine `service.test.ts` 5 例（mid-flight 快照 / 订阅事件 / 失败仍 settle / 监听器隔离 / 向后兼容 onProgress）+ UI `useFontManager.test.tsx` 4 例（mount 播种 / 增量更新 / settle 收敛 / unmount 退订）。以下为原诊断（历史）。
**优先级:** ~~低~~（已修复）
**涉及文件:** `src-engine/fonts/service.ts`, `src-ui/src/hooks/useFontManager.ts`

`useFontManager` 的 `progresses` 是组件级 React state。Modal 关闭 → `FontSettingsSection` unmount → hook 销毁 → `progresses` 丢失。

**场景**：用户点"下载"一个大字体（思源宋体 14MB / 原版霞鹜文楷 11.9MB）→ 下载期间关 Modal 去做别的事 → 几秒后重新打开 Modal。

- `FontsService` 单例仍在后台下载（pendingDownloads 持有 AbortController），不受 Modal 生命周期影响
- 新 `useFontManager` 的 `refresh()` 查 `service.statusOf` 返回 `"downloading"`
- UI 显示"取消"按钮，但**进度条不可见**（`progresses[id]` 是 undefined）
- 下载完成后 `status` 会自动切到 `"installed"`，不影响最终结果

**修复方向:**

1. `FontsService` 内部维护 `progressesMap: Map<id, { loaded; total }>`，在 `install` 的 `onProgress` 钩子里更新
2. 暴露 `service.currentProgresses(): Record<id, Progress>` 查询方法
3. `useFontManager` 在 mount 时调一次拉取初始值；install 过程中继续通过 onProgress 更新自身 state

工作量约 20-30 行。独立且低风险，可随时单独修。

---

## TD-012: LLM `api_base` 硬编码 /v1 导致非标准 endpoint 连不上

**状态:** 已修复（2026-04-19，commit `591a1bc`）
**修复方式:** 移除 engine 层所有 URL 拼接里的 /v1 前缀，改为"用户在 `api_base` 里自己填写完整路径（含 /v1 或目标服务实际的 OpenAI 兼容前缀）"约定；UI 默认值 + 提示文案 + 文档同步更新。

**原问题:** `api_base` 原先约定"用户填裸 host（如 `https://api.deepseek.com`），代码自动拼 `/v1/chat/completions` / `/v1/embeddings`"。但许多代理 / 聚合服务（OpenRouter、自建 OpenAI 网关等）的兼容层不一定在 /v1 下 —— 可能是 `/openai/v1/`、`/api/v1/`、甚至无 /v1。硬编码的 `/v1` 会把路径拼错，请求直接 404 或连接失败，用户在 UI 里无法定位原因。

**涉及文件（已修复）:**

- `src-engine/llm/openai_compatible.ts`: `/v1/chat/completions` → `/chat/completions`（两个调用点：`generateStream` + `requestWithRetry`）
- `src-engine/llm/embedding_provider.ts`: `/v1/embeddings` → `/embeddings`
- `src-engine/llm/config_resolver.ts`: Ollama 模式不再自动补 /v1；`api_base` 原样透传给 provider
- `src-ui/src/api/engine-settings.ts`: `testConnection` 的 Ollama 分支走原生 `/api/tags` 端点（不在 OpenAI 兼容层下），从 `api_base` strip 掉尾部 /v1 后再拼
- UI: `MobileOnboarding` / `ApiConfigStep` / `ApiSetupHelp` / `ModelSelector` 默认值 + 提示文案改为含 /v1 的完整路径
- 删除了过时的"自动补 /v1"单元测试

**经验教训（沉淀到 CLAUDE.md 工作原则）:**

对外可配置的 URL 字段**不应在代码里硬编码路径前缀**。`api_base` 这类约定应让用户填"会被直接用的完整前缀"，避免"我以为只填 host，结果被自动补了 /v1"的误解 —— 尤其代理 / 聚合服务生态复杂，任何"自动补 X"都是未来坑的预埋。

---

## TD-013: ImportFlow `TurnCard` 视觉层级不清 + `setting` / `chapter_continue` 埋得深

**状态:** 待修复
**优先级:** 中（功能已可用，但发现性差 + 批量编辑笨拙）
**涉及文件:** `src-ui/src/ui/import/TurnCard.tsx`, `src-ui/src/ui/import/ChapterArrangeStep.tsx`

波 2 LLM 对话识别完成后（commits `8139a6a`/`f93f6f0`），对话文件的 Import 流程完整 work，但用户在 `ChapterArrangeStep` 手动确认每轮类型时 UX 不佳。**等 Codex 当前架构大改完成后再动手**。

**主要问题（4 条）:**

1. **TurnCard 信息密度高、视觉层级乱**：`#index` / 角色徽标 / 字数 / reason / preview 全部 `text-xs` 挤在一行。20+ 张 TurnCard 滚动起来像噪声墙，没有主次。
2. **`setting` / `chapter_continue` 发现性差**：两者都是"用户手动改"（`classifyTurns` 不自动产出），但选项藏在 `<select>` 下拉里，不点开不知道存在。第一次用的用户容易整个文件都按 chapter/skip 导入，浪费 `worldbuilding/` 写入功能和章节续接功能。
3. **批量操作按钮不显眼**：`tone="neutral" fill="plain"` 3 个小按钮混在文件展开头部，点完无反馈也不能撤销。
4. **缺多选批量机制**：想把第 5/7/9 三轮都改 setting 要开 3 次下拉。真批量选择应是 checkbox + 粘性底部操作栏。

**修复方向（按优先级）:**

- **视觉层级重构（核心）**：role + 类型做主字号 + icon，reason / preview 退为次淡色，preview 从 60 字扩到 120-150 字
- **pill 按钮组代替下拉**（4 个类型 pill + 每个固定 icon/色），一次点击切换，`chapter_continue` 按"前面有 chapter"条件性禁用（保持 UI 稳定而非隐藏）
- **批量操作升级**：按钮组视觉权重提升，加"所有 uncertain → setting/skip/chapter"类按钮，操作后 toast 反馈，缓存 snapshot 支持撤销
- **多选 + 粘性操作栏（进阶）**：每张 TurnCard 加 checkbox，底部粘性栏"已选 N 条 → [设为 X]"

**注意事项:**

此改动触及 `TurnCard.tsx` 和 `ChapterArrangeStep.tsx` 的结构，需等 Codex 当前架构大改完成避免合并冲突。同时可顺带处理：

- `uncertain` 轮次的视觉引导（"请手动决定"文字提示）
- LLM 失败后的持久 UI 痕迹（当前只有 3.5 秒 toast，3.5 秒后再看 AnalysisStep 无任何失败提示）
- 文件头统计数字用徽章 chip 而非嵌入文字
- `"LLM Detected"` 文案友好化（i18n 或至少给 `chatFormat === "LLM Detected"` 特判显示"AI 识别"）

---

## TD-014: facts reverse cascade 未覆盖 deprecate + undo 路径

**状态:** ✅ 已修复（2026-06-22）。复查发现 **undo 路径其实早已覆盖**（`undo_chapter.ts` 的 `collectResolvesRollback` 步骤 3a 正确处理反向级联 + batch 排除全部待删 id，且有 `undo_chapter.test.ts:112` / `undo_chapter_golden.test.ts:157` 双测覆盖）—— 本条最初的 undo 诊断在该函数落地前写的，已过时。**真正的遗留缺口只有 deprecate 路径**，本次补上：`update_fact_status` 在 `fact.status === DEPRECATED && fact.resolves` 时调 `collectResolvesReverse`（exclude 被作废 fact）+ 2 个新测试（reverts / 另有 resolver 仍 RESOLVED）。引擎 980 绿。
**优先级:** 低（影响面窄但语义不正确）
**涉及文件:** `src-engine/services/facts_lifecycle.ts`（已改）, `src-engine/services/undo_chapter.ts`（早已正确，未改）

**已知边界（独立审 2026-06-22 提出，本次不修，留作记录）：**
- **反向不对称**：把已作废的 resolver 重新设回 active/resolved（`update_fact_status`）**不会**把目标重新标 RESOLVED —— `collectResolvesForward` 只在 `add_fact` / `edit_fact` 改 resolves 字段时触发。这是本 bug 的镜像方向，罕见（取消作废少见）、且是否该自动 re-resolve 有产品讨论空间，故不在 TD-014 范围内。
- **批量 chapter_num=0**：`engine-facts.ts` 的 `batchUpdateFactStatus` 用 `chapter_num: 0` 调用，批量作废 resolver 产生的反向 op 也标 0，永不被 undo 回放（undo 不处理 N=0）。是 deprecate op 本身就有的既存特性，本次反向级联沿用，非新引入。

`collectResolvesReverse` 函数（[facts_lifecycle.ts:131](../src-engine/services/facts_lifecycle.ts#L131)）的逻辑本身是正确的：当 fact_B 不再 resolve fact_A 时，**条件性地**把 fact_A 退回 UNRESOLVED——前提是没有别的 fact 还在 resolve 它。

但**只有一条 mutation 路径调用了它**：`edit_fact` 在 `oldResolves !== newResolves` 时（line 336）。

**未覆盖的两条路径：**

1. **`update_fact_status` 把 fact_B 设为 DEPRECATED 时**（line 349-401）：仅做 `applyDanglingFocusCleanup`（从 chapter_focus 移除），**不触发反向级联**。结果：fact_A 仍是 RESOLVED，但揭示者已作废，LLM 上下文被污染。

2. **`undo_chapter` 删除该章节产生的 fact 时**（[undo_chapter.ts:114](../src-engine/services/undo_chapter.ts#L114)，调用 `tx.deleteFactsByIds`）：直接删除，**不触发反向级联**。如果被删除的 fact 中有"揭示老章节伏笔"的，老章节伏笔会留在 RESOLVED 状态。

**事故场景示例：**

```
ch5: fact_A = "Connor 抽屉里有刻 Y 的钥匙"（status: UNRESOLVED）
ch12: fact_B = "Y 是 Connor 妈妈的名字"（resolves: fact_A）
       → 自动把 fact_A 标 RESOLVED ✓

用户 undo 了 ch12 → 删除 fact_B
预期：fact_A 退回 UNRESOLVED
实际：fact_A 仍是 RESOLVED ❌

下次 LLM 续写时，看到 fact_A 是 RESOLVED → 不再当未解之谜处理
但揭示者已经被 undo 掉，剧情上钥匙的来历重新成为谜
→ LLM 上下文跟剧情脱节
```

**修复方向：**

不要立即开 PR 单独修，等 M8 Memory 架构重设计（PRD v5 §2 / D-0041）时一并处理。届时整个 fact lifecycle 的 mutation paths 都会被审查。

修复时机到了的具体动作：

1. `update_fact_status`：当 `new_status === "deprecated"` 且 `fact.resolves` 非空时，调用 `collectResolvesReverse(au_id, fact.resolves, fact.chapter, fact_repo, fact_id)`。返回的 op + fact 一并塞入 tx。
2. `undo_chapter`：在 `deleteFactsByIds` 之前，对每个待删 fact 检查 `resolves` 字段，分别调用 `collectResolvesReverse`。注意 batch 删除时**多个 fact 同时离开**的语义：检查"还有别的 resolver"时要 exclude **所有**待删 fact_ids，不只 exclude 当前一个。

**测试覆盖建议：**

- `facts_lifecycle.test.ts`：新增"DEPRECATE resolver → target reverts to UNRESOLVED"
- `facts_lifecycle.test.ts`：新增"DEPRECATE resolver but another resolver remains → target stays RESOLVED"
- `undo_chapter.test.ts`：新增"undo chapter deleting a resolver → older fact reverts to UNRESOLVED"

**为什么之前的 audit 漏了：**

Codex Phase 7 audit 报告说 facts lifecycle "完全实现"——它看到 `collectResolvesReverse` 函数存在 + `edit_fact` 调用了 + 测试通过，**没核对 update_fact_status / undo_chapter 这两条 mutation path 是否也调用了**。

这是 audit 工具的一个典型局限：**只检查代码存在性，不检查"在所有该被调用的地方都被调用"**。教训记入对 audit 报告的可信度评估方法论。

**讨论上下文：** 2026-04-23 与用户在面试准备讨论中无意发现。当时正在用此 case 做"状态机非平凡设计"的故事素材，grep 验证时发现 gap。

---

## TD-015: 导入/导出范围太窄，不支持简版↔主 app 数据迁回

**严重度**：P2（不阻塞当前功能，阻塞简版 fork 数据互通的体验）
**归属**：engine + UI
**触发场景**：用户在简版 fork（独立 APK）写了 N 章，想迁回主 app 用 RAG/facts 完整模式继续写

**当前状态：**

`src-engine/services/export_service.ts` 和 `import_pipeline.ts` 的导入/导出**只覆盖章节正文**（chapters/main/*.md）+ frontmatter 元数据。其他文件被忽略：

- `state.yaml` — 当前章节号、focus、characters_last_seen 等核心 state 字段
- `facts.jsonl` — facts 表
- `chapter_summaries/*.md` —（未来 M8 实现的）章节摘要
- `.well-known/rag_index/*.json` — RAG embedding 分片
- `simple-chat.yaml`（简版独有）— 对话历史
- `core_worldbuilding/*.md` / `core_characters/*.md` — 设定文件（？要确认现状）

**为什么是债：**

简版 MVP（见 `docs/internal/plans/simple-app-mvp-plan.md` 决策 12）的"迁回主 app"路径依赖完整 AU 数据迁移。当前导入/导出只移正文等于：用户从简版导出后导入主 app，主 app 看到 N 章正文但 state.yaml 里 `current_chapter` 仍是 0、facts.jsonl 空、RAG 索引空 —— 状态完全断裂。需要用户手动跑 `recalc + rebuild RAG`，且部分元数据（如 chapter focus / characters_last_seen 历史）**永久丢失**。

**修复方向（候选）：**

1. **保守方案**：导出加 manifest 列出 AU 所有文件，导入时全文件 round-trip 写入。manifest 标版本号方便后续 schema 迁移。
2. **激进方案**：导出/导入按"AU 整体打包"语义（zip 压缩整个 AU 目录），用户体验更直接。但跨平台（Android Capacitor + Tauri）的 zip 实现要测。
3. **结合 D-0040**：既然 ops.jsonl 降级为 audit log，导出可以**不带 ops**（避免历史泄露），只导可用的 source-of-truth 文件。

**与简版 fork 的关联：**

- 简版用户如果从未需要"迁回主 app"，TD-015 不影响他
- 但简版作为主 app 未来交互重构的原型，长期看主 app 会接管简版用户的工作流，迁回路径必须通
- M8 Memory 重设计（D-0041）是同步推进 TD-015 的好时机（schema 都在动）

**修复时机建议：**

- M8 启动时一并设计（导入/导出 schema 跟新的 facts/summary/thread 文件 layout 对齐）
- 或：简版 fork 真正有用户产生迁回需求时（事件驱动）

**讨论上下文：** 2026-05-03 v4-pro review simple-app-mvp-plan.md 时指出"简版章节迁回主 app 的路径缺失"是 plan 的最大 latent risk。CC 与用户讨论后定方案：不在简版 MVP 范围内自动化迁回，用 import/export 通道兜底，同时主仓库追加这条债跟踪范围扩大。

---

## TD-016: AU 级 LLM api_key/api_base 覆盖在「正文续写」路径上失效（401）

**状态:** ✅ 已修复（2026-06-23）—— `resolve_llm_config` 的掩码 key 回填改为**优先 `project.llm.api_key`、再回退 `settings.default_llm.api_key`**，让 key 与 model/api_base 同源。`src-engine/llm/config_resolver.ts`，单测 `config_resolver.test.ts`（+3）。
**优先级:** ~~中~~（已修复；换 provider 的 AU 正文续写曾必 401）
**涉及文件:** `src-engine/llm/config_resolver.ts`、`src-ui/src/ui/writer/useSessionParams.ts`（payload 不带 key，设计如此，未改）

**怎么发现的：** 复核 TD-008「持久化 llm_override_enabled」后续任务时，端到端 trace + 写实测探针（替换真实 `resolve_llm_config`，复刻 UI 的 `sessionLlmPayload`）跑出实证矩阵，再由独立 agent 对抗验证（确认 401 来自 `openai_compatible.ts` 的 `invalid_api_key`）。

**根因（两处设计相撞）：**
1. 前端 `sessionLlmPayload`（`useSessionParams.ts`）**有意不带 api_key**（key 只留后端），但带 AU 的 model/api_base。
2. `resolve_llm_config` 的掩码 key 防御**只从 `settings.default_llm.api_key`（全局）回填**，从不读 `project.llm.api_key` —— 即便此刻 `proj` 里已是从 secure storage 还原的真实 AU key。且 project 分支（`config_resolver.ts:35`）需要 `model || ollama_model` 才路由。

**修复前实测矩阵（writer = 正文续写 / facts = 事实提取）：**

| AU 覆盖配置 | writer | facts |
|---|---|---|
| 无覆盖 | 全局/全局/全局 | 全局/全局/全局 |
| 整段（model+base+key，换 provider） | model=AU, base=AU, **key=全局 ❌** | 全 AU ✓ |
| 仅 model | model=AU, key=全局 ✓ | model=AU, key=全局 ✓ |
| 仅 key | **全部全局 ❌**（key 被忽略） | 全部全局 ❌ |
| key+base（换 provider、同名 model） | base=AU, **key=全局 ❌** | 忽略→全局 ❌ |

后果：换了 provider（自带 base+key）的 AU 正文续写带**全局 key** 发到 **AU 的 base** → 401。只有「仅 model / 同 provider」覆盖端到端可用。

**修复后：** writer 路径在 session key 被掩码时优先取 AU key，换 provider 的 AU 续写走通；`project.llm.api_key` 为空（仅 model / 无覆盖）时自然回退全局，行为不变。facts 路径本就用 AU key，不受影响。

**遗留（非本次范围）：** 「仅 key、不带 model」的覆盖仍较含糊（session 会带全局 model + AU key + 空 base）；AU 级覆盖「开启」态仍靠真值推断、无持久化标志（TD-008 已记，且实测表明不值得为不工作的 key-only 场景加标志）。
