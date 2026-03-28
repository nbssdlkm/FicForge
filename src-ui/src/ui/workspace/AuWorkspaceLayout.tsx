import { useState, useEffect } from 'react';
import { Sidebar } from '../shared/Sidebar';
import { Button } from '../shared/Button';
import { LogOut, Loader2 } from 'lucide-react';
import { WriterLayout } from '../writer/WriterLayout';
import { FactsLayout } from '../facts/FactsLayout';
import { AuLoreLayout } from '../library/AuLoreLayout';
import { AuSettingsLayout } from '../settings/AuSettingsLayout';
import { AnimatePresence, motion } from 'framer-motion';
import { listChapters, type ChapterInfo } from '../../api/chapters';

export const AuWorkspaceLayout = ({ activeTab, auPath, onNavigate }: { activeTab: string, auPath: string, onNavigate: (page: string, path?: string) => void }) => {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(false);

  // Extract AU folder name from path (e.g. ./fandoms/aus/my_au -> my_au)
  const auName = auPath.split('/').pop() || 'Unknown AU';

  useEffect(() => {
    // Load chapters for the sidebar
    if (!auPath) return;
    setLoadingChapters(true);
    listChapters(auPath)
      .then(res => setChapters(res))
      .catch(() => setChapters([]))
      .finally(() => setLoadingChapters(false));
  }, [auPath]);

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-background text-text font-sans transition-colors duration-200">
      
      {/* Persistent Left Sidebar: Navigation & Chapters */}
      <Sidebar 
        position="left" 
        width="260px" 
        isCollapsed={leftCollapsed} 
        onToggle={() => setLeftCollapsed(!leftCollapsed)}
        className="flex flex-col shrink-0 z-20 border-r border-black/10 dark:border-white/10"
      >
        <div className="p-4 border-b border-black/10 dark:border-white/10 flex flex-col gap-2 bg-surface">
          <div className="flex items-center justify-between">
            <div className="font-serif font-bold text-lg truncate max-w-[170px]" title={auName}>{auName}</div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('library')} className="h-8 w-8 p-0 rounded-full text-text/60 hover:text-text" title="退出并返回首页作品库">
              <LogOut size={16} />
            </Button>
          </div>
          <div className="text-[10px] text-text/50 uppercase tracking-widest font-sans font-bold">AU 工作台 (Workspace)</div>
        </div>
        
        <div className="flex-1 flex flex-col pt-2 bg-surface/30 min-h-0">
          <div className="px-2 space-y-1 mb-4 border-b border-black/10 dark:border-white/10 pb-4 shrink-0">
             <Button variant="ghost" size="sm" className={`w-full justify-start font-medium transition-colors ${activeTab === 'writer' ? 'bg-black/5 dark:bg-white/5 text-text' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5'}`} onClick={() => onNavigate('writer', auPath)}><span className="text-text/60 mr-2">📖</span> 正文与分镜草稿</Button>
             <Button variant="ghost" size="sm" className={`w-full justify-start font-medium transition-colors ${activeTab === 'facts' ? 'bg-black/5 dark:bg-white/5 text-text' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5'}`} onClick={() => onNavigate('facts', auPath)}><span className="text-accent mr-2">🎯</span> 剧情事实交互表 (Facts)</Button>
             <Button variant="ghost" size="sm" className={`w-full justify-start font-medium transition-colors ${activeTab === 'au_lore' ? 'bg-black/5 dark:bg-white/5 text-text' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5'}`} onClick={() => onNavigate('au_lore', auPath)}><span className="text-info mr-2">✨</span> AU 专属设定树 (Lore)</Button>
             <Button variant="ghost" size="sm" className={`w-full justify-start font-medium transition-colors ${activeTab === 'settings' ? 'bg-black/5 dark:bg-white/5 text-text' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5'}`} onClick={() => onNavigate('settings', auPath)}><span className="text-text/50 mr-2">⚙️</span> 引擎全局策略栈</Button>
          </div>

          <div className="px-4 pb-2 text-[10px] font-sans font-bold text-text/40 uppercase tracking-widest shrink-0">
            连载章节导航 (Chapters)
          </div>
          <div className="flex-1 overflow-y-auto px-2 space-y-1 pb-4">
            {loadingChapters ? (
              <div className="flex items-center justify-center py-4 text-text/50"><Loader2 size={16} className="animate-spin" /></div>
            ) : chapters.length === 0 ? (
              <p className="text-text/40 text-xs text-center py-4">新建立的AU，暂无已确认的章节。</p>
            ) : (
              chapters.map(ch => (
                <div key={ch.chapter_num} onClick={() => onNavigate('writer', auPath)} className={`px-3 py-2 rounded-md text-sm cursor-pointer transition-colors ${activeTab === 'writer' ? 'bg-accent/10 text-accent font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5 text-text/80'}`}>
                  <div className="flex items-center gap-2">
                    <span className="opacity-50 text-xs font-mono">#{ch.chapter_num}</span>
                    <span className="truncate">第 {ch.chapter_num} 章</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Sidebar>

      {/* Main Content Pane */}
      <div className="flex-1 flex overflow-hidden relative z-10 bg-background">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 15, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -15, filter: 'blur(4px)' }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="flex-1 flex w-full h-full overflow-hidden"
          >
            {activeTab === 'writer' && <WriterLayout auPath={auPath} onNavigate={onNavigate} />}
            {activeTab === 'facts' && <FactsLayout auPath={auPath} />}
            {activeTab === 'au_lore' && <AuLoreLayout auPath={auPath} />}
            {activeTab === 'settings' && <AuSettingsLayout auPath={auPath} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};
