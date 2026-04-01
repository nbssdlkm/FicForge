import { useState, useEffect, useRef } from 'react';
import { Sidebar } from '../shared/Sidebar';
import { Button } from '../shared/Button';
import { EmptyState } from '../shared/EmptyState';
import { MilestoneGuide } from '../shared/MilestoneGuide';
import { Modal } from '../shared/Modal';
import { LogOut, Loader2, BookOpen } from 'lucide-react';
import { WriterLayout } from '../writer/WriterLayout';
import { FactsLayout } from '../facts/FactsLayout';
import { AuLoreLayout } from '../library/AuLoreLayout';
import { AuSettingsLayout } from '../settings/AuSettingsLayout';
import { AnimatePresence, motion } from 'framer-motion';
import { rebuildIndex } from '../../api/state';
import { listChapters, type ChapterInfo } from '../../api/chapters';
import { getState } from '../../api/state';
import { listFacts, type FactInfo } from '../../api/facts';
import { getProject } from '../../api/project';
import { useTranslation } from '../../i18n/useAppTranslation';
import { FeedbackProvider } from '../../hooks/useFeedback';
import { useMilestoneGuide } from '../../hooks/useMilestoneGuide';

type Props = {
  activeTab: string;
  auPath: string;
  onNavigate: (page: string, path?: string) => void;
};

function AuWorkspaceLayoutInner({ activeTab, auPath, onNavigate }: Props) {
  const { t } = useTranslation();
  const activeAuPathRef = useRef(auPath);
  activeAuPathRef.current = auPath;
  const loadWorkspaceRequestIdRef = useRef(0);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(false);

  const auName = auPath.split('/').pop() || t('common.unknownAu');
  const { shouldShow, dismiss } = useMilestoneGuide();

  // Milestone data (loaded once, from existing page data)
  const [currentChapter, setCurrentChapter] = useState(1);
  const [factsCount, setFactsCount] = useState(0);
  const [embeddingStale, setEmbeddingStale] = useState(false);
  const [embeddingDismissed, setEmbeddingDismissed] = useState(false);
  const [viewingChapter, setViewingChapter] = useState<number | null>(null);
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
    setLoadingChapters(true);
    setChapters([]);
    setCurrentChapter(1);
    setFactsCount(0);
    setEmbeddingStale(false);
    setPinnedCount(0);
    setUnresolvedFact(null);
    setChapterFocusEmpty(true);
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

    // Load milestone data only if any milestone is still active (avoid unnecessary API calls)
    const anyMilestoneActive = shouldShow('facts_intro') || shouldShow('pinned_intro') || shouldShow('focus_intro');
    if (anyMilestoneActive) {
      getState(auPath).then(state => {
        if (requestId !== loadWorkspaceRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;
        setCurrentChapter(state.current_chapter || 1);
        setChapterFocusEmpty(!state.chapter_focus || state.chapter_focus.length === 0);
      }).catch(() => {});

      listFacts(auPath).then(facts => {
        if (requestId !== loadWorkspaceRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;
        setFactsCount(facts.length);
        const firstUnresolved = facts.find((f: FactInfo) => f.status === 'unresolved');
        setUnresolvedFact(firstUnresolved ? (firstUnresolved.content_clean || '').slice(0, 20) + '...' : null);
      }).catch(() => {});

      getProject(auPath).then(proj => {
        if (requestId !== loadWorkspaceRequestIdRef.current || activeAuPathRef.current !== requestAuPath) return;
        setPinnedCount((proj.pinned_context || []).length);
      }).catch(() => {});
    }
  }, [auPath, shouldShow]);

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
            <Button variant="ghost" size="sm" onClick={() => onNavigate('library')} className="h-8 w-8 p-0 rounded-full text-text/60 hover:text-text" title={t('common.actions.back')}>
              <LogOut size={16} />
            </Button>
          </div>
          <div className="text-[10px] text-text/50 uppercase tracking-widest font-sans font-bold">{t('navigation.workspace')}</div>
        </div>

        <div className="flex-1 flex flex-col pt-2 bg-surface/30 min-h-0">
          <div className="px-2 space-y-1 mb-4 border-b border-black/10 dark:border-white/10 pb-4 shrink-0">
            <Button variant="ghost" size="sm" className={`w-full justify-start font-medium transition-colors ${activeTab === 'writer' ? 'bg-black/5 dark:bg-white/5 text-text' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5'}`} onClick={() => onNavigate('writer', auPath)}>{t('writer.modeWrite')}</Button>
            <Button variant="ghost" size="sm" className={`w-full justify-start font-medium transition-colors ${activeTab === 'facts' ? 'bg-black/5 dark:bg-white/5 text-text' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5'}`} onClick={() => onNavigate('facts', auPath)}><span className="text-accent mr-2">🎯</span> {t('navigation.facts')}</Button>
            <Button variant="ghost" size="sm" className={`w-full justify-start font-medium transition-colors ${activeTab === 'au_lore' ? 'bg-black/5 dark:bg-white/5 text-text' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5'}`} onClick={() => onNavigate('au_lore', auPath)}><span className="text-info mr-2">✨</span> {t('navigation.auLore')}</Button>
            <Button variant="ghost" size="sm" className={`w-full justify-start font-medium transition-colors ${activeTab === 'settings' ? 'bg-black/5 dark:bg-white/5 text-text' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5'}`} onClick={() => onNavigate('settings', auPath)}><span className="text-text/50 mr-2">⚙️</span> {t('navigation.settings')}</Button>
          </div>

          <div className="px-4 pb-2 text-[10px] font-sans font-bold text-text/40 uppercase tracking-widest shrink-0">
            {t('workspace.chaptersTitle')}
          </div>
          <div className="flex-1 overflow-y-auto px-2 space-y-1 pb-4">
            {loadingChapters ? (
              <div className="flex items-center justify-center py-4 text-text/50"><Loader2 size={16} className="animate-spin" /></div>
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
                      <Button variant="primary" size="sm" onClick={() => onNavigate('writer', auPath)}>
                        {t('common.actions.startWriting')}
                      </Button>
                    ),
                  },
                ]}
              />
            ) : (
              chapters.map(ch => (
                <div key={ch.chapter_num} onClick={() => { setViewingChapter(ch.chapter_num); onNavigate('writer', auPath); }} className={`px-3 py-2 rounded-md text-sm cursor-pointer transition-colors ${activeTab === 'writer' && viewingChapter === ch.chapter_num ? 'bg-accent/10 text-accent font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5 text-text/80'}`}>
                  <div className="flex items-center gap-2">
                    <span className="opacity-50 text-xs font-mono">#{ch.chapter_num}</span>
                    <span className="truncate">{t('workspace.chapterItem', { num: ch.chapter_num })}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Sidebar>

      <div className="flex-1 flex flex-col overflow-hidden relative z-10 bg-background">
        {/* Milestone banner (only on writer tab, show only the first triggered) */}
        {activeTab === 'writer' && (() => {
          // Priority order: M1 > M2 > M3. Show only one at a time.
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
        })()}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 15, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -15, filter: 'blur(4px)' }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="flex-1 flex w-full h-full overflow-hidden"
          >
            {activeTab === 'writer' && <WriterLayout auPath={auPath} onNavigate={onNavigate} viewChapter={viewingChapter} onClearViewChapter={() => setViewingChapter(null)} />}
            {activeTab === 'facts' && <FactsLayout auPath={auPath} />}
            {activeTab === 'au_lore' && <AuLoreLayout auPath={auPath} />}
            {activeTab === 'settings' && <AuSettingsLayout auPath={auPath} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Embedding stale modal (sub-task 5) */}
      <Modal isOpen={embeddingStale && !embeddingDismissed} onClose={() => setEmbeddingDismissed(true)} title={t('embedding.staleTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-text/80">{t('embedding.staleDesc')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEmbeddingDismissed(true)}>{t('embedding.skipRebuild')}</Button>
            <Button variant="primary" onClick={() => { setEmbeddingDismissed(true); rebuildIndex(auPath).catch(() => {}); }}>{t('embedding.rebuild')}</Button>
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
