import { useState } from 'react';
import { Sidebar } from '../shared/Sidebar';
import { ThemeToggle } from '../shared/ThemeToggle';
import { Button } from '../shared/Button';
import { Tag } from '../shared/Tag';
import { SettingsPanel } from '../settings/SettingsPanel';
import { Undo2, LogOut, ChevronLeft, ChevronRight, Check } from 'lucide-react';

export const WriterLayout = ({ onNavigate }: { onNavigate: (page: string) => void }) => {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-background text-text font-sans transition-colors duration-200">
      
      {/* LEFT SIDEBAR: Chapters */}
      <Sidebar 
        position="left" 
        width="260px" 
        isCollapsed={leftCollapsed} 
        onToggle={() => setLeftCollapsed(!leftCollapsed)}
        className="flex flex-col"
      >
        <div className="p-4 border-b border-black/10 dark:border-white/10 flex items-center justify-between">
          <div className="font-serif font-bold text-lg">Cyberpunk AU</div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate('library')} className="h-8 w-8 p-0 rounded-full text-text/60 hover:text-text" title="Back to Library">
            <LogOut size={16} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {[1, 2, 3, 4, 5].map(ch => (
            <div key={ch} className={`px-3 py-2 rounded-md text-sm cursor-pointer transition-colors ${ch === 5 ? 'bg-accent/10 text-accent font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5 text-text/80'}`}>
              <div className="flex items-center gap-2">
                <span className="opacity-50 text-xs font-mono">#{ch}</span>
                <span className="truncate">雨夜，霓虹灯闪烁...</span>
              </div>
            </div>
          ))}
        </div>
      </Sidebar>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col min-w-0 bg-background relative transition-colors duration-200">
        
        {/* Top Metadata Bar */}
        <header className="h-12 flex items-center justify-between px-6 border-b border-black/5 dark:border-white/5 text-xs text-text/50">
          <div className="flex items-center gap-4">
            <span>deepseek-chat · T1.0</span>
            <span>1623 字</span>
            <span>8.3 秒</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>

        {/* Editor / Reading Area (Large padding for reading) */}
        <div className="flex-1 overflow-y-auto w-full flex justify-center pb-24">
          <div className="w-full max-w-2xl px-8 py-12 text-lg font-serif leading-loose text-text/90">
            <p className="mb-6 indent-8">
              雨水顺着酒吧的霓虹招牌滴落，在这座没有白昼的城市里，空气总是弥漫着机油与合成香精的混合气味。
            </p>
            <p className="mb-6 indent-8">
              他坐在角落的卡座里，机械义眼闪烁着微弱的蓝光。系统正在疯狂提示追踪器遭受干扰，但他早已不在乎。那枚残破的芯片就被紧紧攥在手心里，边缘锋利得近乎要割破皮肤。
            </p>
            <p className="mb-6 indent-8 opacity-70 border-l-2 border-accent/50 pl-4 italic">
              （这是最新草稿区的文字，尚未确认。文字呈现呼吸感的大面积留白，柔和的中性色背景保护视力。）
            </p>
          </div>
        </div>

        {/* Bottom Action Bar */}
        <footer className="absolute bottom-0 w-full shrink-0 border-t border-black/10 dark:border-white/10 p-4 bg-surface/50 backdrop-blur-md flex flex-col gap-3">
          
          {/* Draft Navigation (if in draft mode) */}
          <div className="flex items-center justify-between max-w-3xl w-full mx-auto">
            <div className="flex items-center gap-2">
               <Button variant="ghost" size="sm" className="h-8 px-2 text-text/60 hover:text-text"><ChevronLeft size={16}/> 上一稿</Button>
               <span className="text-xs font-sans text-text/50">草稿 2/3</span>
               <Button variant="ghost" size="sm" className="h-8 px-2 text-text/60 hover:text-text">下一稿 <ChevronRight size={16}/></Button>
            </div>
            <div className="flex items-center gap-2">
               <Button variant="ghost" size="sm" className="h-8 text-error/80 hover:text-error hover:bg-error/10">丢弃草稿</Button>
               <Button variant="secondary" size="sm" className="h-8">再生成一次</Button>
               <Button variant="primary" size="sm" className="h-8 gap-1"><Check size={16}/> 确认这一章</Button>
            </div>
          </div>

          {/* Main Action Bar */}
          <div className="flex items-center justify-between max-w-3xl w-full mx-auto mt-2 pt-2 border-t border-black/5 dark:border-white/5">
            <Button variant="ghost" size="sm" className="text-text/60 hover:text-text"><Undo2 size={16} className="mr-2"/> 撤销最新一章</Button>
            <div className="flex gap-3">
              <Button variant="secondary" className="w-32 shadow-medium">指令</Button>
              <Button variant="primary" className="w-32 shadow-medium">续写</Button>
            </div>
          </div>
        </footer>

      </main>

      {/* RIGHT SIDEBAR: Context & Settings */}
      <Sidebar 
        position="right" 
        width="320px" 
        isCollapsed={rightCollapsed} 
        onToggle={() => setRightCollapsed(!rightCollapsed)}
        className="flex flex-col bg-surface/50 border-l border-black/10 dark:border-white/10"
      >
        <div className="flex-1 overflow-y-auto p-5 space-y-8">
          
          {/* Chapter Focus */}
          <section>
            <h3 className="text-xs font-sans font-medium mb-3 text-text/70 tracking-wide uppercase">本章推进焦点</h3>
            <div className="space-y-1">
              <label className="flex items-start gap-2 p-2 rounded-md hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer border border-transparent hover:border-black/5 dark:hover:border-white/5 transition-colors">
                <input type="radio" name="focus" className="mt-1 accent-accent" defaultChecked />
                <span className="text-sm">自由发挥</span>
              </label>
              <label className="flex items-start gap-2 p-2 rounded-md hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer border border-transparent hover:border-black/5 dark:hover:border-white/5 transition-colors">
                <input type="radio" name="focus" className="mt-1 accent-accent" />
                <span className="text-sm">↩ 延续上章结尾情节</span>
              </label>
              <label className="flex items-start gap-2 p-2 rounded-md hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer border border-transparent hover:border-black/5 dark:hover:border-white/5 transition-colors">
                <input type="radio" name="focus" className="mt-1 accent-accent" />
                <div className="flex flex-col">
                  <span className="text-sm">前往废弃的地下工厂寻找线索</span>
                  <Tag variant="warning" className="mt-1.5 w-fit">Unresolved Fact</Tag>
                </div>
              </label>
            </div>
          </section>

          {/* Context Viualization */}
          <section>
            <h3 className="text-xs font-sans font-medium mb-3 text-text/70 tracking-wide uppercase">Context 可视化 (Mock)</h3>
            <div className="space-y-3">
              {[
                { layer: 'P0', label: 'Pinned', percent: 10, color: 'bg-error/70' },
                { layer: 'P1', label: '指令', percent: 15, color: 'bg-warning/70' },
                { layer: 'P2', label: '最近章节', percent: 35, color: 'bg-info/70' },
                { layer: 'P3', label: '事实表', percent: 20, color: 'bg-accent/70' },
                { layer: 'P4', label: 'RAG 召回', percent: 15, color: 'bg-success/70' },
                { layer: 'P5', label: '设定', percent: 5, color: 'bg-text/30' },
              ].map(item => (
                <div key={item.layer} className="flex items-center gap-2 text-xs">
                  <span className="w-6 font-mono text-text/50">{item.layer}</span>
                  <div className="flex-1 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden flex">
                    <div className={`${item.color} h-full`} style={{ width: `${item.percent}%` }} />
                  </div>
                  <span className="w-8 text-right text-text/50 font-mono">{item.percent}%</span>
                </div>
              ))}
            </div>
          </section>

          {/* Settings Inline Panel */}
          <section className="pt-4 border-t border-black/10 dark:border-white/10">
            <SettingsPanel />
          </section>

        </div>
      </Sidebar>

    </div>
  );
};
