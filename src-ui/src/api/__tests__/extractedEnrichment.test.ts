// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect } from 'vitest';
import { extractedEnrichment, type ExtractedFactCandidate } from '../facts';

const base: ExtractedFactCandidate = {
  content_raw: 'r', content_clean: 'c', characters: [], narrative_weight: 'medium', status: 'active', chapter: 1,
};

describe('extractedEnrichment — 确认提取时转发 M8-A 富化字段（修双审 BLOCKER：此前 hand-pick 丢弃）', () => {
  it('有值的富化/因果字段全部转发', () => {
    expect(extractedEnrichment({
      ...base,
      location: '灯阁', story_time_tag: 'Y1冬', story_time_order: 3, time_kind: 'flashback',
      action_verb: '发现', caused_by: ['f_1', 'f_2'], known_to: 'reader_only', hidden_from: ['皇帝'],
      suspense_type: 'secret', _confidence: { location: 'high' }, thread_ids: ['t_1'],
    })).toEqual({
      location: '灯阁', story_time_tag: 'Y1冬', story_time_order: 3, time_kind: 'flashback',
      action_verb: '发现', caused_by: ['f_1', 'f_2'], known_to: 'reader_only', hidden_from: ['皇帝'],
      suspense_type: 'secret', _confidence: { location: 'high' }, thread_ids: ['t_1'],
    });
  });

  it('null / 空数组 / undefined 一律跳过，addFact payload 保持干净', () => {
    expect(extractedEnrichment({
      ...base, location: null, time_kind: null, story_time_order: null,
      caused_by: [], hidden_from: [], thread_ids: [],
    })).toEqual({});
    expect(extractedEnrichment(base)).toEqual({});
  });

  it('边界：story_time_order=0 与 known_to="all" 不被当 falsy 丢掉', () => {
    expect(extractedEnrichment({ ...base, known_to: 'all', story_time_order: 0 }))
      .toEqual({ known_to: 'all', story_time_order: 0 });
  });
});
