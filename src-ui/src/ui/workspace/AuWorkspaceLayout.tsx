// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect, useRef, useCallback } from 'react';
import { Spinner } from "../shared/Spinner";
import { Sidebar } from '../shared/Sidebar';
import { Button } from '../shared/Button';
import { EmptyState } from '../shared/EmptyState';
import { MilestoneGuide } from '../shared/MilestoneGuide';
import { Modal } from '../shared/Modal';
import { LogOut, BookOpen } from 'lucide-react';
import { WriterLayout } from '../writer/WriterLayout';
import { FactsLayout } from '../facts/FactsLayout';
import { AuLoreLayout } from '../library/AuLoreLayout';
import { AuSettingsLayout } from '../settings/AuSettingsLayout';
import { AnimatePresence, motion } from 'framer-motion';
import { rebuildIndex } from '../../api/engine-client';
import { listChapters, updateChapterTitle, type ChapterInfo } from '../../api/engine-client';
import { getState } from '../../api/engine-client';
import { listFacts, logCatch, type FactInfo } from '../../api/engine-client';
import { getProject } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { FeedbackProvider, useFeedback } from '../../hooks/useFeedback';
import { useMilestoneGuide } from '../../hooks/useMilestoneGuide';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { MobileLayout } from '../mobile/MobileLayout';

type Props = {
  activeTab: string;
  auPath: string;
  onNavigate: (page: string, path?: string) => void;
};

function AuWorkspaceLayoutInner({ activeTab, auPath, onNavigate }: Props) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const activeAuPathRef = useRef(auPath);
  activeAuPathRef.current = auPath;
  const loadWorkspaceRequestIdRef = useRef(0);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(false);

  const [milestoneRefreshKey, setMilestoneRefreshKey] = useState(0);

  const refreshChapters = useCallback(() => {
    listChapters(auPath).then(chs => { if (activeAuPathRef.current === auPath) setChapters(chs); }).catch((err) => logCatch('workspace', 'refreshChapters failed', err));
    setMilestoneRefreshKey(k => k + 1);
  }, [auPath]);

  const auName = auPath.split('/').pop() || t('common.unknownAu');
  const { shouldShow, dismiss } = useMilestoneGuide();

  // Milestone data (loaded once, from existing page data)
  const [currentChapter, setCurrentChapter] = useState(1);
  const [factsCount, setFactsCount] = useState(0);
  const [embeddingStale, setEmbeddingStale] = useState(false);
  const [embeddingDismissed, setEmbeddingDismissed] = useState(false);
  const [viewingChapter, setViewingChapter] = useState<number | null>(null);
  const [editingTitleNum, setEditingTitleNum] = useState<number | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const editingRef = useRef<{ num: number; original: string } | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current); }, []);
  const [pinnedCount, setPinnedCount] = useState(0);
  const [unresolvedFact, setUnresolvedFact] = useState<string | null>(null);
  const [chapterFocusEmpty, setChapterFocusEmpty] = useState(true);
  const [milestoneDismissed, setMilestoneDismissed] = useState<Record<string, boolean>>({});

  const dismissMilestone = (id: string) => {
    dismiss(id);
    setMilestoneDismissed(prev => ({ ...prev, [id]: true }));
  };

  useEffect(() => {
    if (!auPath) return;
    const requestId = ++loadWorkspaceRequestIdRef.current;
    const requestAuPath = auPath;
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    setLoadingChapters(true);
    setChapters([]);
    setCurrentChapter(1);
    setFactsCount(0);
    setEmbeddingStale(false);
    setEmbeddingDismissed(false);
    setPinnedCount(0);
    setUnresolvedFact(null);
    setChapterFocusEmpty(true);
    setViewingChapter(null);
    editingRef.current = null;
    setEditingTitleNum(null);
    setEditingTitleValue('');
    listChapters(auPath)
      .then((res) => {
        if (requestId !== loadWorkspaceRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;
        setChapters(res);
      })
      .catch(() => {})
      .finally(() => {
        if (requestId === loadWorkspaceRequestIdRef.current && activeAuPathRef.current === requestAuPath) {
          setLoadingChapters(false);
        }
      });

    // Embedding check (sub-task 5): check index_status
    getState(auPath).then(s => {
      if (requestId !== loadWorkspaceRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;
      if (s.index_status === 'stale' || s.index_status === 'interrupted') {
        setEmbeddingStale(true);
      }
    }).catch(() => {});
  }, [auPath]);

  // Milestone data — refreshes when auPath changes OR after mutations (refreshKey)
  useEffect(() => {
    if (!auPath) return;
    const anyMilestoneActive = shouldShow('facts_intro') || shouldShow('pinned_intro') || shouldShow('focus_intro');
    if (!anyMilestoneActive) return;

    getState(auPath).then(state => {
      if (activeAuPathRef.current !== auPath) return;
      setCurrentChapter(state.current_chapter || 1);
      setChapterFocusEmpty(!state.chapter_focus || state.chapter_focus.length === 0);
    }).catch(() => {});

    listFacts(auPath).then(facts => {
      if (activeAuPathRef.current !== auPath) return;
      setFactsCount(facts.length);
      const firstUnresolved = facts.find((f: FactInfo) => f.status === 'unresolved');
      setUnresolvedFact(firstUnresolved ? (firstUnresolved.content_clean || '').slice(0, 20) + '...' : null);
    }).catch(() => {});

    getProject(auPath).then(proj => {
      if (activeAuPathRef.current !== auPath) return;
      setPinnedCount((proj.pinned_context || []).length);
    }).catch(() => {});
  }, [auPath, milestoneRefreshKey, shouldShow]);

  // 里程碑 banner 在 mobile early return 之前计算，供 MobileLayout 渲染
  const milestoneElement = activeTab === 'writer' ? (() => {
    if (currentChapter >= 4 && factsCount < 2 && shouldShow('facts_intro') && !milestoneDismissed['facts_intro']) {
      return (
        <MilestoneGuide
          title={t('milestones.factsIntro.title')}
          description={t('milestones.factsIntro.desc')}
          primaryAction={{ label: t('milestones.factsIntro.extract'), onClick: () => { dismissMilestone('facts_intro'); onNavigate('facts', auPath); } }}
          secondaryAction={{ label: t('milestones.factsIntro.later'), onClick: () => dismissMilestone('facts_intro') }}
          onDismiss={() => dismissMilestone('facts_intro')}
        />
      );
    }
    if (currentChapter >= 6 && pinnedCount === 0 && shouldShow('pinned_intro') && !milestoneDismissed['pinned_intro']) {
      return (
        <MilestoneGuide
          title={t('milestones.pinnedIntro.title')}
          description={t('milestones.pinnedIntro.desc')}
          primaryAction={{ label: t('milestones.pinnedIntro.addPinned'), onClick: () => { dismissMilestone('pinned_intro'); onNavigate('settings', auPath); } }}
          secondaryAction={{ label: t('milestones.pinnedIntro.notNeeded'), onClick: () => dismissMilestone('pinned_intro') }}
          onDismiss={() => dismissMilestone('pinned_intro')}
        />
      );
    }
    if (unresolvedFact && chapterFocusEmpty && shouldShow('focus_intro') && !milestoneDismissed['focus_intro']) {
      return (
        <MilestoneGuide
          title={t('milestones.focusIntro.title', { content: unresolvedFact })}
          description={t('milestones.focusIntro.desc')}
          primaryAction={{ label: t('milestones.focusIntro.setFocus'), onClick: () => dismissMilestone('focus_intro') }}
          secondaryAction={{ label: t('milestones.focusIntro.freeStyle'), onClick: () => dismissMilestone('focus_intro') }}
          onDismiss={() => dismissMilestone('focus_intro')}
        />
      );
    }
    return null;
  })() : null;

  if (isMobile) {
    return (
      <MobileLayout
        activePage={activeTab as 'writer' | 'facts' | 'au_lore' | 'settings'}
        auPath={auPath}
        auName={auName}
        chapters={chapters}
        loadingChapters={loadingChapters}
        currentChapter={currentChapter}
        selectedChapter={viewingChapter}
        onNavigate={onNavigate}
        onSelectChapter={setViewingChapter}
        onClearViewChapter={() => setViewingChapter(null)}
        onChaptersChanged={refreshChapters}
        milestoneElement={milestoneElement}
      />
    );
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-background text-text font-sans transition-colors duration-200">
      <Sidebar
        position="left"
        width="260px"
        isCollapsed={leftCollapsed}
        onToggle={() => setLeftCollapsed(!leftCollapsed)}
        className="flex flex-col shrink-0 z-20 border-r border-black/10 dark:border-white/10"
      >
        <div className="p-4 border-b border-black/10 dark:border-white/10 flex flex-col gap-2 bg-surface">
          <div className="flex items-center justify-between">
            <div className="font-serif font-bold text-lg truncate max-w-[170px]" title={auName}>{t('common.scope.auTitle', { name: auName })}</div>
            <Button tone="neutral" fill="plain" size="sm" onClick={() => onNavigate('library')} className="h-8 w-8 p-0 rounded-full text-text/70 hover:text-text" title={t('common.actions.back')}>
              <LogOut size={16} />
            </Button>
          </div>
          <div className="text-xs text-text/50 font-sans font-medium">{t('navigation.workspace')}</div>
        </div>

        <div className="flex-1 flex flex-col pt-2 bg-surface/30 min-h-0">
          <div className="px-2 space-y-1 mb-4 border-b border-black/10 dark:border-white/10 pb-4 shrink-0">
            <Button tone="neutral" fill="plain" size="sm" className={`w-full justify-start font-medium transition-colors ${activeTab === 'writer' ? 'bg-black/5 dark:bg-white/5 text-text' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5'}`} onClick={() => onNavigate('writer', auPath)}>{t('writer.modeWrite')}</Button>
            <Button tone="neutral" fill="plain" size="sm" className={`w-full justify-start font-medium transition-colors ${activeTab === 'facts' ? 'bg-black/5 dark:bg-white/5 text-text' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5'}`} onClick={() => onNavigate('facts', auPath)}>{t('navigation.facts')}</Button>
            <Button tone="neutral" fill="plain" size="sm" className={`w-full justify-start font-medium transition-colors ${activeTab === 'au_lore' ? 'bg-black/5 dark:bg-white/5 text-text' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5'}`} onClick={() => onNavigate('au_lore', auPath)}>{t('navigation.auLore')}</Button>
            <Button tone="neutral" fill="plain" size="sm" className={`w-full justify-start font-medium transition-colors ${activeTab === 'settings' ? 'bg-black/5 dark:bg-white/5 text-text' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5'}`} onClick={() => onNavigate('settings', auPath)}>{t('navigation.settings')}</Button>
          </div>

          <div className="px-4 pb-2 text-xs font-sans font-medium text-text/50 shrink-0">
            {t('workspace.chaptersTitle')}
          </div>
          <div className="flex-1 overflow-y-auto px-2 space-y-1 pb-4">
            {loadingChapters ? (
              <div className="flex items-center justify-center py-4 text-text/50"><Spinner size="md" /></div>
            ) : chapters.length === 0 ? (
              <EmptyState
                compact
                icon={<BookOpen size={28} />}
                title={t('emptyState.chapters.title')}
                description={t('emptyState.chapters.description')}
                actions={[
                  {
                    key: 'start-writing',
                    element: (
                      <Button tone="accent" fill="solid" size="sm" onClick={() => onNavigate('writer', auPath)}>
                        {t('common.actions.startWriting')}
                      </Button>
                    ),
                  },
                ]}
              />
            ) : (
              chapters.map(ch => (
                <div
                  key={ch.chapter_num}
                  onClick={() => {
                    if (editingTitleNum === ch.chapter_num) return;
                    // Delay single click to distinguish from double click
                    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
                    clickTimerRef.current = setTimeout(() => {
                      setViewingChapter(ch.chapter_num); onNavigate('writer', auPath);
                    }, 250);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
                    editingRef.current = { num: ch.chapter_num, original: ch.title || '' };
                    setEditingTitleNum(ch.chapter_num);
                    setEditingTitleValue(ch.title || '');
                  }}
                  className={`px-3 py-2 rounded-md text-sm cursor-pointer transition-colors ${activeTab === 'writer' && viewingChapter === ch.chapter_num ? 'bg-accent/10 text-accent font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5 text-text/90'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="opacity-50 text-xs font-mono">#{ch.chapter_num}</span>
                    {editingTitleNum === ch.chapter_num ? (
                      <input
                        autoFocus
                        value={editingTitleValue}
                        onChange={(e) => setEditingTitleValue(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const ref = editingRef.current;
                            if (!ref) return;
                            const trimmed = editingTitleValue.trim();
                            try {
                              await updateChapterTitle(auPath, ref.num, trimmed);
                              refreshChapters();
                            } catch (err) { showError(err, t('error_messages.unknown')); return; }
                            editingRef.current = null;
                            setEditingTitleNum(null);
                          } else if (e.key === 'Escape') { editingRef.current = null; setEditingTitleNum(null); }
                        }}
                        onBlur={async () => {
                          const ref = editingRef.current;
                          if (!ref) { setEditingTitleNum(null); return; }
                          const trimmed = editingTitleValue.trim();
                          if (trimmed !== ref.original) {
                            try {
                              await updateChapterTitle(auPath, ref.num, trimmed);
                              refreshChapters();
                            } catch (err) { showError(err, t('error_messages.unknown')); }
                          }
                          editingRef.current = null;
                          setEditingTitleNum(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="flex-1 min-w-0 bg-transparent border-b border-accent/50 outline-none text-sm px-0 py-0"
                      />
                    ) : (
                      <span className="truncate">{ch.title || t('workspace.chapterItem', { num: ch.chapter_num })}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Sidebar>

      <div className="flex-1 flex flex-col overflow-hidden relative z-10 bg-background">
        {milestoneElement}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 15, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -15, filter: 'blur(4px)' }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="flex-1 flex w-full h-full overflow-hidden"
          >
            {activeTab === 'writer' && <WriterLayout auPath={auPath} onNavigate={onNavigate} viewChapter={viewingChapter} onClearViewChapter={() => setViewingChapter(null)} onChaptersChanged={refreshChapters} />}
            {activeTab === 'facts' && <FactsLayout auPath={auPath} />}
            {activeTab === 'au_lore' && <AuLoreLayout auPath={auPath} />}
            {activeTab === 'settings' && <AuSettingsLayout auPath={auPath} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Embedding stale modal (sub-task 5) */}
      <Modal isOpen={embeddingStale && !embeddingDismissed} onClose={() => setEmbeddingDismissed(true)} title={t('embedding.staleTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/90">{t('embedding.staleDesc')}</p>
          <div className="flex justify-end gap-2">
            <Button tone="neutral" fill="plain" onClick={() => setEmbeddingDismissed(true)}>{t('embedding.skipRebuild')}</Button>
            <Button tone="accent" fill="solid" onClick={() => { setEmbeddingDismissed(true); rebuildIndex(auPath).catch(() => {}); }}>{t('embedding.rebuild')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function AuWorkspaceLayout(props: Props) {
  return (
    <FeedbackProvider>
      <AuWorkspaceLayoutInner {...props} />
    </FeedbackProvider>
  );
}
