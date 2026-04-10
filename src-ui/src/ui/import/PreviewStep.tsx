// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Button } from '../shared/Button';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useTranslation } from '../../i18n/useAppTranslation';
import type { ChapterPreview } from '../../api/engine-client';

export function PreviewStep({
  chapters,
  splitMethod,
  onConfirm,
  onBack,
  confirming,
}: {
  chapters: ChapterPreview[];
  splitMethod: string;
  onConfirm: () => void;
  onBack: () => void;
  confirming: boolean;
}) {
  const { t } = useTranslation();
  const isSingle = chapters.length === 1 && (chapters[0]?.preview?.length || 0) > 50;

  const methodLabel = splitMethod.includes('standard')
    ? t('import.splitMethods.standard')
    : splitMethod.includes('integer')
    ? t('import.splitMethods.integer')
    : t('import.splitMethods.auto');

  return (
    <div className="space-y-4">
      <div className="text-sm text-text/70">
        {t('import.chaptersDetected', { count: chapters.length, method: methodLabel })}
      </div>

      <div className="max-h-[50vh] overflow-y-auto border border-black/10 dark:border-white/10 rounded-lg divide-y divide-black/5 dark:divide-white/5">
        {chapters.map(ch => (
          <div key={ch.chapter_num} className="px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">{t('import.chapterPreview', { num: ch.chapter_num })}</span>
            </div>
            <p className="text-xs text-text/50 line-clamp-2">{ch.preview}</p>
          </div>
        ))}
      </div>

      {isSingle && (
        <div className="flex items-start gap-2 text-xs text-warning bg-warning/10 rounded-md px-3 py-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{t('import.singleChapterWarning')}</span>
        </div>
      )}

      <p className="text-xs text-text/40">{t('import.splitHint')}</p>

      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack} disabled={confirming}>{t('onboarding.common.prev')}</Button>
        <Button variant="primary" onClick={onConfirm} disabled={confirming}>
          {confirming ? <><Loader2 size={14} className="animate-spin mr-2" />{t('import.importing')}</> : t('import.confirmImport')}
        </Button>
      </div>
    </div>
  );
}
