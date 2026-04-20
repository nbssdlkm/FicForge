// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback } from 'react';
import { setChapterFocus, type FactInfo } from '../../api/engine-client';
import type { ActiveRequestGuard } from '../../hooks/useActiveRequestGuard';

type UseWriterFocusControllerOptions = {
  auPath: string;
  focusSelection: string[];
  unresolvedFacts: FactInfo[];
  lastConfirmedFocus: string[];
  loadGuard: ActiveRequestGuard<string>;
  setFocusSelection: (focus: string[]) => void;
  showToast: (message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  showError: (error: unknown, fallback: string) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
};

export function useWriterFocusController({
  auPath,
  focusSelection,
  unresolvedFacts,
  lastConfirmedFocus,
  loadGuard,
  setFocusSelection,
  showToast,
  showError,
  t,
}: UseWriterFocusControllerOptions) {
  const handleFocusToggle = useCallback(async (factId: string) => {
    const requestAuPath = auPath;
    let next: string[];
    if (focusSelection.includes(factId)) {
      next = focusSelection.filter((id) => id !== factId);
    } else {
      if (focusSelection.length >= 2) {
        showToast(t('focus.maxTwo'), 'warning');
        return;
      }
      next = [...focusSelection, factId];
    }

    try {
      await setChapterFocus(auPath, next);
      if (loadGuard.isKeyStale(requestAuPath)) return;
      setFocusSelection(next);
      showToast(t('writer.focusSaved'), 'success');
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    }
  }, [auPath, focusSelection, loadGuard, setFocusSelection, showError, showToast, t]);

  const handleClearFocus = useCallback(async () => {
    const requestAuPath = auPath;
    try {
      await setChapterFocus(auPath, []);
      if (loadGuard.isKeyStale(requestAuPath)) return;
      setFocusSelection([]);
      showToast(t('writer.focusSaved'), 'success');
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    }
  }, [auPath, loadGuard, setFocusSelection, showError, showToast, t]);

  const handleContinueLastFocus = useCallback(async () => {
    const requestAuPath = auPath;
    const validIds = lastConfirmedFocus.filter((id) =>
      unresolvedFacts.some((fact) => String(fact.id) === id),
    );
    if (validIds.length === 0) {
      showToast(t('focus.lastFocusExpired'), 'warning');
      return;
    }

    try {
      await setChapterFocus(auPath, validIds);
      if (loadGuard.isKeyStale(requestAuPath)) return;
      setFocusSelection(validIds);
      showToast(t('writer.focusSaved'), 'success');
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    }
  }, [auPath, lastConfirmedFocus, loadGuard, setFocusSelection, showError, showToast, t, unresolvedFacts]);

  return {
    handleFocusToggle,
    handleClearFocus,
    handleContinueLastFocus,
  };
}
