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
      hook.result.current.openAddModal();
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
      hook.result.current.openAddModal();
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
      hook.result.current.openAddModal();
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
    act(() => hook.result.current.startEditFact(FACT));
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
    act(() => hook.result.current.startEditFact(FACT));
    attachEditRefs(hook);

    await act(() => hook.result.current.handleSaveFact());

    expect(showError).toHaveBeenCalled();
    expect(hook.result.current.editingFact).toBe(FACT);
    expect(hook.result.current.saveSuccess).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    expect(hook.result.current.savingFact).toBe(false);
  });
});

describe("patchEditingFact（B4 对抗审：空守卫分支）", () => {
  const FACT = { id: "f1", content_clean: "旧内容", characters: ["A"] } as unknown as FactInfo;

  it("编辑中：按 patch 合并字段", () => {
    const { hook } = setup();
    act(() => hook.result.current.startEditFact(FACT));
    act(() => hook.result.current.patchEditingFact({ status: "deprecated" } as Partial<FactInfo>));
    expect((hook.result.current.editingFact as unknown as { status: string })?.status).toBe("deprecated");
    expect(hook.result.current.editingFact?.id).toBe(FACT.id);
  });

  it("编辑视图已关（异步生命周期操作迟到 resolve）：保持 null 不复活", () => {
    const { hook } = setup();
    act(() => hook.result.current.patchEditingFact({ archived: false } as Partial<FactInfo>));
    expect(hook.result.current.editingFact).toBeNull();
  });
});

// ===========================================================================
// M3 批一：知情范围编辑（四态 + 双名单 + 脏检查 + 防串条）
// ===========================================================================

function factWith(over: Partial<FactInfo>): FactInfo {
  return {
    id: "f_1", content_raw: "r", content_clean: "c", characters: [],
    status: "active", type: "plot_event", narrative_weight: "medium",
    chapter: 3, timeline: "", story_time: "", resolves: null,
    source: "manual", revision: 1, created_at: "", updated_at: "",
    ...over,
  } as FactInfo;
}

describe("useFactEditor · 知情范围（M3 批一）", () => {
  it("startEditFact 初始化四态：名单→some、reader_only、裸字符串（历史脏数据）→some 单人、null→unset", () => {
    const { hook } = setup();

    act(() => hook.result.current.startEditFact(factWith({ known_to: ["王妃", "稳婆"], hidden_from: ["王爷"] })));
    expect(hook.result.current.knownToMode).toBe("some");
    expect(hook.result.current.knownToNames).toEqual(["王妃", "稳婆"]);
    expect(hook.result.current.hiddenFromNames).toEqual(["王爷"]);

    act(() => hook.result.current.startEditFact(factWith({ id: "f_2", known_to: "reader_only" })));
    expect(hook.result.current.knownToMode).toBe("reader_only");
    expect(hook.result.current.knownToNames).toEqual([]);          // 防串条：上一条名单不残留
    expect(hook.result.current.hiddenFromNames).toEqual([]);

    act(() => hook.result.current.startEditFact(factWith({ id: "f_3", known_to: "皇帝" as unknown as "all" })));
    expect(hook.result.current.knownToMode).toBe("some");
    expect(hook.result.current.knownToNames).toEqual(["皇帝"]);

    act(() => hook.result.current.startEditFact(factWith({ id: "f_4" })));
    expect(hook.result.current.knownToMode).toBe("unset");
  });

  it("保存：知情字段只在变化时进 payload；未按回车的草稿视同已提交；some 空名单折叠 null", async () => {
    const { hook } = setup();
    act(() => hook.result.current.startEditFact(factWith({ known_to: ["王妃"], hidden_from: [] })));

    // 情形一：全未变 → payload 不含知情键（脏检查）
    await act(() => hook.result.current.handleSaveFact());
    let payload = vi.mocked(editFact).mock.calls[0][2] as Record<string, unknown>;
    expect("known_to" in payload).toBe(false);
    expect("hidden_from" in payload).toBe(false);

    // 情形二：hidden_from 草稿未回车直接保存 → 草稿并入名单
    act(() => hook.result.current.setHiddenFromDraft("王爷"));
    await act(() => hook.result.current.handleSaveFact());
    payload = vi.mocked(editFact).mock.calls[1][2] as Record<string, unknown>;
    expect(payload.hidden_from).toEqual(["王爷"]);
    expect(hook.result.current.hiddenFromNames).toEqual(["王爷"]);   // 保存后草稿落定
    expect(hook.result.current.hiddenFromDraft).toBe("");

    // 情形三：some 态清空名单 → known_to 折叠为 null（与引擎消毒口径一致）
    act(() => hook.result.current.removeKnownToNameAt(0));
    await act(() => hook.result.current.handleSaveFact());
    payload = vi.mocked(editFact).mock.calls[2][2] as Record<string, unknown>;
    expect(payload.known_to).toBeNull();
  });

  it("名单操作语义化：commit 去重去空、popLast 回删、closeEditFact 清空全部知情 state", () => {
    const { hook } = setup();
    act(() => hook.result.current.startEditFact(factWith({})));

    act(() => hook.result.current.selectKnownToMode("some"));
    act(() => hook.result.current.setKnownToDraft("  王妃  "));
    act(() => hook.result.current.commitKnownToName());
    act(() => hook.result.current.setKnownToDraft("王妃"));
    act(() => hook.result.current.commitKnownToName());          // 重复 → 不入列
    expect(hook.result.current.knownToNames).toEqual(["王妃"]);

    act(() => hook.result.current.popLastKnownToName());
    expect(hook.result.current.knownToNames).toEqual([]);

    act(() => hook.result.current.setHiddenFromDraft("王爷"));
    act(() => hook.result.current.commitHiddenFromName());
    act(() => hook.result.current.closeEditFact());
    expect(hook.result.current.knownToMode).toBe("unset");
    expect(hook.result.current.hiddenFromNames).toEqual([]);
    expect(hook.result.current.hiddenFromDraft).toBe("");
  });
});

describe("useFactEditor · 对抗审整改（MED-4 竞态 + 引擎回传反映）", () => {
  it("保存 A 在飞时切到 B：迟到的回写被丢弃，B 的状态不被污染", async () => {
    const { hook } = setup();
    const gate = deferred<FactInfo>();
    vi.mocked(editFact).mockReturnValueOnce(gate.promise as never);

    act(() => hook.result.current.startEditFact(factWith({ id: "f_A", known_to: ["甲"], hidden_from: [] })));
    act(() => hook.result.current.setHiddenFromDraft("乙"));

    let savePromise!: Promise<void>;
    act(() => { savePromise = hook.result.current.handleSaveFact(); });

    // A 的请求还没回来，用户切到 B
    act(() => hook.result.current.startEditFact(factWith({ id: "f_B", known_to: "reader_only", hidden_from: ["丙"] })));

    // A 的请求此刻才完成
    await act(async () => { gate.resolve(factWith({ id: "f_A", known_to: ["甲"], hidden_from: ["乙"] })); await savePromise; });

    // B 的编辑视图与名单不被 A 的结果污染
    expect(hook.result.current.editingFact?.id).toBe("f_B");
    expect(hook.result.current.editingFact?.known_to).toBe("reader_only");
    expect(hook.result.current.knownToMode).toBe("reader_only");
    expect(hook.result.current.hiddenFromNames).toEqual(["丙"]);
  });

  it("引擎回传的矛盾化解结果反映进编辑 state（同名同现 → 瞒着方胜）", async () => {
    const { hook } = setup();
    act(() => hook.result.current.startEditFact(factWith({ id: "f_C", known_to: ["王妃"], hidden_from: [] })));

    // 用户把王妃也加进「瞒着谁」→ 引擎化解后回传 known_to=null
    act(() => hook.result.current.setHiddenFromDraft("王妃"));
    vi.mocked(editFact).mockResolvedValueOnce(
      factWith({ id: "f_C", known_to: null, hidden_from: ["王妃"] }) as never,
    );
    await act(() => hook.result.current.handleSaveFact());

    expect(hook.result.current.knownToMode).toBe("unset");        // 化解结果回落
    expect(hook.result.current.knownToNames).toEqual([]);
    expect(hook.result.current.hiddenFromNames).toEqual(["王妃"]);
    expect(hook.result.current.editingFact?.known_to).toBeNull();
  });
});
