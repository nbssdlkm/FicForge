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
