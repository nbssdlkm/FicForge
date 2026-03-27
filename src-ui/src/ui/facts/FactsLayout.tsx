import { useState, useEffect } from 'react';
import { Button } from '../shared/Button';
import { Tag } from '../shared/Tag';
import { Card } from '../shared/Card';
import { Modal } from '../shared/Modal';
import { Textarea } from '../shared/Input';
import { Plus, Loader2, ArrowLeft, Search } from 'lucide-react';
import { listFacts, addFact, updateFactStatus, type FactInfo } from '../../api/facts';

// TODO: au_path should come from navigation context
const AU_PATH = "./fandoms/fandoms/test/aus/test_au";

const STATUS_COLORS: Record<string, string> = {
  unresolved: 'warning',
  active: 'success',
  resolved: 'info',
  deprecated: 'default',
};

export const FactsLayout = ({ onNavigate }: { onNavigate: (page: string) => void }) => {
  const [facts, setFacts] = useState<FactInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [editingFact, setEditingFact] = useState<FactInfo | null>(null);

  // New fact form
  const [newContentRaw, setNewContentRaw] = useState('');
  const [newContentClean, setNewContentClean] = useState('');
  const [newType, setNewType] = useState('plot_event');
  const [newWeight, setNewWeight] = useState('medium');
  const [newStatus, setNewStatus] = useState('active');

  const loadFacts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listFacts(AU_PATH, statusFilter || undefined);
      setFacts(data);
    } catch (e: any) {
      setError(e.message || '加载失败');
      setFacts([]);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadFacts(); }, [statusFilter]);

  const handleAddFact = async () => {
    if (!newContentClean.trim()) return;
    try {
      await addFact(AU_PATH, 1, {
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
    try {
      await updateFactStatus(AU_PATH, factId, newStatus, 1);
      await loadFacts();
    } catch (e: any) {
      setError(e.message || '状态修改失败');
    }
  };

  const filteredFacts = facts.filter(f => {
    if (filter && !f.content_clean.includes(filter) && !f.characters.join(',').includes(filter)) return false;
    return true;
  });

  // Group by status
  const grouped = {
    unresolved: filteredFacts.filter(f => f.status === 'unresolved'),
    active: filteredFacts.filter(f => f.status === 'active'),
    resolved: filteredFacts.filter(f => f.status === 'resolved'),
    deprecated: filteredFacts.filter(f => f.status === 'deprecated'),
  };

  return (
    <div className="min-h-screen bg-background text-text font-sans">
      <header className="h-14 border-b border-black/10 dark:border-white/10 flex items-center justify-between px-6 bg-surface">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => onNavigate('writer')} className="h-8 w-8 p-0">
            <ArrowLeft size={16} />
          </Button>
          <h1 className="font-serif font-bold text-lg">事实表</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-text/40" />
            <input
              placeholder="搜索..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="h-9 pl-8 pr-3 rounded-lg border border-black/10 dark:border-white/10 bg-background text-sm focus:ring-2 focus:ring-accent/50 outline-none w-48"
            />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-background text-sm">
            <option value="">全部状态</option>
            <option value="unresolved">Unresolved</option>
            <option value="active">Active</option>
            <option value="resolved">Resolved</option>
            <option value="deprecated">Deprecated</option>
          </select>
          <Button onClick={() => setAddModalOpen(true)} size="sm">
            <Plus size={14} className="mr-1" /> 添加事实
          </Button>
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm">{error}</div>
      )}

      <main className="max-w-4xl mx-auto p-6 space-y-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-accent" size={24} />
          </div>
        ) : filteredFacts.length === 0 ? (
          <p className="text-center text-text/40 py-20">暂无事实条目</p>
        ) : (
          Object.entries(grouped).map(([status, items]) => items.length > 0 && (
            <section key={status}>
              <h2 className="text-sm font-medium text-text/60 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Tag variant={STATUS_COLORS[status] as any || 'default'}>{status}</Tag>
                <span className="text-text/40">({items.length})</span>
              </h2>
              <div className="space-y-2">
                {items.map(fact => (
                  <Card key={fact.id} className="p-4 cursor-pointer hover:border-accent/30 transition-colors" onClick={() => setEditingFact(fact)}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm">{fact.content_clean}</p>
                        <div className="flex items-center gap-2 mt-2 text-xs text-text/50">
                          <span>Ch.{fact.chapter}</span>
                          {fact.characters.length > 0 && <span>{fact.characters.join(', ')}</span>}
                          <Tag variant="default" className="text-[10px]">{fact.type}</Tag>
                          <Tag variant={fact.narrative_weight === 'high' ? 'error' : fact.narrative_weight === 'medium' ? 'warning' : 'default'} className="text-[10px]">
                            {fact.narrative_weight}
                          </Tag>
                        </div>
                      </div>
                      <select value={fact.status} onChange={e => { e.stopPropagation(); handleStatusChange(fact.id, e.target.value); }}
                        onClick={e => e.stopPropagation()}
                        className="text-xs h-7 px-2 rounded border border-black/10 dark:border-white/10 bg-background">
                        <option value="unresolved">unresolved</option>
                        <option value="active">active</option>
                        <option value="resolved">resolved</option>
                        <option value="deprecated">deprecated</option>
                      </select>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))
        )}
      </main>

      {/* Add Fact Modal */}
      <Modal isOpen={isAddModalOpen} onClose={() => setAddModalOpen(false)} title="添加事实">
        <div className="space-y-3">
          <Textarea label="描述（管理用）" value={newContentRaw} onChange={e => setNewContentRaw(e.target.value)} placeholder="第N章林深提到..." />
          <Textarea label="注入内容（AI 读取）" value={newContentClean} onChange={e => setNewContentClean(e.target.value)} placeholder="纯叙事描述..." />
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-text/60 mb-1 block">类型</label>
              <select value={newType} onChange={e => setNewType(e.target.value)} className="w-full h-8 px-2 rounded border border-black/10 dark:border-white/10 bg-background text-xs">
                <option value="plot_event">剧情事件</option>
                <option value="character_detail">角色细节</option>
                <option value="relationship">关系</option>
                <option value="foreshadowing">伏笔</option>
                <option value="backstory">背景</option>
                <option value="world_rule">世界规则</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-text/60 mb-1 block">权重</label>
              <select value={newWeight} onChange={e => setNewWeight(e.target.value)} className="w-full h-8 px-2 rounded border border-black/10 dark:border-white/10 bg-background text-xs">
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-text/60 mb-1 block">状态</label>
              <select value={newStatus} onChange={e => setNewStatus(e.target.value)} className="w-full h-8 px-2 rounded border border-black/10 dark:border-white/10 bg-background text-xs">
                <option value="active">Active</option>
                <option value="unresolved">Unresolved</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setAddModalOpen(false)}>取消</Button>
            <Button onClick={handleAddFact}>保存</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Fact Modal */}
      <Modal isOpen={!!editingFact} onClose={() => setEditingFact(null)} title="编辑事实">
        {editingFact && (
          <div className="space-y-3">
            <div className="text-sm text-text/70">ID: {editingFact.id}</div>
            <Textarea label="注入内容" defaultValue={editingFact.content_clean} />
            <p className="text-xs text-text/50">编辑功能将在完整 API 对接后可用。</p>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setEditingFact(null)}>关闭</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
