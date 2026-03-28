import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Plus, Loader2, AlertCircle } from 'lucide-react';
import { Tag } from '../shared/Tag';
import { useState, useEffect } from 'react';
import { resolveDirtyChapter } from '../../api/chapters';
import { listFacts, type FactInfo } from '../../api/facts';

type FactDecision = 'keep' | 'deprecate';

export const DirtyModal = ({ isOpen, onClose, auPath, chapterNum, onResolved }: { isOpen: boolean, onClose: () => void, auPath: string, chapterNum: number, onResolved?: () => void }) => {
  const [isResolving, setIsResolving] = useState(false);
  const [facts, setFacts] = useState<FactInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, FactDecision>>({});

  useEffect(() => {
    if (!isOpen || !auPath || chapterNum == null) return;
    setLoading(true);
    setError(null);
    listFacts(auPath, undefined)
      .then(all => {
        const chapterFacts = all.filter(f => f.chapter === chapterNum);
        setFacts(chapterFacts);
        const initial: Record<string, FactDecision> = {};
        chapterFacts.forEach(f => { initial[f.id] = 'keep'; });
        setDecisions(initial);
      })
      .catch(e => setError(e.message || '加载事实失败'))
      .finally(() => setLoading(false));
  }, [isOpen, auPath, chapterNum]);

  const setDecision = (factId: string, decision: FactDecision) => {
    setDecisions(prev => ({ ...prev, [factId]: decision }));
  };

  const handleResolve = async () => {
    setIsResolving(true);
    try {
      const confirmedChanges = facts.map(f => ({
        fact_id: f.id,
        action: decisions[f.id] || 'keep',
      }));
      await resolveDirtyChapter(auPath, chapterNum, confirmedChanges);
      onClose();
      if (onResolved) onResolved();
    } catch (e: any) {
      alert("处理失败: " + e.message);
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="事实变更审查 (Review Dirty Facts)">
      <div className="space-y-6 mt-2">
        <div className="p-4 bg-warning/10 text-warning text-sm rounded-lg border border-warning/20 leading-relaxed font-sans">
          <strong>状态异常 (Dirty)：</strong> 引擎检测到章节内容已发生人工直接修改。为了保证后续 AI 生成时的记忆一致性，请确认并修缮因此受波及的关键事实。
        </div>

        {error && (
          <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded text-sm flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-2">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-accent" /></div>
          ) : facts.length === 0 ? (
            <p className="text-center text-sm text-text/50 py-6">本章暂无关联事实。可直接解除 Dirty 状态。</p>
          ) : (
            facts.map(f => (
              <div key={f.id} className="border border-black/10 dark:border-white/10 rounded-lg p-4 space-y-4 bg-surface shadow-sm transition-all hover:border-warning/30">
                <div className="font-mono text-xs opacity-60 flex justify-between items-center">
                  <span>{f.id.substring(0, 12)}… (Ch.{f.chapter})</span>
                  <Tag variant={decisions[f.id] === 'deprecate' ? 'error' : 'warning'} className="px-2">
                    {decisions[f.id] === 'deprecate' ? '将废弃' : 'Dirty'}
                  </Tag>
                </div>
                <p className="text-sm font-serif leading-relaxed text-text">{f.content_clean || f.content_raw}</p>
                <div className="flex gap-3">
                  <Button
                    variant={decisions[f.id] === 'keep' ? 'primary' : 'ghost'}
                    size="sm"
                    className="flex-1 border border-black/10 dark:border-white/10"
                    onClick={() => setDecision(f.id, 'keep')}
                  >
                    保留
                  </Button>
                  <Button
                    variant={decisions[f.id] === 'deprecate' ? 'primary' : 'ghost'}
                    size="sm"
                    className="flex-1 border border-black/10 dark:border-white/10"
                    onClick={() => setDecision(f.id, 'deprecate')}
                  >
                    废弃
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-black/10 dark:border-white/10 pt-5 space-y-3">
          <Button variant="secondary" className="w-full border-dashed border-accent/40 text-accent gap-2 bg-accent/5 hover:bg-accent/10 transition-colors h-10">
             <Plus size={16}/> 提取本章编辑所产生的新衍生事实
          </Button>
          <Button variant="primary" className="w-full h-11 text-[15px] shadow-sm tracking-wide" onClick={handleResolve} disabled={isResolving}>
            {isResolving ? <Loader2 size={16} className="animate-spin" /> : "完成校对确认 并且解除全区 Dirty 锁定"}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
