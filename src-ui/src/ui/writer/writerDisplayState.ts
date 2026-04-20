// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import {
  type ContextSummary,
  type DraftGeneratedWith,
  type StateInfo,
} from '../../api/engine-client';
import type { DraftItem } from './useWriterDraftController';

export type ContextLayer = {
  key: string;
  label: string;
  percent: number;
  tokens: number;
  color: string;
};

type WriterDisplayStateOptions = {
  auPath: string;
  state: StateInfo | null;
  drafts: DraftItem[];
  activeDraftIndex: number;
  draftSummaries: Record<string, ContextSummary>;
  isGenerating: boolean;
  isFinalizing: boolean;
  isDiscarding: boolean;
  isSettingsModeBusy: boolean;
  currentContent: string;
  streamText: string;
  generatedWith: DraftGeneratedWith | null;
  budgetReport: any;
  sessionModel: string;
  locale: string;
  t: (key: string, params?: Record<string, unknown>) => string;
};

function formatGeneratedMeta(generatedWith?: DraftGeneratedWith | null, locale = 'zh-CN'): string {
  if (!generatedWith) return '';

  const parts: string[] = [];
  if (generatedWith.generated_at) {
    const timestamp = new Date(generatedWith.generated_at);
    if (!Number.isNaN(timestamp.getTime())) {
      parts.push(
        new Intl.DateTimeFormat(locale, {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(timestamp),
      );
    }
  }

  if (generatedWith.model) {
    parts.push(generatedWith.model);
  }

  return parts.join(' 路 ');
}

function getPreviewText(content: string, maxChars = 200): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
}

export function deriveWriterDisplayState({
  auPath,
  state,
  drafts,
  activeDraftIndex,
  draftSummaries,
  isGenerating,
  isFinalizing,
  isDiscarding,
  isSettingsModeBusy,
  currentContent,
  streamText,
  generatedWith,
  budgetReport,
  sessionModel,
  locale,
  t,
}: WriterDisplayStateOptions) {
  const currentChapter = state?.current_chapter || 1;
  const hasPendingDrafts = drafts.length > 0;
  const writeActionsDisabled = isGenerating || isFinalizing || isDiscarding || isSettingsModeBusy;
  const currentDraft = drafts[activeDraftIndex] || null;
  const settingsFandomPath = auPath.split('/aus/')[0] || auPath;
  const currentDraftSummary = !isGenerating && currentDraft ? draftSummaries[currentDraft.label] || null : null;
  const activeGeneratedWith = currentDraft?.generatedWith || generatedWith;
  const fallbackDisplayContent = streamText || currentDraft?.content || currentContent;
  const metaModel = activeGeneratedWith?.model || sessionModel;
  const metaChars = activeGeneratedWith?.char_count || fallbackDisplayContent.length;
  const metaDuration = activeGeneratedWith?.duration_ms
    ? `${(activeGeneratedWith.duration_ms / 1000).toFixed(1)}s`
    : t('writer.metaDurationUnknown');
  const currentDraftMeta = formatGeneratedMeta(currentDraft?.generatedWith, locale);
  const previewText = currentDraft ? getPreviewText(currentDraft.content) : '';

  const layerSum = budgetReport
    ? (budgetReport.system_tokens || 0)
        + (budgetReport.p1_tokens || 0)
        + (budgetReport.p2_tokens || 0)
        + (budgetReport.p3_tokens || 0)
        + (budgetReport.p4_tokens || 0)
        + (budgetReport.p5_tokens || 0)
    : 1;
  const pct = (tokens: number | undefined) =>
    budgetReport && tokens ? Math.max(1, Math.round((tokens / (layerSum || 1)) * 100)) : 0;
  const contextLayers: ContextLayer[] = budgetReport ? [
    { key: 'pinned', label: t('writer.memoryLayer.pinned'), percent: pct(budgetReport.system_tokens), tokens: budgetReport.system_tokens || 0, color: 'bg-error/70' },
    ...((budgetReport.p2_tokens || 0) > 0 ? [{ key: 'recent', label: t('writer.memoryLayer.recentChapter'), percent: pct(budgetReport.p2_tokens), tokens: budgetReport.p2_tokens || 0, color: 'bg-info/70' }] : []),
    ...((budgetReport.p3_tokens || 0) > 0 ? [{ key: 'facts', label: t('writer.memoryLayer.facts'), percent: pct(budgetReport.p3_tokens), tokens: budgetReport.p3_tokens || 0, color: 'bg-accent/70' }] : []),
    ...((budgetReport.p4_tokens || 0) > 0 ? [{ key: 'rag', label: t('writer.memoryLayer.rag'), percent: pct(budgetReport.p4_tokens), tokens: budgetReport.p4_tokens || 0, color: 'bg-success/70' }] : []),
    ...((budgetReport.p5_tokens || 0) > 0 ? [{ key: 'settings', label: t('writer.memoryLayer.characterSettings'), percent: pct(budgetReport.p5_tokens), tokens: budgetReport.p5_tokens || 0, color: 'bg-warning/70' }] : []),
  ] : [];

  return {
    currentChapter,
    hasPendingDrafts,
    writeActionsDisabled,
    currentDraft,
    settingsFandomPath,
    currentDraftSummary,
    fallbackDisplayContent,
    metaModel,
    metaChars,
    metaDuration,
    currentDraftMeta,
    previewText,
    layerSum,
    contextLayers,
  };
}
