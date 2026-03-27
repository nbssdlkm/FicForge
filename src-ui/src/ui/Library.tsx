import { useState } from 'react';
import { Card } from './shared/Card';
import { Button } from './shared/Button';
import { ThemeToggle } from './shared/ThemeToggle';
import { Settings, Plus, BookOpen, Clock } from 'lucide-react';
import { Modal } from './shared/Modal';

export const Library = ({ onNavigate }: { onNavigate: (page: string) => void }) => {
  const [isFandomModalOpen, setFandomModalOpen] = useState(false);
  const [isAuModalOpen, setAuModalOpen] = useState(false);

  // Mock data
  const fandoms = [
    {
      id: 'f1', name: 'Original Universe: Sci-Fi', 
      aus: [
        { id: 'a1', name: 'Cyberpunk Detective AU', progress: 'Ch 5', lastEdit: '2 hours ago' },
      ]
    },
    {
      id: 'f2', name: 'Fantasy: The Broken Crown', 
      aus: [
        { id: 'a2', name: 'Coffee Shop AU', progress: 'Ch 12', lastEdit: 'Yesterday' },
        { id: 'a3', name: 'Dragon Rider AU', progress: 'Ch 2', lastEdit: '3 days ago' },
      ]
    }
  ];

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

        <div className="space-y-12">
          {fandoms.map(fandom => (
            <div key={fandom.id}>
              <div className="flex items-center justify-between mb-4 border-b border-black/10 dark:border-white/10 pb-2">
                <h2 className="text-xl font-sans font-semibold text-text/80">{fandom.name}</h2>
                <Button variant="ghost" size="sm" onClick={() => setAuModalOpen(true)}>
                  <Plus size={16} className="mr-2" /> 新建 AU
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {fandom.aus.map(au => (
                  <Card key={au.id} className="hover:border-accent/50 cursor-pointer transition-colors" onClick={() => onNavigate('writer')}>
                    <h3 className="text-lg font-sans font-medium mb-4">{au.name}</h3>
                    <div className="flex items-center justify-between text-sm text-text/60">
                      <span className="flex items-center gap-1"><BookOpen size={14}/> {au.progress}</span>
                      <span className="flex items-center gap-1"><Clock size={14}/> {au.lastEdit}</span>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>

      <Modal isOpen={isFandomModalOpen} onClose={() => setFandomModalOpen(false)} title="新建 Fandom">
        <p className="text-sm text-text/70 mb-4">输入您的新 Fandom 名称和基础设定。</p>
        <div className="h-32 flex items-center justify-center border-2 border-dashed border-black/10 dark:border-white/10 rounded-lg text-text/50">
          Modal Content Placeholder
        </div>
      </Modal>

      <Modal isOpen={isAuModalOpen} onClose={() => setAuModalOpen(false)} title="新建 Alternate Universe (AU)">
        <p className="text-sm text-text/70 mb-4">设定在此 AU 下的特殊规则。</p>
        <div className="h-32 flex items-center justify-center border-2 border-dashed border-black/10 dark:border-white/10 rounded-lg text-text/50">
          Modal Content Placeholder
        </div>
      </Modal>
    </div>
  );
};
