import { useState } from 'react';
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { Tag } from '../shared/Tag';
import { Search, Plus, ArrowLeft, FileText, ChevronDown, ChevronRight, Folder, Loader2 } from 'lucide-react';
import { saveLore } from '../../api/lore';

export const FandomLoreLayout = ({ fandomPath, onNavigate }: { fandomPath?: string, onNavigate: (page: string) => void }) => {
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    core_characters: true,
    worldbuilding: true,
  });

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const fandomName = fandomPath?.split('/').pop() || 'Unknown Fandom';

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => ({ ...prev, [folder]: !prev[folder] }));
  };

  const handleCreateGlobalLore = async () => {
    const rawName = window.prompt("请输入全局角色名 (如: Harry Potter)");
    if (!rawName || !rawName.trim()) return;
    
    const slug = rawName.trim().toLowerCase().replace(/\s+/g, '_');
    if (!fandomPath) return;
    
    setIsSaving(true);
    try {
      await saveLore({
        fandom_path: fandomPath,
        category: 'core_characters',
        filename: `${slug}.md`,
        content: `# ${rawName}\n\n[设定尚未编写]`
      });
      setSelectedFile(slug);
      setEditorContent(`# ${rawName}\n\n[设定尚未编写]`);
    } catch (e: any) {
      alert("创建失败: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveLore = async () => {
    if (!selectedFile || !fandomPath) return;
    setIsSaving(true);
    try {
      await saveLore({
        fandom_path: fandomPath,
        category: 'core_characters',  // Default to core characters for now
        filename: `${selectedFile}.md`,
        content: editorContent
      });
    } catch (e: any) {
      alert("保存失败: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <div className="flex h-screen bg-background text-text transition-colors duration-200 w-full overflow-hidden">
       <div className="w-[300px] md:w-[340px] shrink-0 border-r border-black/10 dark:border-white/10 flex flex-col bg-surface/50">
         <header className="p-4 border-b border-black/10 dark:border-white/10 flex flex-col gap-3 shrink-0 bg-surface">
           <div className="flex justify-between items-center">
             <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => onNavigate('library')} className="p-1 h-8 w-8 text-text/60 hover:text-text rounded-full">
                  <ArrowLeft size={18} />
                </Button>
                <h1 className="font-serif text-lg font-bold">{fandomName} 设定库</h1>
             </div>
             <Button variant="ghost" size="sm" className="px-2" onClick={handleCreateGlobalLore} disabled={isSaving}>
               {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16}/>}
             </Button>
           </div>
           <div className="relative">
             <Search className="absolute left-2.5 top-2 text-text/50" size={14} />
             <Input className="pl-8 h-8 text-xs placeholder:text-xs" placeholder="搜索文件或别称..." />
           </div>
         </header>

         <div className="flex-1 overflow-y-auto p-2 space-y-6 font-mono py-4">
           <div className="space-y-2">
             <div className="px-3 pb-1 text-[11px] font-sans font-bold text-text/40 uppercase tracking-widest flex justify-between items-center">
               <span>📚 根节点 Fandom 全局设定 (Global)</span>
             </div>
             <div>
               <div className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/80 font-bold font-sans" onClick={() => toggleFolder('core_characters')}>
                 {expandedFolders['core_characters'] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                 <Folder size={14} className="text-accent" fill="currentColor" fillOpacity={0.2} />
                 <span>core_characters</span>
               </div>
               {expandedFolders['core_characters'] && (
                 <div className="mt-1 space-y-0.5">
                   <p className="text-xs text-text/40 pl-6 py-2">设定文件由 Fandom 文件夹自动发现。<br/>尚未扫描到文件。</p>
                 </div>
               )}
             </div>
             <div>
               <div className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/80 font-bold font-sans" onClick={() => toggleFolder('worldbuilding')}>
                 {expandedFolders['worldbuilding'] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                 <Folder size={14} className="text-warning" fill="currentColor" fillOpacity={0.2} />
                 <span>worldbuilding</span>
               </div>
               {expandedFolders['worldbuilding'] && (
                 <div className="mt-1 space-y-0.5">
                   <p className="text-xs text-text/40 pl-6 py-2">暂无世界观设定文件。</p>
                 </div>
               )}
             </div>
           </div>
         </div>
       </div>

       <div className="flex-1 flex flex-col bg-background relative">
          <header className="h-14 border-b border-black/10 dark:border-white/10 flex items-center px-6 justify-between shrink-0 bg-surface/30">
            {selectedFile ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold opacity-70">{selectedFile}.md</span>
                  <Tag variant="success">Core Character</Tag>
                </div>
                <div className="flex items-center gap-4">
                   <span className="text-[11px] text-text/40 bg-black/5 dark:bg-white/5 px-2 py-1 rounded-md hidden xl:block">
                     ⚠️ Fandom 原著设定。保存将影响所有下属 AU 的基础记忆！
                   </span>
                   <Button variant="primary" size="sm" className="h-8 w-24" onClick={handleSaveLore} disabled={isSaving}>
                     {isSaving ? <Loader2 size={14} className="animate-spin" /> : '全局覆盖保存'}
                   </Button>
                </div>
              </>
            ) : (
              <span className="font-mono text-sm opacity-40">未选择设定文件</span>
            )}
          </header>

          <div className="flex-1 overflow-y-auto p-8 lg:p-12 w-full max-w-4xl mx-auto flex flex-col gap-6">
            {selectedFile ? (
              <>
                <div className="grid grid-cols-2 gap-6">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold text-text/90">标准译名 / 全名</label>
                    <Input defaultValue={selectedFile} className="h-10 font-sans text-base" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold text-text/90">别名 / 别称</label>
                    <Input placeholder="用逗号分隔" className="h-10 font-sans" />
                    <p className="text-xs text-text/50">用逗号分隔。</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 flex-1">
                  <label className="text-sm font-bold text-text/90">Markdown 纯文本设定基底</label>
                  <Textarea
                    value={editorContent}
                    onChange={e => setEditorContent(e.target.value)}
                    className="font-mono flex-1 min-h-[300px] text-sm leading-relaxed bg-surface/30 p-4 resize-y" 
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full opacity-30 mt-20">
                <FileText size={48} className="mb-4" />
                <p>在左侧列表中选择角色以编辑设定。</p>
              </div>
            )}
          </div>
       </div>
    </div>
  );
};
