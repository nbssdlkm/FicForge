// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useMemo, useEffect } from 'react';
import type { FactInfo, StateInfo } from '../../api/engine-client';

const FACTS_PAGE_SIZE = 50;

export function useFactsFilter(facts: FactInfo[], state: StateInfo | null) {
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [chapterFilter, setChapterFilter] = useState<number | null>(null);
  const [characterFilter, setCharacterFilter] = useState('');
  const [visibleCount, setVisibleCount] = useState(FACTS_PAGE_SIZE);

  // 从 facts 中动态提取唯一章节号和角色名
  const uniqueChapters = useMemo(() => [...new Set(facts.map(f => f.chapter))].sort((a, b) => a - b), [facts]);
  const uniqueCharacters = useMemo(() => [...new Set(facts.flatMap(f => f.characters))].sort(), [facts]);

  const filteredFacts = useMemo(() => facts.filter((fact) => {
    // 'stale' 伪筛选：客户端过滤超过 30 章的 active/unresolved facts
    if (statusFilter === 'stale') {
      if (fact.status !== 'active' && fact.status !== 'unresolved') return false;
      if ((state?.current_chapter || 1) - fact.chapter <= 30) return false;
    }
    // 章节筛选
    if (chapterFilter !== null && fact.chapter !== chapterFilter) return false;
    // 角色筛选
    if (characterFilter && !fact.characters.includes(characterFilter)) return false;
    // 文本搜索
    if (!filter) return true;
    const keyword = filter.trim();
    return fact.content_clean.includes(keyword) || fact.characters.join(',').includes(keyword);
  }), [facts, filter, statusFilter, chapterFilter, characterFilter, state?.current_chapter]);

  // Reset pagination when filters change
  useEffect(() => { setVisibleCount(FACTS_PAGE_SIZE); }, [filter, statusFilter, chapterFilter, characterFilter]);

  // Paginated slice of filteredFacts
  const paginatedFacts = useMemo(() => filteredFacts.slice(0, visibleCount), [filteredFacts, visibleCount]);
  const hasMoreFacts = filteredFacts.length > visibleCount;

  // 按章节分组（使用分页后的数据）
  const groupedFacts = useMemo(() => {
    const groups = new Map<number, FactInfo[]>();
    for (const f of paginatedFacts) {
      if (!groups.has(f.chapter)) groups.set(f.chapter, []);
      groups.get(f.chapter)!.push(f);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [paginatedFacts]);

  const resetFilters = () => {
    setFilter('');
    setStatusFilter('');
    setFilterOpen(false);
    setChapterFilter(null);
    setCharacterFilter('');
    setVisibleCount(FACTS_PAGE_SIZE);
  };

  return {
    filter,
    setFilter,
    statusFilter,
    setStatusFilter,
    filterOpen,
    setFilterOpen,
    chapterFilter,
    setChapterFilter,
    characterFilter,
    setCharacterFilter,
    visibleCount,
    setVisibleCount,
    uniqueChapters,
    uniqueCharacters,
    filteredFacts,
    paginatedFacts,
    hasMoreFacts,
    groupedFacts,
    resetFilters,
  };
}
