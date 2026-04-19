# 已知技术债

## TD-001: Capacitor 平台 WebDAV 同步 CORS 问题

**状态:** 待修复  
**优先级:** 中（移动端同步功能启用前必须解决）  
**涉及文件:** `src-ui/src/api/engine-sync.ts`, `src-ui/capacitor.config.json`

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

**状态:** 已修复（v0.3.0）  
**修复方式:** 在 `WebDAVSyncAdapter` 上新增 `testConnection()` 方法，`testWebDAVConnection()` 复用该方法，消除了 Auth 编码和 URL 构造的重复代码。

---

## TD-003: undo 手动状态回滚不产生 ops 条目

**状态:** 已知缺陷（v0.3.0 审计发现）  
**优先级:** 低（仅影响跨设备同步后的一致性）  
**涉及文件:** `src-engine/services/undo_chapter.ts`

undo_latest_chapter 在撤销章节时，会通过 `collectManualStatusRollback` 恢复该章节内手动变更的 fact 状态（如 deprecated → active）。但这个回滚操作直接修改 fact repo，**不产生对应的 ops 条目**。因此 `rebuildFactsFromOps()` 重建结果与 repo 实际状态不一致。

**影响范围:** 仅在"某章节内手动 deprecate 了一个 fact → 撤销该章节 → 在另一台设备上从 ops 重建"这一特定流程下出现。

**修复方向:** 在 undo 的事务中为 status rollback 追加一条 `update_fact_status` ops 条目。需考虑 undo ops 与原始 ops 的语义区分，避免在二次 undo 时产生歧义。

---

## TD-004: 敏感数据存储未加密

**状态:** 已知（v0.3.0 审计文档化）  
**优先级:** 中（正式发布前应解决）  
**涉及文件:** `src-engine/platform/tauri_adapter.ts`, `src-engine/platform/capacitor_adapter.ts`, `src-engine/platform/web_adapter.ts`

所有平台的 `secureGet/secureSet/secureRemove` 当前仅在 KV 键前添加 `__secure__:` 前缀隔离，数据以明文存储。v0.3.0 审计中已在代码中添加 `@warning` 注释标记。

**修复方向:**
- Tauri: 接入 `@tauri-apps/plugin-stronghold`（OS keychain）
- Capacitor: 接入 `@capacitor-community/secure-storage`（Android Keystore / iOS Keychain）
- Web: 接入 `crypto.subtle` 派生密钥加密

接入时 `PlatformAdapter.secureGet/secureSet/secureRemove` 的接口契约不变，仅替换实现；
`repositories/implementations/secure_fields.ts` 的上层机制（占位符、旧明文自动迁移、
删除 AU/Fandom 时清理）无需改动。

---

## TD-005: Embedding 功能不完整（AU 覆盖 + 本地 sidecar 均未接入）

**状态:** 待修复（v0.3.0 二次审计发现）
**优先级:** 中（文档/UI 承诺了该能力但实际不工作，用户无感）
**涉及文件:** `src-engine/llm/embedding_provider.ts`, `src-engine/llm/capabilities.ts`,
`src-ui/src/api/engine-state.ts`, `src-ui/src/api/engine-generate.ts`,
`src-ui/src/api/engine-chapters.ts`

两个相关缺陷捆绑修复：

### 5a. AU 级 embedding_lock 覆盖从未生效

`Project` 数据模型里有 `embedding_lock` 字段（`AuSettingsLayout` 允许用户为单个 AU
配置独立的 embedding 服务），但 `createEmbeddingProvider(sett)` 只读取全局
`settings.embedding`，**完全无视 `project.embedding_lock`**。

### 5b. 本地 Embedding（Python sidecar）从未接入引擎

TS 引擎只实现了 `RemoteEmbeddingProvider`（`/v1/embeddings` 远程端点），
**没有 `LocalEmbeddingProvider`**。Python sidecar 的 `/embed` 端点存在，
但 `createEmbeddingProvider` 不会构造消费它的 provider。因此：

- 全局 `settings.embedding.mode=LOCAL` 在代码上等价于 "不配置 embedding"
- 本次审计已把 `capabilities.ts` 的 `EMBEDDING_MATRIX.tauri.local` 从
  `available: true` 降级为 `coming_soon`，避免 UI 允许但实际不工作
- 等本修复完成再改回 `available: true`

**修复方向:**

1. 新增 `SidecarEmbeddingProvider implements EmbeddingProvider`，调用 Python
   sidecar 的 `POST /embed`；
2. `createEmbeddingProvider` 改签名：`(sett, project?, sidecarUrl?) => EmbeddingProvider | undefined`；
   优先级：`project.embedding_lock.api_key` → `settings.embedding (api)` → `sidecar (local)`；
3. 所有调用点传入 `project`（`engine-generate.ts`、`confirmChapter` 里的
   indexChapter 调用、`rebuildIndex`）；
4. `embedding_lock` 在 `file_project.ts` 里已经加入了 `projectSecureSpecs`（P0-3），
   所以 `embedding_lock.api_key` 已经不会进 `project.yaml` 明文 —— 本修复只影响
   "读取后如何使用"；
5. `capabilities.ts` 把 Tauri 的 local 改回 `available: true`；
6. 补测：generation/RAG 的 "AU embedding_lock 优先于 settings"、"Tauri 回退到 sidecar" 断言。

**关联:** 与 TD-004（secureStorage 真加密）、TD-006（MobileOnboarding
embedding 默认 mode）放在同一轮"embedding + 凭据一致性"修复批次。

---

## TD-006: MobileOnboarding 的 embedding 默认 mode 不适合移动端

**状态:** 待修复（v0.3.0 二次审计发现）
**优先级:** 低（首次使用才触发，不影响续写主流程，仅影响 RAG 索引）
**涉及文件:** `src-ui/src/ui/onboarding/MobileOnboarding.tsx`

`MobileOnboarding.tsx:231` 的逻辑是
`mode: useCustomEmbedding ? LLMMode.API : LLMMode.LOCAL`。当用户不勾选
"使用自定义 embedding"时默认写入 `LLMMode.LOCAL`，但移动端（Capacitor/PWA）
没有 Python sidecar，**LOCAL embedding 根本跑不了**。结果是移动端新用户首次完成
onboarding 后 RAG 索引永远失败（createEmbeddingProvider 返回 undefined，index STALE）。

**修复方向:**

1. 在 MobileOnboarding 里引入 `getEmbeddingModeAvailability(platform)`；
2. 如果 local 不可用（移动端），强制 `useCustomEmbedding = true` 并在 UI 上隐藏
   "使用内置 embedding"这个开关（或者直接不给用户选择，引导填 API 即可）；
3. 桌面端保持现状（内置 local embedding 可用）。

**关联:** 与 P1-5b capabilities 矩阵在同一概念体系下，但涉及 onboarding UX 流程，
适合和 TD-005 / TD-004 一起做成一次 "embedding 一致性"修复批次。

---

## TD-007: WebDAV 同步冲突写入不持 AU 锁

**状态:** 待修复（v0.3.0 五次审计发现）
**优先级:** 低（冲突解决是用户主动触发的低频操作，和本地写入完全并发的概率小）
**涉及文件:** `src-ui/src/api/engine-sync.ts`

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

**状态:** 待修复（v0.3.0 五次审计发现）
**优先级:** 低（非功能缺陷，但首次遇到会让用户困惑）
**涉及文件:** `src-ui/src/ui/Library.tsx`（或 TrashPanel 相关组件），
`src-ui/src/ui/settings/AuSettingsLayout.tsx`

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

**状态:** 待修复（2026-04 字体系统 Phase 7 审查发现）
**优先级:** 低（UI 操作下极难触发，但对所有 settings 写入都构成隐患）
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

**状态:** 待修复（2026-04 字体系统 Phase 7 审查发现）
**优先级:** 低（现有代码未踩坑，对未来新增写入点构成隐患）
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

**状态:** 待修复（2026-04 字体系统 Phase 6 审查发现）
**优先级:** 低（不影响功能，仅影响 Modal 重开瞬间的视觉反馈）
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
