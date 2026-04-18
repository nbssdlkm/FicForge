// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Loader2 } from 'lucide-react';
import { Button } from '../shared/Button';
import { Textarea } from '../shared/Input';
import { ChapterMarkdown } from '../shared/ChapterMarkdown';
import { useTranslation } from '../../i18n/useAppTranslation';

export interface ChapterContentAreaProps {
  loading: boolean;
  streamText: string;
  isGenerating: boolean;
  isViewingHistory: boolean;
  viewingHistoryContent: string | null;
  viewingHistoryNum: number | null;
  editingConfirmed: boolean;
  editingContent: string;
  editingOriginalContent: string;
  savingEdit: boolean;
  onEditingContentChange: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  currentDraft: { content: string } | null;
  onDraftChange: (v: string) => void;
  displayContent: string;
  generationErrorDisplay: { message: string; actions: string[] } | null;
  onDismissError: () => void;
  onNavigate: (page: string) => void;
  fontSize: number;
  lineHeight: number;
}

export const ChapterContentArea = ({
  loading,
  streamText,
  isGenerating,
  isViewingHistory,
  viewingHistoryContent,
  viewingHistoryNum: _viewingHistoryNum,
  editingConfirmed,
  editingContent,
  editingOriginalContent,
  savingEdit,
  onEditingContentChange,
  onSaveEdit,
  onCancelEdit,
  onStartEdit,
  currentDraft,
  onDraftChange,
  displayContent,
  generationErrorDisplay,
  onDismissError,
  onNavigate,
  fontSize,
  lineHeight,
}: ChapterContentAreaProps) => {
  const { t } = useTranslation();

  return (
    <div style={{ fontSize: `${fontSize}px`, lineHeight }}>
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin text-accent" size={24} />
        </div>
      ) : streamText ? (
        <div className="font-serif text-text/90 animate-in fade-in duration-200 pb-8 opacity-90">
          <ChapterMarkdown content={streamText} />
          {isGenerating && <span className="inline-block h-5 w-0.5 bg-accent align-middle animate-pulse" />}
        </div>
      ) : isViewingHistory && viewingHistoryContent ? (
        <div className="font-serif text-text/90 pb-8">
          {editingConfirmed ? (
            <>
              <Textarea
                value={editingContent}
                onChange={(e) => onEditingContentChange(e.target.value)}
                className="min-h-[440px] border-0 bg-transparent px-0 py-0 font-serif shadow-none focus:ring-0"
                style={{ fontSize: 'inherit', lineHeight: 'inherit' }}
              />
              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-black/10 dark:border-white/10">
                <Button variant="primary" size="sm" onClick={onSaveEdit} disabled={savingEdit || editingContent === editingOriginalContent}>
                  {savingEdit ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                  {t('writer.saveEdit')}
                </Button>
                <Button variant="ghost" size="sm" onClick={onCancelEdit} disabled={savingEdit}>
                  {t('writer.cancelEdit')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <ChapterMarkdown content={viewingHistoryContent} />
              <div className="mt-4 pt-4 border-t border-black/10 dark:border-white/10">
                <Button variant="secondary" size="sm" onClick={onStartEdit}>
                  {t('writer.editChapter')}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : currentDraft ? (
        <div className="space-y-4 pb-8">
          <Textarea
            value={currentDraft.content}
            onChange={(event) => onDraftChange(event.target.value)}
            className="min-h-[440px] border-0 bg-transparent px-0 py-0 font-serif shadow-none focus:ring-0"
            style={{ fontSize: 'inherit', lineHeight: 'inherit' }}
          />
        </div>
      ) : displayContent ? (
        <div className="font-serif text-text/90 pb-8">
          <ChapterMarkdown content={displayContent} />
        </div>
      ) : (
        generationErrorDisplay ? (
          <div className="py-12 flex flex-col items-center gap-4">
            <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/20 px-5 py-4 text-red-700 dark:text-red-300 max-w-lg">
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
              <span className="text-sm">{generationErrorDisplay.message}</span>
            </div>
            {generationErrorDisplay.actions.includes('check_settings') && (
              <Button variant="secondary" size="sm" onClick={() => onNavigate('settings')}>
                {t('writer.checkSettings')}
              </Button>
            )}
            <button
              className="inline-flex min-h-[44px] items-center px-4 text-xs text-text/40 hover:text-text/60"
              onClick={onDismissError}
            >
              {t('common.actions.dismiss')}
            </button>
          </div>
        ) : (
          <p className="py-24 text-center text-text/30">{t('writer.emptyContent')}</p>
        )
      )}
    </div>
  );
};
