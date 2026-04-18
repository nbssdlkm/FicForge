// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { AlertCircle, FileUp } from 'lucide-react';
import { Button } from '../shared/Button';
import { Tag } from '../shared/Tag';
import { ThemeToggle } from '../shared/ThemeToggle';
import { useTranslation } from '../../i18n/useAppTranslation';

export type WriterMode = 'write' | 'settings';

export interface WriterHeaderProps {
  mode: WriterMode;
  onModeChange: (next: WriterMode) => void;
  isSettingsModeBusy: boolean;
  isGenerating: boolean;
  isViewingHistory: boolean;
  viewingHistoryNum: number | null;
  currentChapter: number;
  metaModel: string;
  metaChars: number;
  metaDuration: string;
  sessionTemp: number;
  chaptersDirty: number[];
  onOpenDirty: () => void;
  onOpenExport: () => void;
}

export function WriterHeader({
  mode,
  onModeChange,
  isSettingsModeBusy,
  isGenerating,
  isViewingHistory,
  viewingHistoryNum,
  currentChapter,
  metaModel,
  metaChars,
  metaDuration,
  sessionTemp,
  chaptersDirty,
  onOpenDirty,
  onOpenExport,
}: WriterHeaderProps) {
  const { t } = useTranslation();
  const hasDirty = chaptersDirty.length > 0;

  return (
    <header className="flex min-h-[64px] items-center justify-between border-b border-black/5 px-4 text-xs text-text/50 dark:border-white/5 md:h-14 md:px-6">
      <div className="flex items-center gap-4">
        <div className="hidden rounded-lg border border-black/10 bg-surface/60 p-1 dark:border-white/10 md:inline-flex">
          <Button
            tone={mode === 'write' ? 'accent' : 'neutral'}
            fill={mode === 'write' ? 'solid' : 'plain'}
            size="sm"
            className="h-8"
            onClick={() => onModeChange('write')}
            disabled={isSettingsModeBusy}
          >
            {t('settingsMode.tabWrite')}
          </Button>
          <Button
            tone={mode === 'settings' ? 'accent' : 'neutral'}
            fill={mode === 'settings' ? 'solid' : 'plain'}
            size="sm"
            className="h-8"
            onClick={() => onModeChange('settings')}
          >
            {t('settingsMode.tabSettings')}
          </Button>
        </div>
        <div className="md:hidden">
          <p className="text-xs text-text/50">{t('writer.modeWrite')}</p>
          <p className="mt-1 text-sm font-medium text-text/70">
            {isViewingHistory
              ? t('workspace.chapterItem', { num: viewingHistoryNum })
              : t('workspace.chapterItem', { num: currentChapter })}
          </p>
          <p className="mt-0.5 text-xs text-text/30">
            {metaModel} · {t('writer.metaWords', { count: metaChars })} · {metaDuration}
          </p>
        </div>
        <div className="hidden items-center gap-4 md:flex">
          <span>{metaModel} · T{sessionTemp}</span>
          <span>{t('writer.metaWords', { count: metaChars })}</span>
          <span>{metaDuration}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {mode === 'write' && isGenerating && (
          <Tag tone="warning" className="mr-2">{t('common.status.generating')}</Tag>
        )}
        {hasDirty && (
          <Button
            tone="neutral" fill="plain"
            size="sm"
            className="h-11 text-warning md:h-8"
            onClick={onOpenDirty}
            title={t('writer.dirtyButtonTitle')}
          >
            <AlertCircle size={16} />
          </Button>
        )}
        <Button tone="neutral" fill="plain" size="sm" className="h-11 md:h-8" onClick={onOpenExport} title={t('writer.exportButtonTitle')}>
          <FileUp size={16} />
        </Button>
        <span className="hidden md:inline-flex"><ThemeToggle /></span>
      </div>
    </header>
  );
}
