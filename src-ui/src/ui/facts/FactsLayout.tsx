import { useState, useEffect, useRef } from 'react';
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { FactCard } from './FactCard';
import { Modal } from '../shared/Modal';
import { EmptyState } from '../shared/EmptyState';
import { Tag } from '../shared/Tag';
import { Search, Plus, Filter, Loader2, Check, Sparkles, BookOpenText } from 'lucide-react';
import { listFacts, addFact, editFact, updateFactStatus, extractFacts, type FactInfo } from '../../api/facts';
import { getState, type StateInfo } from '../../api/state';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';
import { useFeedback } from '../../hooks/useFeedback';

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
  const activeAuPathRef = useRef(auPath);
  activeAuPathRef.current = auPath;
  const loadFactsRequestIdRef = useRef(0);
  const [facts, setFacts] = useState<FactInfo[]>([]);
  const [state, setState] = useState<StateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [allFactsCounts, setAllFactsCounts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractModalOpen, setExtractModalOpen] = useState(false);
  const [extractedCandidates, setExtractedCandidates] = useState<ExtractedFactCandidate[]>([]);

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
        listFacts(auPath, statusFilter || undefined),
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
        setEditingFact(prev => prev ? { ...prev, status: nextStatus } : null);
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

  const handleExtract = async () => {
    const latestConfirmedChapter = (state?.current_chapter || 1) - 1;
    if (latestConfirmedChapter <= 0) {
      showToast(t('facts.extractNoChapter'), 'info');
      return;
    }

    const requestAuPath = auPath;
    setExtracting(true);
    try {
      const result = await extractFacts(requestAuPath, latestConfirmedChapter);
      if (activeAuPathRef.current !== requestAuPath) return;
      const candidates = (result?.facts || []) as ExtractedFactCandidate[];
      setExtractedCandidates(candidates);
      setExtractModalOpen(true);
      if (candidates.length === 0) {
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

  const filteredFacts = facts.filter((fact) => {
    if (!filter) return true;
    const keyword = filter.trim();
    return fact.content_clean.includes(keyword) || fact.characters.join(',').includes(keyword);
  });

  const totalCount = allFactsCounts.total ?? facts.length;
  const activeCount = allFactsCounts.active ?? 0;
  const unresolvedCount = allFactsCounts.unresolved ?? 0;
  const resolvedCount = allFactsCounts.resolved ?? 0;
  const deprecatedCount = allFactsCounts.deprecated ?? 0;
  const showEmptyNotes = !loading && facts.length === 0 && !filter && !statusFilter;
  const showNoSearchResult = !loading && filteredFacts.length === 0 && !showEmptyNotes;

  return (
    <>
      <div className="w-[360px] md:w-[420px] shrink-0 border-r border-black/10 dark:border-white/10 flex flex-col bg-surface/50 h-full relative">
        <header className="p-5 border-b border-black/10 dark:border-white/10 flex flex-col gap-4 shrink-0 bg-surface">
          <div className="flex justify-between items-center gap-3">
            <h1 className="font-serif text-xl font-bold">{t('facts.title')}</h1>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" className="px-3 gap-1" onClick={handleExtract} disabled={extracting}>
                {extracting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {t('common.actions.extractFacts')}
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
            <Button variant="secondary" className="px-2.5 h-8 flex-shrink-0" title={t('facts.filterTitle')}>
              <Filter size={14} />
            </Button>
          </div>

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
                    <Button variant="secondary" size="sm" onClick={handleExtract} disabled={extracting}>
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
            filteredFacts.map(fact => (
              <div key={fact.id} onClick={() => setEditingFact(fact)}>
                <FactCard fact={{ ...fact, weight: fact.narrative_weight || 'medium', chapter: fact.chapter || 1 }} />
              </div>
            ))
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
          {editingFact ? (
            <div key={editingFact.id}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-bold text-text/90">{t('common.labels.factStatus')}</label>
                  <select
                    className="h-10 rounded-md border border-black/20 dark:border-white/20 bg-surface px-3 text-sm focus:ring-2 focus:ring-accent outline-none font-sans font-medium text-accent"
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
                    className="h-10 rounded-md border border-black/20 dark:border-white/20 bg-surface px-3 text-sm focus:ring-2 focus:ring-accent outline-none font-mono text-accent font-bold"
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
                <Textarea ref={editContentCleanRef} defaultValue={editingFact.content_clean} className="font-serif min-h-[100px] text-lg leading-relaxed resize-y" />
                <p className="text-xs text-text/50">{t('facts.cleanHint')}</p>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-bold text-text/90">{t('common.labels.contentRaw')}</label>
                <Textarea ref={editContentRawRef} defaultValue={editingFact.content_raw} className="font-serif opacity-70 min-h-[140px] text-base leading-relaxed bg-surface/50 resize-y" />
                <p className="text-xs text-text/50">{t('facts.rawHint')}</p>
              </div>

              <div className="flex flex-col gap-2 pt-4 border-t border-black/10 dark:border-white/10">
                <label className="text-sm font-bold text-text/90">{t('common.labels.characters')}</label>
                <Input ref={editCharactersRef} defaultValue={(editingFact.characters || []).join(', ')} className="h-10 text-sm" />
                <p className="text-xs text-text/50">{t('facts.charactersHint')}</p>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<Search size={40} />}
              title={t('facts.emptySelectionTitle')}
              description={t('facts.emptySelectionDescription')}
            />
          )}
        </div>
      </div>

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

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-text/80 mb-1 block">{t('facts.createModal.typeLabel')}</label>
              <select value={newType} onChange={e => setNewType(e.target.value)} className="w-full h-9 px-2 rounded-md border border-black/10 dark:border-white/10 bg-surface text-sm">
                <option value="plot_event">{getEnumLabel('fact_type', 'plot_event', 'plot_event')}</option>
                <option value="character_detail">{getEnumLabel('fact_type', 'character_detail', 'character_detail')}</option>
                <option value="relationship">{getEnumLabel('fact_type', 'relationship', 'relationship')}</option>
                <option value="backstory">{getEnumLabel('fact_type', 'backstory', 'backstory')}</option>
                <option value="foreshadowing">{getEnumLabel('fact_type', 'foreshadowing', 'foreshadowing')}</option>
                <option value="world_rule">{getEnumLabel('fact_type', 'world_rule', 'world_rule')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-text/80 mb-1 block">{t('facts.createModal.weightLabel')}</label>
              <select value={newWeight} onChange={e => setNewWeight(e.target.value)} className="w-full h-9 px-2 rounded-md border border-black/10 dark:border-white/10 bg-surface text-sm">
                <option value="low">{getEnumLabel('narrative_weight', 'low', 'low')}</option>
                <option value="medium">{getEnumLabel('narrative_weight', 'medium', 'medium')}</option>
                <option value="high">{getEnumLabel('narrative_weight', 'high', 'high')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-text/80 mb-1 block">{t('facts.createModal.statusLabel')}</label>
              <select value={newStatus} onChange={e => setNewStatus(e.target.value)} className="w-full h-9 px-2 rounded-md border border-black/10 dark:border-white/10 bg-surface text-sm">
                <option value="active">{getEnumLabel('fact_status', 'active', 'active')}</option>
                <option value="unresolved">{getEnumLabel('fact_status', 'unresolved', 'unresolved')}</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-black/10 dark:border-white/10">
            <Button variant="ghost" onClick={() => setAddModalOpen(false)} disabled={adding}>{t('common.actions.cancel')}</Button>
            <Button variant="primary" onClick={handleAddFact} disabled={!newContentClean.trim() || adding}>
              {adding ? <Loader2 size={16} className="animate-spin" /> : t('facts.createModal.submit')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={extractModalOpen} onClose={() => setExtractModalOpen(false)} title={t('facts.extractReviewTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/70">{t('facts.extractReviewDescription')}</p>
          <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {extractedCandidates.length === 0 ? (
              <EmptyState compact icon={<Sparkles size={28} />} title={t('facts.extractReviewEmpty')} description={t('facts.extractNoResult')} />
            ) : (
              extractedCandidates.map((candidate, index) => {
                const candidateType = candidate.fact_type || candidate.type || 'plot_event';
                return (
                  <div key={`${candidate.content_clean}-${index}`} className="rounded-lg border border-black/10 bg-surface/40 p-4 space-y-3 dark:border-white/10">
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
                          <span key={character} className="text-xs text-accent/80 font-medium">@{character}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
            <Button variant="ghost" onClick={() => setExtractModalOpen(false)}>{t('common.actions.cancel')}</Button>
            <Button variant="primary" onClick={handleSaveExtracted} disabled={saving || extractedCandidates.length === 0}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : t('facts.extractSaveAll')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
