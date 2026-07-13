// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * dumpFrontmatterKey（TD-021 写侧统一）round-trip 测试：
 * 写侧 js-yaml dump ↔ 读侧 safeMatter（gray-matter → js-yaml）同库往返，
 * 对抗值（引号/冒号/井号/$&/前导横线/unicode）逐一锁定语义不变。
 */

import { describe, expect, it } from "vitest";
import { dumpFrontmatterKey, safeMatter } from "../frontmatter.js";

const KNOWN = new Set(["name", "aliases", "importance", "origin_ref"]);

/** 把若干键的行拼成完整卡片再用读侧解析——模拟两个 UI 写侧的实际拼装方式。 */
function roundTrip(lines: string[]): Record<string, unknown> {
  const content = ["---", ...lines, "---", "", "正文"].join("\n");
  return safeMatter(content, KNOWN).data;
}

describe("dumpFrontmatterKey", () => {
  it("标量：普通值单行输出，读回逐字相等", () => {
    const lines = dumpFrontmatterKey("name", "张三");
    expect(lines).toHaveLength(1);
    expect(roundTrip(lines)).toEqual({ name: "张三" });
  });

  it("标量对抗值：冒号/井号/引号/$& 由 js-yaml 转义，读回逐字相等", () => {
    for (const evil of ['他说:"你#好"', "$& $' $` $$", "a: b", "#注释形", "'单引'", '"双引"', "- 开头横线"]) {
      const lines = dumpFrontmatterKey("name", evil);
      expect(roundTrip(lines)).toEqual({ name: evil });
    }
  });

  it("数组：空数组单行 `key: []`（保键语义），非空为块列表，读回逐项相等", () => {
    expect(dumpFrontmatterKey("aliases", [])).toEqual(["aliases: []"]);

    const aliases = ["小张", '外号:"阿三"', "$&", "- dash", "#hash"];
    const lines = dumpFrontmatterKey("aliases", aliases);
    expect(lines[0]).toBe("aliases:");
    // 行手术契约：块列表项必须匹配 /^\s*-\s/（setAliasesInContent 的替换扫描判据）
    for (const item of lines.slice(1)) {
      expect(item).toMatch(/^\s*-\s/);
    }
    expect(roundTrip(lines)).toEqual({ aliases });
  });

  it("多键拼装（UI 写侧实际形态）：name + aliases + importance 同卡读回", () => {
    const lines = [
      ...dumpFrontmatterKey("name", "李四"),
      ...dumpFrontmatterKey("aliases", ["小李", "李帅"]),
      ...dumpFrontmatterKey("importance", "main"),
    ];
    expect(roundTrip(lines)).toEqual({ name: "李四", aliases: ["小李", "李帅"], importance: "main" });
  });

  it("长值不折行（lineWidth:-1）：行手术依赖单值不跨行", () => {
    const long = "很长的别名".repeat(40);
    expect(dumpFrontmatterKey("name", long)).toHaveLength(1);
    expect(roundTrip(dumpFrontmatterKey("name", long))).toEqual({ name: long });
  });
});
