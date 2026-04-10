import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
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
