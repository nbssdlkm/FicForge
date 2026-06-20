import { defineConfig } from "vitest/config";

// 真 LLM 探针专用配置（手动跑：npx vitest run --config vitest.live.config.ts）。
// 与正常 suite（**/__tests__/**/*.test.ts）隔离 —— 正常 CI 永不命中网络/本机 key。
export default defineConfig({
  test: {
    include: ["livetest/**/*.probe.ts"],
    testTimeout: 300_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
