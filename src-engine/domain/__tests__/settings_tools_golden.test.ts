// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 工具 schema 金标（TD-021）：
 *
 * 1) LLM 可见 schema 文本金标 —— getToolsForMode 三个模式的完整 JSON 逐字节锁定
 *    （比较 JSON.stringify 串，锁键序+值；schema 文本直接进 LLM 请求，任何漂移都是
 *    生成行为面变化，必须显式过金标）。更新姿势：确认变更有意后
 *    `UPDATE_GOLDEN=1 npx vitest run domain/__tests__/settings_tools_golden.test.ts`
 *    再生成 fixtures/settings_tools_golden.json，diff 审阅后随代码一起提交。
 *
 * 2) 双声明字段清单一致性 —— SIMPLE_TOOL_SCHEMAS（zod 校验镜像）与 JSON Schema
 *    声明的 properties/required 集合相等断言（B5 锁了工具名集合，这里锁到字段级：
 *    单边加字段/改必填即红）。注意 zod 镜像**有意更严**（required string 拒空串），
 *    这是校验语义差异、不是字段清单漂移，不在本测试断言面内。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getToolsForMode } from "../settings_tools.js";
import { SIMPLE_TOOL_SCHEMAS } from "../simple_tools_zod.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "settings_tools_golden.json");
const MODES = ["au", "fandom", "simple"] as const;

function currentGolden(): Record<string, unknown> {
  return Object.fromEntries(MODES.map((m) => [m, getToolsForMode(m)]));
}

describe("工具 schema 金标（LLM 可见文本逐字节锁定）", () => {
  it("三模式工具定义与金标逐字节一致（键序敏感）", () => {
    // CI 兜底（F2 对抗审 LOW）：UPDATE_GOLDEN 泄漏进 CI 会让金标退化成静默重写的 no-op。
    if (process.env.UPDATE_GOLDEN && !process.env.CI) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(currentGolden(), null, 2)}\n`, "utf-8");
      return;
    }
    expect(existsSync(FIXTURE), "金标缺失——用 UPDATE_GOLDEN=1 首次生成").toBe(true);
    const golden = JSON.parse(readFileSync(FIXTURE, "utf-8")) as Record<string, unknown>;
    for (const mode of MODES) {
      // stringify 对 stringify：JSON.parse 保留键序，等串 ⇔ 键序与值全同
      expect(JSON.stringify(getToolsForMode(mode)), `mode=${mode} 的 schema 文本漂移`).toBe(
        JSON.stringify(golden[mode]),
      );
    }
  });
});

describe("双声明字段清单一致性（JSON Schema ↔ zod 镜像）", () => {
  type ToolDef = {
    function: { name: string; parameters: { properties: Record<string, unknown>; required?: string[] } };
  };
  const simpleTools = getToolsForMode("simple") as unknown as ToolDef[];

  for (const [name, zodSchema] of Object.entries(SIMPLE_TOOL_SCHEMAS)) {
    it(`${name}: properties/required 两侧集合相等`, () => {
      const def = simpleTools.find((t) => t.function.name === name);
      expect(def, `simple 下发工具里找不到 ${name}（名集合锁在 settings_tools.test，字段锁在这里）`).toBeTruthy();
      if (!def) return;

      expect(zodSchema).toBeInstanceOf(z.ZodObject);
      const shape = (zodSchema as z.ZodObject<Record<string, z.ZodType>>).shape;

      const jsonKeys = Object.keys(def.function.parameters.properties).sort();
      const zodKeys = Object.keys(shape).sort();
      expect(zodKeys, `${name} 字段集合漂移`).toEqual(jsonKeys);

      const jsonRequired = [...(def.function.parameters.required ?? [])].sort();
      const zodRequired = Object.entries(shape)
        .filter(([, v]) => !(v instanceof z.ZodOptional))
        .map(([k]) => k)
        .sort();
      expect(zodRequired, `${name} 必填集合漂移`).toEqual(jsonRequired);
    });
  }
});
