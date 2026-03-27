import { useState, useEffect } from 'react';
import { Card } from './shared/Card';
import { Button } from './shared/Button';
import { ThemeToggle } from './shared/ThemeToggle';
import { Settings, Plus, BookOpen, Clock, Loader2 } from 'lucide-react';
import { Modal } from './shared/Modal';
import { Input } from './shared/Input';
import { listFandoms, createFandom, createAu, type FandomInfo } from '../api/fandoms';

export const Library = ({ onNavigate }: { onNavigate: (page: string) => void }) => {
  const [isFandomModalOpen, setFandomModalOpen] = useState(false);
  const [isAuModalOpen, setAuModalOpen] = useState(false);
  const [fandoms, setFandoms] = useState<FandomInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newFandomName, setNewFandomName] = useState('');
  const [newAuName, setNewAuName] = useState('');
  const [selectedFandom, setSelectedFandom] = useState('');

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
      // 离线/未连接时显示空列表
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
    if (!newAuName.trim() || !selectedFandom) return;
    try {
      const fandomPath = `./fandoms/fandoms/${selectedFandom}`;
      await createAu(selectedFandom, newAuName.trim(), fandomPath);
      setAuModalOpen(false);
      setNewAuName('');
      await loadFandoms();
    } catch (e: any) {
      setError(e.message || '创建失败');
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
          <Button variant="ghost" size="sm" onClick={() => onNavigate('settings')} className="h-10 w-10 p-0 rounded-full" title="Settings">
            <Settings size={20} />
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-serif font-bold">作品库</h1>
          <Button onClick={() => setFandomModalOpen(true)}>
            <Plus size={16} className="mr-2" /> 新建 Fandom
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
                  <h2 className="text-xl font-sans font-semibold text-text/80">{fandom.name}</h2>
                  <Button variant="ghost" size="sm" onClick={() => { setSelectedFandom(fandom.name); setAuModalOpen(true); }}>
                    <Plus size={16} className="mr-2" /> 新建 AU
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {fandom.aus.length === 0 ? (
                    <p className="text-text/40 text-sm col-span-3">暂无 AU，点击上方按钮创建</p>
                  ) : (
                    fandom.aus.map(au => (
                      <Card key={au} className="hover:border-accent/50 cursor-pointer transition-colors" onClick={() => onNavigate('writer')}>
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

      <Modal isOpen={isFandomModalOpen} onClose={() => setFandomModalOpen(false)} title="新建 Fandom">
        <p className="text-sm text-text/70 mb-4">输入您的新 Fandom 名称。</p>
        <Input
          placeholder="例如：原神"
          value={newFandomName}
          onChange={(e) => setNewFandomName(e.target.value)}
          className="mb-4"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setFandomModalOpen(false)}>取消</Button>
          <Button onClick={handleCreateFandom}>创建</Button>
        </div>
      </Modal>

      <Modal isOpen={isAuModalOpen} onClose={() => setAuModalOpen(false)} title="新建 Alternate Universe (AU)">
        <p className="text-sm text-text/70 mb-4">在 {selectedFandom} 下创建新 AU。</p>
        <Input
          placeholder="例如：现代咖啡馆AU"
          value={newAuName}
          onChange={(e) => setNewAuName(e.target.value)}
          className="mb-4"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAuModalOpen(false)}>取消</Button>
          <Button onClick={handleCreateAu}>创建</Button>
        </div>
      </Modal>
    </div>
  );
};
