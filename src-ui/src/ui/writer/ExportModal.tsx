import { useState } from 'react';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { FileUp } from 'lucide-react';

export const ExportModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const [format, setFormat] = useState('md');
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleExport = () => {
    setExporting(true);
    // Mock progress interpolation
    let p = 0;
    const interval = setInterval(() => {
      p += 20;
      setProgress(p);
      if (p >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          setExporting(false);
          setProgress(0);
          onClose(); // Auto-close when done
        }, 500);
      }
    }, 200);
  };

  return (
    <Modal isOpen={isOpen} onClose={exporting ? () => {} : onClose} title="导出当前作品 (Export)">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 mt-2">
          <label className="text-sm font-bold text-text/90">选择导出格式</label>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer hover:opacity-80">
              <input type="radio" name="exportFmt" checked={format === 'md'} onChange={() => setFormat('md')} className="text-accent focus:ring-accent accent-accent w-4 h-4" />
              Markdown 原生格式 (.md)
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer hover:opacity-80">
              <input type="radio" name="exportFmt" checked={format === 'txt'} onChange={() => setFormat('txt')} className="text-accent focus:ring-accent accent-accent w-4 h-4" />
              纯文本格式 (.txt)
            </label>
          </div>
          <p className="text-xs text-text/50">导出内容将无缝拼接所有已保存的历史章节，排除草稿信息。</p>
        </div>
        
        {exporting ? (
          <div className="space-y-2 p-2 bg-surface rounded-lg">
            <div className="flex justify-between text-xs font-mono text-text/60 font-bold">
              <span>正在写入本地系统 ...</span>
              <span className="text-success">{progress}%</span>
            </div>
            <div className="w-full bg-black/10 dark:bg-white/10 rounded-full h-2 overflow-hidden">
              <div className="bg-success h-2 rounded-full transition-all duration-200" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        ) : (
          <Button variant="primary" className="w-full gap-2 shadow-md" onClick={handleExport}>
            <FileUp size={16}/> 确认导出
          </Button>
        )}
      </div>
    </Modal>
  );
};
