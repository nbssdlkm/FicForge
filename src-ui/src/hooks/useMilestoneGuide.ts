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
