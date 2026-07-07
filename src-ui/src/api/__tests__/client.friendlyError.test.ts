// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * getFriendlyErrorMessage — 对话/写文路径共用的错误码→友好文案映射（审计 M26）。
 *
 * SimpleChatPanel.onError 融合后改走此映射（对齐 useWriterGeneration），把 error_code
 * 翻成用户可读文案，不再直接拼 `[code] engine原始中文`。UNSUPPORTED_MODE 也在此有
 * 中英对称 i18n key（error_messages.unsupported_mode）。
 */

import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { getFriendlyErrorMessage } from "../client";

describe("getFriendlyErrorMessage (M26)", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh");
  });

  it("UNSUPPORTED_MODE → error_messages.unsupported_mode（不再是引擎原始硬编码 message）", () => {
    const engineRawMessage = "本版本不支持 local 模式（本地模型加载）。请切换到 API 或 Ollama 模式。";
    const out = getFriendlyErrorMessage({ error_code: "UNSUPPORTED_MODE", message: engineRawMessage });
    // 走 i18n key，不是原样透传引擎 message
    expect(out).toBe(i18n.t("error_messages.unsupported_mode"));
    expect(out).not.toBe(engineRawMessage);
  });

  it("大小写不敏感：小写 unsupported_mode 同样命中", () => {
    const out = getFriendlyErrorMessage({ error_code: "unsupported_mode" });
    expect(out).toBe(i18n.t("error_messages.unsupported_mode"));
  });

  it("中英对称：切到 en 时 unsupported_mode 返回英文文案", async () => {
    await i18n.changeLanguage("en");
    try {
      const out = getFriendlyErrorMessage({ error_code: "UNSUPPORTED_MODE" });
      expect(out).toBe(i18n.t("error_messages.unsupported_mode"));
      // 英文文案确实存在且非空、非中文原文
      expect(out.length).toBeGreaterThan(0);
      expect(out).not.toMatch(/[一-鿿]/); // 无中文字符
    } finally {
      await i18n.changeLanguage("zh");
    }
  });

  it("未知 code 且有 message → 回落到 message（保底不丢信息）", () => {
    const out = getFriendlyErrorMessage({ error_code: "SOME_NOVEL_CODE", message: "原始信息" });
    expect(out).toBe("原始信息");
  });
});
