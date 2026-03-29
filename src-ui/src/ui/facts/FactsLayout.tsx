import { useState, useEffect, useRef } from 'react';
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { FactCard } from './FactCard';
import { Modal } from '../shared/Modal';
import { Search, Plus, Filter, Loader2, AlertCircle, Check } from 'lucide-react';
import { listFacts, addFact, editFact, updateFactStatus, type FactInfo } from '../../api/facts';

export const FactsLayout = ({ auPath }: { auPath: string }) => {
  const [facts, setFacts] = useState<FactInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Edit mode — track mutable fields via refs to avoid re-render on each keystroke
  const [editingFact, setEditingFact] = useState<FactInfo | null>(null);
  const editContentCleanRef = useRef<HTMLTextAreaElement>(null);
  const editContentRawRef = useRef<HTMLTextAreaElement>(null);
  const editCharactersRef = useRef<HTMLInputElement>(null);
  const editWeightRef = useRef<HTMLSelectElement>(null);
  
  // Add modal state
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [newContentRaw, setNewContentRaw] = useState('');
  const [newContentClean, setNewContentClean] = useState('');
  const [newType, setNewType] = useState('plot_event');
  const [newWeight, setNewWeight] = useState('medium');
  const [newStatus, setNewStatus] = useState('active');

  const loadFacts = async () => {
    if (!auPath) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listFacts(auPath, statusFilter || undefined);
      setFacts(data);
    } catch (e: any) {
      setError(e.message || '加载失败');
      setFacts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadFacts(); }, [auPath, statusFilter]);

  const handleAddFact = async () => {
    if (!newContentClean.trim() || !auPath) return;
    try {
      await addFact(auPath, 1, {
        content_raw: newContentRaw || newContentClean,
        content_clean: newContentClean,
        type: newType,
        narrative_weight: newWeight,
        status: newStatus,
        characters: [],
      });
      setAddModalOpen(false);
      setNewContentRaw('');
      setNewContentClean('');
      await loadFacts();
    } catch (e: any) {
      setError(e.message || '添加失败');
    }
  };

  const handleStatusChange = async (factId: string, newStatus: string) => {
    if (!auPath) return;
    try {
      await updateFactStatus(auPath, factId, newStatus, 1);
      // Update locally to avoid full reload flinch if preferred, or just loadFacts
      await loadFacts();
      if (editingFact?.id === factId) {
        setEditingFact(prev => prev ? { ...prev, status: newStatus } : null);
      }
    } catch (e: any) {
      setError(e.message || '状态修改失败');
    }
  };

  const handleSaveFact = async () => {
    if (!editingFact || !auPath) return;
    setSaving(true);
    setSaveSuccess(false);
    try {
      const updatedFields: Record<string, any> = {};
      if (editContentCleanRef.current) updatedFields.content_clean = editContentCleanRef.current.value;
      if (editContentRawRef.current) updatedFields.content_raw = editContentRawRef.current.value;
      if (editCharactersRef.current) {
        updatedFields.characters = editCharactersRef.current.value
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
      }
      if (editWeightRef.current) updatedFields.narrative_weight = editWeightRef.current.value;
      await editFact(auPath, editingFact.id, updatedFields);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      await loadFacts();
      // Update editingFact with saved values
      setEditingFact(prev => prev ? { ...prev, ...updatedFields } : null);
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const filteredFacts = facts.filter(f => {
    if (filter && !f.content_clean.includes(filter) && !f.characters.join(',').includes(filter)) return false;
    return true;
  });

  const activeCount = filteredFacts.filter(f => f.status === 'active').length;
  const unresolvedCount = filteredFacts.filter(f => f.status === 'unresolved').length;

  return (
    <>
       {/* Left list */}
       <div className="w-[360px] md:w-[420px] shrink-0 border-r border-black/10 dark:border-white/10 flex flex-col bg-surface/50 h-full relative">
         <header className="p-5 border-b border-black/10 dark:border-white/10 flex flex-col gap-4 shrink-0 bg-surface">
           <div className="flex justify-between items-center">
             <div className="flex items-center gap-2">
                <h1 className="font-serif text-xl font-bold">🎯 剧情事实表</h1>
             </div>
             <Button variant="primary" size="sm" className="px-3 shadow-md gap-1" onClick={() => setAddModalOpen(true)}>
                <Plus size={16}/> 新建
             </Button>
           </div>
           
           <div className="flex gap-2">
             <div className="relative flex-1">
               <Search className="absolute left-2.5 top-2 text-text/50" size={16} />
               <Input 
                 className="pl-9 h-8 text-xs placeholder:text-xs" 
                 placeholder="搜索内容或关联角色..." 
                 value={filter}
                 onChange={e => setFilter(e.target.value)}
               />
             </div>
             <Button variant="secondary" className="px-2.5 h-8 flex-shrink-0" title="高级过滤"><Filter size={14}/></Button>
           </div>

           <div className="flex gap-3 overflow-x-auto pb-1 text-xs font-sans whitespace-nowrap">
             <span className={`cursor-pointer font-medium border-b-2 pb-1 ${!statusFilter ? 'font-bold text-accent border-accent' : 'text-text/60 hover:text-text border-transparent'}`} onClick={() => setStatusFilter('')}>全部 ({facts.length})</span>
             <span className={`cursor-pointer font-medium border-b-2 pb-1 ${statusFilter === 'unresolved' ? 'font-bold text-accent border-accent' : 'text-text/60 hover:text-text border-transparent'}`} onClick={() => setStatusFilter('unresolved')}>Unresolved ({unresolvedCount})</span>
             <span className={`cursor-pointer font-medium border-b-2 pb-1 ${statusFilter === 'active' ? 'font-bold text-accent border-accent' : 'text-text/60 hover:text-text border-transparent'}`} onClick={() => setStatusFilter('active')}>Active ({activeCount})</span>
           </div>
         </header>

         {error && (
            <div className="m-4 p-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded text-xs flex items-center gap-2">
              <AlertCircle size={14} /> {error}
            </div>
         )}

         <div className="flex-1 overflow-y-auto p-4 space-y-4">
           {loading ? (
             <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-accent" /></div>
           ) : filteredFacts.length === 0 ? (
             <div className="text-center text-xs text-text/40 py-10 space-y-2">
               <p>未找到符合条件的事实</p>
               <p>点击右上角「新建」按钮添加第一条剧情事实锚点。</p>
             </div>
           ) : (
             filteredFacts.map(f => (
               <div key={f.id} onClick={() => setEditingFact(f)}>
                 <FactCard
                   fact={{...f, weight: f.narrative_weight || 'medium', chapter: f.chapter || 1}}
                 />
               </div>
             ))
           )}
         </div>
       </div>

       {/* Right Editor */}
       <div className="flex-1 flex flex-col bg-background relative h-full min-w-0">
          <header className="h-14 border-b border-black/10 dark:border-white/10 flex items-center px-6 justify-between shrink-0 bg-surface/30">
            {editingFact ? (
              <>
                <span className="font-mono text-sm font-semibold opacity-70">
                  {editingFact.id.split('-')[0]} <span className="font-sans font-normal opacity-70 ml-2">正在编辑</span>
                </span>
                <div className="flex gap-3 items-center">
                   <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditingFact(null)}>取消选择</Button>
                   <Button variant="primary" size="sm" className="h-8 w-24" onClick={handleSaveFact} disabled={saving}>
                     {saving ? <Loader2 size={14} className="animate-spin" /> : saveSuccess ? <><Check size={14} /> 已保存</> : '保 存'}
                   </Button>
                </div>
              </>
            ) : (
              <span className="font-mono text-sm font-semibold opacity-40">未选择事实节点</span>
            )}
          </header>

          <div className="flex-1 overflow-y-auto p-8 lg:p-12 w-full max-w-3xl mx-auto space-y-8">
            {editingFact ? (
              <div key={editingFact.id}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold text-text/90">当前状态 (Status)</label>
                    <select 
                      className="h-10 rounded-md border border-black/20 dark:border-white/20 bg-surface px-3 text-sm focus:ring-2 focus:ring-accent outline-none font-sans font-medium text-accent"
                      value={editingFact.status}
                      onChange={(e) => handleStatusChange(editingFact.id, e.target.value)}
                    >
                      <option value="unresolved">Unresolved</option>
                      <option value="active">Active</option>
                      <option value="resolved">Resolved</option>
                      <option value="deprecated">Deprecated</option>
                    </select>
                    <p className="text-xs text-text/50">标记为 Resolved 将会停止该事实在后续章节中的高优推送。</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold text-text/90">叙事引力权重 (Narrative Weight)</label>
                    <select
                      ref={editWeightRef as any}
                      defaultValue={editingFact.narrative_weight || 'medium'}
                      className="h-10 rounded-md border border-black/20 dark:border-white/20 bg-surface px-3 text-sm focus:ring-2 focus:ring-accent outline-none font-mono text-accent font-bold"
                    >
                      <option value="low">低 (路人背景/日常细节)</option>
                      <option value="medium">中 (标准日常进展)</option>
                      <option value="high">高 (核心主线/不可违逆)</option>
                    </select>
                    <p className="text-xs text-text/50">权重越高，AI 在后续章节中越优先回忆此事实。"高"用于核心剧情锚点。</p>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-bold text-text/90">精简逻辑 (Content Clean)</label>
                  <Textarea ref={editContentCleanRef} defaultValue={editingFact.content_clean} className="font-serif min-h-[100px] text-lg leading-relaxed resize-y" />
                  <p className="text-xs text-text/50">供 AI 阅读和 Context 注入的结构化抽象事实，避免描写细节。</p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-bold text-text/90">章节出处摘录 (Content Raw)</label>
                  <Textarea ref={editContentRawRef} defaultValue={editingFact.content_raw} className="font-serif opacity-70 min-h-[140px] text-base leading-relaxed bg-surface/50 resize-y" />
                  <p className="text-xs text-text/50">仅供人类作者回溯参考，默认不会占用给 AI 注入的 token，允许大段堆叠。</p>
                </div>

                <div className="flex flex-col gap-2 pt-4 border-t border-black/10 dark:border-white/10">
                  <label className="text-sm font-bold text-text/90">涉及角色 (Characters)</label>
                  <Input ref={editCharactersRef} defaultValue={(editingFact.characters || []).join(', ')} className="h-10 text-sm" />
                  <p className="text-xs text-text/50">用逗号隔开对应的人名，能让角色独立检索时快速召回此事实。</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full opacity-30 mt-20 max-w-md mx-auto text-center space-y-3">
                <Search size={48} className="mb-2" />
                <p className="font-bold">在左侧列表中点击事实卡片以查看和编辑详情</p>
                <p className="text-xs leading-relaxed">
                  「剧情事实表」是 FicForge 保证 AI 不忘记关键剧情的核心机制。
                  每条事实会被注入章节生成的系统提示中，权重越高优先级越大。
                  建议将伏笔、人物关系转折、世界观硬设定等设为「高」权重。
                </p>
              </div>
            )}
          </div>
       </div>

       {/* Add Fact Modal */}
       <Modal isOpen={isAddModalOpen} onClose={() => setAddModalOpen(false)} title="注入新事实 (Add Fact)">
        <div className="space-y-4">
          <div className="space-y-1">
            <Textarea label="章节原文出处摘录 (Raw Content)" value={newContentRaw} onChange={e => setNewContentRaw(e.target.value)} placeholder={'例：第3章 —— 林深在雨中对叶澜说\u201c我不会再回来了\u201d，随后转身消失在巷口。'} className="min-h-[80px] bg-surface/50" />
            <p className="text-[11px] text-text/40">仅供作者回溯参考，不占用 AI 上下文 token。可粘贴原文大段。</p>
          </div>
          <div className="space-y-1">
            <Textarea label="AI 记忆用精简逻辑 (Clean Content) *" value={newContentClean} onChange={e => setNewContentClean(e.target.value)} placeholder="例：林深在第3章末与叶澜决裂并离开，叶澜不知其去向。" className="min-h-[80px] bg-surface/50 font-bold" />
            <p className="text-[11px] text-text/40">这段文字会注入 AI 系统提示。请用简洁第三人称陈述事实。</p>
          </div>
          
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-text/80 mb-1 block">事实归属类型</label>
              <select value={newType} onChange={e => setNewType(e.target.value)} className="w-full h-9 px-2 rounded-md border border-black/10 dark:border-white/10 bg-surface text-sm">
                <option value="plot_event">剧情事件</option>
                <option value="character_detail">角色细节</option>
                <option value="relationship">人物关系</option>
                <option value="foreshadowing">深埋伏笔</option>
                <option value="world_rule">物理/世界规则</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-text/80 mb-1 block">叙事引力权重</label>
              <select value={newWeight} onChange={e => setNewWeight(e.target.value)} className="w-full h-9 px-2 rounded-md border border-black/10 dark:border-white/10 bg-surface text-sm">
                <option value="low">低 (路人背景/日常细节)</option>
                <option value="medium">中 (标准日常进展)</option>
                <option value="high">高 (核心主线/不可违逆)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-text/80 mb-1 block">初始化状态</label>
              <select value={newStatus} onChange={e => setNewStatus(e.target.value)} className="w-full h-9 px-2 rounded-md border border-black/10 dark:border-white/10 bg-surface text-sm">
                <option value="active">Active (生效中)</option>
                <option value="unresolved">Unresolved (悬而未决的坑)</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-black/10 dark:border-white/10">
            <Button variant="ghost" onClick={() => setAddModalOpen(false)}>取消</Button>
            <Button variant="primary" onClick={handleAddFact} disabled={!newContentClean.trim()}>安全锚定</Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
