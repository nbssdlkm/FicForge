import { useState, useEffect } from 'react';
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { Tag } from '../shared/Tag';
import { Search, Plus, FileText, ChevronDown, ChevronRight, Folder, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { getProject, updateProject, type ProjectInfo } from '../../api/project';
import { saveLore } from '../../api/lore';

export const AuLoreLayout = ({ auPath }: { auPath: string }) => {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    au_characters: true,
    au_oc: true,
    core_characters: true,
  });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');

  const [isSaving, setIsSaving] = useState(false);

  const handleSaveLore = async () => {
    if (!selectedFile || !project) return;
    setIsSaving(true);
    try {
      // Find category based on cast_registry
      let category = 'original_characters';
      if (project.cast_registry.au_specific.includes(selectedFile)) category = 'character_overrides';
      
      await saveLore({
        au_path: auPath,
        category,
        filename: `${selectedFile}.md`,
        content: editorContent
      });
      // Need a small toast here ideally, but for now we just unset saving
      setIsSaving(false);
    } catch (e: any) {
      alert("保存失败: " + e.message);
      setIsSaving(false);
    }
  };

  const handleCreateOc = async () => {
    const rawName = window.prompt("请输入新角色名 (如: John Doe)");
    if (!rawName || !rawName.trim()) return;
    
    const slug = rawName.trim().toLowerCase().replace(/\s+/g, '_');
    if (!project) return;
    
    setIsSaving(true);
    try {
      await saveLore({
        au_path: auPath,
        category: 'original_characters',
        filename: `${slug}.md`,
        content: `# ${rawName}\n\n[设定尚未编写]`
      });
      
      const newOcList = [...(project.cast_registry.oc || []), slug];
      await updateProject(auPath, {
        cast_registry: {
          ...project.cast_registry,
          oc: newOcList
        }
      });
      
      setProject({
        ...project,
        cast_registry: { ...project.cast_registry, oc: newOcList }
      });
      setSelectedFile(slug);
      setEditorContent(`# ${rawName}\n\n[设定尚未编写]`);
    } catch (e: any) {
      alert("创建失败: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!auPath) return;
    setLoading(true);
    getProject(auPath)
      .then(proj => {
        setProject(proj);
        // Auto-select first character if available
        const allChars = [
          ...(proj.cast_registry?.from_core || []),
          ...(proj.cast_registry?.au_specific || []),
          ...(proj.cast_registry?.oc || []),
        ];
        if (allChars.length > 0) {
          setSelectedFile(allChars[0]);
          setEditorContent(`# ${allChars[0]}\n\n角色设定尚未编写。点击保存后将生成对应的 .md 文件。`);
        }
      })
      .catch((e: any) => setError(e.message || '加载失败'))
      .finally(() => setLoading(false));
  }, [auPath]);

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => ({ ...prev, [folder]: !prev[folder] }));
  };

  const coreChars = project?.cast_registry?.from_core || [];
  const auChars = project?.cast_registry?.au_specific || [];
  const ocChars = project?.cast_registry?.oc || [];
  const auName = project?.name || auPath.split('/').pop() || 'AU';

  const renderFile = (name: string, isOverride: boolean = false) => (
    <div
      key={name}
      className={`flex items-center justify-between pl-6 pr-3 py-1.5 text-sm cursor-pointer rounded-md ${selectedFile === name ? 'bg-accent/10 text-accent font-medium' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5 hover:text-text'}`}
      onClick={() => { setSelectedFile(name); setEditorContent(`# ${name}\n\n（加载中或该角色的设定文件尚未创建）`); }}
    >
      <div className="flex items-center gap-2 overflow-hidden">
        <FileText size={14} className="opacity-50 shrink-0" />
        <span className="truncate">{name}.md</span>
      </div>
      {isOverride && <div title="此文件通过重载 (Override) 覆盖了 Fandom 层原文件"><RefreshCw size={12} className="text-warning shrink-0" /></div>}
    </div>
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-accent" size={32} />
      </div>
    );
  }

  return (
    <>
       <div className="w-[300px] md:w-[340px] shrink-0 border-r border-black/10 dark:border-white/10 flex flex-col bg-surface/50">
         <header className="p-4 border-b border-black/10 dark:border-white/10 flex flex-col gap-3 shrink-0 bg-surface">
           <div className="flex justify-between items-center">
             <div className="flex items-center gap-2">
                <h1 className="font-serif text-lg font-bold">✨ {auName} 设定库</h1>
             </div>
              <Button variant="ghost" size="sm" className="px-2" onClick={handleCreateOc} disabled={isSaving}>
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16}/>}
              </Button>
           </div>
           <div className="relative">
             <Search className="absolute left-2.5 top-2 text-text/50" size={14} />
             <Input className="pl-8 h-8 text-xs placeholder:text-xs" placeholder="搜索设定或角色名..." />
           </div>
         </header>

         <div className="flex-1 overflow-y-auto p-2 space-y-6 font-mono py-4">
           {error && (
             <div className="m-2 p-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded text-xs flex items-center gap-2">
               <AlertCircle size={14} /> {error}
             </div>
           )}

           {/* Core characters (inherited from Fandom) */}
           {coreChars.length > 0 && (
             <div className="space-y-2">
               <div className="px-3 pb-1 text-[11px] font-sans font-bold text-text/40 uppercase tracking-widest">
                 📚 Fandom 继承角色 ({coreChars.length})
               </div>
               <div>
                 <div className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/80 font-bold font-sans" onClick={() => toggleFolder('core_characters')}>
                   {expandedFolders['core_characters'] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                   <Folder size={14} className="text-accent" fill="currentColor" fillOpacity={0.2} />
                   <span>core_characters</span>
                 </div>
                 {expandedFolders['core_characters'] && (
                   <div className="mt-1 space-y-0.5">
                     {coreChars.map(name => renderFile(name, auChars.includes(name)))}
                   </div>
                 )}
               </div>
             </div>
           )}

           {/* AU-specific overrides */}
           {auChars.length > 0 && (
             <div className="space-y-2">
               <div className="px-3 pb-1 text-[11px] font-sans font-bold text-info uppercase tracking-widest">
                 ✨ AU 专属重载 ({auChars.length})
               </div>
               <div>
                 <div className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/80 font-bold font-sans" onClick={() => toggleFolder('au_characters')}>
                   {expandedFolders['au_characters'] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                   <Folder size={14} className="text-info" fill="currentColor" fillOpacity={0.2} />
                   <span>character_overrides</span>
                 </div>
                 {expandedFolders['au_characters'] && (
                   <div className="mt-1 space-y-0.5">
                     {auChars.map(name => renderFile(name, true))}
                   </div>
                 )}
               </div>
             </div>
           )}

           {/* OC characters */}
           {ocChars.length > 0 && (
             <div className="space-y-2">
               <div className="px-3 pb-1 text-[11px] font-sans font-bold text-success uppercase tracking-widest">
                 🌟 原创角色 OC ({ocChars.length})
               </div>
               <div>
                 <div className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/80 font-bold font-sans" onClick={() => toggleFolder('au_oc')}>
                   {expandedFolders['au_oc'] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                   <Folder size={14} className="text-success" fill="currentColor" fillOpacity={0.2} />
                   <span>original_characters</span>
                 </div>
                 {expandedFolders['au_oc'] && (
                   <div className="mt-1 space-y-0.5">
                     {ocChars.map(name => renderFile(name))}
                   </div>
                 )}
               </div>
             </div>
           )}

           {/* Empty state */}
           {coreChars.length === 0 && auChars.length === 0 && ocChars.length === 0 && (
             <p className="text-center text-text/40 text-xs py-10">角色注册表为空。请在设置中添加角色。</p>
           )}
         </div>
       </div>

       <div className="flex-1 flex flex-col bg-background relative">
          <header className="h-14 border-b border-black/10 dark:border-white/10 flex items-center px-6 justify-between shrink-0 bg-surface/30">
            {selectedFile ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold opacity-70">{selectedFile}.md</span>
                  {auChars.includes(selectedFile) && (
                    <Tag variant="warning" className="text-[10px]"><RefreshCw size={10} className="mr-1"/> AU Override</Tag>
                  )}
                </div>
                <div className="flex items-center gap-4">
                   <Button variant="primary" size="sm" className="h-8 w-20" onClick={handleSaveLore} disabled={isSaving}>
                     {isSaving ? <Loader2 size={14} className="animate-spin" /> : '保 存'}
                   </Button>
                </div>
              </>
            ) : (
              <span className="font-mono text-sm opacity-40">未选择文件</span>
            )}
          </header>

          <div className="flex-1 overflow-y-auto p-8 lg:p-12 w-full max-w-4xl mx-auto flex flex-col gap-6">
            {selectedFile ? (
              <>
                <div className="grid grid-cols-2 gap-6">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold text-text/90">标准译名 (Display Name)</label>
                    <Input defaultValue={selectedFile} className="h-10 font-sans text-base" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold text-text/90">别名 / 别称 (Aliases)</label>
                    <Input placeholder="用逗号分隔" className="h-10 font-sans" />
                    <p className="text-xs text-text/50">用逗号分隔文本。</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 flex-1">
                  <label className="text-sm font-bold text-text/90">Markdown 设定内容</label>
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
    </>
  );
};
