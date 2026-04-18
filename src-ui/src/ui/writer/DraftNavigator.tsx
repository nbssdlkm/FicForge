// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../shared/Button';
import { useTranslation } from '../../i18n/useAppTranslation';

export interface DraftNavigatorProps {
  drafts: Array<{ label: string; draftId: string }>;
  activeDraftIndex: number;
  onSelect: (index: number) => void;
  disabled: boolean;
  modified?: boolean;
}

export const DraftNavigator = ({
  drafts,
  activeDraftIndex,
  onSelect,
  disabled,
  modified,
}: DraftNavigatorProps) => {
  const { t } = useTranslation();

  const isFirstDraft = activeDraftIndex === 0;
  const isLastDraft = activeDraftIndex >= drafts.length - 1;

  return (
    <>
      {/* Desktop: prev/next buttons */}
      <div className="hidden items-center gap-2 text-sm font-sans text-text/75 md:flex">
        <Button
          tone="neutral" fill="plain"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => onSelect(Math.max(0, activeDraftIndex - 1))}
          disabled={isFirstDraft || disabled}
          aria-label={t('drafts.previous')}
        >
          <ChevronLeft size={16} />
        </Button>
        <span className="min-w-[140px] text-center font-medium">
          {t('drafts.count', { current: activeDraftIndex + 1, total: drafts.length })}
          {modified ? <span className="ml-1 text-text/55">{t('drafts.modified')}</span> : null}
        </span>
        <Button
          tone="neutral" fill="plain"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => onSelect(Math.min(drafts.length - 1, activeDraftIndex + 1))}
          disabled={isLastDraft || disabled}
          aria-label={t('drafts.next')}
        >
          <ChevronRight size={16} />
        </Button>
      </div>

      {/* Mobile: tab pills */}
      <div className="flex gap-2 overflow-x-auto md:hidden">
        {drafts.map((draft, index) => (
          <button
            key={draft.draftId}
            type="button"
            onClick={() => onSelect(index)}
            className={`min-h-[44px] rounded-full px-3 text-sm whitespace-nowrap transition-colors ${index === activeDraftIndex ? 'bg-accent text-white' : 'bg-black/5 text-text/60 dark:bg-white/10'}`}
          >
            {t('drafts.count', { current: index + 1, total: drafts.length })}
          </button>
        ))}
      </div>
    </>
  );
};
