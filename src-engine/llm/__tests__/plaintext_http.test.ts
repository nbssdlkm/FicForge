// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** isPlaintextRemoteHttp —— 明文远端判据单源（生成路径告警 + UI 测试连接告警共用）。 */

import { describe, expect, it } from "vitest";
import { isPlaintextRemoteHttp } from "../config_resolver.js";

describe("isPlaintextRemoteHttp", () => {
  it("https 一律 false", () => {
    expect(isPlaintextRemoteHttp("https://api.deepseek.com")).toBe(false);
    expect(isPlaintextRemoteHttp("https://relay.example.com/v1")).toBe(false);
  });

  it("http 本机回环 false（局域网 Ollama 的 localhost 常态）", () => {
    expect(isPlaintextRemoteHttp("http://localhost:11434/v1")).toBe(false);
    expect(isPlaintextRemoteHttp("http://127.0.0.1:8080/v1")).toBe(false);
    expect(isPlaintextRemoteHttp("http://[::1]:11434/v1")).toBe(false);
    expect(isPlaintextRemoteHttp("http://ollama.localhost/v1")).toBe(false);
  });

  it("http 远端 true（密钥明文传输面）", () => {
    expect(isPlaintextRemoteHttp("http://relay.example.com/v1")).toBe(true);
    expect(isPlaintextRemoteHttp("http://192.168.1.10:11434/v1")).toBe(true);
  });

  it("空串 / 非法输入不误报；http:// 开头但解析失败按远端保守告警", () => {
    expect(isPlaintextRemoteHttp("")).toBe(false);
    expect(isPlaintextRemoteHttp("not-a-url")).toBe(false);
    expect(isPlaintextRemoteHttp("http://")).toBe(true);
  });
});
