// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useCallback } from 'react';
import { listFandoms, type FandomInfo } from '../api/engine-client';
import { useActiveRequestGuard } from './useActiveRequestGuard';
import { useTranslation } from '../i18n/useAppTranslation';
import { useFeedback } from './useFeedback';

export function useLibraryData() {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const loadGuard = useActiveRequestGuard('library-fandoms');

  const [fandoms, setFandoms] = useState<FandomInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFandoms = useCallback(async () => {
    const token = loadGuard.start();
    setLoading(true);
    try {
      const data = await listFandoms();
      if (loadGuard.isStale(token)) return;
      setFandoms(data);
    } catch (e: any) {
      if (loadGuard.isStale(token)) return;
      showError(e, t("error_messages.unknown"));
    } finally {
      if (!loadGuard.isStale(token)) {
        setLoading(false);
      }
    }
  }, [showError, t]);

  return {
    fandoms,
    loading,
    loadFandoms,
  };
}
