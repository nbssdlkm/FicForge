// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Loader2, AlertCircle, Check } from 'lucide-react';
import { Tag } from '../shared/Tag';
import { useState, useEffect, useRef } from 'react';
import { resolveDirtyChapter } from '../../api/engine-client';
import { listFacts, extractFacts, addFact, type FactInfo, type ExtractedFactCandidate } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';

type FactDecision = 'keep' | 'deprecate';

export const DirtyModal = ({ isOpen, onClose, auPath, chapterNum, onResolved }: { isOpen: boolean, onClose: () => void, auPath: string, chapterNum: number, onResolved?: () => void }) => {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const activeContextRef = useRef({ auPath, chapterNum });
  activeContextRef.current = { auPath, chapterNum };
  const loadRequestIdRef = useRef(0);

  // Old facts
  const [oldFacts, setOldFacts] = useState<FactInfo[]>([]);
  const [decisions, setDecisions] = useState<Record<string, FactDecision>>({});
  const [loadingOld, setLoadingOld] = useState(false);

  // AI re-extracted candidates
  const [candidates, setCandidates] = useState<ExtractedFactCandidate[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set());
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  // Resolve
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      loadRequestIdRef.current += 1;
      setOldFacts([]);
      setDecisions({});
      setLoadingOld(false);
      setCandidates([]);
      setSelectedCandidates(new Set());
      setExtracting(false);
      setExtractError(null);
      setResolving(false);
      return;
    }
    if (!auPath || !chapterNum) return;

    const requestId = ++loadRequestIdRef.current;

    // Load old facts
    setLoadingOld(true);
    listFacts(auPath, undefined)
      .then(all => {
        if (requestId !== loadRequestIdRef.current) return;
        const chapterFacts = all.filter(f => f.chapter === chapterNum);
        setOldFacts(chapterFacts);
        const initial: Record<string, FactDecision> = {};
        chapterFacts.forEach(f => { initial[f.id] = 'keep'; });
        setDecisions(initial);
      })
      .catch(() => {})
      .finally(() => {
        if (requestId === loadRequestIdRef.current) setLoadingOld(false);
      });

    // AI extract (parallel)
    setExtracting(true);
    setExtractError(null);
    extractFacts(auPath, chapterNum)
      .then(res => {
        if (requestId !== loadRequestIdRef.current) return;
        setCandidates(res.facts || []);
        // Default: select all
        setSelectedCandidates(new Set((res.facts || []).map((_, i) => i)));
      })
      .catch(e => {
        if (requestId !== loadRequestIdRef.current) return;
        setExtractError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (requestId === loadRequestIdRef.current) setExtracting(false);
      });
  }, [isOpen, auPath, chapterNum]);

  const toggleCandidate = (idx: number) => {
    setSelectedCandidates(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const handleResolve = async () => {
    const requestAuPath = auPath;
    const requestChapter = chapterNum;
    setResolving(true);
    try {
      // 1. Resolve dirty: process old facts decisions + clear dirty flag
      const confirmedChanges = oldFacts.map(f => ({
        fact_id: f.id,
        action: decisions[f.id] || 'keep',
      }));
      await resolveDirtyChapter(auPath, chapterNum, confirmedChanges);

      // 2. Save selected new candidates (fault-tolerant: one failure doesn't block others)
      let failCount = 0;
      for (const idx of selectedCandidates) {
        const c = candidates[idx];
        if (!c) continue;
        const active = activeContextRef.current;
        if (active.auPath !== requestAuPath || active.chapterNum !== requestChapter) return;
        try {
          await addFact(auPath, chapterNum, {
            content_raw: c.content_raw,
            content_clean: c.content_clean,
            characters: c.characters,
            type: c.fact_type || c.type || 'plot_event',
            narrative_weight: c.narrative_weight || 'medium',
            status: c.status || 'active',
            timeline: c.timeline || '',
          });
        } catch {
          failCount++;
        }
      }

      const active = activeContextRef.current;
      if (active.auPath !== requestAuPath || active.chapterNum !== requestChapter) return;
      onClose();
      if (onResolved) onResolved();
      if (failCount > 0) {
        showError(new Error(t('dirty.saveFailed', { count: failCount })), t('error_messages.unknown'));
      }
    } catch (e: any) {
      const active = activeContextRef.current;
      if (active.auPath !== requestAuPath || active.chapterNum !== requestChapter) return;
      showError(e, t('error_messages.unknown'));
    } finally {
      const active = activeContextRef.current;
      if (active.auPath === requestAuPath && active.chapterNum === requestChapter) {
        setResolving(false);
      }
    }
  };

  const isLoading = loadingOld || extracting;
  const hasOldFacts = oldFacts.length > 0;
  const hasCandidates = candidates.length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={resolving ? () => {} : onClose}
      title={`${t('dirty.title')} — ${t('workspace.chapterItem', { num: chapterNum })}`}
    >
      <div className="space-y-5 mt-2">
        {/* Warning banner */}
        <div className="p-3 bg-warning/10 text-warning text-sm rounded-lg border border-warning/20 leading-relaxed font-sans">
          <strong>{t('dirty.warningTitle')}{t('common.labelColon')}</strong> {t('dirty.warningDescription')}
        </div>

        <div className="max-h-[55vh] overflow-y-auto space-y-5 pr-1">
          {/* Section 1: Old facts */}
          <div>
            <h3 className="text-xs font-medium text-text/70 mb-2">{t('dirty.oldFactsSection')}</h3>
            {loadingOld ? (
              <div className="flex items-center gap-2 py-4 justify-center text-text/50 text-sm">
                <Loader2 size={16} className="animate-spin" />
              </div>
            ) : !hasOldFacts ? (
              <p className="text-sm text-text/50 py-2">{t('dirty.noOldFacts')}</p>
            ) : (
              <div className="space-y-2">
                {oldFacts.map(f => (
                  <div key={f.id} className="border border-black/10 dark:border-white/10 rounded-lg p-3 bg-surface/50 space-y-2">
                    <div className="flex justify-between items-start gap-2">
                      <p className="text-sm font-serif leading-relaxed text-text flex-1">{f.content_clean || f.content_raw}</p>
                      <Tag tone={decisions[f.id] === 'deprecate' ? 'error' : 'warning'} className="px-2 shrink-0 text-xs">
                        {decisions[f.id] === 'deprecate' ? t('dirty.deprecateTag') : t('dirty.dirtyTag')}
                      </Tag>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        tone={decisions[f.id] === 'keep' ? 'accent' : 'neutral'}
                        fill={decisions[f.id] === 'keep' ? 'solid' : 'plain'}
                        size="sm" className="flex-1 h-11 text-sm md:h-7 md:text-xs"
                        onClick={() => setDecisions(prev => ({ ...prev, [f.id]: 'keep' }))}
                        disabled={resolving}
                      >{t('dirty.keep')}</Button>
                      <Button
                        tone={decisions[f.id] === 'deprecate' ? 'accent' : 'neutral'}
                        fill={decisions[f.id] === 'deprecate' ? 'solid' : 'plain'}
                        size="sm" className="flex-1 h-11 text-sm md:h-7 md:text-xs"
                        onClick={() => setDecisions(prev => ({ ...prev, [f.id]: 'deprecate' }))}
                        disabled={resolving}
                      >{t('dirty.deprecate')}</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: AI re-extracted candidates */}
          <div>
            <h3 className="text-xs font-medium text-text/70 mb-2">{t('dirty.newFactsSection')}</h3>
            {extracting ? (
              <div className="flex items-center gap-2 py-4 justify-center text-accent text-sm">
                <Loader2 size={16} className="animate-spin" />
                <span>{t('dirty.extracting')}</span>
              </div>
            ) : extractError ? (
              <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 rounded-lg text-sm">
                <AlertCircle size={14} className="shrink-0" />
                <span>{t('dirty.extractFailed')}</span>
              </div>
            ) : !hasCandidates ? (
              <p className="text-sm text-text/50 py-2">{t('dirty.noCandidates')}</p>
            ) : (
              <div className="space-y-2">
                {candidates.map((c, idx) => (
                  <label key={idx} className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition-colors ${selectedCandidates.has(idx) ? 'border-accent/40 bg-accent/5' : 'border-black/10 dark:border-white/10 bg-surface/30'}`}>
                    <input
                      type="checkbox"
                      checked={selectedCandidates.has(idx)}
                      onChange={() => toggleCandidate(idx)}
                      disabled={resolving}
                      className="mt-1 accent-accent w-4 h-4 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-serif leading-relaxed text-text">{c.content_clean || c.content_raw}</p>
                      {c.characters && c.characters.length > 0 && (
                        <p className="text-xs text-text/50 mt-1">{c.characters.join(', ')}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Confirm button */}
        <div className="border-t border-black/10 dark:border-white/10 pt-4">
          <Button
            tone="accent" fill="solid"
            className="w-full h-11 text-sm shadow-sm"
            onClick={handleResolve}
            disabled={resolving || isLoading}
          >
            {resolving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <span className="flex flex-col items-center leading-tight">
                <span className="flex items-center gap-1.5"><Check size={15} /> {t('dirty.confirmResolve')}</span>
                <span className="text-xs opacity-80">{t('dirty.confirmResolveSubtitle')}</span>
              </span>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
