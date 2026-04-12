// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState } from 'react';
import { batchUpdateFactStatus, type FactInfo } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';
import { useFeedback } from '../../hooks/useFeedback';

export function useBatchFacts(auPath: string, facts: FactInfo[], onUpdated: () => void) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useFeedback();

  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const [batchConfirm, setBatchConfirm] = useState<string | null>(null);
  const [batchProcessing, setBatchProcessing] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === facts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(facts.map(f => f.id)));
    }
  };

  const handleBatchStatus = async (newStatus: string) => {
    setBatchConfirm(null);
    setBatchProcessing(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await batchUpdateFactStatus(auPath, ids, newStatus);
      showSuccess(t('facts.batchSuccess', { count: result.updated, status: getEnumLabel('fact_status', newStatus, newStatus) }));
      setSelectedIds(new Set());
      setBatchMenuOpen(false);
      await onUpdated();
    } catch (error) {
      showError(error, t('error_messages.unknown'));
    } finally {
      setBatchProcessing(false);
    }
  };

  return {
    batchMode,
    setBatchMode,
    selectedIds,
    setSelectedIds,
    batchMenuOpen,
    setBatchMenuOpen,
    batchConfirm,
    setBatchConfirm,
    batchProcessing,
    toggleSelect,
    toggleSelectAll,
    handleBatchStatus,
  };
}
