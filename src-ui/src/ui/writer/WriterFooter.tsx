// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { RefObject } from 'react';
import { BookOpen, Check, ChevronsDown, ChevronsUp, RefreshCw, Trash2, Undo2 } from 'lucide-react';
import { Spinner } from "../shared/Spinner";
import { Button } from '../shared/Button';
import { Textarea } from '../shared/Input';
import { DraftNavigator } from './DraftNavigator';
import { useTranslation } from '../../i18n/useAppTranslation';

const MAX_RECOMMENDED_DRAFTS = 5;

export interface FooterDraft {
  label: string;
  draftId: string;
  modified: boolean;
}

export interface WriterFooterProps {
  footerCollapsed: boolean;
  onToggleCollapsed: () => void;

  isGenerating: boolean;
  writeActionsDisabled: boolean;
  isSettingsModeBusy: boolean;
  isDiscarding: boolean;
  currentChapter: number;

  instructionText: string;
  onInstructionTextChange: (v: string) => void;
  instructionInputRef: RefObject<HTMLInputElement | null>;
  onGenerate: (type: 'instruction' | 'continue') => void;

  drafts: FooterDraft[];
  activeDraftIndex: number;
  onSelectDraft: (idx: number) => void;
  currentDraft: FooterDraft | null;
  hasPendingDrafts: boolean;
  currentDraftMeta: string;

  onOpenFinalize: () => void;
  onRegenerate: () => void;
  onOpenDiscard: () => void;

  onOpenUndo: () => void;
  onNavigateFacts: () => void;
  onOpenMobileTools: () => void;

  onBlockedToast: () => void;
}

export function WriterFooter(props: WriterFooterProps) {
  const {
    footerCollapsed,
    onToggleCollapsed,
    isGenerating,
    writeActionsDisabled,
    isSettingsModeBusy,
    isDiscarding,
    currentChapter,
    instructionText,
    onInstructionTextChange,
    instructionInputRef,
    onGenerate,
    drafts,
    activeDraftIndex,
    onSelectDraft,
    currentDraft,
    hasPendingDrafts,
    currentDraftMeta,
    onOpenFinalize,
    onRegenerate,
    onOpenDiscard,
    onOpenUndo,
    onNavigateFacts,
    onOpenMobileTools,
    onBlockedToast,
  } = props;
  const { t } = useTranslation();

  const triggerGenerate = () => onGenerate(instructionText.trim() ? 'instruction' : 'continue');

  return (
    <footer className="safe-area-bottom w-full shrink-0 border-t border-black/10 dark:border-white/10 bg-surface/80 backdrop-blur-md flex flex-col">
      <button
        className="mx-auto flex min-h-[44px] items-center gap-1 px-4 py-1 text-xs text-text/50 transition-colors hover:text-text/70"
        onClick={onToggleCollapsed}
      >
        {footerCollapsed ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
        {footerCollapsed ? t('writer.expandToolbar') : t('writer.collapseToolbar')}
      </button>

      {footerCollapsed ? (
        <div className="flex items-center justify-center gap-3 pb-2">
          <Button
            tone="accent" fill="solid"
            size="sm"
            onClick={() => { onToggleCollapsed(); triggerGenerate(); }}
            disabled={writeActionsDisabled || hasPendingDrafts}
          >
            {isGenerating ? <Spinner size="md" /> : t('common.actions.continue')}
          </Button>
          {hasPendingDrafts && (
            <Button tone="accent" fill="solid" size="sm" onClick={() => { onToggleCollapsed(); onOpenFinalize(); }} disabled={writeActionsDisabled}>
              <Check size={15} /> {t('drafts.finalize')}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-4 pb-6 md:pb-4">
          {hasPendingDrafts && currentDraft && (
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3 rounded-xl border border-black/10 bg-background/60 px-4 py-3 dark:border-white/10">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <DraftNavigator
                  drafts={drafts}
                  activeDraftIndex={activeDraftIndex}
                  onSelect={onSelectDraft}
                  disabled={writeActionsDisabled}
                  modified={currentDraft.modified}
                />

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button tone="accent" fill="solid" size="sm" className="h-11 gap-1 md:h-8" onClick={onOpenFinalize} disabled={writeActionsDisabled}>
                    <Check size={15} /> {t('drafts.finalize')}
                  </Button>
                  <Button tone="neutral" fill="outline" size="sm" className="h-11 gap-1 md:h-8" onClick={onRegenerate} disabled={writeActionsDisabled}>
                    {isGenerating ? <Spinner size="sm" /> : <RefreshCw size={15} />}
                    {t('drafts.regenerate')}
                  </Button>
                  <Button
                    tone="neutral" fill="plain"
                    size="sm"
                    className="h-11 gap-1 text-error/80 hover:bg-error/10 hover:text-error md:h-8"
                    onClick={onOpenDiscard}
                    disabled={isGenerating || isDiscarding || isSettingsModeBusy}
                  >
                    <Trash2 size={15} />
                    {drafts.length > 1 ? t('drafts.discardAll') : t('drafts.discard')}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2 text-xs text-text/50 lg:flex-row lg:items-center lg:justify-between">
                <span>{currentDraftMeta || t('writer.metaDurationUnknown')}</span>
                {drafts.length > MAX_RECOMMENDED_DRAFTS && (
                  <span>{t('drafts.tooMany', { count: drafts.length })}</span>
                )}
              </div>
            </div>
          )}

          <div className="mx-auto hidden w-full max-w-[720px] md:block">
            <input
              ref={instructionInputRef}
              type="text"
              placeholder={t('writer.inputPlaceholder')}
              value={instructionText}
              onChange={(event) => onInstructionTextChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || writeActionsDisabled) return;
                if (hasPendingDrafts) { onBlockedToast(); return; }
                triggerGenerate();
              }}
              disabled={writeActionsDisabled}
              className="h-9 w-full rounded-lg border border-black/10 bg-background px-3 text-sm text-text placeholder:text-text/50 outline-none focus:ring-2 focus:ring-accent/50 dark:border-white/10"
            />
          </div>

          <div className="mx-auto w-full max-w-[720px] md:hidden">
            <Textarea
              value={instructionText}
              onChange={(event) => onInstructionTextChange(event.target.value)}
              placeholder={t('writer.inputPlaceholder')}
              disabled={writeActionsDisabled}
              className="min-h-[80px] resize-none bg-background/90 text-text"
            />
          </div>

          <div className="mx-auto mt-2 hidden w-full max-w-[720px] items-center justify-between border-t border-black/5 pt-2 dark:border-white/5 md:flex">
            <div className="flex items-center gap-2">
              <Button tone="neutral" fill="plain" size="sm" className="text-text/70 hover:text-text" onClick={onOpenUndo} disabled={currentChapter <= 1 || writeActionsDisabled}>
                <Undo2 size={16} className="mr-2" /> {t('common.actions.undoPreviousChapter')}
              </Button>
              <Button tone="neutral" fill="plain" size="sm" className="text-text/70 hover:text-text" onClick={onNavigateFacts}>
                <BookOpen size={16} className="mr-1" /> {t('writer.factsShortcut')}
              </Button>
            </div>
            <div className="flex gap-3">
              <Button
                tone="accent" fill="solid"
                className="w-32"
                onClick={triggerGenerate}
                disabled={writeActionsDisabled || hasPendingDrafts}
              >
                {isGenerating ? <Spinner size="md" /> : (instructionText.trim() ? t('common.actions.instruction') : t('common.actions.continue'))}
              </Button>
            </div>
          </div>

          <div className="mx-auto mt-2 flex w-full max-w-[720px] items-center justify-between border-t border-black/5 pt-3 dark:border-white/5 md:hidden">
            <Button tone="neutral" fill="outline" size="sm" className="px-4" onClick={onOpenMobileTools}>
              {t('common.actions.more')}
            </Button>
            <div className="flex items-center gap-2">
              {hasPendingDrafts ? (
                <Button tone="accent" fill="solid" size="sm" onClick={onOpenFinalize} disabled={writeActionsDisabled}>
                  <Check size={15} className="mr-1" /> {t('drafts.finalize')}
                </Button>
              ) : null}
              <Button
                tone="accent" fill="solid"
                size="sm"
                className="min-w-[110px]"
                onClick={triggerGenerate}
                disabled={writeActionsDisabled || hasPendingDrafts}
              >
                {isGenerating ? <Spinner size="md" /> : (instructionText.trim() ? t('common.actions.instruction') : t('common.actions.continue'))}
              </Button>
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}
