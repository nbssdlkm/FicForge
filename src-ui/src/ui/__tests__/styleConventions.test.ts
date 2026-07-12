import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// rule / rule-soft 是预混 rgba 的「终端」颜色令牌（alpha 随主题变化，
// 见 App.css @theme inline 注释）。v3 时代对它们写 /N 透明度修饰符静默
// 无效；tailwind v4 下会真的生效造成二次透明度叠加（0.22 × N% ≈ 更淡的
// 线），且无任何报错。2026-07 升 v4 时已摘净存量 4 处 —— 此测试把
// 「勿加 /N」的注释约定变成硬约束，防止回潜。
const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FORBIDDEN = /[a-z-]*rule(?:-soft)?\/\d/;

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (/\.(tsx|ts|css)$/.test(entry.name) && !entry.name.includes(".test.")) {
      acc.push(full);
    }
  }
  return acc;
}

describe("style conventions", () => {
  it("终端色令牌 rule/rule-soft 不得携带 /N 透明度修饰符", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (FORBIDDEN.test(line)) {
          offenders.push(`${path.relative(SRC_ROOT, file)}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `发现 rule/N 修饰符（v4 下会二次叠加透明度，请改用裸 rule / rule-soft）:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
