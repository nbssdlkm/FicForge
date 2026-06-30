// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect, useRef, useCallback } from 'react';
import { Spinner } from "../shared/Spinner";
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import { Sidebar } from '../shared/Sidebar';
import { Button } from '../shared/Button';
import { EmptyState } from '../shared/EmptyState';
import { MilestoneGuide } from '../shared/MilestoneGuide';
import { Modal } from '../shared/Modal';
import { LogOut, BookOpen } from 'lucide-react';
import { WriterLayout } from '../writer/WriterLayout';
import { FactsLayout } from '../facts/FactsLayout';
import { ThreadsLayout } from '../threads/ThreadsLayout';
import { AuLoreLayout } from '../library/AuLoreLayout';
import { AuSettingsLayout } from '../settings/AuSettingsLayout';
import { SimpleChatPanel } from '../simple/SimpleChatPanel';
import { AnimatePresence, motion } from 'framer-motion';
import { rebuildIndex } from '../../api/engine-client';
import { listChapters, updateChapterTitle, type ChapterInfo } from '../../api/engine-client';
import { getState } from '../../api/engine-client';
import { listFacts, logCatch, type FactInfo } from '../../api/engine-client';
import { getWorkspaceSnapshot } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { FeedbackProvider, useFeedback } from '../../hooks/useFeedback';
import { useMilestoneGuide } from '../../hooks/useMilestoneGuide';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { MobileLayout } from '../mobile/MobileLayout';
import { catchAndLog } from '../../utils/ui-logger';

type Props = {
  activeTab: string;
  auPath: string;
  onNavigate: (page: string, path?: string) => void;
};

function AuWorkspaceLayoutInner({ activeTab, auPath, onNavigate }: Props) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const loadGuard = useActiveRequestGuard(auPath);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(false);

  const [milestoneRefreshKey, setMilestoneRefreshKey] = useState(0);
  const fallbackAuName = auPath.split('/').pop() || t('common.unknownAu');
  const [auName, setAuName] = useState(fallbackAuName);

  const refreshChapters = useCallback(() => {
    listChapters(auPath).then(chs => { if (!loadGuard.isKeyStale(auPath)) setChapters(chs); }).catch((err) => logCatch('workspace', 'refreshChapters failed', err));
    setMilestoneRefreshKey(k => k + 1);
  }, [auPath, loadGuard]);
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
    const token = loadGuard.start();
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
    setAuName(fallbackAuName);
    setViewingChapter(null);
    editingRef.current = null;
    setEditingTitleNum(null);
    setEditingTitleValue('');
    listChapters(auPath)
      .then((res) => {
        if (loadGuard.isStale(token)) return;
        setChapters(res);
      })
      .catch(catchAndLog('workspace', 'listChapters failed'))
      .finally(() => {
        if (!loadGuard.isStale(token)) {
          setLoadingChapters(false);
        }
      });

    // Embedding check (sub-task 5): check index_status
    getState(auPath).then(s => {
      if (loadGuard.isStale(token)) return;
      if (s.index_status === 'stale' || s.index_status === 'interrupted') {
        setEmbeddingStale(true);
      }
    }).catch(catchAndLog('workspace', 'embedding check getState failed'));

    getWorkspaceSnapshot(auPath).then((snapshot) => {
      if (loadGuard.isStale(token)) return;
      setAuName(snapshot.au_name || fallbackAuName);
    }).catch(catchAndLog('workspace', 'getWorkspaceSnapshot failed'));
  }, [auPath, fallbackAuName, loadGuard]);

  // Milestone data — refreshes when auPath changes OR after mutations (refreshKey)
  useEffect(() => {
    if (!auPath) return;
    const anyMilestoneActive = shouldShow('facts_intro') || shouldShow('pinned_intro') || shouldShow('focus_intro');
    if (!anyMilestoneActive) return;

    getState(auPath).then(state => {
      if (loadGuard.isKeyStale(auPath)) return;
      setCurrentChapter(state.current_chapter || 1);
      setChapterFocusEmpty(!state.chapter_focus || state.chapter_focus.length === 0);
    }).catch(catchAndLog('workspace', 'milestone getState failed'));

    listFacts(auPath).then(facts => {
      if (loadGuard.isKeyStale(auPath)) return;
      setFactsCount(facts.length);
      const firstUnresolved = facts.find((f: FactInfo) => f.status === 'unresolved');
      setUnresolvedFact(firstUnresolved ? (firstUnresolved.content_clean || '').slice(0, 20) + '...' : null);
    }).catch(catchAndLog('workspace', 'milestone listFacts failed'));

    getWorkspaceSnapshot(auPath).then((snapshot) => {
      if (loadGuard.isKeyStale(auPath)) return;
      setPinnedCount(snapshot.pinned_count);
    }).catch(catchAndLog('workspace', 'milestone snapshot failed'));
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
        activePage={activeTab as 'writer' | 'chat' | 'facts' | 'threads' | 'au_lore' | 'settings'}
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
        className="flex flex-col shrink-0 z-20 border-r border-rule"
      >
        {/* Brand seal + AU name header — mirrors the Library topbar so the two
            surfaces read as parts of the same catalog */}
        <div className="flex flex-col gap-1 border-b border-rule bg-surface px-4 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                aria-hidden="true"
                className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border-[1.5px] border-accent"
              >
                <span className="font-display italic text-base font-semibold leading-none text-accent">
                  F
                </span>
                <span className="pointer-events-none absolute inset-[2.5px] rounded-[2px] border border-accent/50 opacity-60" />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="truncate font-display text-base font-semibold text-text" title={auName}>
                  {auName}
                </div>
                <div className="font-sans text-[10px] font-medium uppercase tracking-[0.18em] text-gold">
                  {t('navigation.workspace')}
                </div>
              </div>
            </div>
            <Button tone="neutral" fill="plain" size="sm" onClick={() => onNavigate('library')} className="h-8 w-8 shrink-0 rounded-full p-0 text-text/60 hover:text-text" title={t('common.actions.back')}>
              <LogOut size={16} />
            </Button>
          </div>
        </div>

        <div className="flex-1 flex flex-col pt-2 bg-surface/30 min-h-0">
          {/* 4 workspace tabs — gold left-bar marks the active one */}
          <div className="border-b border-rule px-2 pb-3 pt-1 shrink-0 space-y-0.5">
            {(
              [
                { key: 'chat' as const, label: t('simple.tabs.chat', { defaultValue: '对话' }) },
                { key: 'writer' as const, label: t('writer.modeWrite') },
                { key: 'facts' as const, label: t('navigation.facts') },
                { key: 'threads' as const, label: t('navigation.threads') },
                { key: 'au_lore' as const, label: t('navigation.auLore') },
                { key: 'settings' as const, label: t('navigation.settings') },
              ]
            ).map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <div key={tab.key} className="relative">
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-0 top-1.5 bottom-1.5 z-10 w-[2px] rounded-r bg-gold"
                    />
                  )}
                  <Button
                    tone="neutral"
                    fill="plain"
                    size="sm"
                    onClick={() => onNavigate(tab.key, auPath)}
                    className={`w-full justify-start font-medium transition-colors ${
                      isActive
                        ? 'bg-accent/10 text-accent hover:bg-accent/10 hover:text-accent'
                        : 'text-text/75 hover:bg-rule-soft hover:text-text'
                    }`}
                  >
                    {tab.label}
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2 px-4 pb-2 shrink-0 font-sans text-[10px] font-medium uppercase tracking-[0.18em] text-ink-faint">
            <span className="text-gold">◆</span>
            {t('workspace.chaptersTitle')}
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
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
              chapters.map(ch => {
                const isActive = activeTab === 'writer' && viewingChapter === ch.chapter_num;
                return (
                  <div key={ch.chapter_num} className="relative">
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-0 top-1.5 bottom-1.5 z-10 w-[2px] rounded-r bg-gold"
                      />
                    )}
                    <div
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
                      className={`cursor-pointer rounded-sm px-3 py-2 text-sm transition-colors ${
                        isActive
                          ? 'bg-accent/10 text-accent font-medium'
                          : 'text-text/85 hover:bg-rule-soft'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`shrink-0 font-mono text-[10px] tracking-[0.04em] ${isActive ? 'text-gold' : 'text-text/40'}`}>
                          № {String(ch.chapter_num).padStart(2, '0')}
                        </span>
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
                            className="min-w-0 flex-1 border-b border-accent/50 bg-transparent px-0 py-0 text-sm outline-none"
                          />
                        ) : (
                          <span className="truncate">{ch.title || t('workspace.chapterItem', { num: ch.chapter_num })}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
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
            {activeTab === 'chat' && <SimpleChatPanel auPath={auPath} />}
            {activeTab === 'writer' && (
              <WriterLayout auPath={auPath} onNavigate={onNavigate} viewChapter={viewingChapter} onClearViewChapter={() => setViewingChapter(null)} onChaptersChanged={refreshChapters} />
            )}
            {activeTab === 'facts' && <FactsLayout auPath={auPath} />}
            {activeTab === 'threads' && <ThreadsLayout auPath={auPath} />}
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
            <Button tone="accent" fill="solid" onClick={() => { setEmbeddingDismissed(true); rebuildIndex(auPath).catch((e) => showError(e, t('error_messages.unknown'))); }}>{t('embedding.rebuild')}</Button>
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
