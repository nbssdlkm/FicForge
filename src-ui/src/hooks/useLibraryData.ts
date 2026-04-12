// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useRef, useCallback } from 'react';
import { listFandoms, type FandomInfo } from '../api/engine-client';
import { useTranslation } from '../i18n/useAppTranslation';
import { useFeedback } from './useFeedback';

export function useLibraryData() {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const loadFandomsRequestIdRef = useRef(0);

  const [fandoms, setFandoms] = useState<FandomInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFandoms = useCallback(async () => {
    const requestId = ++loadFandomsRequestIdRef.current;
    setLoading(true);
    try {
      const data = await listFandoms();
      if (requestId !== loadFandomsRequestIdRef.current) return;
      setFandoms(data);
    } catch (e: any) {
      if (requestId !== loadFandomsRequestIdRef.current) return;
      showError(e, t("error_messages.unknown"));
    } finally {
      if (requestId === loadFandomsRequestIdRef.current) {
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
