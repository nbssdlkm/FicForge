// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Layer 2 — tool_stream_buffer 单测。
 *
 * 覆盖：
 *   - applyToolDelta 累积/name 重发防御/多 index
 *   - finalizeToolCalls 排序/空 args fallback/id 缺失 fallback
 *   - extractPartialJsonStringField 合法/转义/unicode/不完整 escape/字段未出现/闭合截断
 */

import { describe, it, expect, vi } from "vitest";
import { applyToolDelta, finalizeToolCalls, extractPartialJsonStringField } from "../tool_stream_buffer.js";
import type { ToolBuffer } from "../tool_stream_buffer.js";

describe("applyToolDelta", () => {
  it("(a) 累积单个 tool: name 在首 chunk + 多个 args chunk 拼接", () => {
    const buffers = new Map<number, ToolBuffer>();
    applyToolDelta(buffers, { index: 0, id: "call_1", function: { name: "show_chapter", arguments: '{"ch' } });
    applyToolDelta(buffers, { index: 0, function: { arguments: "apter_n" } });
    applyToolDelta(buffers, { index: 0, function: { arguments: 'um":3}' } });

    const buf = buffers.get(0)!;
    expect(buf.name).toBe("show_chapter");
    expect(buf.args).toBe('{"chapter_num":3}');
    expect(buf.id).toBe("call_1");
  });

  it("(b) name 跨 chunk 重发（防御非标 provider）：用 = 不 +=，取最后值", () => {
    const buffers = new Map<number, ToolBuffer>();
    applyToolDelta(buffers, { index: 0, function: { name: "show" } });
    applyToolDelta(buffers, { index: 0, function: { name: "show_chapter" } });

    expect(buffers.get(0)!.name).toBe("show_chapter");
  });
});

describe("finalizeToolCalls", () => {
  it("(c) 多 index 排序：index=1 先 emit + index=0 后 emit → 按 index 0,1 排序", () => {
    const buffers = new Map<number, ToolBuffer>();
    applyToolDelta(buffers, { index: 1, id: "call_b", function: { name: "tool_b", arguments: "{}" } });
    applyToolDelta(buffers, { index: 0, id: "call_a", function: { name: "tool_a", arguments: "{}" } });

    const calls = finalizeToolCalls(buffers);
    expect(calls).toHaveLength(2);
    expect(calls[0].function.name).toBe("tool_a");
    expect(calls[1].function.name).toBe("tool_b");
  });

  it("(d) 空 args fallback: buf.args 是空字符串 → arguments = '{}'", () => {
    const buffers = new Map<number, ToolBuffer>();
    applyToolDelta(buffers, { index: 0, id: "call_x", function: { name: "tool_x" } });
    // 不给 arguments delta

    const calls = finalizeToolCalls(buffers);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.arguments).toBe("{}");
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: 测试名故意以字面文本描述生成的 id 格式，不是漏写反引号
  it("(e) id 缺失 fallback: buf.id 空 → 生成 tc-${Date.now()}-${i} 格式 id", () => {
    const fakeNow = 1700000000000;
    vi.spyOn(Date, "now").mockReturnValue(fakeNow);

    const buffers = new Map<number, ToolBuffer>();
    applyToolDelta(buffers, { index: 0, function: { name: "tool_e", arguments: '{"k":"v"}' } });
    // 不给 id

    const calls = finalizeToolCalls(buffers);
    expect(calls).toHaveLength(1);
    expect(calls[0].id).toBe(`tc-${fakeNow}-0`);

    vi.restoreAllMocks();
  });
});

describe("extractPartialJsonStringField", () => {
  it("(f) 合法情形：提取已闭合的字段值", () => {
    const result = extractPartialJsonStringField('{"content":"hello"}', "content");
    expect(result).toBe("hello");
  });

  it("(g) 含转义：\\n \\t 等正确解码", () => {
    const result = extractPartialJsonStringField('{"content":"line1\\nline2\\ttab"}', "content");
    expect(result).toBe("line1\nline2\ttab");
  });

  it("(h) unicode escape：\\u4e2d 解码为 '中'", () => {
    const result = extractPartialJsonStringField('{"content":"\\u4e2d"}', "content");
    expect(result).toBe("中");
  });

  it("(i) 不完整 escape（\\u 缺位）：保守返回已 parse 部分", () => {
    const result = extractPartialJsonStringField('{"content":"\\u4e2', "content");
    expect(result).toBe("");
  });

  it("(j) 字段未出现：返回 null", () => {
    const result = extractPartialJsonStringField('{"other":"x"}', "content");
    expect(result).toBeNull();
  });

  it("(k) 闭合引号截断：引号已闭合时精确返回到闭合位置", () => {
    const result = extractPartialJsonStringField('{"content":"part"}', "content");
    expect(result).toBe("part");
  });

  it("通用 fieldName：支持任意字段名提取", () => {
    const result = extractPartialJsonStringField('{"summary":"done","detail":"ok"}', "summary");
    expect(result).toBe("done");
  });

  it("fieldName 含正则特殊字符：自动转义", () => {
    const result = extractPartialJsonStringField('{"some.field":"value"}', "some.field");
    expect(result).toBe("value");
  });
});
