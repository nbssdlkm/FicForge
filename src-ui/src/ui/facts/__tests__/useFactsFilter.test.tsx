// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useFactsFilter 筛选/分页/分组派生测试（盲审长期债③）。
 * 重点：'stale' 伪筛选的 30 章判据、筛选变更时分页复位。
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFactsFilter } from "../useFactsFilter";
import type { FactInfo, StateInfo } from "../../../api/engine-client";

function makeFact(id: string, chapter: number, overrides: Partial<FactInfo> = {}): FactInfo {
  return {
    id,
    chapter,
    content_raw: id,
    content_clean: `内容-${id}`,
    characters: [],
    status: "active",
    type: "plot_event",
    narrative_weight: "medium",
    timeline: "",
    ...overrides,
  } as FactInfo;
}

const STATE_CH40 = { current_chapter: 40 } as unknown as StateInfo;

describe("useFactsFilter · 筛选", () => {
  it("文本搜索：命中 content_clean 或角色名", () => {
    const facts = [
      makeFact("f1", 1, { content_clean: "主角拿到钥匙" }),
      makeFact("f2", 2, { characters: ["赫敏"] }),
      makeFact("f3", 3),
    ];
    const { result } = renderHook(() => useFactsFilter(facts, STATE_CH40));

    act(() => result.current.setFilter("钥匙"));
    expect(result.current.filteredFacts.map((f) => f.id)).toEqual(["f1"]);

    act(() => result.current.setFilter("赫敏"));
    expect(result.current.filteredFacts.map((f) => f.id)).toEqual(["f2"]);
  });

  it("章节与角色筛选", () => {
    const facts = [
      makeFact("f1", 1, { characters: ["A"] }),
      makeFact("f2", 2, { characters: ["A", "B"] }),
      makeFact("f3", 2, { characters: ["C"] }),
    ];
    const { result } = renderHook(() => useFactsFilter(facts, STATE_CH40));

    act(() => result.current.setChapterFilter(2));
    expect(result.current.filteredFacts.map((f) => f.id)).toEqual(["f2", "f3"]);

    act(() => result.current.setCharacterFilter("A"));
    expect(result.current.filteredFacts.map((f) => f.id)).toEqual(["f2"]);
  });

  it("stale 伪筛选：只留超过 30 章未动的 active/unresolved", () => {
    const facts = [
      makeFact("old-active", 5),                                  // 40-5=35 > 30 → 命中
      makeFact("old-unresolved", 3, { status: "unresolved" }),    // 命中
      makeFact("old-resolved", 2, { status: "resolved" }),        // 状态不符 → 排除
      makeFact("recent-active", 15),                              // 40-15=25 ≤ 30 → 排除
    ];
    const { result } = renderHook(() => useFactsFilter(facts, STATE_CH40));

    act(() => result.current.setStatusFilter("stale"));
    expect(result.current.filteredFacts.map((f) => f.id)).toEqual(["old-active", "old-unresolved"]);
  });

  it("state 缺失时 stale 按第 1 章兜底（全部不满 30 章 → 空）", () => {
    const facts = [makeFact("f1", 1)];
    const { result } = renderHook(() => useFactsFilter(facts, null));
    act(() => result.current.setStatusFilter("stale"));
    expect(result.current.filteredFacts).toHaveLength(0);
  });

  it("uniqueChapters / uniqueCharacters：去重且有序", () => {
    const facts = [
      makeFact("f1", 3, { characters: ["乙", "甲"] }),
      makeFact("f2", 1, { characters: ["甲"] }),
      makeFact("f3", 3),
    ];
    const { result } = renderHook(() => useFactsFilter(facts, STATE_CH40));
    expect(result.current.uniqueChapters).toEqual([1, 3]);
    expect(result.current.uniqueCharacters).toEqual(["乙", "甲"]);
  });
});

describe("useFactsFilter · 分页与分组", () => {
  const manyFacts = Array.from({ length: 60 }, (_, i) => makeFact(`f${i}`, Math.floor(i / 10) + 1));

  it("默认一页 50 条；加载更多后筛选变更把分页复位", () => {
    const { result } = renderHook(() => useFactsFilter(manyFacts, STATE_CH40));
    expect(result.current.paginatedFacts).toHaveLength(50);
    expect(result.current.hasMoreFacts).toBe(true);

    act(() => result.current.showMoreFacts());
    expect(result.current.paginatedFacts).toHaveLength(60);
    expect(result.current.hasMoreFacts).toBe(false);

    // 改任一筛选维度 → 分页回到第一页（旧 offset 对新结果集无意义）
    act(() => result.current.setChapterFilter(1));
    expect(result.current.visibleCount).toBe(50);
  });

  it("groupedFacts：按章分组升序，用分页后的数据", () => {
    const facts = [makeFact("f1", 3), makeFact("f2", 1), makeFact("f3", 3)];
    const { result } = renderHook(() => useFactsFilter(facts, STATE_CH40));
    const groups = result.current.groupedFacts;
    expect(groups.map(([ch]) => ch)).toEqual([1, 3]);
    expect(groups[1][1].map((f) => f.id)).toEqual(["f1", "f3"]);
  });

  it("resetFilters：五个筛选维度 + 分页全部复位", () => {
    const { result } = renderHook(() => useFactsFilter(manyFacts, STATE_CH40));
    act(() => {
      result.current.setFilter("x");
      result.current.setStatusFilter("stale");
      result.current.setChapterFilter(2);
      result.current.setCharacterFilter("甲");
      result.current.showMoreFacts();
      result.current.toggleFilterPanel();
    });

    act(() => result.current.resetFilters());

    expect(result.current.filter).toBe("");
    expect(result.current.statusFilter).toBe("");
    expect(result.current.chapterFilter).toBeNull();
    expect(result.current.characterFilter).toBe("");
    expect(result.current.visibleCount).toBe(50);
    expect(result.current.filterOpen).toBe(false);
  });
});
