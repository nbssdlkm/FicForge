// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useTranslation } from '../../i18n/useAppTranslation';

export function StepIndicator({ current, total }: { current: number; total: number }) {
  const { t } = useTranslation();
  return (
    <div className="text-xs text-text/50 font-mono">
      {t('onboarding.common.step', { current, total })}
    </div>
  );
}
