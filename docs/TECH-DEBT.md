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
