// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TD-008 — shouldWarnEmptyAuApiKey: 何时提示「本篇 AU 的 API Key 为空」。
 * 主要覆盖「删除→回收站恢复后密钥被清空」的 UX 场景，且对未开覆盖 / 非 API 模式
 * 不误报。
 */

import { describe, expect, it } from "vitest";
import { shouldWarnEmptyAuApiKey } from "../form-mappers";

describe("shouldWarnEmptyAuApiKey (TD-008)", () => {
  it("warns when override + api mode + empty key (e.g. after trash-restore clears it)", () => {
    expect(shouldWarnEmptyAuApiKey(true, "api", "")).toBe(true);
  });

  it("treats whitespace-only key as empty", () => {
    expect(shouldWarnEmptyAuApiKey(true, "api", "   ")).toBe(true);
  });

  it("does not warn when a key is present", () => {
    expect(shouldWarnEmptyAuApiKey(true, "api", "sk-abc")).toBe(false);
  });

  it("does not warn when override is off (inherits global)", () => {
    expect(shouldWarnEmptyAuApiKey(false, "api", "")).toBe(false);
  });

  it("does not warn for non-api modes (ollama / local don't use api_key)", () => {
    expect(shouldWarnEmptyAuApiKey(true, "ollama", "")).toBe(false);
    expect(shouldWarnEmptyAuApiKey(true, "local", "")).toBe(false);
  });
});
