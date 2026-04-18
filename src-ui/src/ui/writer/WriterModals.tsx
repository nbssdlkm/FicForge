// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Sparkles } from 'lucide-react';
import { Spinner } from "../shared/Spinner";
import { Button } from '../shared/Button';
import { Tag } from '../shared/Tag';
import { Modal } from '../shared/Modal';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { EmptyState } from '../shared/EmptyState';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';
import type { ExtractedFactCandidate } from '../../api/engine-client';

// --- Finalize Confirm Modal ---

export interface FinalizeConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentChapter: number;
  chapterTitle: string;
  onChapterTitleChange: (v: string) => void;
  previewText: string;
  onConfirm: () => void;
  isFinalizing: boolean;
}

export const FinalizeConfirmModal = ({
  isOpen,
  onClose,
  currentChapter,
  chapterTitle,
  onChapterTitleChange,
  previewText,
  onConfirm,
  isFinalizing,
}: FinalizeConfirmModalProps) => {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('drafts.confirmFinalize', { chapter: currentChapter })}
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-text/70 mb-1.5">{t('writer.chapterTitleLabel')}</label>
          <input
            type="text"
            value={chapterTitle}
            onChange={(e) => onChapterTitleChange(e.target.value)}
            placeholder={t('writer.chapterTitlePlaceholder')}
            className="w-full rounded-lg border border-black/10 bg-surface/40 px-3 py-2 text-base text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent dark:border-white/10 md:text-sm"
          />
          <p className="text-xs text-text/50 mt-1">{t('writer.chapterTitleAutoHint')}</p>
        </div>
        <div className="rounded-lg border border-black/10 bg-surface/40 p-4 text-sm leading-relaxed text-text/90 dark:border-white/10 max-h-48 overflow-y-auto">
          {previewText || t('writer.emptyContent')}
        </div>
        <div className="flex justify-end gap-2">
          <Button tone="neutral" fill="plain" onClick={onClose}>
            {t('common.actions.cancel')}
          </Button>
          <Button tone="accent" fill="solid" onClick={onConfirm} disabled={isFinalizing}>
            {isFinalizing ? <Spinner size="md" /> : t('drafts.finalize')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// --- Discard Confirm Modal ---

export interface DiscardConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  draftsCount: number;
  onDiscard: () => void;
  isDiscarding: boolean;
}

export const DiscardConfirmModal = ({
  isOpen,
  onClose,
  draftsCount,
  onDiscard,
  isDiscarding,
}: DiscardConfirmModalProps) => {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onDiscard}
      title={draftsCount > 1 ? t('drafts.discardAll') : t('drafts.discard')}
      message={draftsCount > 1
        ? t('drafts.confirmDiscardAll', { count: draftsCount })
        : t('drafts.confirmDiscard')}
      destructive
      loading={isDiscarding}
    />
  );
};

// --- Facts Prompt Modal ---

export interface FactsPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  extractingFacts: boolean;
  skipFactsPrompt: boolean;
  onOpenExtractReview: () => void;
  onManualNavigate: () => void;
  onSkip: () => void;
  onToggle: (checked: boolean) => void;
}

export const FactsPromptModal = ({
  isOpen,
  onClose,
  title,
  extractingFacts,
  skipFactsPrompt,
  onOpenExtractReview,
  onManualNavigate,
  onSkip,
  onToggle,
}: FactsPromptModalProps) => {
  const { t } = useTranslation();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-5">
        <p className="text-sm text-text/90">{t('drafts.factsPrompt')}</p>
        <div className="space-y-2">
          <Button tone="accent" fill="solid" className="w-full gap-2" onClick={onOpenExtractReview} disabled={extractingFacts}>
            {extractingFacts ? <Spinner size="md" /> : <Sparkles size={16} />}
            {t('drafts.factsExtract')}
          </Button>
          <Button tone="neutral" fill="outline" className="w-full" onClick={onManualNavigate}>
            {t('drafts.factsManual')}
          </Button>
          <Button tone="neutral" fill="plain" className="w-full" onClick={onSkip}>
            {t('drafts.factsSkip')}
          </Button>
        </div>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-text/70">
          <input
            type="checkbox"
            className="accent-accent"
            checked={skipFactsPrompt}
            onChange={(event) => onToggle(event.target.checked)}
          />
          <span>{t('drafts.factsNeverAsk')}</span>
        </label>
      </div>
    </Modal>
  );
};

// --- Extract Review Modal ---

export interface ExtractReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  extractedCandidates: ExtractedFactCandidate[];
  selectedExtractedKeys: string[];
  getCandidateKey: (candidate: ExtractedFactCandidate, index: number) => string;
  onToggleCandidate: (key: string) => void;
  onSave: () => void;
  savingExtracted: boolean;
}

export const ExtractReviewModal = ({
  isOpen,
  onClose,
  extractedCandidates,
  selectedExtractedKeys,
  getCandidateKey,
  onToggleCandidate,
  onSave,
  savingExtracted,
}: ExtractReviewModalProps) => {
  const { t } = useTranslation();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('facts.extractReviewTitle')}>
      <div className="space-y-4">
        <p className="text-sm text-text/70">{t('facts.extractReviewDescription')}</p>
        <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
          {extractedCandidates.length === 0 ? (
            <EmptyState compact icon={<Sparkles size={28} />} title={t('facts.extractReviewEmpty')} description={t('facts.extractNoResult')} />
          ) : (
            extractedCandidates.map((candidate, index) => {
              const candidateType = candidate.fact_type || candidate.type || 'plot_event';
              const key = getCandidateKey(candidate, index);
              const checked = selectedExtractedKeys.includes(key);

              return (
                <label key={key} className={`flex cursor-pointer gap-3 rounded-lg border p-4 dark:border-white/10 ${checked ? 'border-accent/40 bg-accent/5' : 'border-black/10 bg-surface/40'}`}>
                  <input
                    type="checkbox"
                    className="mt-1 accent-accent"
                    checked={checked}
                    onChange={() => onToggleCandidate(key)}
                  />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag tone="info">{getEnumLabel('fact_type', candidateType, candidateType)}</Tag>
                      <Tag tone="warning">{getEnumLabel('narrative_weight', candidate.narrative_weight, candidate.narrative_weight)}</Tag>
                      <Tag tone="default">{getEnumLabel('fact_status', candidate.status, candidate.status)}</Tag>
                      <span className="text-xs text-text/50">{t('facts.extractSourceChapter', { chapter: candidate.chapter })}</span>
                    </div>
                    <p className="text-sm text-text/90">{candidate.content_clean}</p>
                    {candidate.characters.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {candidate.characters.map((character) => (
                          <span key={character} className="text-xs font-medium text-accent/80">@{character}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </label>
              );
            })
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
          <Button tone="neutral" fill="plain" onClick={onClose}>
            {t('common.actions.cancel')}
          </Button>
          <Button tone="accent" fill="solid" onClick={onSave} disabled={savingExtracted || selectedExtractedKeys.length === 0}>
            {savingExtracted ? <Spinner size="md" /> : t('drafts.extractSaveSelected')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// --- Undo Confirm Modal ---

export interface UndoConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  chapterNum: number;
  onConfirm: () => void;
}

export const UndoConfirmModal = ({
  isOpen,
  onClose,
  chapterNum,
  onConfirm,
}: UndoConfirmModalProps) => {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title={t('undo.confirmTitle', { chapter: chapterNum })}
      message={
        <>
          <span className="block whitespace-pre-line">{t('undo.confirmDesc')}</span>
          <span className="mt-2 block font-medium text-red-500">{t('undo.irreversible')}</span>
        </>
      }
      destructive
      confirmLabel={t('undo.confirmAction')}
      cancelLabel={t('undo.cancel')}
    />
  );
};

// --- Combined WriterModals ---

export interface WriterModalsProps {
  // Finalize
  isFinalizeConfirmOpen: boolean;
  onCloseFinalizeConfirm: () => void;
  currentChapter: number;
  chapterTitle: string;
  onChapterTitleChange: (v: string) => void;
  previewText: string;
  onConfirmFinalize: () => void;
  isFinalizing: boolean;
  hasDraft: boolean;
  // Discard
  isDiscardConfirmOpen: boolean;
  onCloseDiscardConfirm: () => void;
  draftsCount: number;
  onDiscardDrafts: () => void;
  isDiscarding: boolean;
  // Facts prompt
  isFactsPromptOpen: boolean;
  onCloseFactsPrompt: () => void;
  factsPromptTitle: string;
  extractingFacts: boolean;
  skipFactsPrompt: boolean;
  onOpenExtractReview: () => void;
  onFactsManualNavigate: () => void;
  onSkipFactsPrompt: () => void;
  onFactsPromptToggle: (checked: boolean) => void;
  // Extract review
  isExtractReviewOpen: boolean;
  onCloseExtractReview: () => void;
  extractedCandidates: ExtractedFactCandidate[];
  selectedExtractedKeys: string[];
  getCandidateKey: (candidate: ExtractedFactCandidate, index: number) => string;
  onToggleExtractedCandidate: (key: string) => void;
  onSaveExtracted: () => void;
  savingExtracted: boolean;
  // Undo
  isUndoConfirmOpen: boolean;
  onCloseUndoConfirm: () => void;
  undoChapterNum: number;
  onConfirmUndo: () => void;
}

export const WriterModals = (props: WriterModalsProps) => {
  return (
    <>
      <FinalizeConfirmModal
        isOpen={props.isFinalizeConfirmOpen && props.hasDraft}
        onClose={props.onCloseFinalizeConfirm}
        currentChapter={props.currentChapter}
        chapterTitle={props.chapterTitle}
        onChapterTitleChange={props.onChapterTitleChange}
        previewText={props.previewText}
        onConfirm={props.onConfirmFinalize}
        isFinalizing={props.isFinalizing}
      />
      <DiscardConfirmModal
        isOpen={props.isDiscardConfirmOpen}
        onClose={props.onCloseDiscardConfirm}
        draftsCount={props.draftsCount}
        onDiscard={props.onDiscardDrafts}
        isDiscarding={props.isDiscarding}
      />
      <FactsPromptModal
        isOpen={props.isFactsPromptOpen}
        onClose={props.onCloseFactsPrompt}
        title={props.factsPromptTitle}
        extractingFacts={props.extractingFacts}
        skipFactsPrompt={props.skipFactsPrompt}
        onOpenExtractReview={props.onOpenExtractReview}
        onManualNavigate={props.onFactsManualNavigate}
        onSkip={props.onSkipFactsPrompt}
        onToggle={props.onFactsPromptToggle}
      />
      <ExtractReviewModal
        isOpen={props.isExtractReviewOpen}
        onClose={props.onCloseExtractReview}
        extractedCandidates={props.extractedCandidates}
        selectedExtractedKeys={props.selectedExtractedKeys}
        getCandidateKey={props.getCandidateKey}
        onToggleCandidate={props.onToggleExtractedCandidate}
        onSave={props.onSaveExtracted}
        savingExtracted={props.savingExtracted}
      />
      <UndoConfirmModal
        isOpen={props.isUndoConfirmOpen}
        onClose={props.onCloseUndoConfirm}
        chapterNum={props.undoChapterNum}
        onConfirm={props.onConfirmUndo}
      />
    </>
  );
};
