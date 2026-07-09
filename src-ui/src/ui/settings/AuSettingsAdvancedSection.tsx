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
  handleBackfillMemory: () => void;
  handleArchiveFacts: () => void;
  /** 归档候选数（null=未扫/扫失败）。>0 时在「整理旧剧情笔记」按钮上显示徽标，提升可发现性。 */
  archiveCandidateCount?: number | null;
};

export function AuSettingsAdvancedSection({
  recalcing,
  handleRecalc,
  handleRebuildIndex,
  handleBackfillMemory,
  handleArchiveFacts,
  archiveCandidateCount,
}: AuSettingsAdvancedSectionProps) {
  const { t } = useTranslation();
  const hasArchiveCandidates = typeof archiveCandidateCount === 'number' && archiveCandidateCount > 0;

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
        <div className="space-y-2">
          <Button tone="neutral" fill="outline" size="sm" className="w-full mb-2" onClick={handleBackfillMemory}>
            {t('advanced.backfillMemory')}
          </Button>
          <p className="text-xs text-text/50">{t('advanced.backfillMemoryDesc')}</p>
        </div>
        <div className="space-y-2">
          <Button
            tone={hasArchiveCandidates ? 'accent' : 'neutral'}
            fill="outline"
            size="sm"
            className="w-full mb-2 flex items-center justify-center gap-2"
            onClick={handleArchiveFacts}
          >
            {t('advanced.archiveFacts')}
            {hasArchiveCandidates && (
              <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-white">
                {archiveCandidateCount}
              </span>
            )}
          </Button>
          <p className="text-xs text-text/50">
            {hasArchiveCandidates
              ? t('advanced.archiveFactsCount', { count: archiveCandidateCount })
              : t('advanced.archiveFactsDesc')}
          </p>
        </div>
      </div>
      <p className="text-xs text-text/30">{t('advanced.advancedHint')}</p>
    </section>
  );
}
