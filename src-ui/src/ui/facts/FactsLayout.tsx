// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { FactCard } from './FactCard';
import { Modal } from '../shared/Modal';
import { EmptyState } from '../shared/EmptyState';
import { Tag } from '../shared/Tag';
import { Search, Plus, Filter, Loader2, Check, Sparkles, BookOpenText } from 'lucide-react';
import { listFacts, addFact, editFact, updateFactStatus, batchUpdateFactStatus, extractFactsBatch, FactStatus, type FactInfo } from '../../api/engine-client';
import { getState, type StateInfo } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';
import { useFeedback } from '../../hooks/useFeedback';
import { useMediaQuery } from '../../hooks/useMediaQuery';

type ExtractedFactCandidate = {
  content_raw: string;
  content_clean: string;
  characters: string[];
  fact_type?: string;
  type?: string;
  narrative_weight: string;
  status: string;
  chapter: number;
  timeline?: string;
};

export const FactsLayout = ({ auPath }: { auPath: string }) => {
  const { t } = useTranslation();
  const { showError, showSuccess, showToast } = useFeedback();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const activeAuPathRef = useRef(auPath);
  activeAuPathRef.current = auPath;
  const loadFactsRequestIdRef = useRef(0);
  const [facts, setFacts] = useState<FactInfo[]>([]);
  const [state, setState] = useState<StateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [chapterFilter, setChapterFilter] = useState<number | null>(null);
  const [characterFilter, setCharacterFilter] = useState('');
  const [allFactsCounts, setAllFactsCounts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractModalOpen, setExtractModalOpen] = useState(false);
  const [extractedCandidates, setExtractedCandidates] = useState<ExtractedFactCandidate[]>([]);
  const [extractRangeOpen, setExtractRangeOpen] = useState(false);
  const [extractRange, setExtractRange] = useState<[number, number]>([1, 1]);
  const [extractProgress, setExtractProgress] = useState(0);

  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const [batchConfirm, setBatchConfirm] = useState<string | null>(null);
  const [batchProcessing, setBatchProcessing] = useState(false);

  const [editingFact, setEditingFact] = useState<FactInfo | null>(null);
  const editContentCleanRef = useRef<HTMLTextAreaElement>(null);
  const editContentRawRef = useRef<HTMLTextAreaElement>(null);
  const editCharactersRef = useRef<HTMLInputElement>(null);
  const editWeightRef = useRef<HTMLSelectElement>(null);

  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [newContentRaw, setNewContentRaw] = useState('');
  const [newContentClean, setNewContentClean] = useState('');
  const [newType, setNewType] = useState('plot_event');
  const [newWeight, setNewWeight] = useState('medium');
  const [newStatus, setNewStatus] = useState('active');

  const loadFacts = async () => {
    if (!auPath) return;
    const requestId = ++loadFactsRequestIdRef.current;
    const requestAuPath = auPath;
    setLoading(true);
    try {
      const [factsData, allFactsData, stateData] = await Promise.all([
        listFacts(auPath, (statusFilter && statusFilter !== 'stale') ? statusFilter : undefined),
        listFacts(auPath),
        getState(auPath).catch(() => null),
      ]);
      if (requestId !== loadFactsRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;
      setFacts(factsData);
      setState(stateData);
      const counts: Record<string, number> = { total: allFactsData.length };
      for (const f of allFactsData) {
        counts[f.status] = (counts[f.status] || 0) + 1;
      }
      setAllFactsCounts(counts);
    } catch (error) {
      if (requestId !== loadFactsRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (requestId === loadFactsRequestIdRef.current && activeAuPathRef.current === requestAuPath) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    activeAuPathRef.current = auPath;
    loadFactsRequestIdRef.current += 1;
    setLoading(true);
    setAdding(false);
    setSaving(false);
    setSaveSuccess(false);
    setExtracting(false);
    setFacts([]);
    setState(null);
    setEditingFact(null);
    setAddModalOpen(false);
    setExtractModalOpen(false);
    setExtractedCandidates([]);
    setChapterFilter(null);
    setCharacterFilter('');
    setFilterOpen(false);
  }, [auPath]);

  useEffect(() => {
    void loadFacts();
  }, [auPath, statusFilter]);

  const resetAddModal = () => {
    setNewContentRaw('');
    setNewContentClean('');
    setNewType('plot_event');
    setNewWeight('medium');
    setNewStatus('active');
  };

  const handleAddFact = async () => {
    if (!newContentClean.trim() || !auPath || adding) return;
    const requestAuPath = auPath;
    const chapterNum = Math.max(1, (state?.current_chapter || 1) - 1 || 1);
    setAdding(true);
    try {
      await addFact(requestAuPath, chapterNum, {
        content_raw: newContentRaw || newContentClean,
        content_clean: newContentClean,
        type: newType,
        narrative_weight: newWeight,
        status: newStatus,
        characters: [],
      });
      if (activeAuPathRef.current !== requestAuPath) return;
      setAddModalOpen(false);
      resetAddModal();
      await loadFacts();
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setAdding(false);
      }
    }
  };

  const handleStatusChange = async (factId: string, nextStatus: string) => {
    if (!auPath) return;
    const requestAuPath = auPath;
    const targetFact = facts.find((fact) => fact.id === factId);
    const chapterNum = targetFact?.chapter || editingFact?.chapter || 1;
    try {
      await updateFactStatus(requestAuPath, factId, nextStatus, chapterNum);
      if (activeAuPathRef.current !== requestAuPath) return;
      await loadFacts();
      if (editingFact?.id === factId) {
        setEditingFact(prev => prev ? { ...prev, status: nextStatus as FactStatus } : null);
      }
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    }
  };

  const handleSaveFact = async () => {
    if (!editingFact || !auPath) return;
    const requestAuPath = auPath;
    setSaving(true);
    setSaveSuccess(false);
    try {
      const updatedFields: Record<string, any> = {};
      if (editContentCleanRef.current) updatedFields.content_clean = editContentCleanRef.current.value;
      if (editContentRawRef.current) updatedFields.content_raw = editContentRawRef.current.value;
      if (editCharactersRef.current) {
        updatedFields.characters = editCharactersRef.current.value
          .split(',')
          .map((item: string) => item.trim())
          .filter(Boolean);
      }
      if (editWeightRef.current) updatedFields.narrative_weight = editWeightRef.current.value;

      await editFact(requestAuPath, editingFact.id, updatedFields);
      if (activeAuPathRef.current !== requestAuPath) return;
      setSaveSuccess(true);
      window.setTimeout(() => setSaveSuccess(false), 2000);
      await loadFacts();
      setEditingFact(prev => prev ? { ...prev, ...updatedFields } : null);
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setSaving(false);
      }
    }
  };

  const handleExtractClick = () => {
    const totalConfirmed = (state?.current_chapter || 1) - 1;
    if (totalConfirmed <= 0) {
      showToast(t('facts.extractNoChapter'), 'info');
      return;
    }
    setExtractRange([1, totalConfirmed]);
    setExtractRangeOpen(true);
  };

  const handleExtractConfirm = async () => {
    setExtractRangeOpen(false);
    const [from, to] = extractRange;

    const requestAuPath = auPath;
    setExtracting(true);
    setExtractProgress(0);
    try {
      const allCandidates: ExtractedFactCandidate[] = [];
      const totalChapters = to - from + 1;
      const batchSize = 3; // 每 3 章合并为一个 LLM 请求
      let done = 0;
      for (let start = from; start <= to; start += batchSize) {
        const chapterNums: number[] = [];
        for (let ch = start; ch <= Math.min(start + batchSize - 1, to); ch++) {
          chapterNums.push(ch);
        }
        const result = await extractFactsBatch(requestAuPath, chapterNums).catch(() => ({ facts: [] }));
        if (activeAuPathRef.current !== requestAuPath) return;
        allCandidates.push(...((result?.facts || []) as ExtractedFactCandidate[]));
        done += chapterNums.length;
        setExtractProgress(Math.round((done / totalChapters) * 100));
      }
      if (activeAuPathRef.current !== requestAuPath) return;
      setExtractedCandidates(allCandidates);
      setExtractModalOpen(true);
      if (allCandidates.length === 0) {
        showToast(t('facts.extractNoResult'), 'info');
      }
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setExtracting(false);
      }
    }
  };

  const handleSaveExtracted = async () => {
    if (extractedCandidates.length === 0) {
      setExtractModalOpen(false);
      return;
    }

    const requestAuPath = auPath;
    setSaving(true);
    try {
      for (const candidate of extractedCandidates) {
        await addFact(requestAuPath, candidate.chapter || 1, {
          content_raw: candidate.content_raw || candidate.content_clean,
          content_clean: candidate.content_clean,
          type: candidate.fact_type || candidate.type || 'plot_event',
          narrative_weight: candidate.narrative_weight || 'medium',
          status: candidate.status || 'active',
          characters: candidate.characters || [],
          ...(candidate.timeline ? { timeline: candidate.timeline } : {}),
        });
        if (activeAuPathRef.current !== requestAuPath) return;
      }

      showSuccess(t('facts.extractSaved', { count: extractedCandidates.length }));
      setExtractModalOpen(false);
      setExtractedCandidates([]);
      await loadFacts();
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (activeAuPathRef.current === requestAuPath) {
        setSaving(false);
      }
    }
  };

  // 从 facts 中动态提取唯一章节号和角色名
  const uniqueChapters = useMemo(() => [...new Set(facts.map(f => f.chapter))].sort((a, b) => a - b), [facts]);
  const uniqueCharacters = useMemo(() => [...new Set(facts.flatMap(f => f.characters))].sort(), [facts]);

  const FACTS_PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(FACTS_PAGE_SIZE);

  const filteredFacts = useMemo(() => facts.filter((fact) => {
    // 'stale' 伪筛选：客户端过滤超过 30 章的 active/unresolved facts
    if (statusFilter === 'stale') {
      if (fact.status !== 'active' && fact.status !== 'unresolved') return false;
      if ((state?.current_chapter || 1) - fact.chapter <= 30) return false;
    }
    // 章节筛选
    if (chapterFilter !== null && fact.chapter !== chapterFilter) return false;
    // 角色筛选
    if (characterFilter && !fact.characters.includes(characterFilter)) return false;
    // 文本搜索
    if (!filter) return true;
    const keyword = filter.trim();
    return fact.content_clean.includes(keyword) || fact.characters.join(',').includes(keyword);
  }), [facts, filter, statusFilter, chapterFilter, characterFilter, state?.current_chapter]);

  // Reset pagination when filters change
  useEffect(() => { setVisibleCount(FACTS_PAGE_SIZE); }, [filter, statusFilter, chapterFilter, characterFilter]);

  // Paginated slice of filteredFacts
  const paginatedFacts = useMemo(() => filteredFacts.slice(0, visibleCount), [filteredFacts, visibleCount]);
  const hasMoreFacts = filteredFacts.length > visibleCount;

  // 按章节分组（使用分页后的数据）
  const groupedFacts = useMemo(() => {
    const groups = new Map<number, FactInfo[]>();
    for (const f of paginatedFacts) {
      if (!groups.has(f.chapter)) groups.set(f.chapter, []);
      groups.get(f.chapter)!.push(f);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [paginatedFacts]);

  const totalCount = allFactsCounts.total ?? facts.length;
  const activeCount = allFactsCounts.active ?? 0;
  const unresolvedCount = allFactsCounts.unresolved ?? 0;
  const resolvedCount = allFactsCounts.resolved ?? 0;
  const deprecatedCount = allFactsCounts.deprecated ?? 0;
  const showEmptyNotes = !loading && facts.length === 0 && !filter && !statusFilter && chapterFilter === null && !characterFilter;
  const showNoSearchResult = !loading && filteredFacts.length === 0 && !showEmptyNotes;

  // 过期 facts 提醒（current_chapter - fact.chapter > 30）
  const currentChapter = state?.current_chapter || 1;
  const staleFacts = facts.filter(f => (f.status === 'active' || f.status === 'unresolved') && currentChapter - f.chapter > 30);
  const staleCount = staleFacts.length;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredFacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredFacts.map(f => f.id)));
    }
  };

  const handleBatchStatus = async (newStatus: string) => {
    setBatchConfirm(null);
    setBatchProcessing(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await batchUpdateFactStatus(auPath, ids, newStatus);
      showSuccess(t('facts.batchSuccess', { count: result.updated, status: getEnumLabel('fact_status', newStatus, newStatus) }));
      setSelectedIds(new Set());
      setBatchMenuOpen(false);
      await loadFacts();
    } catch (error) {
      showError(error, t('error_messages.unknown'));
    } finally {
      setBatchProcessing(false);
    }
  };

  const renderFactEditor = (showFooter: boolean) => {
    if (!editingFact) {
      return (
        <EmptyState
          icon={<Search size={40} />}
          title={t('facts.emptySelectionTitle')}
          description={t('facts.emptySelectionDescription')}
        />
      );
    }

    return (
      <div key={editingFact.id} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-text/90">{t('common.labels.factStatus')}</label>
            <select
              className="h-11 rounded-md border border-black/20 bg-surface px-3 text-base outline-none focus:ring-2 focus:ring-accent dark:border-white/20 md:h-10 md:text-sm"
              value={editingFact.status}
              onChange={(e) => handleStatusChange(editingFact.id, e.target.value)}
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
              ref={editWeightRef as any}
              defaultValue={editingFact.narrative_weight || 'medium'}
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
          <Textarea ref={editContentCleanRef} defaultValue={editingFact.content_clean} className="font-serif min-h-[160px] text-lg leading-relaxed resize-y" />
          <p className="text-xs text-text/50">{t('facts.cleanHint')}</p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-bold text-text/90">{t('common.labels.contentRaw')}</label>
          <Textarea ref={editContentRawRef} defaultValue={editingFact.content_raw} className="font-serif opacity-70 min-h-[140px] text-base leading-relaxed bg-surface/50 resize-y" />
          <p className="text-xs text-text/50">{t('facts.rawHint')}</p>
        </div>

        <div className="flex flex-col gap-2 border-t border-black/10 pt-4 dark:border-white/10">
          <label className="text-sm font-bold text-text/90">{t('common.labels.characters')}</label>
          <Input ref={editCharactersRef} defaultValue={(editingFact.characters || []).join(', ')} className="h-11 text-base md:h-10 md:text-sm" />
          <p className="text-xs text-text/50">{t('facts.charactersHint')}</p>
        </div>

        {showFooter ? (
          <div className="flex items-center justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
            <Button variant="ghost" onClick={() => setEditingFact(null)}>{t('facts.cancelSelection')}</Button>
            <Button variant="primary" onClick={handleSaveFact} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : saveSuccess ? <><Check size={14} className="mr-1" /> {t('facts.saved')}</> : t('common.actions.save')}
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
          isOpen={!!editingFact}
          onClose={saving ? () => {} : () => setEditingFact(null)}
          title={editingFact ? `${editingFact.id.split('-')[0]} ${t('facts.editing')}` : t('facts.editing')}
        >
          {renderFactEditor(true)}
        </Modal>
      ) : null}

      <Modal isOpen={isAddModalOpen} onClose={adding ? () => {} : () => setAddModalOpen(false)} title={t('facts.createModal.title')}>
        <div className="space-y-4">
          <div className="space-y-1">
            <Textarea
              label={t('common.labels.contentRaw')}
              value={newContentRaw}
              onChange={e => setNewContentRaw(e.target.value)}
              placeholder={t('facts.createModal.rawPlaceholder')}
              className="min-h-[80px] bg-surface/50"
            />
            <p className="text-[11px] text-text/40">{t('facts.rawHint')}</p>
          </div>
          <div className="space-y-1">
            <Textarea
              label={`${t('common.labels.contentClean')} *`}
              value={newContentClean}
              onChange={e => setNewContentClean(e.target.value)}
              placeholder={t('facts.createModal.cleanPlaceholder')}
              className="min-h-[80px] bg-surface/50 font-bold"
            />
            <p className="text-[11px] text-text/40">{t('facts.cleanHint')}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-text/80">{t('facts.createModal.typeLabel')}</label>
              <select value={newType} onChange={e => setNewType(e.target.value)} className="h-11 w-full rounded-md border border-black/10 bg-surface px-2 text-base dark:border-white/10 md:h-9 md:text-sm">
                <option value="plot_event">{getEnumLabel('fact_type', 'plot_event', 'plot_event')}</option>
                <option value="character_detail">{getEnumLabel('fact_type', 'character_detail', 'character_detail')}</option>
                <option value="relationship">{getEnumLabel('fact_type', 'relationship', 'relationship')}</option>
                <option value="backstory">{getEnumLabel('fact_type', 'backstory', 'backstory')}</option>
                <option value="foreshadowing">{getEnumLabel('fact_type', 'foreshadowing', 'foreshadowing')}</option>
                <option value="world_rule">{getEnumLabel('fact_type', 'world_rule', 'world_rule')}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-text/80">{t('facts.createModal.weightLabel')}</label>
              <select value={newWeight} onChange={e => setNewWeight(e.target.value)} className="h-11 w-full rounded-md border border-black/10 bg-surface px-2 text-base dark:border-white/10 md:h-9 md:text-sm">
                <option value="low">{getEnumLabel('narrative_weight', 'low', 'low')}</option>
                <option value="medium">{getEnumLabel('narrative_weight', 'medium', 'medium')}</option>
                <option value="high">{getEnumLabel('narrative_weight', 'high', 'high')}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-text/80">{t('facts.createModal.statusLabel')}</label>
              <select value={newStatus} onChange={e => setNewStatus(e.target.value)} className="h-11 w-full rounded-md border border-black/10 bg-surface px-2 text-base dark:border-white/10 md:h-9 md:text-sm">
                <option value="active">{getEnumLabel('fact_status', 'active', 'active')}</option>
                <option value="unresolved">{getEnumLabel('fact_status', 'unresolved', 'unresolved')}</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
            <Button variant="ghost" onClick={() => setAddModalOpen(false)} disabled={adding}>{t('common.actions.cancel')}</Button>
            <Button variant="primary" onClick={handleAddFact} disabled={!newContentClean.trim() || adding}>
              {adding ? <Loader2 size={16} className="animate-spin" /> : t('facts.createModal.submit')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={extractRangeOpen} onClose={() => setExtractRangeOpen(false)} title={t('facts.extractRangeTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/70">{t('facts.extractRangeDesc')}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto,96px,auto,96px,1fr] sm:items-center">
            <label className="text-sm text-text/70 shrink-0">{t('facts.extractFrom')}</label>
            <Input type="number" className="h-11 text-base md:h-8 md:text-sm" min={1} max={extractRange[1]} value={extractRange[0]} onChange={e => setExtractRange([Math.max(1, parseInt(e.target.value) || 1), extractRange[1]])} />
            <label className="text-sm text-text/70 shrink-0">{t('facts.extractTo')}</label>
            <Input type="number" className="h-11 text-base md:h-8 md:text-sm" min={extractRange[0]} value={extractRange[1]} onChange={e => setExtractRange([extractRange[0], parseInt(e.target.value) || extractRange[1]])} />
            <span className="text-xs text-text/40">{t('facts.extractChapterCount', { count: extractRange[1] - extractRange[0] + 1 })}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setExtractRangeOpen(false)}>{t('common.actions.cancel')}</Button>
            <Button variant="primary" onClick={handleExtractConfirm}>{t('facts.extractStart')}</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={extractModalOpen} onClose={saving ? () => {} : () => setExtractModalOpen(false)} title={t('facts.extractReviewTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/70">{t('facts.extractReviewDescription')}</p>
          <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {extractedCandidates.length === 0 ? (
              <EmptyState compact icon={<Sparkles size={28} />} title={t('facts.extractReviewEmpty')} description={t('facts.extractNoResult')} />
            ) : (
              extractedCandidates.map((candidate, index) => {
                const candidateType = candidate.fact_type || candidate.type || 'plot_event';
                return (
                  <div key={`${candidate.content_clean}-${index}`} className="space-y-3 rounded-lg border border-black/10 bg-surface/40 p-4 dark:border-white/10">
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag variant="info">{getEnumLabel('fact_type', candidateType, candidateType)}</Tag>
                      <Tag variant="warning">{getEnumLabel('narrative_weight', candidate.narrative_weight, candidate.narrative_weight)}</Tag>
                      <Tag variant="default">{getEnumLabel('fact_status', candidate.status, candidate.status)}</Tag>
                      <span className="text-xs text-text/50">{t('facts.extractSourceChapter', { chapter: candidate.chapter })}</span>
                    </div>
                    <p className="text-sm text-text/85">{candidate.content_clean}</p>
                    {candidate.characters.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {candidate.characters.map(character => (
                          <span key={character} className="text-xs font-medium text-accent/80">@{character}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
            <Button variant="ghost" onClick={() => setExtractModalOpen(false)} disabled={saving}>{t('common.actions.cancel')}</Button>
            <Button variant="primary" onClick={handleSaveExtracted} disabled={saving || extractedCandidates.length === 0}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : t('facts.extractSaveAll')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!batchConfirm} onClose={batchProcessing ? () => {} : () => setBatchConfirm(null)} title={t('facts.batchConfirmTitle', { count: selectedIds.size, status: batchConfirm ? getEnumLabel('fact_status', batchConfirm, batchConfirm) : '' })}>
        <div className="space-y-4">
          <p className="text-sm text-text/70">
            {batchConfirm === 'deprecated' && t('facts.batchDeprecatedDesc')}
            {batchConfirm === 'resolved' && t('facts.batchResolvedDesc')}
            {batchConfirm === 'active' && t('facts.batchActiveDesc')}
            {batchConfirm === 'unresolved' && t('facts.batchUnresolvedDesc')}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBatchConfirm(null)} disabled={batchProcessing}>{t('common.actions.cancel')}</Button>
            <Button variant="primary" onClick={() => batchConfirm && handleBatchStatus(batchConfirm)} disabled={batchProcessing}>
              {batchProcessing ? <Loader2 size={14} className="animate-spin" /> : t('common.actions.confirm')}
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
                <p className="text-sm text-text/55">{t('facts.subtitle')}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" className="px-3" onClick={handleExtractClick} disabled={extracting}>
                  {extracting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                </Button>
                <Button variant="primary" size="sm" className="px-3 shadow-md" onClick={() => setAddModalOpen(true)}>
                  <Plus size={16} className="mr-1" />
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
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                />
              </div>
              <Button
                variant={filterOpen || chapterFilter !== null || characterFilter ? 'primary' : 'secondary'}
                className="w-11 px-0"
                title={t('facts.filterTitle')}
                onClick={() => setFilterOpen(!filterOpen)}
              >
                <Filter size={16} />
              </Button>
            </div>

            {filterOpen ? (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <select
                  value={chapterFilter ?? ''}
                  onChange={e => setChapterFilter(e.target.value ? Number(e.target.value) : null)}
                  className="h-11 rounded-md border border-black/15 bg-background px-3 text-base outline-none focus:ring-1 focus:ring-accent dark:border-white/15 md:text-sm"
                >
                  <option value="">{t('facts.filterAllChapters')}</option>
                  {uniqueChapters.map(ch => (
                    <option key={ch} value={ch}>{t('facts.chapterGroup', { num: ch })}</option>
                  ))}
                </select>
                <select
                  value={characterFilter}
                  onChange={e => setCharacterFilter(e.target.value)}
                  className="h-11 rounded-md border border-black/15 bg-background px-3 text-base outline-none focus:ring-1 focus:ring-accent dark:border-white/15 md:text-sm"
                >
                  <option value="">{t('facts.filterAllCharacters')}</option>
                  {uniqueCharacters.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 text-sm whitespace-nowrap">
              <button
                type="button"
                className={`min-h-[44px] border-b-2 px-1 pb-1 font-medium ${!statusFilter ? 'border-accent text-accent' : 'border-transparent text-text/60'}`}
                onClick={() => setStatusFilter('')}
              >
                {t('facts.allTab')} ({totalCount})
              </button>
              <button
                type="button"
                className={`min-h-[44px] border-b-2 px-1 pb-1 font-medium ${statusFilter === 'unresolved' ? 'border-accent text-accent' : 'border-transparent text-text/60'}`}
                onClick={() => setStatusFilter('unresolved')}
              >
                {getEnumLabel('fact_status', 'unresolved', 'unresolved')} ({unresolvedCount})
              </button>
              <button
                type="button"
                className={`min-h-[44px] border-b-2 px-1 pb-1 font-medium ${statusFilter === 'active' ? 'border-accent text-accent' : 'border-transparent text-text/60'}`}
                onClick={() => setStatusFilter('active')}
              >
                {getEnumLabel('fact_status', 'active', 'active')} ({activeCount})
              </button>
              <button
                type="button"
                className={`min-h-[44px] border-b-2 px-1 pb-1 font-medium ${statusFilter === 'resolved' ? 'border-accent text-accent' : 'border-transparent text-text/60'}`}
                onClick={() => setStatusFilter('resolved')}
              >
                {getEnumLabel('fact_status', 'resolved', 'resolved')} ({resolvedCount})
              </button>
              <button
                type="button"
                className={`min-h-[44px] border-b-2 px-1 pb-1 font-medium ${statusFilter === 'deprecated' ? 'border-accent text-accent' : 'border-transparent text-text/60'}`}
                onClick={() => setStatusFilter('deprecated')}
              >
                {getEnumLabel('fact_status', 'deprecated', 'deprecated')} ({deprecatedCount})
              </button>
            </div>
          </header>

          {staleCount > 0 && !statusFilter ? (
            <div className="mx-4 mt-3 flex items-center justify-between rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">
              <span>💡 {t('facts.staleHint', { count: staleCount })}</span>
              <Button variant="ghost" size="sm" className="h-11 px-3 text-sm" onClick={() => setStatusFilter('stale')}>{t('facts.staleView')}</Button>
            </div>
          ) : null}

          {filteredFacts.length > 0 ? (
            <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 text-xs text-text/60">
              <button
                type="button"
                className={`min-h-[44px] font-medium ${batchMode ? 'text-accent' : 'text-text/40 hover:text-text/60'}`}
                onClick={() => { setBatchMode(!batchMode); if (batchMode) { setSelectedIds(new Set()); setBatchMenuOpen(false); } }}
              >
                {batchMode ? t('facts.batchExit') : t('facts.batchEnter')}
              </button>
              {batchMode ? (
                <label className="flex min-h-[44px] items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={selectedIds.size > 0 && selectedIds.size === filteredFacts.length} onChange={toggleSelectAll} className="accent-accent" />
                  {t('facts.batchSelect')}
                </label>
              ) : null}
              {selectedIds.size > 0 ? (
                <>
                  <span className="font-medium text-accent">{t('facts.batchSelected', { count: selectedIds.size })}</span>
                  <Button variant="secondary" size="sm" className="h-11 px-3 text-sm" onClick={() => setBatchMenuOpen(!batchMenuOpen)} disabled={batchProcessing}>
                    {t('facts.batchAction')} ▾
                  </Button>
                  {batchMenuOpen ? (
                    <div className="w-full rounded-lg border border-black/10 bg-surface p-1 dark:border-white/10">
                      {(['deprecated', 'resolved', 'active', 'unresolved'] as const).map(s => (
                        <button key={s} type="button" className="flex min-h-[44px] w-full items-center rounded-md px-3 py-2 text-left text-sm hover:bg-accent/10" onClick={() => { setBatchMenuOpen(false); setBatchConfirm(s); }}>
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
              <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-accent" /></div>
            ) : showEmptyNotes ? (
              <EmptyState
                compact
                icon={<BookOpenText size={28} />}
                title={t('emptyState.facts.title')}
                description={t('emptyState.facts.description')}
                actions={[
                  {
                    key: 'add-fact',
                    element: <Button variant="primary" size="sm" onClick={() => setAddModalOpen(true)}>{t('common.actions.manualFact')}</Button>,
                  },
                  {
                    key: 'extract-facts',
                    element: <Button variant="secondary" size="sm" onClick={handleExtractClick} disabled={extracting}>{t('common.actions.extractFacts')}</Button>,
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
                    element: <Button variant="primary" size="sm" onClick={() => setAddModalOpen(true)}>{t('common.actions.newNote')}</Button>,
                  },
                ]}
              />
            ) : (
              groupedFacts.map(([chapterNum, chapterFacts]) => (
                <div key={chapterNum} className="space-y-3">
                  <div className="sticky top-[148px] z-10 rounded-xl border border-black/5 bg-background/92 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text/50 backdrop-blur dark:border-white/5">
                    {t('facts.chapterGroup', { num: chapterNum })} ({chapterFacts.length})
                  </div>
                  {chapterFacts.map(fact => (
                    <div key={fact.id} className="flex items-start gap-2">
                      {batchMode ? (
                        <input
                          type="checkbox"
                          className="mt-4 accent-accent shrink-0"
                          checked={selectedIds.has(fact.id)}
                          onChange={() => toggleSelect(fact.id)}
                        />
                      ) : null}
                      <div className="flex-1 cursor-pointer" onClick={() => setEditingFact(fact)}>
                        <FactCard fact={{ ...fact, weight: fact.narrative_weight || 'medium', chapter: fact.chapter || 1 }} />
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
            {hasMoreFacts && (
              <div className="flex justify-center py-4">
                <Button variant="ghost" size="sm" onClick={() => setVisibleCount(prev => prev + FACTS_PAGE_SIZE)}>
                  {t('facts.loadMore', { remaining: filteredFacts.length - visibleCount })}
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
              <Button variant="secondary" size="sm" className="px-3 gap-1" onClick={handleExtractClick} disabled={extracting}>
                {extracting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {extracting ? `${extractProgress}%` : t('common.actions.extractFacts')}
              </Button>
              <Button variant="primary" size="sm" className="px-3 shadow-md gap-1" onClick={() => setAddModalOpen(true)}>
                <Plus size={16} />
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
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
            </div>
            <Button
              variant={filterOpen || chapterFilter !== null || characterFilter ? 'primary' : 'secondary'}
              className="px-2.5 h-8 flex-shrink-0"
              title={t('facts.filterTitle')}
              onClick={() => setFilterOpen(!filterOpen)}
            >
              <Filter size={14} />
            </Button>
          </div>

          {filterOpen && (
            <div className="flex gap-2 items-center flex-wrap">
              <select
                value={chapterFilter ?? ''}
                onChange={e => setChapterFilter(e.target.value ? Number(e.target.value) : null)}
                className="h-7 rounded-md border border-black/15 dark:border-white/15 bg-background px-2 text-xs focus:ring-1 focus:ring-accent outline-none"
              >
                <option value="">{t('facts.filterAllChapters')}</option>
                {uniqueChapters.map(ch => (
                  <option key={ch} value={ch}>{t('facts.chapterGroup', { num: ch })}</option>
                ))}
              </select>
              <select
                value={characterFilter}
                onChange={e => setCharacterFilter(e.target.value)}
                className="h-7 rounded-md border border-black/15 dark:border-white/15 bg-background px-2 text-xs focus:ring-1 focus:ring-accent outline-none"
              >
                <option value="">{t('facts.filterAllCharacters')}</option>
                {uniqueCharacters.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {(chapterFilter !== null || characterFilter) && (
                <button
                  className="text-[11px] text-accent hover:underline"
                  onClick={() => { setChapterFilter(null); setCharacterFilter(''); }}
                >{t('facts.filterClear')}</button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <div className="flex gap-3 overflow-x-auto pb-1 text-xs font-sans whitespace-nowrap">
              <span className={`cursor-pointer font-medium border-b-2 pb-1 ${!statusFilter ? 'font-bold text-accent border-accent' : 'text-text/60 hover:text-text border-transparent'}`} onClick={() => setStatusFilter('')}>
                {t('facts.allTab')} ({totalCount})
              </span>
              <span className={`cursor-pointer font-medium border-b-2 pb-1 ${statusFilter === 'unresolved' ? 'font-bold text-accent border-accent' : 'text-text/60 hover:text-text border-transparent'}`} onClick={() => setStatusFilter('unresolved')}>
                {getEnumLabel('fact_status', 'unresolved', 'unresolved')} ({unresolvedCount})
              </span>
              <span className={`cursor-pointer font-medium border-b-2 pb-1 ${statusFilter === 'active' ? 'font-bold text-accent border-accent' : 'text-text/60 hover:text-text border-transparent'}`} onClick={() => setStatusFilter('active')}>
                {getEnumLabel('fact_status', 'active', 'active')} ({activeCount})
              </span>
              <span className={`cursor-pointer font-medium border-b-2 pb-1 ${statusFilter === 'resolved' ? 'font-bold text-accent border-accent' : 'text-text/60 hover:text-text border-transparent'}`} onClick={() => setStatusFilter('resolved')}>
                {getEnumLabel('fact_status', 'resolved', 'resolved')} ({resolvedCount})
              </span>
              <span className={`cursor-pointer font-medium border-b-2 pb-1 ${statusFilter === 'deprecated' ? 'font-bold text-accent border-accent' : 'text-text/60 hover:text-text border-transparent'}`} onClick={() => setStatusFilter('deprecated')}>
                {getEnumLabel('fact_status', 'deprecated', 'deprecated')} ({deprecatedCount})
              </span>
            </div>
            {statusFilter && (
              <p className="text-[10px] text-text/40 font-sans">{t(`facts.statusHint.${statusFilter}`)}</p>
            )}
          </div>
        </header>

        {/* 过期提醒 */}
        {staleCount > 0 && !statusFilter && (
          <div className="mx-4 mt-3 flex items-center justify-between rounded-lg bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning">
            <span>💡 {t('facts.staleHint', { count: staleCount })}</span>
            <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={() => setStatusFilter('stale')}>{t('facts.staleView')}</Button>
          </div>
        )}

        {/* 批量操作栏 */}
        {filteredFacts.length > 0 && (
          <div className="mx-4 mt-2 flex items-center gap-3 text-xs text-text/60">
            <button className={`font-medium ${batchMode ? 'text-accent' : 'text-text/40 hover:text-text/60'}`} onClick={() => { setBatchMode(!batchMode); if (batchMode) { setSelectedIds(new Set()); setBatchMenuOpen(false); } }}>
              {batchMode ? t('facts.batchExit') : t('facts.batchEnter')}
            </button>
            {batchMode && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={selectedIds.size > 0 && selectedIds.size === filteredFacts.length} onChange={toggleSelectAll} className="accent-accent" />
                {t('facts.batchSelect')}
              </label>
            )}
            {selectedIds.size > 0 && (
              <>
                <span className="text-accent font-medium">{t('facts.batchSelected', { count: selectedIds.size })}</span>
                <div className="relative">
                  <Button variant="secondary" size="sm" className="h-6 px-2 text-xs" onClick={() => setBatchMenuOpen(!batchMenuOpen)} disabled={batchProcessing}>
                    {t('facts.batchAction')} ▾
                  </Button>
                  {batchMenuOpen && (
                    <div className="absolute top-7 left-0 z-20 bg-surface border border-black/10 dark:border-white/10 rounded-lg shadow-lg py-1 min-w-[160px]">
                      {(['deprecated', 'resolved', 'active', 'unresolved'] as const).map(s => (
                        <button key={s} className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/10 transition-colors" onClick={() => { setBatchMenuOpen(false); setBatchConfirm(s); }}>
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
            <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-accent" /></div>
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
                    <Button variant="primary" size="sm" onClick={() => setAddModalOpen(true)}>
                      {t('common.actions.manualFact')}
                    </Button>
                  ),
                },
                {
                  key: 'extract-facts',
                  element: (
                    <Button variant="secondary" size="sm" onClick={handleExtractClick} disabled={extracting}>
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
                    <Button variant="primary" size="sm" onClick={() => setAddModalOpen(true)}>
                      {t('common.actions.newNote')}
                    </Button>
                  ),
                },
              ]}
            />
          ) : (
            groupedFacts.map(([chapterNum, chapterFacts]) => (
              <div key={chapterNum}>
                <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm px-1 py-1.5 text-[11px] font-bold text-text/50 uppercase tracking-wider border-b border-black/5 dark:border-white/5">
                  {t('facts.chapterGroup', { num: chapterNum })} ({chapterFacts.length})
                </div>
                <div className="space-y-3 pt-2">
                  {chapterFacts.map(fact => (
                    <div key={fact.id} className="flex items-start gap-2">
                      {batchMode && (
                        <input
                          type="checkbox"
                          className="mt-3 accent-accent shrink-0"
                          checked={selectedIds.has(fact.id)}
                          onChange={() => toggleSelect(fact.id)}
                        />
                      )}
                      <div className="flex-1 cursor-pointer" onClick={() => setEditingFact(fact)}>
                        <FactCard fact={{ ...fact, weight: fact.narrative_weight || 'medium', chapter: fact.chapter || 1 }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
          {hasMoreFacts && (
            <div className="flex justify-center py-4">
              <Button variant="ghost" size="sm" onClick={() => setVisibleCount(prev => prev + FACTS_PAGE_SIZE)}>
                {t('facts.loadMore', { remaining: filteredFacts.length - visibleCount })}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-background relative h-full min-w-0">
        <header className="h-14 border-b border-black/10 dark:border-white/10 flex items-center px-6 justify-between shrink-0 bg-surface/30">
          {editingFact ? (
            <>
              <span className="font-mono text-sm font-semibold opacity-70">
                {editingFact.id.split('-')[0]} <span className="font-sans font-normal opacity-70 ml-2">{t('facts.editing')}</span>
              </span>
              <div className="flex gap-3 items-center">
                <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditingFact(null)}>{t('facts.cancelSelection')}</Button>
                <Button variant="primary" size="sm" className="h-8 w-24" onClick={handleSaveFact} disabled={saving}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : saveSuccess ? <><Check size={14} /> {t('facts.saved')}</> : t('common.actions.save')}
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
