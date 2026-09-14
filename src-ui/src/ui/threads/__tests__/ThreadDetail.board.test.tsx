// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * REQ-140 剧情线编排板（ThreadDetail）行为锁定：
 * 缝隙插入落位（before/after 邻居）、尾部追加、摘除常显、上移/下移换位、
 * 「编辑笔记」跳转回调、人物/故事时间元数据徽章、显式 thread_order 优先于章号序。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThreadDetail } from "../ThreadDetail";
import { FeedbackProvider } from "../../../hooks/useFeedback";
import { ThreadStatus } from "@ficforge/engine";
import type { FactInfo } from "../../../api/engine-client";

vi.mock("../../../api/engine-client", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    addFactToThread: vi.fn().mockResolvedValue(undefined),
    removeFactFromThread: vi.fn().mockResolvedValue(undefined),
    moveFactInThread: vi.fn().mockResolvedValue(undefined),
    setFactThreadRole: vi.fn().mockResolvedValue(undefined),
    getStaleThreads: vi.fn().mockResolvedValue([]),
    regenerateThreadState: vi.fn().mockResolvedValue(null),
  };
});

import { addFactToThread, removeFactFromThread, moveFactInThread } from "../../../api/engine-client";

const THREAD = {
  id: "t1",
  title: "感情线",
  description: "",
  state: "等待和解",
  status: ThreadStatus.ACTIVE,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const mkFact = (over: Partial<FactInfo> = {}): FactInfo =>
  ({
    id: "f0",
    content_raw: "r",
    content_clean: "节点内容",
    characters: [],
    timeline: "",
    story_time: "",
    chapter: 1,
    status: "active",
    type: "plot_event",
    resolves: null,
    narrative_weight: "medium",
    source: "manual",
    revision: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    thread_ids: ["t1"],
    ...over,
  }) as FactInfo;

const N1 = mkFact({ id: "f1", content_clean: "首次接触", chapter: 1, characters: ["林深"], story_time_tag: "Y1 春" });
const N2 = mkFact({ id: "f2", content_clean: "告白被拒", chapter: 2 });
const FREE = mkFact({ id: "f9", content_clean: "可挂的新笔记", chapter: 3, thread_ids: [] });

const renderDetail = (props: { onEditFact?: (id: string) => void } = {}) =>
  render(
    <FeedbackProvider>
      <ThreadDetail
        auPath="au"
        thread={THREAD}
        facts={[N1, N2, FREE]}
        onBack={() => {}}
        onEdit={() => {}}
        onChanged={() => {}}
        {...props}
      />
    </FeedbackProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ThreadDetail 编排板（REQ-140）", () => {
  it("节点按显式 thread_order 排序（优先于章号派生序）", () => {
    const a = mkFact({ id: "fa", content_clean: "章1但序号20", chapter: 1, thread_order: { t1: 20 } });
    const b = mkFact({ id: "fb", content_clean: "章9但序号10", chapter: 9, thread_order: { t1: 10 } });
    render(
      <FeedbackProvider>
        <ThreadDetail
          auPath="au"
          thread={THREAD}
          facts={[a, b]}
          onBack={() => {}}
          onEdit={() => {}}
          onChanged={() => {}}
        />
      </FeedbackProvider>,
    );
    const items = screen.getAllByText(/章.但序号/);
    expect(items[0].textContent).toContain("章9但序号10");
    expect(items[1].textContent).toContain("章1但序号20");
  });

  it("缝隙插入：首节点前的 + 落位 beforeFactId=首节点", async () => {
    renderDetail();
    const gaps = screen.getAllByLabelText("在此插入节点");
    // 3 条缝隙：首节点前 / f1-f2 之间 / 尾部
    expect(gaps).toHaveLength(3);
    fireEvent.click(gaps[0]);
    fireEvent.click(await screen.findByText("可挂的新笔记"));
    await waitFor(() =>
      expect(addFactToThread).toHaveBeenCalledWith("au", "f9", "t1", { beforeFactId: "f1", afterFactId: undefined }),
    );
  });

  it("中间缝隙：两节点之间 + 落位 before/after 双邻居", async () => {
    renderDetail();
    const gaps = screen.getAllByLabelText("在此插入节点");
    fireEvent.click(gaps[1]); // f1 与 f2 之间
    fireEvent.click(await screen.findByText("可挂的新笔记"));
    await waitFor(() =>
      expect(addFactToThread).toHaveBeenCalledWith("au", "f9", "t1", { beforeFactId: "f2", afterFactId: "f1" }),
    );
  });

  it("尾部缝隙：afterFactId=末节点；头部按钮 = 追加（空位置对象）", async () => {
    renderDetail();
    const gaps = screen.getAllByLabelText("在此插入节点");
    fireEvent.click(gaps[2]); // 尾部
    fireEvent.click(await screen.findByText("可挂的新笔记"));
    await waitFor(() =>
      expect(addFactToThread).toHaveBeenCalledWith("au", "f9", "t1", { beforeFactId: undefined, afterFactId: "f2" }),
    );

    vi.clearAllMocks();
    fireEvent.click(screen.getByText("挂节点"));
    fireEvent.click(await screen.findByText("可挂的新笔记"));
    await waitFor(() => expect(addFactToThread).toHaveBeenCalledWith("au", "f9", "t1", {}));
  });

  it("摘除按钮常显（无 opacity-0 隐藏类）并触发摘除", async () => {
    renderDetail();
    const removes = screen.getAllByLabelText("从本线移除");
    expect(removes[0].className).not.toContain("opacity-0");
    fireEvent.click(removes[1]);
    await waitFor(() => expect(removeFactFromThread).toHaveBeenCalledWith("au", "f2", "t1"));
  });

  it("上移/下移：端点禁用，中间节点双向可点", async () => {
    renderDetail();
    const ups = screen.getAllByLabelText("上移节点");
    const downs = screen.getAllByLabelText("下移节点");
    expect(ups[0]).toBeDisabled();
    expect(downs[1]).toBeDisabled();
    fireEvent.click(downs[0]);
    await waitFor(() => expect(moveFactInThread).toHaveBeenCalledWith("au", "t1", "f1", "down"));
    fireEvent.click(ups[1]);
    await waitFor(() => expect(moveFactInThread).toHaveBeenCalledWith("au", "t1", "f2", "up"));
  });

  it("「编辑笔记」：宿主给了 onEditFact 才渲染，点击回传 fact id", () => {
    const onEditFact = vi.fn();
    renderDetail({ onEditFact });
    const edits = screen.getAllByLabelText("编辑这条笔记");
    fireEvent.click(edits[0]);
    expect(onEditFact).toHaveBeenCalledWith("f1");
  });

  it("宿主没给 onEditFact 时不渲染编辑入口", () => {
    renderDetail();
    expect(screen.queryByLabelText("编辑这条笔记")).toBeNull();
  });

  it("节点行展示人物与故事时间徽章", () => {
    renderDetail();
    expect(screen.getByText("林深")).toBeInTheDocument();
    expect(screen.getByText("Y1 春")).toBeInTheDocument();
  });
});
