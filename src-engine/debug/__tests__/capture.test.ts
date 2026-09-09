// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it } from "vitest";
import {
  captureDebugBundle,
  clearDebugBundles,
  getDebugBundle,
  isDebugCaptureEnabled,
  listDebugBundles,
  setDebugCaptureEnabled,
} from "../capture.js";
import { createGenerationDebugBundle, type GenerationDebugBundle } from "../../domain/debug_bundle.js";

function makeBundle(overrides: Partial<GenerationDebugBundle> = {}): GenerationDebugBundle {
  return createGenerationDebugBundle({ path: "write", au_id: "au_a", chapter_num: 1, ...overrides });
}

describe("debug capture", () => {
  beforeEach(() => {
    setDebugCaptureEnabled(true);
    clearDebugBundles();
  });

  it("disabled: capture is no-op", () => {
    setDebugCaptureEnabled(false);
    captureDebugBundle(makeBundle());
    expect(listDebugBundles()).toEqual([]);
  });

  it("enabled: capture assigns id and list returns meta newest-first without messages", () => {
    const b1 = makeBundle({ chapter_num: 1 });
    const b2 = makeBundle({ chapter_num: 2, result: { input_tokens: 10, output_tokens: 5, duration_ms: 42 } });
    captureDebugBundle(b1);
    captureDebugBundle(b2);
    const list = listDebugBundles();
    expect(list).toHaveLength(2);
    expect(list[0].chapter_num).toBe(2); // 最新在前
    expect(list[1].chapter_num).toBe(1);
    expect(list[0].status).toBe("ok");
    expect(list[1].status).toBe("unknown");
    expect(list[0].id).not.toBe("");
    // meta 不含 messages 全文
    expect("start_messages" in list[0]).toBe(false);
    expect("final_messages" in list[0]).toBe(false);
  });

  it("ring buffer rolls: 11th capture drops the oldest", () => {
    for (let i = 1; i <= 11; i++) captureDebugBundle(makeBundle({ chapter_num: i }));
    const list = listDebugBundles();
    expect(list).toHaveLength(10);
    expect(list[list.length - 1].chapter_num).toBe(2); // 最旧的 chapter 1 被丢
    expect(list[0].chapter_num).toBe(11);
  });

  it("setDebugCaptureEnabled(false) clears buffer (关 = 零保留)", () => {
    captureDebugBundle(makeBundle());
    expect(listDebugBundles()).toHaveLength(1);
    setDebugCaptureEnabled(false);
    expect(isDebugCaptureEnabled()).toBe(false);
    expect(listDebugBundles()).toEqual([]);
  });

  it("getDebugBundle returns deep copy; mutating it does not affect store", () => {
    const b = makeBundle({
      start_messages: [{ role: "user", content: "原文" }],
      result: { input_tokens: 1, output_tokens: 2, duration_ms: 3 },
    });
    captureDebugBundle(b);
    const id = listDebugBundles()[0].id;
    const copy = getDebugBundle(id);
    expect(copy).not.toBeNull();
    copy!.start_messages[0].content = "篡改";
    copy!.result!.input_tokens = 999;
    const again = getDebugBundle(id);
    expect(again!.start_messages[0].content).toBe("原文");
    expect(again!.result!.input_tokens).toBe(1);
    expect(getDebugBundle("nonexistent")).toBeNull();
  });

  it("listDebugBundles returns copies (caller cannot mutate internal meta)", () => {
    captureDebugBundle(makeBundle());
    const list = listDebugBundles();
    (list[0] as { chapter_num: number }).chapter_num = 999;
    expect(listDebugBundles()[0].chapter_num).toBe(1);
  });

  it("error bundle status is error", () => {
    captureDebugBundle(makeBundle({ error: { code: "X", message: "y" } }));
    expect(listDebugBundles()[0].status).toBe("error");
  });
});
