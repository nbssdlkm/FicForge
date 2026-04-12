import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ficforge/engine": path.resolve(__dirname, "../src-engine/index.ts"),
    },
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
