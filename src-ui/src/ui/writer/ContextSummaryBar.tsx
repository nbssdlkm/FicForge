// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../shared/Button';
import { Tag } from '../shared/Tag';
import { type ContextSummary, type RagChunkDetail } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';

type ContextSummaryBarProps = {
  summary: ContextSummary | null;
  onAdjustCoreIncludes?: () => void;
};

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function stripMarkdownExtension(name: string): string {
  return name.replace(/\.md$/i, '');
}

function buildCharacterSummary(summary: ContextSummary, t: TranslateFn): string | null {
  if (summary.characters_used.length === 0) return null;

  const names = summary.characters_used.slice(0, 3).join(t('common.listSeparator'));
  if (summary.characters_used.length > 3) {
    return t('contextSummary.charactersMore', {
      names,
      count: summary.characters_used.length,
    });
  }

  return t('contextSummary.charactersList', { names });
}

function buildWorldbuildingSummary(summary: ContextSummary, t: TranslateFn): string | null {
  if (summary.worldbuilding_used.length === 0) return null;

  const names = summary.worldbuilding_used.map(stripMarkdownExtension);
  const visible = names.slice(0, 2).join(t('common.listSeparator'));
  if (names.length > 2) {
    return t('contextSummary.worldbuildingMore', { names: visible });
  }

  return t('contextSummary.worldbuildingList', { names: visible });
}

function buildSummaryParts(summary: ContextSummary, t: TranslateFn): string[] {
  return [
    buildCharacterSummary(summary, t),
    buildWorldbuildingSummary(summary, t),
    summary.facts_injected > 0 ? t('contextSummary.facts', { count: summary.facts_injected }) : null,
    summary.pinned_count > 0 ? t('contextSummary.pinned', { count: summary.pinned_count }) : null,
  ].filter((part): part is string => Boolean(part));
}

function buildRagChunkLabel(chunk: RagChunkDetail, t: TranslateFn): string {
  if (chunk.collection === 'chapters') {
    return chunk.chapter_num
      ? t('contextSummary.ragChunkLabelChapter', { num: chunk.chapter_num })
      : t('contextSummary.ragChunkLabelChapterNoNum');
  }
  const source = chunk.source_file ? stripMarkdownExtension(chunk.source_file) : '';
  if (chunk.collection === 'characters') {
    return source
      ? t('contextSummary.ragChunkLabelCharacter', { name: source })
      : t('contextSummary.ragChunkLabelCharacterGeneric');
  }
  return source
    ? t('contextSummary.ragChunkLabelWorldbuilding', { name: source })
    : t('contextSummary.ragChunkLabelWorldbuildingGeneric');
}

// 折叠 2 行的展示粒度下，约 80 字符能排满；超过才值得给用户一个"展开全文"入口。
const RAG_CHUNK_EXPAND_THRESHOLD = 80;

function RagChunkItem({
  chunk,
  t,
  hasWarning,
}: {
  chunk: RagChunkDetail;
  t: TranslateFn;
  hasWarning: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = buildRagChunkLabel(chunk, t);
  const scorePercent = Math.round(Math.max(0, Math.min(1, chunk.score)) * 100);
  const canExpand = chunk.content.length > RAG_CHUNK_EXPAND_THRESHOLD;
  const borderClass = hasWarning ? 'border-warning/20' : 'border-black/10 dark:border-white/10';
  const textClass = hasWarning ? 'text-warning/90' : 'text-text/70';

  return (
    <div className={`space-y-1.5 border-l-2 pl-3 ${borderClass}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={hasWarning ? 'warning' : 'default'}>{label}</Tag>
        <span className={`font-mono text-xs ${hasWarning ? 'text-warning/70' : 'text-text/50'}`}>{scorePercent}%</span>
      </div>
      <p className={`whitespace-pre-wrap text-sm ${textClass} ${expanded ? '' : 'line-clamp-2'}`}>
        {chunk.content}
      </p>
      {canExpand && (
        <Button
          tone="neutral"
          fill="plain"
          size="sm"
          className="h-11 gap-1 px-1 text-xs text-text/50 md:h-6"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? t('contextSummary.ragChunkCollapse') : t('contextSummary.ragChunkExpand')}
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </Button>
      )}
    </div>
  );
}

function buildTruncatedMessages(summary: ContextSummary, t: TranslateFn): string[] {
  const messages: string[] = [];

  if (summary.truncated_characters.length > 0) {
    messages.push(
      t('contextSummary.truncatedCharacters', {
        names: summary.truncated_characters.join(t('common.listSeparator')),
      })
    );
  }

  if (summary.truncated_layers.includes('P5_core_settings')) {
    messages.push(t('contextSummary.truncatedP5'));
  }
  if (summary.truncated_layers.includes('P4_rag')) {
    messages.push(t('contextSummary.truncatedP4'));
  }
  if (summary.truncated_layers.includes('P2_recent_chapter')) {
    messages.push(t('contextSummary.truncatedP2'));
  }

  return Array.from(new Set(messages));
}

export function ContextSummaryBar({ summary, onAdjustCoreIncludes }: ContextSummaryBarProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [summary]);

  const summaryParts = useMemo(
    () => (summary ? buildSummaryParts(summary, t) : []),
    [summary, t]
  );
  const truncatedMessages = useMemo(
    () => (summary ? buildTruncatedMessages(summary, t) : []),
    [summary, t]
  );

  if (!summary) return null;

  const hasWarning = truncatedMessages.length > 0;
  const hasSummaryParts = summaryParts.length > 0;
  const normalSummaryText = hasSummaryParts
    ? `${t('contextSummary.prefix')}${summaryParts.join(' · ')}`
    : t('contextSummary.noContext');
  const factsRestCount = Math.max(0, summary.facts_injected - summary.facts_as_focus.length);

  const headingClass = hasWarning ? 'text-warning font-medium' : 'text-text/90 font-medium';
  const itemClass = hasWarning ? 'text-warning/90' : 'text-text/70';
  const emptyClass = hasWarning ? 'text-warning/65' : 'text-text/50';

  return (
    <div
      className={[
        'rounded-xl border px-4 py-4 text-sm shadow-subtle transition-colors md:py-3',
        hasWarning
          ? 'border-warning/30 bg-warning/10 text-warning'
          : 'border-black/10 bg-background/60 text-text/70 dark:border-white/10',
      ].join(' ')}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          {hasWarning ? (
            <>
              <p className="font-medium text-warning">{t('contextSummary.truncatedWarning')}</p>
              {truncatedMessages.map((message) => (
                <p key={message} className="text-sm text-warning/90">
                  {message}
                </p>
              ))}
              {hasSummaryParts && (
                <p className="text-sm text-warning/90">
                  {t('contextSummary.truncatedRest', { summary: summaryParts.join(' · ') })}
                </p>
              )}
            </>
          ) : (
            <p>{normalSummaryText}</p>
          )}
        </div>

        <div className="flex items-center gap-2 self-start">
          {hasWarning && onAdjustCoreIncludes && (
            <Button
              tone="neutral" fill="plain"
              size="sm"
              className="h-11 border border-warning/30 bg-warning/10 text-warning hover:bg-warning/20 hover:text-warning md:h-8"
              onClick={onAdjustCoreIncludes}
            >
              {t('contextSummary.adjustCoreIncludes')}
            </Button>
          )}
          <Button
            tone="neutral" fill="plain"
            size="sm"
            className={[
              'h-11 gap-1 px-3 md:h-8 md:px-2',
              hasWarning ? 'text-warning hover:bg-warning/10 hover:text-warning' : 'text-text/70',
            ].join(' ')}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? t('contextSummary.detailCollapse') : t('contextSummary.detailToggle')}
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div
          className={[
            'mt-3 space-y-3 border-t pt-3',
            hasWarning ? 'border-warning/20' : 'border-black/10 dark:border-white/10',
          ].join(' ')}
        >
          <p className={headingClass}>{t('contextSummary.detailTitle')}</p>

          <div className="space-y-1">
            <p className={headingClass}>{t('contextSummary.detailCharacters', { count: summary.characters_used.length })}</p>
            {summary.characters_used.length > 0 ? (
              <div className="space-y-1 pl-3">
                {summary.characters_used.map((name) => (
                  <p key={name} className={itemClass}>
                    {t('contextSummary.detailCharacterFull', { name })}
                  </p>
                ))}
              </div>
            ) : (
              <p className={`pl-3 ${emptyClass}`}>{t('common.none')}</p>
            )}
          </div>

          <div className="space-y-1">
            <p className={headingClass}>{t('contextSummary.detailWorldbuilding', { count: summary.worldbuilding_used.length })}</p>
            {summary.worldbuilding_used.length > 0 ? (
              <div className="space-y-1 pl-3">
                {summary.worldbuilding_used.map((name) => (
                  <p key={name} className={itemClass}>
                    {stripMarkdownExtension(name)}
                  </p>
                ))}
              </div>
            ) : (
              <p className={`pl-3 ${emptyClass}`}>{t('common.none')}</p>
            )}
          </div>

          <div className="space-y-1">
            <p className={headingClass}>{t('contextSummary.detailFacts', { count: summary.facts_injected })}</p>
            {(summary.facts_as_focus.length > 0 || factsRestCount > 0) ? (
              <div className="space-y-1 pl-3">
                {summary.facts_as_focus.map((content, index) => (
                  <p key={`${content}-${index}`} className={itemClass}>
                    {t('contextSummary.detailFactsFocus', { content })}
                  </p>
                ))}
                {factsRestCount > 0 && (
                  <p className={itemClass}>{t('contextSummary.detailFactsRest', { count: factsRestCount })}</p>
                )}
              </div>
            ) : (
              <p className={`pl-3 ${emptyClass}`}>{t('common.none')}</p>
            )}
          </div>

          <div className="space-y-1">
            <p className={headingClass}>{t('contextSummary.detailPinned', { count: summary.pinned_count })}</p>
          </div>

          {summary.rag_chunks_retrieved > 0 && (
            <div className="space-y-2">
              <p className={headingClass}>{t('contextSummary.detailRag', { count: summary.rag_chunks.length || summary.rag_chunks_retrieved })}</p>
              {summary.rag_chunks && summary.rag_chunks.length > 0 ? (
                <div className="space-y-3 pl-3">
                  {summary.rag_chunks.map((chunk, index) => (
                    <RagChunkItem
                      key={`${index}-${chunk.collection}-${chunk.content.slice(0, 32)}`}
                      chunk={chunk}
                      t={t}
                      hasWarning={hasWarning}
                    />
                  ))}
                </div>
              ) : (
                <p className={`pl-3 ${emptyClass}`}>{t('common.none')}</p>
              )}
            </div>
          )}

          <div className="space-y-1">
            {truncatedMessages.length > 0 ? (
              <>
                <p className={headingClass}>{t('contextSummary.detailTruncated')}</p>
                <div className="space-y-1 pl-3">
                  {truncatedMessages.map((message) => (
                    <p key={message} className={itemClass}>
                      {message}
                    </p>
                  ))}
                </div>
              </>
            ) : (
              <p className={headingClass}>{t('contextSummary.detailNoTruncation')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
