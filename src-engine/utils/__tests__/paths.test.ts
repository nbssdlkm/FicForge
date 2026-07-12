// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 盲审 R3 M4：路径穿越安全守卫（validateBasePath / validatePathSegment）此前只有
 * 空路径分支被覆盖，`..`/空字节/绝对路径/反斜杠等关键拒绝分支零测试 —— 误删这些
 * 判断即等于重开越权读写他人 AU，且全测试仍绿。此文件把每个拒绝/放行分支钉死。
 */

import { describe, expect, it } from "vitest";
import { joinPath, sanitizePathSegment, validateBasePath, validatePathSegment } from "../paths.js";

describe("validateBasePath（系统级路径：允许绝对 + 反斜杠，拒空/空字节/..）", () => {
  it("拒绝空路径", () => {
    expect(() => validateBasePath("", "au_id")).toThrow(/must not be empty/);
  });

  it("拒绝空字节（null byte 注入）", () => {
    expect(() => validateBasePath("data/au\0evil", "au_id")).toThrow(/null byte/);
  });

  it("拒绝 `..` 遍历段（正斜杠）", () => {
    expect(() => validateBasePath("data/../../etc/passwd", "au_id")).toThrow(/'\.\.' traversal/);
  });

  it("拒绝 `..` 遍历段（反斜杠，Windows 分隔符）", () => {
    expect(() => validateBasePath("data\\..\\..\\secret", "au_id")).toThrow(/'\.\.' traversal/);
  });

  it("拒绝混合分隔符里的 `..`", () => {
    expect(() => validateBasePath("data/sub\\..\\x", "au_id")).toThrow(/'\.\.' traversal/);
  });

  it("放行合法相对路径", () => {
    expect(() => validateBasePath("data/fandoms/f1/aus/au1", "au_id")).not.toThrow();
  });

  it("放行 Windows 绝对路径（appDataDir 带盘符 + 反斜杠）", () => {
    expect(() => validateBasePath("C:\\Users\\me\\AppData\\ficforge", "au_id")).not.toThrow();
  });

  it("放行 POSIX 绝对路径", () => {
    expect(() => validateBasePath("/Users/me/Library/ficforge", "au_id")).not.toThrow();
  });

  it("`..` 只作为文件名子串（非独立段）不误伤", () => {
    // "a..b" 不是遍历段，应放行；只有独立的 ".." 段才拒
    expect(() => validateBasePath("data/a..b/c", "au_id")).not.toThrow();
  });
});

describe("validatePathSegment（纯相对段：额外拒绝绝对路径与反斜杠）", () => {
  it("继承 base 校验：拒空 / 空字节 / ..", () => {
    expect(() => validatePathSegment("", "variant")).toThrow(/must not be empty/);
    expect(() => validatePathSegment("a\0b", "variant")).toThrow(/null byte/);
    expect(() => validatePathSegment("../x", "variant")).toThrow(/'\.\.' traversal/);
  });

  it("拒绝绝对路径（前导斜杠）", () => {
    expect(() => validatePathSegment("/abs/name", "variant")).toThrow(/must be a relative path/);
  });

  it("拒绝反斜杠（防 Windows 分隔符逃逸子目录）", () => {
    expect(() => validatePathSegment("sub\\name", "variant")).toThrow(/contains backslash/);
  });

  it("放行合法相对段名", () => {
    expect(() => validatePathSegment("draft_A", "variant")).not.toThrow();
    expect(() => validatePathSegment("角色-01.md", "variant")).not.toThrow();
  });
});

describe("joinPath（去重分隔符 + 过滤空段）", () => {
  it("单斜杠拼接，去掉各段首尾多余斜杠", () => {
    expect(joinPath("data/", "/fandoms/", "/f1")).toBe("data/fandoms/f1");
  });

  it("过滤空段（平台 Data 根为空串时可安全拼子路径）", () => {
    expect(joinPath("", "aus", "au1")).toBe("aus/au1");
  });

  it("首段保留前导斜杠（绝对路径根不被吞）", () => {
    expect(joinPath("/root", "sub")).toBe("/root/sub");
  });
});

describe("sanitizePathSegment 幂等性质（E4 审：tool-runners 双清洗落盘一致性依据）", () => {
  // 代表性输入：全角标点 / 空格点尾缀 / 下划线连串 / normalizeMarkdownFilename 典型输出
  //（.md 结尾、无前导点、无斜杠）。这些是 tool-runners.runModifyWorldbuildingFile 双清洗
  //（本处显式 sanitize + saveLore 内部 sanitize）落盘名等价的前提 —— sanitize 对它们幂等，
  // 双清洗结果 === 单清洗结果。
  const idempotentInputs = [
    "全角标点：（你好）？！.md", // 全角标点 → _
    "name   with   spaces .md", // 内部多空格保留
    "trailing dots... .md", // 空格 + 点尾缀
    "a__b___c.md", // 下划线连串 → 单下划线
    "张三？：李四.md", // normalizeMarkdownFilename 典型输出（保留全角标点）
    "worldbuilding: the realm.md", // 半角冒号 → _
    "Foo Bar Baz.md", // 纯 ASCII + 空格
    "重名_分裂_test.md", // 已清洗形态自洽
  ];

  for (const input of idempotentInputs) {
    it(`幂等：sanitize(sanitize(x)) === sanitize(x) —— ${JSON.stringify(input)}`, () => {
      const once = sanitizePathSegment(input);
      expect(sanitizePathSegment(once)).toBe(once);
    });
  }

  it("控制符+空白+点前缀是唯一非幂等边界（行为锁定：已知非幂等）", () => {
    // "\x01 .foo"：首遍剥控制符 \x01 → " .foo"，前导空白让 ^\.+ 匹配不到点前缀；.trim() 之后才
    // 暴露出 ".foo"。第二遍 ^\.+ 才把点前缀剥掉 → "foo"。故单遍 ≠ 双遍——这是 tool-runners 注释
    // 所述「向设定侧双清洗行为收敛」的唯一边界。这里锁定实际行为，任何改动导致漂移都会被捕获。
    const boundary = "\x01 .foo";
    const once = sanitizePathSegment(boundary);
    const twice = sanitizePathSegment(once);
    expect(once).toBe(".foo"); // 单遍：点前缀残留
    expect(twice).toBe("foo"); // 双遍：点前缀被剥
    expect(once).not.toBe(twice); // 非幂等确证
  });
});
