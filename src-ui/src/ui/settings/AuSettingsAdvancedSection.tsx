// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Spinner } from "../shared/Spinner";
import { Button } from '../shared/Button';
import { useTranslation } from '../../i18n/useAppTranslation';

export type AuSettingsAdvancedSectionProps = {
  recalcing: boolean;
  handleRecalc: () => void;
  handleRebuildIndex: () => void;
};

export function AuSettingsAdvancedSection({
  recalcing,
  handleRecalc,
  handleRebuildIndex,
}: AuSettingsAdvancedSectionProps) {
  const { t } = useTranslation();

  return (
    <section className="space-y-4 border-t border-black/10 pt-6 dark:border-white/10">
      <h2 className="text-lg font-sans font-bold text-text/50 border-l-4 border-text/20 pl-3">{t('advanced.title')}</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Button tone="neutral" fill="outline" size="sm" className="w-full mb-2" onClick={handleRecalc} disabled={recalcing}>
            {recalcing ? <Spinner size="sm" className="mr-2" /> : null}
            {t('advanced.recalc')}
          </Button>
          <p className="text-xs text-text/50">{t('advanced.recalcDesc')}</p>
        </div>
        <div className="space-y-2">
          <Button tone="neutral" fill="outline" size="sm" className="w-full mb-2" onClick={handleRebuildIndex}>
            {t('advanced.rebuildIndex')}
          </Button>
          <p className="text-xs text-text/50">{t('advanced.rebuildIndexDesc')}</p>
        </div>
      </div>
      <p className="text-xs text-text/30">{t('advanced.advancedHint')}</p>
    </section>
  );
}
