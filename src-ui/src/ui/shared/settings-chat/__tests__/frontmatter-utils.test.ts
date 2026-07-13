// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * frontmatter-utils round-trip 测试（TD-021 写侧统一到真 YAML 序列化）。
 * 写侧 dumpFrontmatterKey（js-yaml）↔ 读侧 safeMatter/parseCharacterCard 同库往返；
 * 判别回归：流式 `aliases: [a, b]`（别名编辑器旧写法）在 preserveManagedFrontmatter
 * 的旧手写行级解析下会被静默丢弃——真 YAML 解析后必须保留。
 */

import { describe, expect, it } from "vitest";
import { parseCharacterCard, safeMatter } from "@ficforge/engine";
import { applyManagedFrontmatter, CHARACTER_FRONTMATTER_KEYS, preserveManagedFrontmatter } from "../frontmatter-utils";

const GATE = new Set<string>(CHARACTER_FRONTMATTER_KEYS);

describe("applyManagedFrontmatter — 真 YAML 写侧 round-trip", () => {
  it("对抗值字段（冒号/井号/引号/$&）写入后引擎读侧逐字读回", () => {
    const fields = {
      name: '张三:"阿三" #主角',
      aliases: ["小张", "$& $'", "外号: 三哥"],
      importance: "main",
      origin_ref: "某圈/张三",
    };
    const out = applyManagedFrontmatter("正文第一段。", fields, CHARACTER_FRONTMATTER_KEYS);

    const card = parseCharacterCard(out);
    expect(card.name).toBe(fields.name);
    expect(card.aliases).toEqual(fields.aliases);
    const { data, content } = safeMatter(out, GATE);
    expect(data.importance).toBe("main");
    expect(data.origin_ref).toBe("某圈/张三");
    expect(content.trim()).toBe("正文第一段。");
  });

  it("未受管字段（含注释行）按原文保留，不被真 YAML 重排", () => {
    const original = ["---", 'name: "旧名"', "custom_field: 用户手加的", "# 用户注释", "---", "", "正文"].join("\n");
    const out = applyManagedFrontmatter(original, { name: "新名" }, CHARACTER_FRONTMATTER_KEYS);
    expect(out).toContain("custom_field: 用户手加的");
    expect(out).toContain("# 用户注释");
    expect(parseCharacterCard(out).name).toBe("新名");
  });

  it("正文以 --- 场景分割线开头不被吞（H6 防线经 splitFrontmatterRaw 保持）", () => {
    const body = "---\n场景一\n---\n正文";
    const out = applyManagedFrontmatter(body, { name: "甲" }, CHARACTER_FRONTMATTER_KEYS);
    expect(out).toContain("场景一");
    expect(parseCharacterCard(out).name).toBe("甲");
  });
});

describe("preserveManagedFrontmatter — 真 YAML 提取（修正手写解析的流式丢失）", () => {
  it("判别回归：流式 aliases: [a, b]（别名编辑器旧写法）不再被静默丢弃", () => {
    const old = ["---", "name: 张三", 'aliases: ["小张", "阿三"]', "importance: main", "---", "", "旧正文"].join("\n");
    const out = preserveManagedFrontmatter(old, "全新正文", CHARACTER_FRONTMATTER_KEYS);
    const card = parseCharacterCard(out);
    expect(card.name).toBe("张三");
    // 旧实现此处得到 []（手写行级解析只认块式列表）—— 真 YAML 解析后保留
    expect(card.aliases).toEqual(["小张", "阿三"]);
    expect(safeMatter(out, GATE).data.importance).toBe("main");
    expect(out).toContain("全新正文");
  });

  it("块式 aliases 照常保留（既有行为回归）", () => {
    const old = ["---", "name: 李四", "aliases:", '  - "小李"', "  - 李帅", "---", "", "旧正文"].join("\n");
    const out = preserveManagedFrontmatter(old, "新正文", CHARACTER_FRONTMATTER_KEYS);
    expect(parseCharacterCard(out).aliases).toEqual(["小李", "李帅"]);
  });

  it("旧内容无 frontmatter → 新内容原样返回", () => {
    expect(preserveManagedFrontmatter("裸正文", "新正文", CHARACTER_FRONTMATTER_KEYS)).toBe("新正文");
  });

  it("空值语义与旧行为一致：aliases: [] / 空串标量不落行", () => {
    const old = ["---", "name: 王五", "aliases: []", "---", "", "旧"].join("\n");
    const out = preserveManagedFrontmatter(old, "新", CHARACTER_FRONTMATTER_KEYS);
    expect(parseCharacterCard(out).name).toBe("王五");
    expect(out).not.toContain("aliases");
  });
});
