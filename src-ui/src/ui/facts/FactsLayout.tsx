// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect } from 'react';
import { Spinner } from "../shared/Spinner";
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { FactCard } from './FactCard';
import { Modal } from '../shared/Modal';
import { EmptyState } from '../shared/EmptyState';
import { Search, Filter, Check, Sparkles, BookOpenText, X } from 'lucide-react';
import { ProgressBar } from '../shared/ProgressBar';
import { listFacts, updateFactStatus, FactStatus, type FactInfo } from '../../api/engine-client';
import { getState, type StateInfo } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';
import { useFeedback } from '../../hooks/useFeedback';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useFactsFilter } from './useFactsFilter';
import { useBatchFacts } from './useBatchFacts';
import { useFactEditor } from './useFactEditor';
import { useFactsExtraction } from './useFactsExtraction';
import { ExtractReviewModal } from '../writer/WriterModals';

export const FactsLayout = ({ auPath }: { auPath: string }) => {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const loadGuard = useActiveRequestGuard(auPath);
  const [facts, setFacts] = useState<FactInfo[]>([]);
  const [state, setState] = useState<StateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [allFactsCounts, setAllFactsCounts] = useState<Record<string, number>>({});

  const factsFilter = useFactsFilter(facts, state);
  const loadFacts = async () => {
    if (!auPath) return;
    const token = loadGuard.start();
    setLoading(true);
    try {
      const [factsData, allFactsData, stateData] = await Promise.all([
        listFacts(auPath, (factsFilter.statusFilter && factsFilter.statusFilter !== 'stale') ? factsFilter.statusFilter : undefined),
        listFacts(auPath),
        getState(auPath).catch(() => null),
      ]);
      if (loadGuard.isStale(token)) return;
      setFacts(factsData);
      setState(stateData);
      const counts: Record<string, number> = { total: allFactsData.length };
      for (const f of allFactsData) {
        counts[f.status] = (counts[f.status] || 0) + 1;
      }
      setAllFactsCounts(counts);
    } catch (error) {
      if (loadGuard.isStale(token)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!loadGuard.isStale(token)) {
        setLoading(false);
      }
    }
  };

  const batch = useBatchFacts(auPath, factsFilter.filteredFacts, loadFacts);
  const editor = useFactEditor(auPath, state?.current_chapter ?? 1, loadFacts);
  const extraction = useFactsExtraction(auPath, state, loadFacts);

  useEffect(() => {
    setLoading(true);
    setFacts([]);
    setState(null);
    // Hooks handle their own reset via auPath-dependent effects
    factsFilter.resetFilters();
    editor.setEditingFact(null);
    editor.setAddModalOpen(false);
    // extraction 状态由 useFactsExtraction 的 [auPath] effect 自行管理
  }, [auPath]);

  useEffect(() => {
    void loadFacts();
  }, [auPath, factsFilter.statusFilter]);

  const handleStatusChange = async (factId: string, nextStatus: string) => {
    if (!auPath) return;
    const requestAuPath = auPath;
    const targetFact = facts.find((fact) => fact.id === factId);
    const chapterNum = targetFact?.chapter || editor.editingFact?.chapter || 1;
    try {
      await updateFactStatus(requestAuPath, factId, nextStatus, chapterNum);
      if (loadGuard.isKeyStale(requestAuPath)) return;
      await loadFacts();
      if (editor.editingFact?.id === factId) {
        editor.setEditingFact(prev => prev ? { ...prev, status: nextStatus as FactStatus } : null);
      }
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    }
  };

  const totalCount = allFactsCounts.total ?? facts.length;
  const activeCount = allFactsCounts.active ?? 0;
  const unresolvedCount = allFactsCounts.unresolved ?? 0;
  const resolvedCount = allFactsCounts.resolved ?? 0;
  const deprecatedCount = allFactsCounts.deprecated ?? 0;
  const showEmptyNotes = !loading && facts.length === 0 && !factsFilter.filter && !factsFilter.statusFilter && factsFilter.chapterFilter === null && !factsFilter.characterFilter;
  const showNoSearchResult = !loading && factsFilter.filteredFacts.length === 0 && !showEmptyNotes;

  // 过期 facts 提醒（current_chapter - fact.chapter > 30）
  const currentChapter = state?.current_chapter || 1;
  const staleFacts = facts.filter(f => (f.status === 'active' || f.status === 'unresolved') && currentChapter - f.chapter > 30);
  const staleCount = staleFacts.length;

  const FACTS_PAGE_SIZE = 50;

  const renderFactEditor = (showFooter: boolean) => {
    if (!editor.editingFact) {
      return (
        <EmptyState
          icon={<Search size={40} />}
          title={t('facts.emptySelectionTitle')}
          description={t('facts.emptySelectionDescription')}
        />
      );
    }

    return (
      <div key={editor.editingFact.id} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-text/90">{t('common.labels.factStatus')}</label>
            <select
              className="h-11 rounded-md border border-black/20 bg-surface px-3 text-base outline-none focus:ring-2 focus:ring-accent dark:border-white/20 md:h-10 md:text-sm"
              value={editor.editingFact.status}
              onChange={(e) => handleStatusChange(editor.editingFact!.id, e.target.value)}
            >
              <option value="unresolved">{getEnumLabel('fact_status', 'unresolved', 'unresolved')}</option>
              <option value="active">{getEnumLabel('fact_status', 'active', 'active')}</option>
              <option value="resolved">{getEnumLabel('fact_status', 'resolved', 'resolved')}</option>
              <option value="deprecated">{getEnumLabel('fact_status', 'deprecated', 'deprecated')}</option>
            </select>
            <p className="text-xs text-text/50">{t('facts.statusHintResolved')}</p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-text/90">{t('common.labels.narrativeWeight')}</label>
            <select
              ref={editor.editWeightRef}
              defaultValue={editor.editingFact.narrative_weight || 'medium'}
              className="h-11 rounded-md border border-black/20 bg-surface px-3 text-base outline-none focus:ring-2 focus:ring-accent dark:border-white/20 md:h-10 md:text-sm"
            >
              <option value="low">{getEnumLabel('narrative_weight', 'low', 'low')}</option>
              <option value="medium">{getEnumLabel('narrative_weight', 'medium', 'medium')}</option>
              <option value="high">{getEnumLabel('narrative_weight', 'high', 'high')}</option>
            </select>
            <p className="text-xs text-text/50">{t('facts.weightHint')}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-bold text-text/90">{t('common.labels.contentClean')}</label>
          <Textarea ref={editor.editContentCleanRef} defaultValue={editor.editingFact.content_clean} className="font-serif min-h-[160px] text-lg leading-relaxed resize-y" />
          <p className="text-xs text-text/50">{t('facts.cleanHint')}</p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-bold text-text/90">{t('common.labels.contentRaw')}</label>
          <Textarea ref={editor.editContentRawRef} defaultValue={editor.editingFact.content_raw} className="font-serif opacity-70 min-h-[140px] text-base leading-relaxed bg-surface/50 resize-y" />
          <p className="text-xs text-text/50">{t('facts.rawHint')}</p>
        </div>

        <div className="flex flex-col gap-2 border-t border-black/10 pt-4 dark:border-white/10">
          <label className="text-sm font-bold text-text/90">{t('common.labels.characters')}</label>
          <Input ref={editor.editCharactersRef} defaultValue={(editor.editingFact.characters || []).join(', ')} className="h-11 text-base md:h-10 md:text-sm" />
          <p className="text-xs text-text/50">{t('facts.charactersHint')}</p>
        </div>

        {showFooter ? (
          <div className="flex items-center justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
            <Button tone="neutral" fill="plain" onClick={() => editor.setEditingFact(null)}>{t('facts.cancelSelection')}</Button>
            <Button tone="accent" fill="solid" onClick={editor.handleSaveFact} disabled={editor.savingFact}>
              {editor.savingFact ? <Spinner size="sm" /> : editor.saveSuccess ? <><Check size={14} className="mr-1" /> {t('facts.saved')}</> : t('common.actions.save')}
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  const sharedModals = (
    <>
      {isMobile ? (
        <Modal
          isOpen={!!editor.editingFact}
          onClose={editor.savingFact ? () => {} : () => editor.setEditingFact(null)}
          title={editor.editingFact ? `${editor.editingFact.id.split('-')[0]} ${t('facts.editing')}` : t('facts.editing')}
        >
          {renderFactEditor(true)}
        </Modal>
      ) : null}

      <Modal isOpen={editor.isAddModalOpen} onClose={editor.adding ? () => {} : () => editor.setAddModalOpen(false)} title={t('facts.createModal.title')}>
        <div className="space-y-4">
          <div className="space-y-1">
            <Textarea
              label={t('common.labels.contentRaw')}
              value={editor.newContentRaw}
              onChange={e => editor.setNewContentRaw(e.target.value)}
              placeholder={t('facts.createModal.rawPlaceholder')}
              className="min-h-[80px] bg-surface/50"
            />
            <p className="text-xs text-text/50">{t('facts.rawHint')}</p>
          </div>
          <div className="space-y-1">
            <Textarea
              label={`${t('common.labels.contentClean')} *`}
              value={editor.newContentClean}
              onChange={e => editor.setNewContentClean(e.target.value)}
              placeholder={t('facts.createModal.cleanPlaceholder')}
              className="min-h-[80px] bg-surface/50 font-bold"
            />
            <p className="text-xs text-text/50">{t('facts.cleanHint')}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-text/90">{t('facts.createModal.typeLabel')}</label>
              <select value={editor.newType} onChange={e => editor.setNewType(e.target.value)} className="h-11 w-full rounded-md border border-black/10 bg-surface px-2 text-base dark:border-white/10 md:h-9 md:text-sm">
                <option value="plot_event">{getEnumLabel('fact_type', 'plot_event', 'plot_event')}</option>
                <option value="character_detail">{getEnumLabel('fact_type', 'character_detail', 'character_detail')}</option>
                <option value="relationship">{getEnumLabel('fact_type', 'relationship', 'relationship')}</option>
                <option value="backstory">{getEnumLabel('fact_type', 'backstory', 'backstory')}</option>
                <option value="foreshadowing">{getEnumLabel('fact_type', 'foreshadowing', 'foreshadowing')}</option>
                <option value="world_rule">{getEnumLabel('fact_type', 'world_rule', 'world_rule')}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-text/90">{t('facts.createModal.weightLabel')}</label>
              <select value={editor.newWeight} onChange={e => editor.setNewWeight(e.target.value)} className="h-11 w-full rounded-md border border-black/10 bg-surface px-2 text-base dark:border-white/10 md:h-9 md:text-sm">
                <option value="low">{getEnumLabel('narrative_weight', 'low', 'low')}</option>
                <option value="medium">{getEnumLabel('narrative_weight', 'medium', 'medium')}</option>
                <option value="high">{getEnumLabel('narrative_weight', 'high', 'high')}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-text/90">{t('facts.createModal.statusLabel')}</label>
              <select value={editor.newStatus} onChange={e => editor.setNewStatus(e.target.value)} className="h-11 w-full rounded-md border border-black/10 bg-surface px-2 text-base dark:border-white/10 md:h-9 md:text-sm">
                <option value="active">{getEnumLabel('fact_status', 'active', 'active')}</option>
                <option value="unresolved">{getEnumLabel('fact_status', 'unresolved', 'unresolved')}</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
            <Button tone="neutral" fill="plain" onClick={() => editor.setAddModalOpen(false)} disabled={editor.adding}>{t('common.actions.cancel')}</Button>
            <Button tone="accent" fill="solid" onClick={editor.handleAddFact} disabled={!editor.newContentClean.trim() || editor.adding}>
              {editor.adding ? <Spinner size="md" /> : t('facts.createModal.submit')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={extraction.extractRangeOpen} onClose={() => extraction.setExtractRangeOpen(false)} title={t('facts.extractRangeTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/70">{t('facts.extractRangeDesc')}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto,96px,auto,96px,1fr] sm:items-center">
            <label className="text-sm text-text/70 shrink-0">{t('facts.extractFrom')}</label>
            <Input type="number" className="h-11 text-base md:h-8 md:text-sm" min={1} max={extraction.extractRange[1]} value={extraction.extractRange[0]} onChange={e => extraction.setExtractRange([Math.max(1, parseInt(e.target.value) || 1), extraction.extractRange[1]])} />
            <label className="text-sm text-text/70 shrink-0">{t('facts.extractTo')}</label>
            <Input type="number" className="h-11 text-base md:h-8 md:text-sm" min={extraction.extractRange[0]} value={extraction.extractRange[1]} onChange={e => extraction.setExtractRange([extraction.extractRange[0], parseInt(e.target.value) || extraction.extractRange[1]])} />
            <span className="text-xs text-text/50">{t('facts.extractChapterCount', { count: extraction.extractRange[1] - extraction.extractRange[0] + 1 })}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button tone="neutral" fill="plain" onClick={() => extraction.setExtractRangeOpen(false)}>{t('common.actions.cancel')}</Button>
            <Button tone="accent" fill="solid" onClick={extraction.handleExtractConfirm}>{t('facts.extractStart')}</Button>
          </div>
        </div>
      </Modal>

      <ExtractReviewModal
        isOpen={extraction.extractModalOpen}
        onClose={extraction.savingExtraction ? () => {} : () => extraction.setExtractModalOpen(false)}
        extractedCandidates={extraction.extractedCandidates}
        selectedExtractedKeys={extraction.selectedExtractedKeys}
        getCandidateKey={extraction.getCandidateKey}
        onToggleCandidate={extraction.toggleExtractedCandidate}
        onSave={extraction.handleSaveExtracted}
        savingExtracted={extraction.savingExtraction}
      />

      <Modal isOpen={!!batch.batchConfirm} onClose={batch.batchProcessing ? () => {} : () => batch.setBatchConfirm(null)} title={t('facts.batchConfirmTitle', { count: batch.selectedIds.size, status: batch.batchConfirm ? getEnumLabel('fact_status', batch.batchConfirm, batch.batchConfirm) : '' })}>
        <div className="space-y-4">
          <p className="text-sm text-text/70">
            {batch.batchConfirm === 'deprecated' && t('facts.batchDeprecatedDesc')}
            {batch.batchConfirm === 'resolved' && t('facts.batchResolvedDesc')}
            {batch.batchConfirm === 'active' && t('facts.batchActiveDesc')}
            {batch.batchConfirm === 'unresolved' && t('facts.batchUnresolvedDesc')}
          </p>
          <div className="flex justify-end gap-2">
            <Button tone="neutral" fill="plain" onClick={() => batch.setBatchConfirm(null)} disabled={batch.batchProcessing}>{t('common.actions.cancel')}</Button>
            <Button tone="accent" fill="solid" onClick={() => batch.batchConfirm && batch.handleBatchStatus(batch.batchConfirm)} disabled={batch.batchProcessing}>
              {batch.batchProcessing ? <Spinner size="sm" /> : t('common.actions.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );

  if (isMobile) {
    return (
      <>
        <div className="min-h-full bg-background pb-28 md:hidden">
          <header className="safe-area-top sticky top-0 z-20 border-b border-black/10 bg-surface/90 px-4 py-4 backdrop-blur dark:border-white/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="font-serif text-2xl font-bold">{t('facts.title')}</h1>
                <p className="text-sm text-text/50">{t('facts.subtitle')}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button tone="neutral" fill="outline" size="sm" className="px-3" onClick={extraction.handleExtractClick} disabled={extraction.extracting}>
                  {extraction.extracting ? <Spinner size="md" /> : <Sparkles size={16} />}
                </Button>
                <Button tone="accent" fill="solid" size="sm" className="px-3 shadow-md" onClick={() => editor.setAddModalOpen(true)}>
                  新建
                </Button>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 text-text/50" size={16} />
                <Input
                  className="pl-10"
                  placeholder={t('common.search.facts')}
                  value={factsFilter.filter}
                  onChange={e => factsFilter.setFilter(e.target.value)}
                />
              </div>
              <Button
                tone={factsFilter.filterOpen || factsFilter.chapterFilter !== null || factsFilter.characterFilter ? 'accent' : 'neutral'} fill={factsFilter.filterOpen || factsFilter.chapterFilter !== null || factsFilter.characterFilter ? 'solid' : 'outline'}
                className="w-11 px-0"
                title={t('facts.filterTitle')}
                onClick={() => factsFilter.setFilterOpen(!factsFilter.filterOpen)}
              >
                <Filter size={16} />
              </Button>
            </div>

            {factsFilter.filterOpen ? (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <select
                  value={factsFilter.chapterFilter ?? ''}
                  onChange={e => factsFilter.setChapterFilter(e.target.value ? Number(e.target.value) : null)}
                  className="h-11 rounded-md border border-black/10 bg-background px-3 text-base outline-none focus:ring-1 focus:ring-accent dark:border-white/15 md:text-sm"
                >
                  <option value="">{t('facts.filterAllChapters')}</option>
                  {factsFilter.uniqueChapters.map(ch => (
                    <option key={ch} value={ch}>{t('facts.chapterGroup', { num: ch })}</option>
                  ))}
                </select>
                <select
                  value={factsFilter.characterFilter}
                  onChange={e => factsFilter.setCharacterFilter(e.target.value)}
                  className="h-11 rounded-md border border-black/10 bg-background px-3 text-base outline-none focus:ring-1 focus:ring-accent dark:border-white/15 md:text-sm"
                >
                  <option value="">{t('facts.filterAllCharacters')}</option>
                  {factsFilter.uniqueCharacters.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 text-sm whitespace-nowrap">
              <button
                type="button"
                className={`min-h-[44px] border-b-2 px-1 pb-1 font-medium ${!factsFilter.statusFilter ? 'border-accent text-accent' : 'border-transparent text-text/70'}`}
                onClick={() => factsFilter.setStatusFilter('')}
              >
                {t('facts.allTab')} ({totalCount})
              </button>
              <button
                type="button"
                className={`min-h-[44px] border-b-2 px-1 pb-1 font-medium ${factsFilter.statusFilter === 'unresolved' ? 'border-accent text-accent' : 'border-transparent text-text/70'}`}
                onClick={() => factsFilter.setStatusFilter('unresolved')}
              >
                {getEnumLabel('fact_status', 'unresolved', 'unresolved')} ({unresolvedCount})
              </button>
              <button
                type="button"
                className={`min-h-[44px] border-b-2 px-1 pb-1 font-medium ${factsFilter.statusFilter === 'active' ? 'border-accent text-accent' : 'border-transparent text-text/70'}`}
                onClick={() => factsFilter.setStatusFilter('active')}
              >
                {getEnumLabel('fact_status', 'active', 'active')} ({activeCount})
              </button>
              <button
                type="button"
                className={`min-h-[44px] border-b-2 px-1 pb-1 font-medium ${factsFilter.statusFilter === 'resolved' ? 'border-accent text-accent' : 'border-transparent text-text/70'}`}
                onClick={() => factsFilter.setStatusFilter('resolved')}
              >
                {getEnumLabel('fact_status', 'resolved', 'resolved')} ({resolvedCount})
              </button>
              <button
                type="button"
                className={`min-h-[44px] border-b-2 px-1 pb-1 font-medium ${factsFilter.statusFilter === 'deprecated' ? 'border-accent text-accent' : 'border-transparent text-text/70'}`}
                onClick={() => factsFilter.setStatusFilter('deprecated')}
              >
                {getEnumLabel('fact_status', 'deprecated', 'deprecated')} ({deprecatedCount})
              </button>
            </div>
          </header>

          {extraction.extracting && (
            <div className="mx-4 mt-3 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Spinner size="sm" className="shrink-0 text-accent" />
                  <span className="truncate text-text/70">{t('common.status.extracting')}</span>
                  <span className="shrink-0 font-medium text-accent">{extraction.extractProgress}%</span>
                </div>
                <button
                  type="button"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0 rounded-md text-text/50 hover:text-error hover:bg-error/10 transition-colors"
                  onClick={extraction.handleCancelExtraction}
                >
                  <X size={16} />
                </button>
              </div>
              <ProgressBar percent={extraction.extractProgress} className="mt-1.5" />
            </div>
          )}

          {staleCount > 0 && !factsFilter.statusFilter ? (
            <div className="mx-4 mt-3 flex items-center justify-between rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">
              <span>💡 {t('facts.staleHint', { count: staleCount })}</span>
              <Button tone="neutral" fill="plain" size="sm" className="h-11 px-3 text-sm" onClick={() => factsFilter.setStatusFilter('stale')}>{t('facts.staleView')}</Button>
            </div>
          ) : null}

          {factsFilter.filteredFacts.length > 0 ? (
            <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 text-xs text-text/70">
              <button
                type="button"
                className={`min-h-[44px] font-medium ${batch.batchMode ? 'text-accent' : 'text-text/50 hover:text-text/70'}`}
                onClick={() => { batch.setBatchMode(!batch.batchMode); if (batch.batchMode) { batch.setSelectedIds(new Set()); batch.setBatchMenuOpen(false); } }}
              >
                {batch.batchMode ? t('facts.batchExit') : t('facts.batchEnter')}
              </button>
              {batch.batchMode ? (
                <label className="flex min-h-[44px] items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={batch.selectedIds.size > 0 && batch.selectedIds.size === factsFilter.filteredFacts.length} onChange={batch.toggleSelectAll} className="accent-accent" />
                  {t('facts.batchSelect')}
                </label>
              ) : null}
              {batch.selectedIds.size > 0 ? (
                <>
                  <span className="font-medium text-accent">{t('facts.batchSelected', { count: batch.selectedIds.size })}</span>
                  <Button tone="neutral" fill="outline" size="sm" className="h-11 px-3 text-sm" onClick={() => batch.setBatchMenuOpen(!batch.batchMenuOpen)} disabled={batch.batchProcessing}>
                    {t('facts.batchAction')} ▾
                  </Button>
                  {batch.batchMenuOpen ? (
                    <div className="w-full rounded-lg border border-black/10 bg-surface p-1 dark:border-white/10">
                      {(['deprecated', 'resolved', 'active', 'unresolved'] as const).map(s => (
                        <button key={s} type="button" className="flex min-h-[44px] w-full items-center rounded-md px-3 py-2 text-left text-sm hover:bg-accent/10" onClick={() => { batch.setBatchMenuOpen(false); batch.setBatchConfirm(s); }}>
                          {t(`facts.batchTo.${s}`)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-4 px-4 py-4">
            {loading ? (
              <div className="flex justify-center py-10"><Spinner size="lg" className="text-accent" /></div>
            ) : showEmptyNotes ? (
              <EmptyState
                compact
                icon={<BookOpenText size={28} />}
                title={t('emptyState.facts.title')}
                description={t('emptyState.facts.description')}
                actions={[
                  {
                    key: 'add-fact',
                    element: <Button tone="accent" fill="solid" size="sm" onClick={() => editor.setAddModalOpen(true)}>{t('common.actions.manualFact')}</Button>,
                  },
                  {
                    key: 'extract-facts',
                    element: <Button tone="neutral" fill="outline" size="sm" onClick={extraction.handleExtractClick} disabled={extraction.extracting}>{t('common.actions.extractFacts')}</Button>,
                  },
                ]}
              />
            ) : showNoSearchResult ? (
              <EmptyState
                compact
                icon={<Search size={28} />}
                title={t('facts.noSearchResultTitle')}
                description={t('facts.noSearchResultDescription')}
                actions={[
                  {
                    key: 'add-first-fact',
                    element: <Button tone="accent" fill="solid" size="sm" onClick={() => editor.setAddModalOpen(true)}>{t('common.actions.newNote')}</Button>,
                  },
                ]}
              />
            ) : (
              factsFilter.groupedFacts.map(([chapterNum, chapterFacts]) => (
                <div key={chapterNum} className="space-y-3">
                  <div className="sticky top-[148px] z-10 rounded-xl border border-black/5 bg-background/92 px-3 py-2 text-xs font-medium text-text/50 backdrop-blur dark:border-white/5">
                    {t('facts.chapterGroup', { num: chapterNum })} ({chapterFacts.length})
                  </div>
                  {chapterFacts.map(fact => (
                    <div key={fact.id} className="flex items-start gap-2">
                      {batch.batchMode ? (
                        <input
                          type="checkbox"
                          className="mt-4 accent-accent shrink-0"
                          checked={batch.selectedIds.has(fact.id)}
                          onChange={() => batch.toggleSelect(fact.id)}
                        />
                      ) : null}
                      <div className="flex-1 cursor-pointer" onClick={() => editor.setEditingFact(fact)}>
                        <FactCard fact={{ ...fact, weight: fact.narrative_weight || 'medium', chapter: fact.chapter || 1 }} />
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
            {factsFilter.hasMoreFacts && (
              <div className="flex justify-center py-4">
                <Button tone="neutral" fill="plain" size="sm" onClick={() => factsFilter.setVisibleCount(prev => prev + FACTS_PAGE_SIZE)}>
                  {t('facts.loadMore', { remaining: factsFilter.filteredFacts.length - factsFilter.visibleCount })}
                </Button>
              </div>
            )}
          </div>
        </div>
        {sharedModals}
      </>
    );
  }

  return (
    <>
      <div className="w-[360px] md:w-[420px] shrink-0 border-r border-black/10 dark:border-white/10 flex flex-col bg-surface/50 h-full relative">
        <header className="p-5 border-b border-black/10 dark:border-white/10 flex flex-col gap-4 shrink-0 bg-surface">
          <div className="flex justify-between items-center gap-3">
            <h1 className="font-serif text-xl font-bold">{t('facts.title')}</h1>
            <div className="flex items-center gap-2">
              <Button tone="neutral" fill="outline" size="sm" className="px-3 gap-1" onClick={extraction.handleExtractClick} disabled={extraction.extracting}>
                {extraction.extracting ? <Spinner size="md" /> : <Sparkles size={16} />}
                {extraction.extracting ? `${extraction.extractProgress}%` : t('common.actions.extractFacts')}
              </Button>
              <Button tone="accent" fill="solid" size="sm" className="px-3 shadow-md" onClick={() => editor.setAddModalOpen(true)}>
                {t('facts.createButton')}
              </Button>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2 text-text/50" size={16} />
              <Input
                className="pl-9 h-8 text-xs placeholder:text-xs"
                placeholder={t('common.search.facts')}
                value={factsFilter.filter}
                onChange={e => factsFilter.setFilter(e.target.value)}
              />
            </div>
            <Button
              tone={factsFilter.filterOpen || factsFilter.chapterFilter !== null || factsFilter.characterFilter ? 'accent' : 'neutral'} fill={factsFilter.filterOpen || factsFilter.chapterFilter !== null || factsFilter.characterFilter ? 'solid' : 'outline'}
              className="px-2.5 h-8 flex-shrink-0"
              title={t('facts.filterTitle')}
              onClick={() => factsFilter.setFilterOpen(!factsFilter.filterOpen)}
            >
              <Filter size={14} />
            </Button>
          </div>

          {factsFilter.filterOpen && (
            <div className="flex gap-2 items-center flex-wrap">
              <select
                value={factsFilter.chapterFilter ?? ''}
                onChange={e => factsFilter.setChapterFilter(e.target.value ? Number(e.target.value) : null)}
                className="h-7 rounded-md border border-black/10 dark:border-white/15 bg-background px-2 text-xs focus:ring-1 focus:ring-accent outline-none"
              >
                <option value="">{t('facts.filterAllChapters')}</option>
                {factsFilter.uniqueChapters.map(ch => (
                  <option key={ch} value={ch}>{t('facts.chapterGroup', { num: ch })}</option>
                ))}
              </select>
              <select
                value={factsFilter.characterFilter}
                onChange={e => factsFilter.setCharacterFilter(e.target.value)}
                className="h-7 rounded-md border border-black/10 dark:border-white/15 bg-background px-2 text-xs focus:ring-1 focus:ring-accent outline-none"
              >
                <option value="">{t('facts.filterAllCharacters')}</option>
                {factsFilter.uniqueCharacters.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {(factsFilter.chapterFilter !== null || factsFilter.characterFilter) && (
                <button
                  className="text-xs text-accent hover:underline"
                  onClick={() => { factsFilter.setChapterFilter(null); factsFilter.setCharacterFilter(''); }}
                >{t('facts.filterClear')}</button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <div className="flex gap-3 overflow-x-auto pb-1 text-xs font-sans whitespace-nowrap">
              <span className={`cursor-pointer font-medium border-b-2 pb-1 ${!factsFilter.statusFilter ? 'font-bold text-accent border-accent' : 'text-text/70 hover:text-text border-transparent'}`} onClick={() => factsFilter.setStatusFilter('')}>
                {t('facts.allTab')} ({totalCount})
              </span>
              <span className={`cursor-pointer font-medium border-b-2 pb-1 ${factsFilter.statusFilter === 'unresolved' ? 'font-bold text-accent border-accent' : 'text-text/70 hover:text-text border-transparent'}`} onClick={() => factsFilter.setStatusFilter('unresolved')}>
                {getEnumLabel('fact_status', 'unresolved', 'unresolved')} ({unresolvedCount})
              </span>
              <span className={`cursor-pointer font-medium border-b-2 pb-1 ${factsFilter.statusFilter === 'active' ? 'font-bold text-accent border-accent' : 'text-text/70 hover:text-text border-transparent'}`} onClick={() => factsFilter.setStatusFilter('active')}>
                {getEnumLabel('fact_status', 'active', 'active')} ({activeCount})
              </span>
              <span className={`cursor-pointer font-medium border-b-2 pb-1 ${factsFilter.statusFilter === 'resolved' ? 'font-bold text-accent border-accent' : 'text-text/70 hover:text-text border-transparent'}`} onClick={() => factsFilter.setStatusFilter('resolved')}>
                {getEnumLabel('fact_status', 'resolved', 'resolved')} ({resolvedCount})
              </span>
              <span className={`cursor-pointer font-medium border-b-2 pb-1 ${factsFilter.statusFilter === 'deprecated' ? 'font-bold text-accent border-accent' : 'text-text/70 hover:text-text border-transparent'}`} onClick={() => factsFilter.setStatusFilter('deprecated')}>
                {getEnumLabel('fact_status', 'deprecated', 'deprecated')} ({deprecatedCount})
              </span>
            </div>
            {factsFilter.statusFilter && (
              <p className="text-xs text-text/50 font-sans">{t(`facts.statusHint.${factsFilter.statusFilter}`)}</p>
            )}
          </div>
        </header>

        {/* 提取进度 */}
        {extraction.extracting && (
          <div className="mx-4 mt-3 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <Spinner size="sm" className="shrink-0 text-accent" />
                <span className="truncate text-text/70">{t('common.status.extracting')}</span>
                <span className="shrink-0 font-medium text-accent">{extraction.extractProgress}%</span>
              </div>
              <button
                type="button"
                className="shrink-0 rounded p-0.5 text-text/50 hover:text-error hover:bg-error/10 transition-colors"
                onClick={extraction.handleCancelExtraction}
                title={t('common.actions.cancel')}
              >
                <X size={14} />
              </button>
            </div>
            <ProgressBar percent={extraction.extractProgress} className="mt-1.5" />
          </div>
        )}

        {/* 过期提醒 */}
        {staleCount > 0 && !factsFilter.statusFilter && (
          <div className="mx-4 mt-3 flex items-center justify-between rounded-lg bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning">
            <span>💡 {t('facts.staleHint', { count: staleCount })}</span>
            <Button tone="neutral" fill="plain" size="sm" className="text-xs h-6 px-2" onClick={() => factsFilter.setStatusFilter('stale')}>{t('facts.staleView')}</Button>
          </div>
        )}

        {/* 批量操作栏 */}
        {factsFilter.filteredFacts.length > 0 && (
          <div className="mx-4 mt-2 flex items-center gap-3 text-xs text-text/70">
            <button className={`font-medium ${batch.batchMode ? 'text-accent' : 'text-text/50 hover:text-text/70'}`} onClick={() => { batch.setBatchMode(!batch.batchMode); if (batch.batchMode) { batch.setSelectedIds(new Set()); batch.setBatchMenuOpen(false); } }}>
              {batch.batchMode ? t('facts.batchExit') : t('facts.batchEnter')}
            </button>
            {batch.batchMode && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={batch.selectedIds.size > 0 && batch.selectedIds.size === factsFilter.filteredFacts.length} onChange={batch.toggleSelectAll} className="accent-accent" />
                {t('facts.batchSelect')}
              </label>
            )}
            {batch.selectedIds.size > 0 && (
              <>
                <span className="text-accent font-medium">{t('facts.batchSelected', { count: batch.selectedIds.size })}</span>
                <div className="relative">
                  <Button tone="neutral" fill="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => batch.setBatchMenuOpen(!batch.batchMenuOpen)} disabled={batch.batchProcessing}>
                    {t('facts.batchAction')} ▾
                  </Button>
                  {batch.batchMenuOpen && (
                    <div className="absolute top-7 left-0 z-20 bg-surface border border-black/10 dark:border-white/10 rounded-lg shadow-lg py-1 min-w-[160px]">
                      {(['deprecated', 'resolved', 'active', 'unresolved'] as const).map(s => (
                        <button key={s} className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/10 transition-colors" onClick={() => { batch.setBatchMenuOpen(false); batch.setBatchConfirm(s); }}>
                          {t(`facts.batchTo.${s}`)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-10"><Spinner size="lg" className="text-accent" /></div>
          ) : showEmptyNotes ? (
            <EmptyState
              compact
              icon={<BookOpenText size={28} />}
              title={t('emptyState.facts.title')}
              description={t('emptyState.facts.description')}
              actions={[
                {
                  key: 'add-fact',
                  element: (
                    <Button tone="accent" fill="solid" size="sm" onClick={() => editor.setAddModalOpen(true)}>
                      {t('common.actions.manualFact')}
                    </Button>
                  ),
                },
                {
                  key: 'extract-facts',
                  element: (
                    <Button tone="neutral" fill="outline" size="sm" onClick={extraction.handleExtractClick} disabled={extraction.extracting}>
                      {t('common.actions.extractFacts')}
                    </Button>
                  ),
                },
              ]}
            />
          ) : showNoSearchResult ? (
            <EmptyState
              compact
              icon={<Search size={28} />}
              title={t('facts.noSearchResultTitle')}
              description={t('facts.noSearchResultDescription')}
              actions={[
                {
                  key: 'add-first-fact',
                  element: (
                    <Button tone="accent" fill="solid" size="sm" onClick={() => editor.setAddModalOpen(true)}>
                      {t('common.actions.newNote')}
                    </Button>
                  ),
                },
              ]}
            />
          ) : (
            factsFilter.groupedFacts.map(([chapterNum, chapterFacts]) => (
              <div key={chapterNum}>
                <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm px-1 py-1.5 text-xs font-medium text-text/50 border-b border-black/5 dark:border-white/5">
                  {t('facts.chapterGroup', { num: chapterNum })} ({chapterFacts.length})
                </div>
                <div className="space-y-3 pt-2">
                  {chapterFacts.map(fact => (
                    <div key={fact.id} className="flex items-start gap-2">
                      {batch.batchMode && (
                        <input
                          type="checkbox"
                          className="mt-3 accent-accent shrink-0"
                          checked={batch.selectedIds.has(fact.id)}
                          onChange={() => batch.toggleSelect(fact.id)}
                        />
                      )}
                      <div className="flex-1 cursor-pointer" onClick={() => editor.setEditingFact(fact)}>
                        <FactCard fact={{ ...fact, weight: fact.narrative_weight || 'medium', chapter: fact.chapter || 1 }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
          {factsFilter.hasMoreFacts && (
            <div className="flex justify-center py-4">
              <Button tone="neutral" fill="plain" size="sm" onClick={() => factsFilter.setVisibleCount(prev => prev + FACTS_PAGE_SIZE)}>
                {t('facts.loadMore', { remaining: factsFilter.filteredFacts.length - factsFilter.visibleCount })}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-background relative h-full min-w-0">
        <header className="h-14 border-b border-black/10 dark:border-white/10 flex items-center px-6 justify-between shrink-0 bg-surface/30">
          {editor.editingFact ? (
            <>
              <span className="font-mono text-sm font-semibold opacity-70">
                {editor.editingFact.id.split('-')[0]} <span className="font-sans font-normal opacity-70 ml-2">{t('facts.editing')}</span>
              </span>
              <div className="flex gap-3 items-center">
                <Button tone="neutral" fill="plain" size="sm" className="h-8" onClick={() => editor.setEditingFact(null)}>{t('facts.cancelSelection')}</Button>
                <Button tone="accent" fill="solid" size="sm" className="h-8 w-24" onClick={editor.handleSaveFact} disabled={editor.savingFact}>
                  {editor.savingFact ? <Spinner size="sm" /> : editor.saveSuccess ? <><Check size={14} /> {t('facts.saved')}</> : t('common.actions.save')}
                </Button>
              </div>
            </>
          ) : (
            <span className="font-mono text-sm font-semibold opacity-40">{t('facts.unselected')}</span>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-8 lg:p-12 w-full max-w-3xl mx-auto space-y-8">
          {renderFactEditor(false)}
        </div>
      </div>

      {sharedModals}
    </>
  );
};
