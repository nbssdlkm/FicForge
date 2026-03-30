import { useState, useEffect } from 'react';
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { Modal } from '../shared/Modal';
import { Search, Plus, FileText, ChevronDown, ChevronRight, Folder, Loader2, AlertCircle, Trash2 } from 'lucide-react';
import { getProject, updateProject, type ProjectInfo } from '../../api/project';
import { saveLore, readLore, deleteLore } from '../../api/lore';

export const AuLoreLayout = ({ auPath }: { auPath: string }) => {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    characters: true,
  });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const loadFileContent = async (name: string) => {
    setSelectedFile(name);
    try {
      const result = await readLore({ au_path: auPath, category: 'characters', filename: `${name}.md` });
      setEditorContent(result.content || `# ${name}\n\n[设定尚未编写]`);
    } catch {
      setEditorContent(`# ${name}\n\n[设定尚未编写]`);
    }
  };

  const handleSaveLore = async () => {
    if (!selectedFile || !project) return;
    setIsSaving(true);
    try {
      await saveLore({
        au_path: auPath,
        category: 'characters',
        filename: `${selectedFile}.md`,
        content: editorContent
      });
      setIsSaving(false);
    } catch (e: any) {
      alert("保存失败: " + e.message);
      setIsSaving(false);
    }
  };

  const handleDeleteLore = async () => {
    if (!selectedFile || !project) return;

    setDeleteConfirmOpen(false);
    setIsSaving(true);
    try {
      await deleteLore({
        au_path: auPath,
        category: 'characters',
        filename: `${selectedFile}.md`,
      });

      // Update cast_registry
      const newList = project.cast_registry.characters.filter(n => n !== selectedFile);
      await updateProject(auPath, { cast_registry: { characters: newList } });
      setProject({ ...project, cast_registry: { characters: newList } });
      setSelectedFile(null);
      setEditorContent('');
    } catch (e: any) {
      alert("删除失败: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreate = async () => {
    const rawName = createName.trim();
    if (!rawName || !project) return;

    const slug = rawName.toLowerCase().replace(/\s+/g, '_');
    const defaultContent = `# ${rawName}\n\n[设定尚未编写]`;
    setCreateModalOpen(false);
    setIsSaving(true);
    try {
      await saveLore({
        au_path: auPath,
        category: 'characters',
        filename: `${slug}.md`,
        content: defaultContent,
      });

      const newList = [...(project.cast_registry.characters || []), slug];
      await updateProject(auPath, { cast_registry: { characters: newList } });
      setProject({ ...project, cast_registry: { characters: newList } });
      setSelectedFile(slug);
      setEditorContent(defaultContent);
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
        const chars = proj.cast_registry?.characters || [];
        if (chars.length > 0) {
          loadFileContent(chars[0]);
        }
      })
      .catch((e: any) => setError(e.message || '加载失败'))
      .finally(() => setLoading(false));
  }, [auPath]);

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => ({ ...prev, [folder]: !prev[folder] }));
  };

  const characters = project?.cast_registry?.characters || [];
  const auName = project?.name || auPath.split('/').pop() || 'AU';

  const renderFile = (name: string) => (
    <div
      key={name}
      className={`flex items-center justify-between pl-6 pr-3 py-1.5 text-sm cursor-pointer rounded-md ${selectedFile === name ? 'bg-accent/10 text-accent font-medium' : 'text-text/70 hover:bg-black/5 dark:hover:bg-white/5 hover:text-text'}`}
      onClick={() => loadFileContent(name)}
    >
      <div className="flex items-center gap-2 overflow-hidden">
        <FileText size={14} className="opacity-50 shrink-0" />
        <span className="truncate">{name}.md</span>
      </div>
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
                <h1 className="font-serif text-lg font-bold">{auName} 设定库</h1>
             </div>
              <Button variant="ghost" size="sm" className="px-2" onClick={() => { setCreateName(''); setCreateModalOpen(true); }} disabled={isSaving}>
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

           {/* Characters (unified — D-0022) */}
           <div className="space-y-2">
             <div className="px-3 pb-1 text-[11px] font-sans font-bold text-text/40 uppercase tracking-widest">
               角色 ({characters.length})
             </div>
             <div>
               <div className="flex items-center justify-between px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/80 font-bold font-sans" onClick={() => toggleFolder('characters')}>
                 <div className="flex items-center gap-2">
                   {expandedFolders['characters'] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                   <Folder size={14} className="text-accent" fill="currentColor" fillOpacity={0.2} />
                   <span>characters</span>
                 </div>
                 <Button variant="ghost" size="sm" className="p-0 h-6 w-6" onClick={(e) => { e.stopPropagation(); setCreateName(''); setCreateModalOpen(true); }}>
                   <Plus size={12} />
                 </Button>
               </div>
               {expandedFolders['characters'] && (
                 <div className="mt-1 space-y-0.5">
                   {characters.length === 0 ? (
                     <p className="text-xs text-text/40 pl-6 py-2">暂无角色。点击 + 创建。</p>
                   ) : (
                     characters.map(name => renderFile(name))
                   )}
                 </div>
               )}
             </div>
           </div>

           {/* Empty state */}
           {characters.length === 0 && (
             <p className="text-center text-text/40 text-xs py-10">角色注册表为空。点击 + 添加角色。</p>
           )}
         </div>
       </div>

       <div className="flex-1 flex flex-col bg-background relative">
          <header className="h-14 border-b border-black/10 dark:border-white/10 flex items-center px-6 justify-between shrink-0 bg-surface/30">
            {selectedFile ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold opacity-70">{selectedFile}.md</span>
                </div>
                <div className="flex items-center gap-4">
                   <Button variant="ghost" size="sm" className="h-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => setDeleteConfirmOpen(true)} disabled={isSaving}>
                     <Trash2 size={14} />
                   </Button>
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

       <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="新建角色">
         <div className="flex flex-col gap-4">
           <Input
             placeholder="角色名 (如: Connor、林小雨)"
             value={createName}
             onChange={e => setCreateName(e.target.value)}
             className="h-10"
             autoFocus
           />
           <div className="flex justify-end gap-2">
             <Button variant="ghost" onClick={() => setCreateModalOpen(false)}>取消</Button>
             <Button variant="primary" onClick={handleCreate} disabled={!createName.trim()}>创建</Button>
           </div>
         </div>
       </Modal>

       <Modal isOpen={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} title="确认删除设定文件">
         <div className="space-y-4">
           <p className="text-sm text-text/80">确定要删除「<strong>{selectedFile}.md</strong>」吗？此操作不可撤销。</p>
           <div className="flex justify-end gap-2">
             <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)}>取消</Button>
             <Button variant="primary" className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDeleteLore}>确认删除</Button>
           </div>
         </div>
       </Modal>
    </>
  );
};
