// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 日志脱敏机制（盲审 2026-07-11 日志维根治）：
 * ① 字段名匹配（既有）② 数组递归（新）③ 字符串值级敏感形态擦洗（新）。
 * 该日志文件随「导出日志」外发 —— 这里的每一条都是外泄防线。
 */

import { describe, expect, it } from "vitest";
import { redactCtx } from "../logger.js";

describe("redactCtx — 字段名匹配（既有行为回归锚）", () => {
  it("api_key / token / authorization / *_key 字段整体掩码", () => {
    const out = redactCtx({ api_key: "sk-abc", token: "t", authorization: "Bearer x", my_key: "n", safe: 1 });
    expect(out).toEqual({
      api_key: "[REDACTED]",
      token: "[REDACTED]",
      authorization: "[REDACTED]",
      my_key: "[REDACTED]",
      safe: 1,
    });
  });
});

describe("redactCtx — 数组递归（旧实现数组值原样直通）", () => {
  it("对象数组内层敏感字段被掩码", () => {
    const out = redactCtx({ headers: [{ authorization: "Bearer secret123456" }, { ok: true }] });
    expect(out.headers).toEqual([{ authorization: "[REDACTED]" }, { ok: true }]);
  });

  it("字符串数组元素也过值级擦洗", () => {
    const out = redactCtx({ lines: ["Bearer abcdefgh12345678", "plain"] });
    expect(out.lines).toEqual(["Bearer [REDACTED]", "plain"]);
  });
});

describe("redactCtx — 字符串值级擦洗（error 字段直通面根治）", () => {
  it("err.message 携带的 Bearer 头被擦掉", () => {
    const out = redactCtx({ error: "HTTP 401: bad header Authorization: Bearer sk_live_abcdef123456 rejected" });
    expect(out.error).not.toContain("sk_live_abcdef123456");
    // kv 模式与 Bearer 模式叠加会双重掩码（宁可多擦不可漏擦）—— 只断言密钥消失且有掩码痕迹
    expect(out.error).toContain("[REDACTED]");
  });

  it("响应体回显的 sk- 裸 key 被擦掉", () => {
    const out = redactCtx({ error: 'LLM 调用失败 (HTTP 400): {"detail":"invalid key sk-proj-AbCd1234EfGh5678"}' });
    expect(out.error).not.toContain("sk-proj-AbCd1234EfGh5678");
  });

  it("URL query 里的密钥参数值被擦掉", () => {
    const out = redactCtx({ error: "fetch failed: https://gw.example.com/v1?api_key=supersecret999&x=1" });
    expect(out.error).not.toContain("supersecret999");
    expect(out.error).toContain("api_key=[REDACTED]");
  });

  it("kv 形态 api_key: xxx 被擦掉", () => {
    const out = redactCtx({ error: 'request dump: api_key: "sk_verysecret42", model: "m"' });
    expect(out.error).not.toContain("sk_verysecret42");
  });

  it("secure key 名内嵌的作品标题被擦掉（keyring 错误串形态）", () => {
    const out = redactCtx({
      error: "failed to read secure store entry for project.我的秘密同人文.llm.api_key: locked",
    });
    expect(out.error).not.toContain("我的秘密同人文");
    expect(out.error).toContain("project.[REDACTED].llm.api_key");
  });

  it("含空格的作品/AU 标题也被擦掉（B2 对抗审 MEDIUM：\\S 曾遇空格即断）", () => {
    const out = redactCtx({ error: 'read failed for key "project.Harry Potter/Season 8 Fix-It.llm.api_key": locked' });
    expect(out.error).not.toContain("Harry Potter");
    expect(out.error).not.toContain("Season 8 Fix-It");
    expect(out.error).toContain("project.[REDACTED].llm.api_key");
  });

  it("redactSecureKey 产出的 #哈希 诊断形态不被二次抹除（保留日志内关联能力）", () => {
    const out = redactCtx({ error: "retry for project.#a1b2c3d4.llm.api_key twice" });
    expect(out.error).toContain("project.#a1b2c3d4.llm.api_key");
  });

  it("裸 token kv 形态被擦掉（网关 4xx 回显常见），token 计数字段不误伤", () => {
    const out = redactCtx({ error: '{"token":"abcd1234efgh5678"} and output_tokens=1234, "tokens": 500' });
    expect(out.error).not.toContain("abcd1234efgh5678");
    expect(out.error).toContain("output_tokens=1234");
    expect(out.error).toContain('"tokens": 500');
  });

  it("普通诊断文本不受影响", () => {
    const out = redactCtx({ error: "network timeout after 30s", count: 3, flag: true });
    expect(out).toEqual({ error: "network timeout after 30s", count: 3, flag: true });
  });
});
