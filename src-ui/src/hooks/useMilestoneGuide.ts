// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback } from 'react';

const PREFIX = 'ficforge.milestones.';

export function useMilestoneGuide() {
  const shouldShow = useCallback((milestoneId: string): boolean => {
    return localStorage.getItem(`${PREFIX}${milestoneId}`) !== 'dismissed';
  }, []);

  const dismiss = useCallback((milestoneId: string): void => {
    localStorage.setItem(`${PREFIX}${milestoneId}`, 'dismissed');
  }, []);

  return { shouldShow, dismiss };
}
