// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useState } from 'react';
import { getSettingsSummary, type SettingsSummary } from '../../api/engine-client';
import { isOnboardingCompleted, isOnboardingDismissedForSession } from '../onboarding/OnboardingFlow';

function hasUsableConnectionConfig(settings: SettingsSummary | null | undefined) {
  return Boolean(settings?.default_llm.has_usable_connection);
}

export function useLibraryOnboardingGate() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showApiWarning, setShowApiWarning] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (isOnboardingCompleted() || isOnboardingDismissedForSession()) {
      getSettingsSummary().then((settings) => {
        if (!cancelled && !hasUsableConnectionConfig(settings)) {
          setShowApiWarning(true);
        }
      }).catch(() => {});
    } else {
      getSettingsSummary().then((settings) => {
        if (!cancelled && !hasUsableConnectionConfig(settings)) {
          setShowOnboarding(true);
        }
      }).catch(() => {
        if (!cancelled) setShowOnboarding(true);
      });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    showOnboarding,
    setShowOnboarding,
    showApiWarning,
    dismissApiWarning: () => setShowApiWarning(false),
  };
}
