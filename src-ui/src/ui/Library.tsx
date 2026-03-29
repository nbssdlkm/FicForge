import { useState, useEffect } from 'react';
import { Card } from './shared/Card';
import { Button } from './shared/Button';
import { ThemeToggle } from './shared/ThemeToggle';
import { Input, Textarea } from './shared/Input';
import { Settings, Plus, BookOpen, Clock, FileText, Loader2, Trash2 } from 'lucide-react';
import { Modal } from './shared/Modal';
import { GlobalSettingsModal } from './settings/GlobalSettingsModal';
import { listFandoms, createFandom, createAu, deleteFandom, deleteAu, type FandomInfo } from '../api/fandoms';

export const Library = ({ onNavigate }: { onNavigate: (page: string, auPath?: string) => void }) => {
  const [isFandomModalOpen, setFandomModalOpen] = useState(false);
  const [isAuModalOpen, setAuModalOpen] = useState(false);
  const [isGlobalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [fandoms, setFandoms] = useState<FandomInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newFandomName, setNewFandomName] = useState('');
  const [newAuName, setNewAuName] = useState('');
  const [selectedFandom, setSelectedFandom] = useState('');
  const [selectedFandomDir, setSelectedFandomDir] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'fandom' | 'au'; fandomDir: string; fandomName: string; auName?: string } | null>(null);

  useEffect(() => {
    loadFandoms();
  }, []);

  const loadFandoms = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listFandoms();
      setFandoms(data);
    } catch (e: any) {
      setError(e.message || '加载失败');
      setFandoms([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFandom = async () => {
    if (!newFandomName.trim()) return;
    try {
      await createFandom(newFandomName.trim());
      setFandomModalOpen(false);
      setNewFandomName('');
      await loadFandoms();
    } catch (e: any) {
      setError(e.message || '创建失败');
    }
  };

  const handleCreateAu = async () => {
    if (!newAuName.trim() || !selectedFandomDir) return;
    try {
      const fandomPath = `./fandoms/fandoms/${selectedFandomDir}`;
      await createAu(selectedFandomDir, newAuName.trim(), fandomPath);
      setAuModalOpen(false);
      setNewAuName('');
      await loadFandoms();
    } catch (e: any) {
      setError(e.message || '创建失败');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'fandom') {
        await deleteFandom(deleteTarget.fandomDir);
      } else {
        await deleteAu(deleteTarget.fandomDir, deleteTarget.auName!);
      }
      setDeleteTarget(null);
      await loadFandoms();
    } catch (e: any) {
      setError(e.message || '删除失败');
      setDeleteTarget(null);
    }
  };

  return (
    <div className="min-h-screen bg-background text-text flex flex-col font-sans transition-colors duration-200">
      <header className="h-16 border-b border-black/10 dark:border-white/10 flex items-center justify-between px-6 bg-surface transition-colors duration-200">
        <div className="flex items-center gap-2 font-serif text-xl font-bold">
          <BookOpen className="text-accent" />
          <span>FicForge</span>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={() => setGlobalSettingsOpen(true)} className="h-10 w-10 p-0 rounded-full" title="Global Settings">
            <Settings size={20} />
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-serif font-bold">作品库</h1>
          <Button onClick={() => setFandomModalOpen(true)} className="shadow-md">
            <Plus size={16} className="mr-2" /> 新建 Fandom 母树
          </Button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-accent" size={32} />
            <span className="ml-3 text-text/60">加载作品库…</span>
          </div>
        ) : fandoms.length === 0 ? (
          <div className="text-center py-20 text-text/50">
            <BookOpen size={48} className="mx-auto mb-4 opacity-30" />
            <p>还没有任何作品。点击上方按钮创建第一个 Fandom。</p>
          </div>
        ) : (
          <div className="space-y-12">
            {fandoms.map(fandom => (
              <div key={fandom.name}>
                <div className="flex items-center justify-between mb-4 border-b border-black/10 dark:border-white/10 pb-2">
                  <h2 className="text-xl font-sans font-semibold text-text/80 flex items-center gap-2">
                    <span className="opacity-50 text-accent text-sm">📚</span> {fandom.name}
                  </h2>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => onNavigate('fandom_lore', `./fandoms/fandoms/${fandom.dir_name}`)} className="bg-surface/80 border-black/10 dark:border-white/10 text-text/70">
                      <FileText size={14} className="mr-2 text-text/50" /> 本 Fandom 核心人物与世界观
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setSelectedFandom(fandom.name); setSelectedFandomDir(fandom.dir_name); setAuModalOpen(true); }}>
                      <Plus size={14} className="mr-1 text-accent" /> 新建衍生 AU
                    </Button>
                    <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => setDeleteTarget({ type: 'fandom', fandomDir: fandom.dir_name, fandomName: fandom.name })}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {fandom.aus.length === 0 ? (
                    <p className="text-text/40 text-sm col-span-3">暂无 AU，点击上方按钮创建</p>
                  ) : (
                    fandom.aus.map(au => (
                      <Card key={au} className="hover:border-accent/50 cursor-pointer transition-colors relative group" onClick={() => onNavigate('writer', `./fandoms/fandoms/${fandom.dir_name}/aus/${au}`)}>
                        <button
                          className="absolute top-2 right-2 p-1.5 rounded-md text-text/30 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'au', fandomDir: fandom.dir_name, fandomName: fandom.name, auName: au }); }}
                          title="删除此 AU"
                        >
                          <Trash2 size={14} />
                        </button>
                        <h3 className="text-lg font-sans font-medium mb-4">{au}</h3>
                        <div className="flex items-center justify-between text-sm text-text/60">
                          <span className="flex items-center gap-1"><BookOpen size={14} /> AU</span>
                          <span className="flex items-center gap-1"><Clock size={14} /> —</span>
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <Modal isOpen={isFandomModalOpen} onClose={() => setFandomModalOpen(false)} title="新建系列 (Fandom)">
        <p className="text-sm text-text/70 mb-5">输入您的新 Fandom 名称和设定基础，将作为整个创作树的独立根节点。</p>
        <div className="flex flex-col gap-4">
          <Input placeholder="Fandom 主名称 (如: Harry Potter)" value={newFandomName} onChange={(e) => setNewFandomName(e.target.value)} className="w-full h-10 bg-surface/50 text-base" />
          <Textarea placeholder="可选：贴入 Wiki 原文参考、起源设定或资料 URL，辅助首次世界观初始化。" className="w-full min-h-[120px] text-sm bg-surface/50 leading-relaxed resize-y" />
          <Button variant="primary" className="w-full h-10 mt-2 font-medium tracking-wide" onClick={handleCreateFandom}>建立 Fandom</Button>
        </div>
      </Modal>

      <Modal isOpen={isAuModalOpen} onClose={() => setAuModalOpen(false)} title="新建衍生分支 (Alternate Universe)">
        <p className="text-sm text-text/70 mb-5 leading-relaxed">设定一个新的平行宇宙或衍生同人世界。AU 相互隔离且支持独有的设定重载 (Overrides)。</p>
        <div className="flex flex-col gap-5">
          <Input placeholder="AU 主标题 (如: Cyberpunk Detective Dystopia)" value={newAuName} onChange={(e) => setNewAuName(e.target.value)} className="w-full h-10 bg-surface/50 text-base" />
          <div className="flex flex-col gap-2">
             <label className="text-sm font-bold text-text/90">选择继承与锚定的母树 Fandom</label>
             <select className="h-10 rounded-md border border-black/20 dark:border-white/20 bg-surface/80 px-3 text-sm focus:ring-2 focus:ring-accent outline-none w-full">
                <option>{selectedFandom}</option>
             </select>
          </div>
          <div className="flex flex-col gap-2">
             <label className="text-sm font-bold text-text/90">引擎与生成器初始化配置</label>
             <select className="h-10 rounded-md border border-black/20 dark:border-white/20 bg-surface/80 px-3 text-sm focus:ring-2 focus:ring-accent outline-none w-full">
                <option>承袭应用全局的默认写作模型配置</option>
                <option>独立挂载专用的特定微调模型 (后续在设定中变更)</option>
             </select>
          </div>
          <Button variant="primary" className="w-full h-10 mt-2 font-medium tracking-wide" onClick={handleCreateAu}>立即生成世界线</Button>
        </div>
      </Modal>

      <GlobalSettingsModal isOpen={isGlobalSettingsOpen} onClose={() => setGlobalSettingsOpen(false)} />

      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={deleteTarget?.type === 'fandom' ? '确认删除 Fandom' : '确认删除 AU'}>
        <div className="space-y-4">
          <p className="text-sm text-text/80 leading-relaxed">
            {deleteTarget?.type === 'fandom' ? (
              <>确定要删除 Fandom「<strong>{deleteTarget?.fandomName}</strong>」及其所有 AU 数据吗？此操作不可撤销。</>
            ) : (
              <>确定要删除 AU「<strong>{deleteTarget?.auName}</strong>」及其全部章节和设定吗？此操作不可撤销。</>
            )}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="primary" className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete}>确认删除</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
