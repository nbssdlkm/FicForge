// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useFactEditor 测试（盲审长期债③：手动加/改剧情笔记是用户数据写路径，
 * 失败与 AU 切换竞态分支此前零测试）。
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFactEditor } from "../useFactEditor";
import { addFact, editFact, type FactInfo } from "../../../api/engine-client";

vi.mock("../../../api/engine-client", () => ({
  addFact: vi.fn(),
  editFact: vi.fn(),
}));

const showError = vi.fn();
vi.mock("../../../hooks/useFeedback", () => ({
  useFeedback: () => ({ showError, showSuccess: vi.fn(), showToast: vi.fn() }),
}));

vi.mock("../../../i18n/useAppTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const AU = "/data/fandoms/F/aus/A1";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(currentChapter = 5) {
  const onSaved = vi.fn(async () => {});
  const hook = renderHook(
    ({ auPath }: { auPath: string }) => useFactEditor(auPath, currentChapter, onSaved),
    { initialProps: { auPath: AU } },
  );
  return { hook, onSaved };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(addFact).mockResolvedValue(undefined as never);
  vi.mocked(editFact).mockResolvedValue(undefined as never);
});

describe("useFactEditor · handleAddFact", () => {
  it("空 content_clean：no-op 不发请求", async () => {
    const { hook } = setup();
    act(() => hook.result.current.setNewContentClean("   "));
    await act(() => hook.result.current.handleAddFact());
    expect(addFact).not.toHaveBeenCalled();
  });

  it("成功：挂在最近定稿章（current_chapter-1）、raw 缺省回退 clean、关 modal 重置字段", async () => {
    const { hook, onSaved } = setup(5);
    act(() => {
      hook.result.current.setAddModalOpen(true);
      hook.result.current.setNewContentClean("主角拿到钥匙");
      hook.result.current.setNewType("relationship");
    });

    await act(() => hook.result.current.handleAddFact());

    expect(addFact).toHaveBeenCalledWith(AU, 4, expect.objectContaining({
      content_raw: "主角拿到钥匙",
      content_clean: "主角拿到钥匙",
      type: "relationship",
      characters: [],
    }));
    expect(hook.result.current.isAddModalOpen).toBe(false);
    expect(hook.result.current.newContentClean).toBe("");
    expect(hook.result.current.newType).toBe("plot_event");
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(hook.result.current.adding).toBe(false);
  });

  it("current_chapter=1（尚无定稿章）：章号钳到 1 不出 0", async () => {
    const { hook } = setup(1);
    act(() => hook.result.current.setNewContentClean("设定"));
    await act(() => hook.result.current.handleAddFact());
    expect(addFact).toHaveBeenCalledWith(AU, 1, expect.anything());
  });

  it("失败：showError、modal 不关（输入保留可重试）、adding 复位", async () => {
    vi.mocked(addFact).mockRejectedValueOnce(new Error("EACCES"));
    const { hook, onSaved } = setup();
    act(() => {
      hook.result.current.setAddModalOpen(true);
      hook.result.current.setNewContentClean("会失败的笔记");
    });

    await act(() => hook.result.current.handleAddFact());

    expect(showError).toHaveBeenCalled();
    expect(hook.result.current.isAddModalOpen).toBe(true);
    expect(hook.result.current.newContentClean).toBe("会失败的笔记");
    expect(onSaved).not.toHaveBeenCalled();
    expect(hook.result.current.adding).toBe(false);
  });

  it("进行中重入：adding=true 时再次调用 no-op（防双击重复落库）", async () => {
    const pending = deferred<void>();
    vi.mocked(addFact).mockReturnValue(pending.promise as never);
    const { hook } = setup();
    act(() => hook.result.current.setNewContentClean("笔记"));

    let firstAdd!: Promise<void>;
    act(() => { firstAdd = hook.result.current.handleAddFact(); });
    expect(hook.result.current.adding).toBe(true);
    await act(() => hook.result.current.handleAddFact());
    expect(addFact).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve();
      await firstAdd;
    });
  });

  it("AU 切换竞态：响应落地时已换 AU → 不关 modal、不 showError（旧页面结果整体丢弃）", async () => {
    const pending = deferred<void>();
    vi.mocked(addFact).mockReturnValue(pending.promise as never);
    const { hook, onSaved } = setup();
    act(() => {
      hook.result.current.setAddModalOpen(true);
      hook.result.current.setNewContentClean("笔记");
    });

    let addPromise!: Promise<void>;
    act(() => { addPromise = hook.result.current.handleAddFact(); });
    hook.rerender({ auPath: "/data/fandoms/F/aus/B2" });

    await act(async () => {
      pending.resolve();
      await addPromise;
    });
    expect(hook.result.current.isAddModalOpen).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });
});

describe("useFactEditor · handleSaveFact", () => {
  const FACT = { id: "f1", content_clean: "旧内容", characters: ["A"] } as unknown as FactInfo;

  function attachEditRefs(hook: ReturnType<typeof setup>["hook"]) {
    hook.result.current.editContentCleanRef.current = { value: "新内容" } as HTMLTextAreaElement;
    hook.result.current.editContentRawRef.current = { value: "新原文" } as HTMLTextAreaElement;
    hook.result.current.editCharactersRef.current = { value: " A , B ,, " } as HTMLInputElement;
    hook.result.current.editWeightRef.current = { value: "high" } as HTMLSelectElement;
  }

  it("无 editingFact：no-op", async () => {
    const { hook } = setup();
    await act(() => hook.result.current.handleSaveFact());
    expect(editFact).not.toHaveBeenCalled();
  });

  it("成功：从编辑 refs 收集字段（characters 去空白/去空项）、saveSuccess 亮起、editingFact 就地合并", async () => {
    const { hook, onSaved } = setup();
    act(() => hook.result.current.setEditingFact(FACT));
    attachEditRefs(hook);

    await act(() => hook.result.current.handleSaveFact());

    expect(editFact).toHaveBeenCalledWith(AU, "f1", {
      content_clean: "新内容",
      content_raw: "新原文",
      characters: ["A", "B"],
      narrative_weight: "high",
    });
    expect(hook.result.current.saveSuccess).toBe(true);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(hook.result.current.editingFact?.content_clean).toBe("新内容");
    expect(hook.result.current.savingFact).toBe(false);
  });

  it("失败：showError、编辑态保留、saving 复位", async () => {
    vi.mocked(editFact).mockRejectedValueOnce(new Error("conflict"));
    const { hook, onSaved } = setup();
    act(() => hook.result.current.setEditingFact(FACT));
    attachEditRefs(hook);

    await act(() => hook.result.current.handleSaveFact());

    expect(showError).toHaveBeenCalled();
    expect(hook.result.current.editingFact).toBe(FACT);
    expect(hook.result.current.saveSuccess).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    expect(hook.result.current.savingFact).toBe(false);
  });
});
