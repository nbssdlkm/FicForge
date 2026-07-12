// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Layer 1 — tool_args_repair 单测。
 *
 * 覆盖：
 *   - 合法输入不动（准则 1）
 *   - 4 类形状修复（参数错的 4 类高频模式）
 *   - Markdown 链接拆解（路径字段污染）
 *   - 修复顺序（parse_json_string 必须先于 wrap_bare）
 *   - 失败给 retryHint，不打 `Error:` 前缀（准则 4）
 *   - 多 issue 同时修
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { repairAndValidateToolArgs, salvageMalformedJson } from "../tool_args_repair.js";

describe("repairAndValidateToolArgs", () => {
  // -------------------------------------------------------------------------
  // 合法输入：准则 1（schema fail first，不预处理 valid value）
  // -------------------------------------------------------------------------
  describe("合法输入", () => {
    it("合法 JSON 直接通过，repairs 为空", () => {
      const schema = z.object({ name: z.string(), aliases: z.array(z.string()) });
      const result = repairAndValidateToolArgs(
        "create_character_file",
        JSON.stringify({ name: "Alice", aliases: ["Liddell"] }),
        schema,
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: "Alice", aliases: ["Liddell"] });
      expect(result.repairs).toEqual([]);
      expect(result.remainingIssues).toEqual([]);
    });

    it("含路径字段但路径合法 → markdown pre-pass 不动", () => {
      const schema = z.object({ file_path: z.string() });
      const result = repairAndValidateToolArgs(
        "show_setting",
        JSON.stringify({ file_path: "characters/Alice.md" }),
        schema,
        { pathFields: [["file_path"]] },
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ file_path: "characters/Alice.md" });
      expect(result.repairs).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 4 类形状修复
  // -------------------------------------------------------------------------
  describe("4 类形状修复", () => {
    it("#1 可选字段强传 null → 删字段", () => {
      const schema = z.object({
        name: z.string(),
        origin_ref: z.string().optional(),
      });
      const result = repairAndValidateToolArgs(
        "create_character_file",
        JSON.stringify({ name: "Alice", origin_ref: null }),
        schema,
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: "Alice" });
      expect(result.repairs).toHaveLength(1);
      expect(result.repairs[0].kind).toBe("drop_null_optional");
      expect(result.repairs[0].field).toEqual(["origin_ref"]);
    });

    it("#1 必填字段传 null → 不修，给 hint（避免 silent corruption）", () => {
      const schema = z.object({ name: z.string() });
      const result = repairAndValidateToolArgs("create_character_file", JSON.stringify({ name: null }), schema);
      expect(result.success).toBe(false);
      expect(result.retryHint).toContain("name");
    });

    it("#2 JSON 数组当字符串传 → parse 字符串", () => {
      const schema = z.object({ aliases: z.array(z.string()) });
      const result = repairAndValidateToolArgs(
        "create_character_file",
        JSON.stringify({ aliases: '["Liddell","Wonderland Alice"]' }),
        schema,
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ aliases: ["Liddell", "Wonderland Alice"] });
      expect(result.repairs[0].kind).toBe("parse_json_string_array");
    });

    it("#3 schema 要数组它包了 {} → 替换空数组", () => {
      const schema = z.object({ aliases: z.array(z.string()) });
      const result = repairAndValidateToolArgs("create_character_file", JSON.stringify({ aliases: {} }), schema);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ aliases: [] });
      expect(result.repairs[0].kind).toBe("unwrap_array_placeholder");
    });

    it("#4 应传数组传裸字符串 → 包成单元素数组", () => {
      const schema = z.object({ aliases: z.array(z.string()) });
      const result = repairAndValidateToolArgs("create_character_file", JSON.stringify({ aliases: "Liddell" }), schema);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ aliases: ["Liddell"] });
      expect(result.repairs[0].kind).toBe("wrap_bare_to_array");
    });
  });

  // -------------------------------------------------------------------------
  // 修复顺序：parse_json_string 必须先于 wrap_bare
  // -------------------------------------------------------------------------
  describe("修复顺序约束", () => {
    it('\'["a","b"]\' 应被 parse 成 ["a","b"]，不应被错包成 [[\'["a","b"]\']]', () => {
      const schema = z.object({ aliases: z.array(z.string()) });
      const result = repairAndValidateToolArgs(
        "create_character_file",
        JSON.stringify({ aliases: '["a","b"]' }),
        schema,
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ aliases: ["a", "b"] });
      expect(result.repairs[0].kind).toBe("parse_json_string_array");
      expect(result.repairs.find((r) => r.kind === "wrap_bare_to_array")).toBeUndefined();
    });

    it("'foo' 不是合法 JSON 数组 → 走 wrap_bare 兜底", () => {
      const schema = z.object({ aliases: z.array(z.string()) });
      const result = repairAndValidateToolArgs("create_character_file", JSON.stringify({ aliases: "foo" }), schema);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ aliases: ["foo"] });
      expect(result.repairs[0].kind).toBe("wrap_bare_to_array");
    });
  });

  // -------------------------------------------------------------------------
  // Markdown 链接拆解（路径字段专属）
  // -------------------------------------------------------------------------
  describe("Markdown 链接拆解", () => {
    it("路径字段含退化 markdown 链接 → 还原（text=basename(url)）", () => {
      const schema = z.object({ file_path: z.string() });
      const result = repairAndValidateToolArgs(
        "show_setting",
        JSON.stringify({ file_path: "characters/[Alice.md](http://Alice.md)" }),
        schema,
        { pathFields: [["file_path"]] },
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ file_path: "characters/Alice.md" });
      expect(result.repairs[0].kind).toBe("strip_degenerate_markdown_link");
      expect(result.repairs[0].field).toEqual(["file_path"]);
    });

    it("text === url 完全相同 → 拆解", () => {
      const schema = z.object({ filename: z.string() });
      const result = repairAndValidateToolArgs(
        "modify_character_file",
        JSON.stringify({ filename: "[Alice.md](Alice.md)" }),
        schema,
        { pathFields: [["filename"]] },
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ filename: "Alice.md" });
    });

    it("正常 markdown 链接（text ≠ url 且不是 basename）→ 不动", () => {
      const schema = z.object({ filename: z.string() });
      const result = repairAndValidateToolArgs(
        "test",
        JSON.stringify({ filename: "[click here](http://example.com)" }),
        schema,
        { pathFields: [["filename"]] },
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ filename: "[click here](http://example.com)" });
      expect(result.repairs).toEqual([]);
    });

    it("非路径字段（不在 pathFields 里）含 markdown 链接 → 不动（保护正文）", () => {
      // Awais 准则：writeFile 正文里像 JSON 的内容不能被预处理"好心修坏"
      const schema = z.object({ content: z.string() });
      const result = repairAndValidateToolArgs(
        "create_character_file",
        JSON.stringify({ content: "见 [notes.md](http://notes.md) 详情" }),
        schema,
        { pathFields: [["filename"]] }, // 故意不含 content
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ content: "见 [notes.md](http://notes.md) 详情" });
      expect(result.repairs).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 失败路径：retryHint 格式 + 不抛异常
  // -------------------------------------------------------------------------
  describe("失败路径", () => {
    it("非法 JSON → success=false + retryHint 含 '注意：' 前缀（不用 'Error:'）", () => {
      const schema = z.object({ name: z.string() });
      const result = repairAndValidateToolArgs(
        "test",
        "{name: 'Alice'", // 缺右花括号 + 单引号
        schema,
      );
      expect(result.success).toBe(false);
      expect(result.retryHint).toContain("注意：");
      expect(result.retryHint).not.toContain("Error:");
    });

    it("修不了的字段（类型完全错） → 给模型可读重试 hint", () => {
      const schema = z.object({ count: z.number() });
      const result = repairAndValidateToolArgs("test", JSON.stringify({ count: "not a number" }), schema);
      expect(result.success).toBe(false);
      expect(result.retryHint).toContain("count");
      expect(result.retryHint).toContain("注意：");
      expect(result.remainingIssues).toHaveLength(1);
    });

    it("required 字段缺失 → 不修，给 hint", () => {
      const schema = z.object({ name: z.string(), content: z.string() });
      const result = repairAndValidateToolArgs("create_character_file", JSON.stringify({ name: "Alice" }), schema);
      expect(result.success).toBe(false);
      expect(result.retryHint).toContain("content");
    });

    it("rawArgs 解析为非对象（数组） → 拒绝", () => {
      const schema = z.object({ name: z.string() });
      const result = repairAndValidateToolArgs("test", "[1,2,3]", schema);
      expect(result.success).toBe(false);
      expect(result.retryHint).toContain("数组");
    });

    it("空字符串 args → 视为 {}，required 字段缺失返回 hint", () => {
      const schema = z.object({ name: z.string() });
      const result = repairAndValidateToolArgs("test", "", schema);
      expect(result.success).toBe(false);
      expect(result.retryHint).toContain("name");
    });

    it("retryHint 截断：超过 5 条 issue 显示 '另有 N 条'", () => {
      const schema = z.object({
        a: z.string(),
        b: z.string(),
        c: z.string(),
        d: z.string(),
        e: z.string(),
        f: z.string(),
        g: z.string(),
      });
      const result = repairAndValidateToolArgs("test", JSON.stringify({}), schema);
      expect(result.success).toBe(false);
      expect(result.retryHint).toContain("另有 2 条");
    });
  });

  // -------------------------------------------------------------------------
  // 多 issue 同时修
  // -------------------------------------------------------------------------
  describe("多 issue 同时修", () => {
    it("一次调用同时修 null-optional + bare-string-as-array", () => {
      const schema = z.object({
        name: z.string(),
        origin_ref: z.string().optional(),
        aliases: z.array(z.string()),
      });
      const result = repairAndValidateToolArgs(
        "create_character_file",
        JSON.stringify({ name: "Alice", origin_ref: null, aliases: "Liddell" }),
        schema,
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: "Alice", aliases: ["Liddell"] });
      expect(result.repairs).toHaveLength(2);
      const kinds = result.repairs.map((r) => r.kind).sort();
      expect(kinds).toEqual(["drop_null_optional", "wrap_bare_to_array"]);
    });

    it("修 + markdown 拆解共存", () => {
      const schema = z.object({
        filename: z.string(),
        aliases: z.array(z.string()),
      });
      const result = repairAndValidateToolArgs(
        "modify_character_file",
        JSON.stringify({
          filename: "[Alice.md](Alice.md)",
          aliases: "Liddell",
        }),
        schema,
        { pathFields: [["filename"]] },
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ filename: "Alice.md", aliases: ["Liddell"] });
      expect(result.repairs.map((r) => r.kind).sort()).toEqual([
        "strip_degenerate_markdown_link",
        "wrap_bare_to_array",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Trace 完整性（telemetry 用）
  // -------------------------------------------------------------------------
  describe("Trace 完整性", () => {
    it("每条 trace 含 field / kind / before / after", () => {
      const schema = z.object({ aliases: z.array(z.string()) });
      const result = repairAndValidateToolArgs("test", JSON.stringify({ aliases: "foo" }), schema);
      expect(result.repairs[0]).toMatchObject({
        field: ["aliases"],
        kind: "wrap_bare_to_array",
        before: "foo",
        after: ["foo"],
      });
    });
  });

  // -------------------------------------------------------------------------
  // 嵌套对象：当前实现只对 enum-mismatch 和顶层 invalid_type 修；嵌套保守不修
  // （isOptionalAtPath 只支持 path.length === 1，嵌套场景安全侧失败）
  // -------------------------------------------------------------------------
  describe("嵌套字段", () => {
    it("嵌套字段的 invalid_type 仍能修（不依赖 isOptional 判断）", () => {
      const schema = z.object({
        meta: z.object({ aliases: z.array(z.string()) }),
      });
      const result = repairAndValidateToolArgs("test", JSON.stringify({ meta: { aliases: "Liddell" } }), schema);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ meta: { aliases: ["Liddell"] } });
      expect(result.repairs[0].field).toEqual(["meta", "aliases"]);
    });

    it("嵌套可选字段强传 null → 保守不修，让模型重试（path.length > 1 走安全侧）", () => {
      const schema = z.object({
        meta: z.object({ origin_ref: z.string().optional() }),
      });
      const result = repairAndValidateToolArgs("test", JSON.stringify({ meta: { origin_ref: null } }), schema);
      // 保守：不修，给 hint。这是有意的安全侧失败。
      expect(result.success).toBe(false);
      expect(result.retryHint).toContain("origin_ref");
    });
  });

  // -------------------------------------------------------------------------
  // Malformed-JSON 抢救（只补串内字面控制字符；刻意不猜未转义引号——见函数注释）。
  // 判别性：字面换行写坏的 JSON 在旧代码里 JSON.parse 直接抛 → success:false 丢空；
  // 新代码补转义后 success:true。引号类一律不静默改数据（安全回退 retryHint）。
  // -------------------------------------------------------------------------
  describe("malformed JSON 抢救", () => {
    const factsSchema = z.object({
      facts: z
        .array(
          z.object({
            content_clean: z.string(),
            characters: z.array(z.string()),
            evidence: z.string().optional(),
          }),
        )
        .min(1),
    });

    it("字符串值里字面换行（逐字抄多行原文）→ 补转义抢救成功（旧代码此处丢空）", () => {
      const broken = '{"facts":[{"content_clean":"多行事实","characters":["沈砚"],"evidence":"第一行\n第二行"}]}';
      expect(() => JSON.parse(broken)).toThrow(); // 前提：字面换行确实是坏 JSON
      const r = repairAndValidateToolArgs("propose_facts", broken, factsSchema);
      expect(r.success).toBe(true);
      const facts = (r.data as { facts: { evidence?: string }[] }).facts;
      expect(facts[0].evidence).toBe("第一行\n第二行");
      expect(r.repairs.some((x) => x.kind === "salvage_malformed_json")).toBe(true);
    });

    it("字面制表符 → 补转义抢救成功", () => {
      const broken = '{"facts":[{"content_clean":"a\tb","characters":["A"]}]}';
      expect(() => JSON.parse(broken)).toThrow();
      const r = repairAndValidateToolArgs("propose_facts", broken, factsSchema);
      expect(r.success).toBe(true);
      expect((r.data as { facts: { content_clean: string }[] }).facts[0].content_clean).toBe("a\tb");
    });

    it("未转义引号：不静默截断，安全回退（对抗审 HIGH 防回归）", () => {
      // 内容引号后跟 ", —— 旧贪心启发式会误判为闭合、静默截断 value 再让残余恰好 parse 成功。
      // 现在一律不猜：串状态错位 → 再 parse 必失败 → success:false，绝不写错数据。
      const broken = '{"facts":[{"content_clean":"c","characters":["A"],"evidence":"note "x", "y":"z"}]}';
      expect(() => JSON.parse(broken)).toThrow();
      const r = repairAndValidateToolArgs("propose_facts", broken, factsSchema);
      expect(r.success).toBe(false);
      expect(r.retryHint).toContain("无法解析");
    });

    it("引号 + 换行同时坏：残余引号仍让 parse 失败 → 安全回退（不静默改数据）", () => {
      const broken =
        '{"facts":[{"content_clean":"面圣","characters":["沈砚"],"evidence":"太傅出列："陛下\n私藏宫档""}]}';
      expect(() => JSON.parse(broken)).toThrow();
      const r = repairAndValidateToolArgs("propose_facts", broken, factsSchema);
      expect(r.success).toBe(false);
    });

    it("合法 JSON（含已正确转义的引号 + 换行）→ 抢救不触发，逐字节不动（零回归）", () => {
      const valid = JSON.stringify({
        facts: [{ content_clean: '他说"好"', characters: ["A"], evidence: "line1\nline2" }],
      });
      const r = repairAndValidateToolArgs("propose_facts", valid, factsSchema);
      expect(r.success).toBe(true);
      expect(r.repairs).toEqual([]); // 没跑抢救
      expect((r.data as { facts: { evidence?: string }[] }).facts[0].evidence).toBe("line1\nline2");
    });

    it("全角引号本就合法 → 不误改", () => {
      const valid = '{"facts":[{"content_clean":"他说“好”","characters":["A"]}]}';
      expect(() => JSON.parse(valid)).not.toThrow();
      const r = repairAndValidateToolArgs("propose_facts", valid, factsSchema);
      expect(r.success).toBe(true);
      expect(r.repairs).toEqual([]);
    });

    it("截断 / 非控制字符类畸形 → 抢救不了，仍返回 retryHint（不谎报修好）", () => {
      const truncated = '{"facts":[{"content_clean":"foo';
      const r = repairAndValidateToolArgs("propose_facts", truncated, factsSchema);
      expect(r.success).toBe(false);
      expect(r.retryHint).toContain("无法解析");
    });

    it("salvageMalformedJson 单元：合法 / 纯引号问题 → null（只碰控制字符，不猜引号）", () => {
      expect(salvageMalformedJson('{"a":"b"}')).toBeNull(); // 合法
      expect(salvageMalformedJson('{"a":"he said \\"hi\\""}')).toBeNull(); // 已转义引号不动
      expect(salvageMalformedJson('{"x":"a"b"}')).toBeNull(); // 未转义引号：不猜、不动
      expect(salvageMalformedJson('{"e":"note "x", "y":"z"}')).toBeNull(); // 对抗审 HIGH 形态：不动
    });

    it("salvageMalformedJson 单元：只把串内字面控制字符补成转义", () => {
      const out = salvageMalformedJson('{"x":"a\nb"}');
      expect(out).toBe('{"x":"a\\nb"}');
      expect(JSON.parse(out as string)).toEqual({ x: "a\nb" });
    });
  });
});
