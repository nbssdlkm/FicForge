import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    // PWA service worker（审计 M21）：D-0037 把 PWA 定为 iOS 唯一方案，此前无 SW
    // → 离线打开 = 白屏（数据都在 IndexedDB 里但壳打不开）。
    // dist 三端共用（Tauri frontendDist / Capacitor webDir / Web），插件在所有构建
    // 里都生成 sw.js（几 KB，无害），但**注册**在 main.tsx 用运行时平台判定门控：
    // 仅非 Tauri 且非 Capacitor 时 registerSW —— 壳内资源本地加载不需要缓存层，
    // 也避免 SW 缓存壳资源在壳更新后产生陈旧风险。
    VitePWA({
      // prompt（R1-6 终审 5-A/鲜眼②）：autoUpdate 会在新 SW 就绪后自动接管并强刷页面，
      // 用户写作/生成中被静默刷新 = 丢防抖窗口内未落盘内容。改 prompt 后由 main.tsx
      // onNeedRefresh → App.tsx 横幅，用户空闲时点击才 updateSW(true) 更新。
      registerType: "prompt",
      // 不自动注入注册脚本 —— main.tsx 手动 import virtual:pwa-register 做平台门控
      injectRegister: false,
      // 复用 public/manifest.json（index.html 已 link），不让插件另生成 webmanifest
      manifest: false,
      workbox: {
        // 预缓存 app shell：js/css/html + 图标 + manifest + 拉丁字体（52KB）+
        // 字体声明 css。LXGW CJK 子集（244 片 / 13MB，按 unicode-range 懒加载）
        // 不进预缓存 —— 每次 SW 更新全量校验/重下 13MB 不可接受，改走下方
        // CacheFirst 运行时缓存（用到哪片缓存哪片，离线时已访问过的字形照常显示，
        // 未缓存的子集回退系统 CJK 字体，文本仍可读）。
        globPatterns: [
          "**/*.{js,css,html}",
          "icon-*.png",
          "favicon.ico",
          "manifest.json",
          "fonts/source-serif-4.woff2",
        ],
        globIgnores: ["fonts/lxgw-wenkai-screen/**/*.woff2"],
        runtimeCaching: [
          {
            urlPattern: /\/fonts\/lxgw-wenkai-screen\/.*\.woff2$/,
            handler: "CacheFirst",
            options: {
              cacheName: "ficforge-cjk-fonts",
              expiration: { maxEntries: 300 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@ficforge/engine": path.resolve(__dirname, "../src-engine/index.ts"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("react-markdown") || id.includes("remark") || id.includes("rehype") || id.includes("mdast") || id.includes("hast") || id.includes("unified") || id.includes("micromark")) {
            return "vendor-markdown";
          }
          if (id.includes("js-yaml") || id.includes("gray-matter")) {
            return "vendor-yaml";
          }
          if (id.includes("framer-motion")) {
            return "vendor-motion";
          }
          if (id.includes("gpt-tokenizer")) {
            return "vendor-tokenizer";
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
