// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

// gray-matter 依赖 Node.js Buffer — 用极轻量 shim 替代完整 polyfill（省 1.3MB）
if (typeof (globalThis as Record<string, unknown>).Buffer === "undefined") {
  const encoder = new TextEncoder();
  const BufferShim = {
    isBuffer: (_v: unknown) => false,
    from: (input: string | Uint8Array, encoding?: string) => {
      if (typeof input === "string") {
        if (encoding === "base64") {
          const binary = atob(input);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return bytes;
        }
        return encoder.encode(input);
      }
      return input;
    },
    alloc: (size: number) => new Uint8Array(size),
  };
  (globalThis as Record<string, unknown>).Buffer = BufferShim;
}

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { ContextMenuProvider } from "./ui/shared/ContextMenu";
import { registerSW } from "virtual:pwa-register";
import { isCapacitor, isTauri } from "./utils/platform";
import { SW_UPDATE_READY_EVENT, type SwUpdateReadyDetail } from "./utils/sw-update";

// PWA service worker 注册（审计 M21）：仅 Web/PWA 场景注册。dist 三端共用，
// Tauri（tauri:// 本地资源）/ Capacitor（app 内置资源）不需要离线缓存层，
// 且 SW 缓存壳资源会在壳升级后引入陈旧资源风险 —— 用运行时平台判定而非构建分叉。
// registerType: 'prompt'（vite.config.ts，R1-6 终审 5-A）：新版本 SW 就绪后不自动接管
// 强刷页面（用户写作/生成中被静默刷新会丢未落盘内容），改为派发自定义事件，
// App.tsx 显示低调可关横幅，用户空闲时点击才 updateSW(true) 激活并刷新。
if (!isTauri() && !isCapacitor() && "serviceWorker" in navigator) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(
        new CustomEvent<SwUpdateReadyDetail>(SW_UPDATE_READY_EVENT, {
          detail: {
            update: () => {
              void updateSW(true);
            },
          },
        }),
      );
    },
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ContextMenuProvider>
      <App />
    </ContextMenuProvider>
  </React.StrictMode>,
);
