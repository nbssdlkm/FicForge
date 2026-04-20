// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from 'react';
import { hasSeenSettingsModeTooltip, markSettingsModeTooltipSeen } from '../../utils/writerStorage';
import type { WriterMode } from './WriterHeader';

type UseWriterModeControllerOptions = {
  isMobile: boolean;
  isSettingsModeBusy: boolean;
  showToast: (message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  t: (key: string, params?: Record<string, unknown>) => string;
};

export function useWriterModeController({
  isMobile,
  isSettingsModeBusy,
  showToast,
  t,
}: UseWriterModeControllerOptions) {
  const [mode, setMode] = useState<WriterMode>('write');
  const [showSettingsTooltip, setShowSettingsTooltip] = useState(false);

  useEffect(() => {
    if (isMobile && mode !== 'write') {
      setMode('write');
      setShowSettingsTooltip(false);
    }
  }, [isMobile, mode]);

  const handleModeChange = useCallback((nextMode: WriterMode) => {
    if (nextMode === 'write' && isSettingsModeBusy) {
      showToast(t('settingsMode.busyWriteBlocked'), 'warning');
      return;
    }
    setMode(nextMode);
    if (nextMode === 'settings' && !hasSeenSettingsModeTooltip()) {
      setShowSettingsTooltip(true);
      markSettingsModeTooltipSeen();
      return;
    }
    if (nextMode !== 'settings') {
      setShowSettingsTooltip(false);
    }
  }, [isSettingsModeBusy, showToast, t]);

  const closeSettingsTooltip = useCallback(() => {
    setShowSettingsTooltip(false);
  }, []);

  return {
    mode,
    showSettingsTooltip,
    handleModeChange,
    closeSettingsTooltip,
  };
}
