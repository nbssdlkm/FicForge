// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useWriterBootstrap 异步编排测试（盲审长期债③：170 行首载/刷新编排此前零测试）。
 *
 * 重点失败路径：
 * - 四路并发 API 各自 .catch 降级（getState 挂 → state=null 且 projectInfo 强制 null）；
 * - 正文加载失败回退 i18n 文案而非静默空串；
 * - auPath 切换竞态：迟到的旧 AU 响应必须被 guard 丢弃，不得覆盖新 AU 数据；
 * - refreshSettingsModeData 瞬时失败（settings/state 为 null）保留旧值不降级。
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWriterBootstrap } from "../useWriterBootstrap";
import { useActiveRequestGuard } from "../../../hooks/useActiveRequestGuard";
import {
  getChapterContent,
  getState,
  getWriterProjectContext,
  getWriterSessionConfig,
  listFacts,
  type StateInfo,
} from "../../../api/engine-client";

vi.mock("../../../api/engine-client", () => ({
  getState: vi.fn(),
  listFacts: vi.fn(),
  getWriterProjectContext: vi.fn(),
  getWriterSessionConfig: vi.fn(),
  getChapterContent: vi.fn(),
}));

const t = (key: string) => key;

function makeState(overrides: Partial<StateInfo> = {}): StateInfo {
  return { au_id: "a1", current_chapter: 3, ...overrides } as unknown as StateInfo;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// 与 WriterLayout 生产接线一致：guard 以 auPath 为 key，切 AU 时旧 token 自动失效。
function useHarness(auPath: string, showError: (e: unknown, fallback: string) => void) {
  const loadGuard = useActiveRequestGuard(auPath);
  const refreshGuard = useActiveRequestGuard(auPath);
  return useWriterBootstrap({ auPath, loadGuard, refreshGuard, showError, t });
}

function setup(auPath = "/data/fandoms/F/aus/A1") {
  const showError = vi.fn();
  const hook = renderHook(({ path }) => useHarness(path, showError), {
    initialProps: { path: auPath },
  });
  return { hook, showError };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getState).mockResolvedValue(makeState());
  vi.mocked(listFacts).mockResolvedValue([{ id: "f1" } as never]);
  vi.mocked(getWriterProjectContext).mockResolvedValue({ llm: { has_override: false } } as never);
  vi.mocked(getWriterSessionConfig).mockResolvedValue({ default_llm: { mode: "api" } } as never);
  vi.mocked(getChapterContent).mockResolvedValue("第二章正文" as never);
});

describe("useWriterBootstrap · 首载", () => {
  it("成功：四路数据落位 + 拉最近定稿章正文（current_chapter-1）+ loading 收敛", async () => {
    const { hook, showError } = setup();
    expect(hook.result.current.loading).toBe(true);

    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    expect(hook.result.current.data.state?.current_chapter).toBe(3);
    expect(hook.result.current.data.projectInfo).not.toBeNull();
    expect(hook.result.current.data.settingsInfo).not.toBeNull();
    expect(hook.result.current.data.unresolvedFacts).toHaveLength(1);
    expect(getChapterContent).toHaveBeenCalledWith("/data/fandoms/F/aus/A1", 2);
    expect(hook.result.current.data.currentContent).toBe("第二章正文");
    expect(showError).not.toHaveBeenCalled();
  });

  it("current_chapter=1（新 AU）：不拉正文，currentContent 为空", async () => {
    vi.mocked(getState).mockResolvedValue(makeState({ current_chapter: 1 }));
    const { hook } = setup();

    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    expect(getChapterContent).not.toHaveBeenCalled();
    expect(hook.result.current.data.currentContent).toBe("");
  });

  it("正文加载失败：回退 i18n 提示文案（不静默、不 showError）", async () => {
    vi.mocked(getChapterContent).mockRejectedValue(new Error("ENOENT"));
    const { hook, showError } = setup();

    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    expect(hook.result.current.data.currentContent).toBe("writer.contentLoadFailed");
    expect(showError).not.toHaveBeenCalled();
  });

  it("getState 失败：state=null 且 projectInfo 强制 null（页面按未初始化处理），其余不炸", async () => {
    vi.mocked(getState).mockRejectedValue(new Error("corrupt state.yaml"));
    const { hook, showError } = setup();

    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    expect(hook.result.current.data.state).toBeNull();
    // proj 本身成功返回，但 state 缺失时必须一并置 null，避免「有项目信息没状态」的半初始化
    expect(hook.result.current.data.projectInfo).toBeNull();
    expect(hook.result.current.data.unresolvedFacts).toHaveLength(1);
    expect(showError).not.toHaveBeenCalled();
    expect(hook.result.current.loading).toBe(false);
  });

  it("auPath 切换竞态：旧 AU 迟到响应被丢弃，不覆盖新 AU 数据", async () => {
    const slowA = deferred<StateInfo>();
    vi.mocked(getState).mockImplementation(async (path: string) => {
      if (path === "/aus/A") return slowA.promise;
      return makeState({ au_id: "b", current_chapter: 1 });
    });

    const showError = vi.fn();
    const hook = renderHook(({ path }) => useHarness(path, showError), {
      initialProps: { path: "/aus/A" },
    });

    // A 的 getState 还挂着 → 切到 B；B 数据先落位
    hook.rerender({ path: "/aus/B" });
    await waitFor(() => expect(hook.result.current.data.state?.au_id).toBe("b"));
    expect(hook.result.current.loading).toBe(false);

    // A 的响应此刻才到：guard key 已变，必须整体丢弃
    await act(async () => {
      slowA.resolve(makeState({ au_id: "a-late", current_chapter: 9 }));
    });
    expect(hook.result.current.data.state?.au_id).toBe("b");
    expect(hook.result.current.data.state?.current_chapter).toBe(1);
  });

  it("auPath 切换：数据即时清空重置，loading 回到 true", async () => {
    const { hook } = setup("/aus/A");
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.data.currentContent).toBe("第二章正文");

    // 让新 AU 的加载挂起，观察重置后的即时状态
    vi.mocked(getState).mockImplementation(() => new Promise(() => {}));
    hook.rerender({ path: "/aus/B" });

    expect(hook.result.current.loading).toBe(true);
    expect(hook.result.current.data.state).toBeNull();
    expect(hook.result.current.data.currentContent).toBe("");
    expect(hook.result.current.data.unresolvedFacts).toHaveLength(0);
  });
});

describe("useWriterBootstrap · refreshSettingsModeData", () => {
  it("瞬时失败保旧值：state/settings 拉挂时保留旧值，facts 照常刷新（R1-1）", async () => {
    const { hook, showError } = setup();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const oldState = hook.result.current.data.state;
    const oldSettings = hook.result.current.data.settingsInfo;

    vi.mocked(getState).mockRejectedValue(new Error("transient"));
    vi.mocked(getWriterSessionConfig).mockRejectedValue(new Error("transient"));
    vi.mocked(listFacts).mockResolvedValue([{ id: "f2" } as never, { id: "f3" } as never]);

    await act(async () => {
      await hook.result.current.refreshSettingsModeData();
    });

    // 「可用但略旧」不降级为「不可用」
    expect(hook.result.current.data.state).toBe(oldState);
    expect(hook.result.current.data.settingsInfo).toBe(oldSettings);
    expect(hook.result.current.data.unresolvedFacts).toHaveLength(2);
    expect(showError).not.toHaveBeenCalled();
  });

  it("成功：state/settings/facts 全量换新", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    vi.mocked(getState).mockResolvedValue(makeState({ current_chapter: 7 }));
    vi.mocked(getWriterSessionConfig).mockResolvedValue({ default_llm: { mode: "ollama" } } as never);

    await act(async () => {
      await hook.result.current.refreshSettingsModeData();
    });

    expect(hook.result.current.data.state?.current_chapter).toBe(7);
    expect((hook.result.current.data.settingsInfo as { default_llm: { mode: string } }).default_llm.mode).toBe("ollama");
  });

  it("applyStateSnapshot：外部动作（confirm/undo）回写 state 快照", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    act(() => {
      hook.result.current.applyStateSnapshot(makeState({ current_chapter: 4 }));
    });
    expect(hook.result.current.data.state?.current_chapter).toBe(4);
  });
});
