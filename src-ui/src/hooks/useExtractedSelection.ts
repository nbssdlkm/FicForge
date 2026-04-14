// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { useState, useCallback } from 'react';
import type { ExtractedFactCandidate } from '../api/engine-client';

export function getCandidateKey(candidate: ExtractedFactCandidate, index: number): string {
  return `${candidate.content_clean}-${candidate.chapter}-${index}`;
}

/**
 * 提取结果的选择/反选逻辑。
 * Facts 页和 Writer 页共用，配合 ExtractReviewModal 使用。
 */
export function useExtractedSelection() {
  const [selectedExtractedKeys, setSelectedExtractedKeys] = useState<string[]>([]);

  const selectAll = useCallback((candidates: ExtractedFactCandidate[]) => {
    setSelectedExtractedKeys(candidates.map((c, i) => getCandidateKey(c, i)));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedExtractedKeys([]);
  }, []);

  const toggleExtractedCandidate = useCallback((key: string) => {
    setSelectedExtractedKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    );
  }, []);

  const filterSelected = useCallback((candidates: ExtractedFactCandidate[]) => {
    return candidates.filter((candidate, index) =>
      selectedExtractedKeys.includes(getCandidateKey(candidate, index))
    );
  }, [selectedExtractedKeys]);

  return {
    selectedExtractedKeys,
    selectAll,
    clearSelection,
    toggleExtractedCandidate,
    filterSelected,
    getCandidateKey,
  };
}
