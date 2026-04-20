// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from 'react';
import { setChapterFocus, type FactInfo, type StateInfo } from '../../api/engine-client';
import type { ActiveRequestGuard } from '../../hooks/useActiveRequestGuard';

type UseWriterFocusControllerOptions = {
  auPath: string;
  state: StateInfo | null;   // 取代原来的 setFocusFromState bridge 注入
  unresolvedFacts: FactInfo[];
  lastConfirmedFocus: string[];
  loadGuard: ActiveRequestGuard<string>;
  showToast: (message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  showError: (error: unknown, fallback: string) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
};

export function useWriterFocusController({
  auPath,
  state,
  unresolvedFacts,
  lastConfirmedFocus,
  loadGuard,
  showToast,
  showError,
  t,
}: UseWriterFocusControllerOptions) {
  const [focusSelection, setFocusSelection] = useState<string[]>([]);

  // 自主 watch state.chapter_focus（按 auPath + current_chapter 粒度）。
  // 原来 bootstrap.loadData + refreshSettingsModeData 通过 bridge 调 setFocusFromState；
  // 现在 hook 自己监听，消除 focusControllerBridgeRef。
  // 用户 toggle focus 时会调 setChapterFocus 同步到 engine，下次 getState 时 state.chapter_focus
  // 已经是用户最新值，此 effect fire 会 setFocusSelection 到同一值 → 幂等。
  useEffect(() => {
    setFocusSelection(state?.chapter_focus ? [...state.chapter_focus] : []);
  }, [auPath, state?.current_chapter]);

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
    focusSelection,
    handleFocusToggle,
    handleClearFocus,
    handleContinueLastFocus,
  };
}
