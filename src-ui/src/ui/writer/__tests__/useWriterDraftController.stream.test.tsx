// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * useWriterDraftController — 流式 rAF 缓冲语义（审计 M11）。
 *
 * 判别性契约（回退到「每 chunk 一次 setStreamText」旧实现即挂）：
 *  1. 同帧多次 appendStream 只缓冲不落 state，rAF 回调时一次性批量应用
 *  2. flushStream 强制立即落地（终态前调用的契约，对齐 useSimpleChat）
 *  3. 单帧缓冲超 50KB 阈值绕过 rAF 同步 flush（后台 rAF throttle 兜底）
 *  4. resetStream 丢弃未 flush 的缓冲（这轮流式作废，不泄漏到下一轮）
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWriterDraftController } from "../useWriterDraftController";

type RafCallback = (time: number) => void;

let rafQueue: Map<number, RafCallback>;
let rafId: number;

function runPendingRaf() {
  const callbacks = [...rafQueue.values()];
  rafQueue.clear();
  for (const cb of callbacks) cb(performance.now());
}

beforeEach(() => {
  rafQueue = new Map();
  rafId = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: RafCallback) => {
    rafId += 1;
    rafQueue.set(rafId, cb);
    return rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafQueue.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderController() {
  // state=null：draft 加载 effect 走清空分支，不触发任何引擎调用，
  // 流式缓冲与 draft 加载互相独立。
  return renderHook(() =>
    useWriterDraftController({ auPath: "/fandoms/F/aus/A", state: null }),
  );
}

describe("useWriterDraftController 流式 rAF 缓冲（审计 M11）", () => {
  it("同帧多个 chunk 只缓冲，rAF 回调时一次性批量应用", () => {
    const { result } = renderController();

    act(() => {
      result.current.appendStream("春风");
      result.current.appendStream("拂过");
      result.current.appendStream("山岗");
    });
    // rAF 未跑：state 不应有任何变化（旧实现此处已是 "春风拂过山岗" → 挂）
    expect(result.current.streamText).toBe("");
    expect(rafQueue.size).toBe(1);

    act(() => {
      runPendingRaf();
    });
    expect(result.current.streamText).toBe("春风拂过山岗");
  });

  it("flushStream 取消挂起的 rAF 并立即落地缓冲", () => {
    const { result } = renderController();

    act(() => {
      result.current.appendStream("残句");
    });
    expect(result.current.streamText).toBe("");

    act(() => {
      result.current.flushStream();
    });
    expect(result.current.streamText).toBe("残句");
    // rAF 已被取消，不会二次 append
    expect(rafQueue.size).toBe(0);
    act(() => {
      runPendingRaf();
    });
    expect(result.current.streamText).toBe("残句");
  });

  it("单帧缓冲超过 50KB 阈值时绕过 rAF 同步 flush", () => {
    const { result } = renderController();
    const bigChunk = "字".repeat(50_001);

    act(() => {
      result.current.appendStream(bigChunk);
    });
    // 未跑 rAF 也应立即落地（后台 rAF throttle 时防 buffer 无限增长）
    expect(result.current.streamText).toBe(bigChunk);
  });

  it("resetStream 丢弃未 flush 的缓冲，不泄漏到下一轮流式", () => {
    const { result } = renderController();

    act(() => {
      result.current.appendStream("上一轮的残余");
      result.current.resetStream();
    });
    expect(result.current.streamText).toBe("");

    // 下一轮流式：只应出现新内容
    act(() => {
      result.current.appendStream("新篇");
      result.current.flushStream();
    });
    expect(result.current.streamText).toBe("新篇");
  });
});
