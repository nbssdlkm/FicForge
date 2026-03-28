import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { ChevronDown, Plus, Loader2 } from 'lucide-react';
import { Tag } from '../shared/Tag';
import { useState } from 'react';
import { resolveDirtyChapter } from '../../api/chapters';

export const DirtyModal = ({ isOpen, onClose, auPath, chapterNum, onResolved }: { isOpen: boolean, onClose: () => void, auPath: string, chapterNum: number, onResolved?: () => void }) => {
  const [isResolving, setIsResolving] = useState(false);

  const handleResolve = async () => {
    setIsResolving(true);
    try {
      await resolveDirtyChapter(auPath, chapterNum, []);
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

        <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-2">
          {/* Mock Fact Items affected by editing */}
          <div className="border border-black/10 dark:border-white/10 rounded-lg p-4 space-y-4 bg-surface shadow-sm transition-all hover:border-warning/30">
             <div className="font-mono text-xs opacity-60 flex justify-between items-center">
                <span>FV-001 (基于本章抽取)</span>
                <Tag variant="warning" className="px-2">Dirty</Tag>
             </div>
             <p className="text-sm font-serif leading-relaxed text-text">主角在地下室发现了一枚带有家族徽章的戒指。</p>
             <div className="flex gap-3">
               <Button variant="ghost" size="sm" className="flex-1 border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10">保留原样</Button>
               <Button variant="secondary" size="sm" className="flex-[2] text-warning border-warning/30 hover:bg-warning/10 transition-colors">修改为受本次编辑影响后的新内容</Button>
             </div>
          </div>
        </div>

        <div>
          <Button variant="ghost" size="sm" className="w-full text-text/50 gap-1 hover:text-text/80 transition-colors"><ChevronDown size={14} /> 展开检索更多间接关联事实</Button>
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
